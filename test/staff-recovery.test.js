import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaffLoginHandler } from '../api/admin-login.js';
import { requestStaffRecovery, verifyStaffCode, setStaffPassword, staffMfaOptions, finishStaffMfa, skipStaffMfa,
  beginStaffMfa, limitStaffRequest, deliverStaffCode, staffCodeMessage } from '../api/_lib/staff-onboarding.js';
import { tokenHash, loadStaffSession, authorisedStaff } from '../api/_lib/staff-session.js';

Object.assign(process.env, { APP_ORIGIN: 'https://staff.example.test', SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'synthetic-test-only', SUPABASE_PUBLISHABLE_KEY: 'synthetic-test-only', ORDER_TOKEN_SECRET: 'synthetic-recovery-test-secret', AUTH_MAIL_ENABLED: 'true' });
const secret = 'a'.repeat(64);
const email = 'staff@example.test';
const password = 'Maple!River-Copper42';
const factorId = '11111111-1111-4111-8111-111111111111';
const future = () => new Date(Date.now() + 900_000).toISOString();
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, getHeader(key) { return this.headers[key]; },
  status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

function database(tables, failure = () => null) {
  const calls = [];
  return { calls, tables, async rpc(name, args) {
    calls.push({ name, args });
    if (name === 'consume_staff_auth_limit') return { data: true };
    if (name === 'consume_staff_setup_attempt') {
      const row = (tables.staff_setup_challenges || []).find(row => row.token_hash === args.p_hash && row.status === 'sent' && row.attempts < 5 && Date.parse(row.expires_at) > Date.now());
      if (!row) return { data: [] };
      row.attempts++;
      return { data: [{ approval_id: row.approval_id, auth_user_id: row.auth_user_id, remember: row.remember }] };
    }
    throw Error('Unexpected RPC');
  }, from(table) {
    const filters = []; let mutation, inserted;
    const query = {
      select() { return query; }, eq(key, value) { filters.push(row => row[key] === value); return query; },
      neq(key, value) { filters.push(row => row[key] !== value); return query; },
      is(key, value) { filters.push(row => (row[key] ?? null) === value); return query; },
      gt(key, value) { filters.push(row => row[key] > value); return query; },
      update(value) { mutation = value; return query; }, insert(value) { inserted = value; return query; },
      async maybeSingle() { const result = await execute(); return { ...result, data: result.error ? null : result.data[0] || null }; },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    async function execute() {
      const call = { table, mutation, inserted }; calls.push(call);
      const error = failure(call); if (error) return { error, data: null };
      if (inserted) { (tables[table] ||= []).push({ ...inserted }); return { data: [] }; }
      const rows = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
      if (mutation) rows.forEach(row => Object.assign(row, mutation));
      return { data: rows };
    }
    return query;
  } };
}

function fixture({ enrolled = false, level = 'aal1', failure, providerFailure } = {}) {
  const approval = { id: 'approval', email, active: true, auth_user_id: 'user', password_set_at: '2026-10-22', setup_completed_at: '2026-10-22', role: 'administrator', display_name: 'Synthetic staff' };
  const user = { id: 'user', email, email_confirmed_at: '2026-10-22', factors: enrolled ? [{ id: factorId, factor_type: 'totp', status: 'verified' }] : [] };
  const record = { token_hash: tokenHash(secret), approval_id: approval.id, auth_user_id: user.id, kind: 'verified', remember: false, expires_at: future(), revoked_at: null };
  const previous = { ...record, token_hash: 'b'.repeat(64), kind: 'ready' };
  const unrelated = { ...previous, token_hash: 'c'.repeat(64), auth_user_id: 'other-user' };
  const tables = { staff_access_approvals: [approval], staff_login_sessions: [record, previous, unrelated], staff_setup_challenges: [] };
  const db = database(tables, failure);
  const events = [];
  let assurance = level;
  const session = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', user };
  const auth = { auth: {
    setSession: async () => ({ data: { user, session } }), getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session } }),
    signOut: async options => { events.push(`signOut:${options.scope}`); return providerFailure === 'signOut' ? { error: Error('synthetic provider failure') } : {}; },
    updateUser: async () => { events.push('updateUser'); return providerFailure === 'updateUser' ? { error: Error('synthetic provider failure') } : { data: { user } }; },
    verifyOtp: async values => { events.push(`verifyOtp:${values.type}`); return { data: { user, session } }; },
    mfa: {
      listFactors: async () => ({ data: { all: user.factors } }),
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: assurance } }),
      challengeAndVerify: async () => { assurance = 'aal2'; events.push('mfa-verified'); return { data: session }; },
      enroll() { throw Error('Recovery must not enroll an authenticator'); },
      unenroll() { throw Error('Recovery must not remove an authenticator'); },
    },
  } };
  return { database: db, auth, approval, user, record, previous, unrelated, secret, accessToken: session.access_token, refreshToken: session.refresh_token, events, session };
}

test('recovery requests give identical generic responses and opaque cookies for configured, unknown, inactive and first-time addresses', async () => {
  const results = [];
  for (const mode of ['configured', 'unknown', 'inactive', 'first-time']) {
    const context = fixture();
    if (mode === 'unknown') context.database.tables.staff_access_approvals = [];
    if (mode === 'inactive') context.approval.active = false;
    if (mode === 'first-time') context.approval.password_set_at = null;
    const jobs = []; const deliveries = []; const res = response();
    results.push(await requestStaffRecovery(context.database, res, email, true, job => jobs.push(job), async (_db, approved) => deliveries.push(approved.id)));
    assert.match(res.headers['Set-Cookie'][0], /^bb_setup_challenge=[a-f0-9]{64};.*HttpOnly; SameSite=Strict; Secure; Max-Age=900$/);
    assert.equal(jobs.length, 1);
    await Promise.all(jobs);
    assert.equal(deliveries.length, mode === 'configured' ? 1 : 0);
    assert.equal(context.database.tables.staff_setup_challenges.length, mode === 'configured' ? 1 : 0);
  }
  for (const result of results) assert.deepEqual(result, results[0]);
});

test('recovery HTTP requests retain same-origin protection and shared setup/recovery rate limits', async () => {
  const context = fixture(); context.database.tables.staff_access_approvals = [];
  const jobs = [];
  const handler = createStaffLoginHandler({ databaseFactory: () => context.database, authFactory: () => context.auth, schedule: job => jobs.push(job) });
  const denied = response();
  await handler({ method: 'POST', headers: { origin: 'https://evil.test' }, body: { action: 'request-recovery', email } }, denied);
  assert.equal(denied.code, 403); assert.equal(context.database.calls.length, 0);
  const accepted = response();
  await handler({ method: 'POST', headers: { origin: process.env.APP_ORIGIN }, body: { action: 'request-recovery', email } }, accepted);
  assert.equal(accepted.code, 200); assert.equal(accepted.body.next, 'code'); await Promise.all(jobs);
  const setup = fixture(), recovery = fixture();
  const req = { headers: { 'x-vercel-forwarded-for': '192.0.2.1' } };
  await limitStaffRequest(setup.database, req, 'request-code', email);
  await limitStaffRequest(recovery.database, req, 'request-recovery', email);
  assert.deepEqual(setup.database.calls.map(call => call.args), recovery.database.calls.map(call => call.args));
  context.database.rpc = async () => ({ data: false });
  const limited = response();
  await handler({ method: 'POST', headers: { origin: process.env.APP_ORIGIN }, body: { action: 'request-recovery', email } }, limited);
  assert.equal(limited.code, 429);
});

test('existing accounts use provider recovery OTPs while first-time setup retains email OTPs', async () => {
  for (const recovery of [true, false]) {
    const context = fixture(); if (!recovery) context.approval.password_set_at = null;
    const challenge = { token_hash: tokenHash(secret), approval_id: 'approval', auth_user_id: 'user', status: 'sent', attempts: 0, expires_at: future(), remember: false };
    context.database.tables.staff_setup_challenges.push(challenge);
    const res = response();
    const result = await verifyStaffCode(context.database, context.auth, { headers: { cookie: `bb_setup_challenge=${secret}` } }, res, '12345678');
    assert.equal(result.next, recovery ? 'recovery' : 'new-password');
    assert.deepEqual(context.events, [`verifyOtp:${recovery ? 'recovery' : 'email'}`]);
    assert.equal(challenge.status, 'used');
    assert.equal(context.database.tables.staff_login_sessions.at(-1).kind, 'verified');
    await assert.rejects(verifyStaffCode(context.database, context.auth, { headers: { cookie: `bb_setup_challenge=${secret}` } }, response(), '12345678'), { statusCode: 400 });
    assert.equal(context.events.length, 1, 'a used challenge never reaches provider verification again');
  }
});

test('expired or exhausted recovery challenges clear their cookie without contacting the provider', async () => {
  for (const change of [{ expires_at: '2000-01-01' }, { attempts: 5 }]) {
    const context = fixture();
    context.database.tables.staff_setup_challenges.push({ token_hash: tokenHash(secret), approval_id: 'approval', auth_user_id: 'user', status: 'sent', attempts: 0, expires_at: future(), ...change });
    const res = response();
    await assert.rejects(verifyStaffCode(context.database, context.auth, { headers: { cookie: `bb_setup_challenge=${secret}` } }, res, '12345678'), { statusCode: 400 });
    assert.equal(context.events.length, 0); assert.match(res.headers['Set-Cookie'][0], /Max-Age=0$/);
  }
});

test('an existing authenticator cannot be bypassed through direct password, skip or new-enrolment requests', async () => {
  const context = fixture({ enrolled: true });
  assert.deepEqual(await staffMfaOptions(context, response()), { next: 'mfa-code', factor_id: factorId, enrolling: false, can_skip: false, recovery: true });
  await assert.rejects(setStaffPassword(context, response(), password, password), { statusCode: 409 });
  await assert.rejects(skipStaffMfa(context, response()), { statusCode: 401 });
  await assert.rejects(beginStaffMfa(context), { statusCode: 401 });
  await assert.rejects(authorisedStaff(context), { statusCode: 401 });
  assert.equal(context.events.length, 0); assert.equal(context.record.revoked_at, null);
});

test('recovery MFA permits password selection only and preserves the factor and stage deadline', async () => {
  const context = fixture({ enrolled: true }); const res = response(); const deadline = context.record.expires_at;
  assert.deepEqual(await finishStaffMfa(context, res, factorId, '123456'), { next: 'new-password', recovery: true });
  assert.equal(context.record.kind, 'verified'); assert.equal(context.record.expires_at, deadline);
  assert.equal(context.database.calls.length, 0); assert.equal(context.user.factors.length, 1);
  await assert.rejects(authorisedStaff(context), { statusCode: 401 });
  assert.deepEqual(await setStaffPassword(context, response(), password, password), { next: 'mfa' });
  assert.equal(context.user.factors[0].id, factorId);
  assert.deepEqual(context.events, ['mfa-verified', 'signOut:others', 'updateUser']);
});

test('password reset revokes existing application/provider sessions and creates a new short password stage', async () => {
  const context = fixture();
  assert.deepEqual(await staffMfaOptions(context, response()), { next: 'new-password', recovery: true });
  const res = response();
  assert.deepEqual(await setStaffPassword(context, res, password, password), { next: 'mfa' });
  assert.ok(context.record.revoked_at); assert.ok(context.previous.revoked_at); assert.equal(context.unrelated.revoked_at, null);
  const created = context.database.tables.staff_login_sessions.at(-1);
  assert.equal(created.kind, 'password'); assert.notEqual(created.token_hash, context.record.token_hash);
  assert.ok(Date.parse(created.expires_at) - Date.now() <= 900_000);
  assert.deepEqual(context.events, ['signOut:others', 'updateUser']);
  assert.ok(res.headers['Set-Cookie'].some(value => /^bb_admin_sid=;.*Max-Age=0$/.test(value)));
  await assert.rejects(setStaffPassword(context, response(), password, password), { statusCode: 401 });
  assert.equal(context.events.filter(event => event === 'updateUser').length, 1);
});

test('concurrent password mutations cannot consume the same verified session twice', async () => {
  const context = fixture();
  const results = await Promise.allSettled([setStaffPassword(context, response(), password, password), setStaffPassword(context, response(), password, password)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(context.events.filter(event => event === 'updateUser').length, 1);
  assert.equal(context.database.tables.staff_login_sessions.filter(record => record.kind === 'password').length, 1);
});

test('application-session revocation failure prevents any provider credential mutation', async () => {
  const context = fixture({ failure: call => call.table === 'staff_login_sessions' && call.mutation && !call.inserted && call.mutation.revoked_at && context.record.revoked_at ? Error('synthetic revocation failure') : null });
  await assert.rejects(setStaffPassword(context, response(), password, password));
  assert.deepEqual(context.events, []);
  assert.equal(context.database.tables.staff_login_sessions.filter(record => record.kind === 'password').length, 0);
});

test('provider revocation or password failure never creates a usable replacement app session', async () => {
  for (const providerFailure of ['signOut', 'updateUser']) {
    const context = fixture({ providerFailure }); const res = response();
    await assert.rejects(setStaffPassword(context, res, password, password));
    assert.ok(context.record.revoked_at); assert.ok(context.previous.revoked_at);
    assert.equal(context.database.tables.staff_login_sessions.filter(record => record.kind === 'password').length, 0);
    assert.ok(res.headers['Set-Cookie'].every(value => /Max-Age=0$/.test(value)));
    if (providerFailure === 'signOut') assert.equal(context.events.includes('updateUser'), false);
    await assert.rejects(setStaffPassword(context, response(), password, password), { statusCode: 401 });
  }
});

test('expired verified sessions and freshly changed identities fail before password mutation', async () => {
  for (const mode of ['expired', 'identity', 'disabled']) {
    const context = fixture();
    if (mode === 'expired') context.record.expires_at = '2000-01-01';
    if (mode === 'identity') context.auth.auth.getUser = async () => ({ data: { user: { ...context.user, id: 'another-user' } } });
    if (mode === 'disabled') context.approval.active = false;
    await assert.rejects(setStaffPassword(context, response(), password, password), { statusCode: 401 });
    assert.deepEqual(context.events, []);
  }
  const context = fixture(); context.record.expires_at = '2000-01-01'; const res = response();
  await assert.rejects(loadStaffSession({ headers: { cookie: `bb_admin_sid=${secret}` } }, res, { database: context.database, auth: context.auth }), { statusCode: 401 });
  assert.ok(res.headers['Set-Cookie'].every(value => /Max-Age=0$/.test(value)));
});

test('recovery delivery requests the native existing-user OTP type and retains approved branded instructions', async () => {
  const context = fixture();
  const challenge = { token_hash: 'd'.repeat(64), status: 'queued', expires_at: future() };
  context.database.tables.staff_setup_challenges.push(challenge);
  context.database.auth = { admin: { generateLink: async values => { assert.equal(values.type, 'recovery'); return { data: { user: context.user, properties: { email_otp: '12345678' } } }; } } };
  let delivered;
  await deliverStaffCode(context.database, context.approval, challenge.token_hash, { source: { AUTH_MAIL_ENABLED: 'true', MAIL_FROM: 'orders@briljanteboeke.co.za', MAIL_REPLY_TO: 'info@briljanteboeke.co.za',
    SMTP_HOST: 'smtp.purelymail.com', SMTP_PORT: '465', SMTP_USER: 'orders@briljanteboeke.co.za', SMTP_PASSWORD: 'synthetic-test-only' },
    transportFactory: () => ({ sendMail: async message => { delivered = message; return { accepted: [email] }; }, close() {} }) });
  assert.equal(challenge.status, 'sent'); assert.match(delivered.subject, /password recovery/);
  assert.match(delivered.html, /existing authenticator will still be required/); assert.match(delivered.html, /bestaande verifikasie-app/);
  assert.doesNotMatch(delivered.html, /access_token|refresh_token|password=/);
  const ordinary = staffCodeMessage(email, '12345678', { from: 'orders@briljanteboeke.co.za', replyTo: 'info@briljanteboeke.co.za' });
  assert.match(ordinary.subject, /account verification/);
});
