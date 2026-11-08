import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaffLoginHandler } from '../api/admin-login.js';
import { assertStaffEnvironmentEmail } from '../api/_lib/staff-environment.js';
import { loadStaffSession, tokenHash } from '../api/_lib/staff-session.js';
import { verifyStaffCode, deliverStaffCode, requestStaffRecovery, setStaffPassword, beginStaffMfa, skipStaffMfa, finishStaffMfa } from '../api/_lib/staff-onboarding.js';

const preview = { VERCEL_ENV: 'preview', APP_ORIGIN: 'https://briljante-preview-awaldstudio.vercel.app', SUPABASE_URL: 'https://cigyxjfzbjlgbrduzcpw.supabase.co', DEMO_PAYMENTS_ENABLED: 'true', AUTH_MAIL_ENABLED: 'true', SUPABASE_SECRET_KEY: 'synthetic', SUPABASE_PUBLISHABLE_KEY: 'synthetic', ORDER_TOKEN_SECRET: 'synthetic-preview-isolation-secret' };
const secret = 'a'.repeat(64), factor = '11111111-1111-4111-8111-111111111111';
const future = () => new Date(Date.now() + 900_000).toISOString();
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, getHeader(key) { return this.headers[key]; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
async function inEnvironment(source, run) {
  const prior = Object.fromEntries(Object.keys(preview).map(key => [key, process.env[key]]));
  Object.assign(process.env, preview, source);
  try { return await run(); } finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
function fixture(email = 'real-staff@example.test') {
  const approval = { id: 'approval', email, auth_user_id: 'user', active: true, role: 'administrator', password_set_at: '2026-10-22', setup_completed_at: '2026-10-22' };
  const record = { token_hash: tokenHash(secret), approval_id: approval.id, auth_user_id: 'user', kind: 'ready', remember: false, expires_at: future(), revoked_at: null };
  const challenge = { token_hash: tokenHash(secret), approval_id: approval.id, auth_user_id: 'user', status: 'sent', attempts: 0, expires_at: future() };
  const tables = { staff_access_approvals: [approval], staff_login_sessions: [record], staff_setup_challenges: [challenge] }, calls = [], providerCalls = [];
  const database = { calls, tables, async rpc(name, args) {
    calls.push({ rpc: name });
    if (name === 'consume_staff_auth_limit') return { data: true };
    if (name === 'consume_staff_setup_attempt') {
      const row = tables.staff_setup_challenges.find(row => row.token_hash === args.p_hash && row.status === 'sent' && row.attempts < 5 && Date.parse(row.expires_at) > Date.now());
      if (!row) return { data: [] };
      row.attempts++;
      return { data: [{ approval_id: row.approval_id, auth_user_id: row.auth_user_id, remember: false }] };
    }
    throw Error('Unexpected RPC');
  }, from(table) {
    const filters = []; let mutation, insert;
    const query = { select() { return query; }, eq(key, value) { filters.push(row => row[key] === value); return query; }, neq(key, value) { filters.push(row => row[key] !== value); return query; }, is(key, value) { filters.push(row => (row[key] ?? null) === value); return query; }, gt(key, value) { filters.push(row => row[key] > value); return query; }, update(value) { mutation = value; return query; }, insert(value) { insert = value; return query; }, async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] || null }; }, then(resolve, reject) { return execute().then(resolve, reject); } };
    async function execute() { calls.push({ table, mutation, insert }); if (insert) { (tables[table] ||= []).push({ ...insert }); return { data: [] }; } const rows = (tables[table] || []).filter(row => filters.every(filter => filter(row))); if (mutation) rows.forEach(row => Object.assign(row, mutation)); return { data: rows }; }
    return query;
  } };
  const user = { id: 'user', email, email_confirmed_at: '2026-10-22', factors: [] }, session = { user, access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' };
  const auth = { auth: { getUser: async () => { providerCalls.push('getUser'); return { data: { user } }; }, refreshSession: async () => { providerCalls.push('refresh'); return { data: { user, session } }; }, signInWithPassword: async () => { providerCalls.push('password'); return { data: { user, session } }; }, verifyOtp: async () => { providerCalls.push('otp'); return { data: { user, session } }; }, setSession: async () => { providerCalls.push('setSession'); return { data: { user, session } }; } } };
  return { database, auth, approval, record, challenge, providerCalls, user, session, accessToken: session.access_token, refreshToken: session.refresh_token, secret };
}
const oldCookies = `bb_admin_sid=${secret}; bb_admin_access=synthetic-access; bb_admin_refresh=synthetic-refresh`;
const request = body => ({ method: 'POST', headers: { origin: process.env.APP_ORIGIN, cookie: oldCookies }, body });
const writes = context => context.database.calls.filter(call => call.mutation || call.insert);

test('preview identity restriction requires its exact project, origin and enabled test configuration', () => {
  assert.doesNotThrow(() => assertStaffEnvironmentEmail('technical@awaldstudio.com', preview));
  for (const source of [{ ...preview, APP_ORIGIN: 'https://another-preview.test' }, { ...preview, SUPABASE_URL: 'https://other.supabase.co' }, { ...preview, DEMO_PAYMENTS_ENABLED: 'false' }]) assert.throws(() => assertStaffEnvironmentEmail('technical@awaldstudio.com', source), { statusCode: 403 });
  assert.throws(() => assertStaffEnvironmentEmail('real-staff@example.test', preview), { statusCode: 403 });
  assert.doesNotThrow(() => assertStaffEnvironmentEmail('real-staff@example.test', { VERCEL_ENV: 'production' }));
});

test('preview login, setup and recovery reject real staff before quotas, provider calls or writes', async () => inEnvironment({}, async () => {
  for (const action of ['email-check', 'password', 'request-code', 'request-recovery']) {
    const context = fixture(), jobs = [], res = response(), handler = createStaffLoginHandler({ databaseFactory: () => context.database, authFactory: () => context.auth, schedule: job => jobs.push(job) });
    await handler(request({ action, email: context.approval.email, password: 'synthetic' }), res);
    assert.equal(res.code, 403); assert.deepEqual(context.database.calls, []); assert.deepEqual(context.providerCalls, []); assert.deepEqual(jobs, []);
  }
}));

test('an incorrectly configured preview fails before constructing a database or authentication client', async () => inEnvironment({ DEMO_PAYMENTS_ENABLED: 'false' }, async () => {
  const res = response(), handler = createStaffLoginHandler({ databaseFactory() { throw Error('must not construct database'); }, authFactory() { throw Error('must not construct auth'); } });
  await handler(request({ action: 'password', email: 'technical@awaldstudio.com', password: 'synthetic' }), res);
  assert.equal(res.code, 403);
}));

test('an existing real staff preview session is denied before token validation or refresh and cleared locally', async () => inEnvironment({}, async () => {
  const context = fixture(), res = response();
  await assert.rejects(loadStaffSession({ headers: { cookie: oldCookies } }, res, context), { statusCode: 403 });
  assert.deepEqual(context.providerCalls, []); assert.equal(writes(context).length, 0); assert.equal(context.record.revoked_at, null);
  assert.ok(res.headers['Set-Cookie'].every(value => /Max-Age=0$/.test(value)));
}));

test('existing real staff sessions cannot reach password, MFA or staff status routes on preview', async () => inEnvironment({}, async () => {
  for (const action of ['status', 'new-password', 'mfa-options', 'mfa-begin', 'mfa-verify', 'mfa-skip']) {
    const context = fixture(), res = response(), handler = createStaffLoginHandler({ databaseFactory: () => context.database, authFactory: () => context.auth });
    await handler(request({ action, password: 'Maple!River-Copper42', confirmation: 'Maple!River-Copper42', factor_id: factor, code: '123456' }), res);
    assert.equal(res.code, 403); assert.deepEqual(context.providerCalls, []); assert.equal(writes(context).length, 0); assert.equal(context.record.revoked_at, null);
  }
}));

test('preview rejects a real staff challenge before consuming an attempt or verifying its OTP', async () => inEnvironment({}, async () => {
  const context = fixture();
  await assert.rejects(verifyStaffCode(context.database, context.auth, { headers: { cookie: `bb_setup_challenge=${secret}` } }, response(), '12345678'), { statusCode: 403 });
  assert.equal(context.challenge.attempts, 0); assert.equal(context.challenge.status, 'sent'); assert.equal(context.database.calls.some(call => call.rpc), false); assert.equal(writes(context).length, 0); assert.deepEqual(context.providerCalls, []);
}));

test('an earlier queued real staff delivery cannot generate codes, send mail or mutate its challenge on preview', async () => inEnvironment({}, async () => {
  const context = fixture();
  await deliverStaffCode(context.database, context.approval, tokenHash(secret), { source: preview, transportFactory() { throw Error('must not construct mail transport'); } });
  assert.deepEqual(context.database.calls, []); assert.deepEqual(context.providerCalls, []); assert.equal(context.challenge.status, 'sent');
}));

test('preview logout clears a disallowed old login without revoking its shared real staff session', async () => inEnvironment({}, async () => {
  const context = fixture(), res = response(), handler = createStaffLoginHandler({ databaseFactory: () => context.database, authFactory: () => context.auth });
  await handler({ method: 'DELETE', headers: { origin: process.env.APP_ORIGIN, cookie: oldCookies } }, res);
  assert.equal(res.code, 200); assert.equal(context.record.revoked_at, null); assert.equal(writes(context).length, 0); assert.deepEqual(context.providerCalls, []);
}));

test('the dedicated technical preview account retains password login and mailbox-code verification', async () => inEnvironment({}, async () => {
  const context = fixture('technical@awaldstudio.com'), res = response(), handler = createStaffLoginHandler({ databaseFactory: () => context.database, authFactory: () => context.auth });
  await handler(request({ action: 'password', email: context.approval.email, password: 'synthetic' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.next, 'mfa'); assert.deepEqual(context.providerCalls, ['password']);
  const verified = await verifyStaffCode(context.database, context.auth, { headers: { cookie: `bb_setup_challenge=${secret}` } }, response(), '12345678');
  assert.equal(verified.next, 'recovery'); assert.equal(context.challenge.status, 'used'); assert.equal(context.challenge.attempts, 1); assert.equal(context.database.tables.staff_login_sessions.at(-1).kind, 'verified');
}));

test('the dedicated technical preview account can refresh its existing session', async () => inEnvironment({}, async () => {
  const context = fixture('technical@awaldstudio.com');
  const loaded = await loadStaffSession({ headers: { cookie: `bb_admin_sid=${secret}; bb_admin_refresh=synthetic-refresh` } }, response(), context);
  assert.equal(loaded.user.email, context.approval.email); assert.deepEqual(context.providerCalls, ['refresh']); assert.equal(writes(context).length, 0);
}));

test('production preserves real staff recovery, code verification and logout', async () => inEnvironment({ VERCEL_ENV: 'production', APP_ORIGIN: 'https://www.briljanteboeke.co.za', DEMO_PAYMENTS_ENABLED: 'false' }, async () => {
  const context = fixture(), jobs = [], deliveries = [];
  const recovery = await requestStaffRecovery(context.database, response(), context.approval.email, false, job => jobs.push(job), async (_db, approval) => deliveries.push(approval.email));
  await Promise.all(jobs);
  assert.equal(recovery.next, 'code'); assert.deepEqual(deliveries, [context.approval.email]);
  const verified = await verifyStaffCode(context.database, context.auth, { headers: { cookie: `bb_setup_challenge=${secret}` } }, response(), '12345678');
  assert.equal(verified.next, 'recovery'); assert.equal(context.challenge.status, 'used'); assert.deepEqual(context.providerCalls, ['otp']);
  const res = response(), handler = createStaffLoginHandler({ databaseFactory: () => context.database, authFactory: () => context.auth });
  await handler({ method: 'DELETE', headers: { origin: process.env.APP_ORIGIN, cookie: oldCookies } }, res);
  assert.equal(res.code, 200); assert.ok(context.record.revoked_at);
}));

test('direct credential helpers cannot attach a real staff provider session on preview', async () => inEnvironment({}, async () => {
  for (const invoke of [context => setStaffPassword({ ...context, record: { ...context.record, kind: 'verified' } }, response(), 'Maple!River-Copper42', 'Maple!River-Copper42'), context => beginStaffMfa(context), context => skipStaffMfa({ ...context, record: { ...context.record, kind: 'password' } }, response()), context => finishStaffMfa(context, response(), factor, '123456')]) {
    const context = fixture(); await assert.rejects(invoke(context), { statusCode: 403 }); assert.deepEqual(context.providerCalls, []); assert.equal(writes(context).length, 0);
  }
}));
