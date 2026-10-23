import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { schoolAccess, schoolOrderLink, paymentReadiness } from '../assets/school-links.js';
import { createPublicSchoolHandler } from '../api/public-school.js';
import { sha256 } from '../api/_lib/crypto.js';
import orders from '../api/orders.js';
import { createSchoolSaveHandler } from '../api/admin-schools.js';

const token = 'ABCDE-23456';
const clock = Date.parse('2026-10-23T08:00:00Z');
const school = { id: 's', slug: 'test-school-1', name: 'Test School 1', status: 'active' };
const period = { id: 'p', status: 'open', opens_at: '2026-10-01T00:00:00Z', closes_at: '2026-12-01T00:00:00Z' };
function fixture({ schoolOverride = {}, periodOverride = {}, accessOverride = {}, missingAccess = false } = {}) {
  const tables = {
    school_access: missingAccess ? [] : [{ school_id: 's', ordering_period_id: 'p', token_hash: sha256(token), expires_at: period.closes_at, revoked_at: null, ...accessOverride }],
    schools: [{ ...school, ...schoolOverride }],
    ordering_periods: [{ ...period, school_id: 's', ...periodOverride }],
    school_grade_offerings: [{ id: 'o', school_id: 's', ordering_period_id: 'p', active: true, price_cents: 32000, grades: { code: '1' }, books: { title: 'Grade 1 Workbook' } }],
  };
  const reads = [];
  return { reads, from(table) {
    reads.push(table); const filters = [];
    const run = () => ({ data: tables[table].filter(row => filters.every(([key, value]) => row[key] === value)), error: null });
    const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, order() { return query; },
      async maybeSingle() { const result = run(); return { ...result, data: result.data[0] ?? null }; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); } };
    return query;
  } };
}
function response() { return { status(code) { this.code = code; return this; }, setHeader() {}, json(body) { this.body = body; return this; } }; }
async function lookup(options = {}, query = { token, identifier: school.slug }, paymentReady = false) {
  const db = fixture(options), res = response();
  await createPublicSchoolHandler({ databaseFactory: () => db, configuration: () => ({}), now: () => clock,
    checkPayments() { if (!paymentReady) throw Error('Not configured'); } })({ method: 'GET', query }, res);
  return { res, db };
}

test('identifiers are included in links without replacing their private code', () => {
  const link = schoolOrderLink('https://example.test/', school.slug, token);
  assert.deepEqual(schoolAccess(new URL(link).search), { identifier: school.slug, token });
  assert.equal(new URL(link).searchParams.get('lang'), 'en');
  assert.deepEqual(schoolAccess(new URL(schoolOrderLink('https://example.test', school.slug, '', 'af')).search), { identifier: school.slug, token: '' });
});
test('existing token links and manually entered codes retain compatibility', () => {
  assert.equal(schoolAccess(`?school=${token}&lang=en`).token, token);
  assert.equal(schoolAccess(`?code=${token}`).token, token);
});
test('open school details can be read while payments remain disabled', async () => {
  const { res } = await lookup();
  assert.equal(res.code, 200); assert.equal(res.body.period.open, true); assert.equal(res.body.payments_enabled, false);
  assert.equal(res.body.offerings.length, 1); assert.equal(res.body.school.slug, school.slug);
});
test('configured payments are reported separately from school availability', async () => {
  const { res } = await lookup({}, undefined, true);
  assert.equal(res.body.period.open, true); assert.equal(res.body.payments_enabled, true);
});
test('draft, closed, future and past periods and inactive schools are not made open by the change', async () => {
  for (const options of [{ periodOverride: { status: 'draft' } }, { periodOverride: { status: 'closed' } },
    { periodOverride: { opens_at: '2026-11-01T00:00:00Z' } }, { periodOverride: { closes_at: '2026-10-22T00:00:00Z' } },
    { schoolOverride: { status: 'inactive' } }]) {
    const { res } = await lookup(options); assert.equal(res.code, 200); assert.equal(res.body.period.open, false);
  }
});
test('a wrong school identifier cannot use another school code', async () => {
  const { res, db } = await lookup({}, { token, identifier: 'another-school' });
  assert.equal(res.code, 404); assert.equal(res.body.school, undefined); assert.ok(!db.reads.includes('school_grade_offerings'));
});
test('identifier-only, malformed, invalid, revoked and expired access is denied', async () => {
  for (const [options, query] of [[{}, { identifier: school.slug }], [{}, { token, identifier: '../school' }],
    [{}, { token: 'WRONG-23456' }], [{ missingAccess: true }, { token }],
    [{ accessOverride: { revoked_at: '2026-10-22' } }, { token }],
    [{ accessOverride: { expires_at: '2026-10-22T00:00:00Z' } }, { token }]]) {
    const { res } = await lookup(options, query); assert.equal(res.code, 404); assert.equal(res.body.school, undefined);
  }
});
test('legacy links are not required to supply an identifier', async () => {
  assert.equal((await lookup({}, { token })).res.code, 200);
});
test('payment readiness defaults closed; demo never enables real submission', () => {
  for (const config of [undefined, {}, { payments_enabled: false }, { payments_enabled: 'true' }]) assert.equal(paymentReadiness(config).enabled, false);
  assert.equal(paymentReadiness({ payments_enabled: true }).enabled, true);
});
test('client guard does not send an order when payment is unavailable, even if invoked directly', async () => {
  const source = await readFile(new URL('../assets/order-app.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('async function startPayment()'), source.indexOf('function submitExternalForm('));
  const button = {}, message = {}; let requests = 0;
  const context = vm.createContext({ preview: false, state: { config: { payments_enabled: false } }, paymentReadiness,
    $: selector => selector === '#pay-button' ? button : message, paymentUnavailableMessage: () => 'Unavailable', api: () => { requests++; throw Error('Must not submit'); } });
  vm.runInContext(fn, context); await vm.runInContext('startPayment()', context);
  assert.equal(requests, 0); assert.equal(button.disabled, true); assert.equal(message.textContent, 'Unavailable');
  assert.doesNotMatch(source, /if \(!preview && !state\.config\.payments_enabled\) throw/);
});
test('server still refuses a direct order submission without configured PayFast', async () => {
  const names = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'ORDER_TOKEN_SECRET', 'APP_ORIGIN', 'PAYFAST_MERCHANT_ID'];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) process.env[name] = name === 'PAYFAST_MERCHANT_ID' ? '' : 'test-only';
  try {
    const res = response();
    await orders({ method: 'POST', body: { school_token: token, request_id: '550e8400-e29b-41d4-a716-446655440000',
      parent: { first_name: 'Test', last_name: 'Parent', email: 'test@example.test', mobile: '0820000000' },
      consent: { accepted: true, policy_version: '2026-10-20' },
      learners: [{ first_name: 'Test', last_name: 'Child', offering_id: '2de1d6a7-02b5-41e0-b9ee-b276c4d65041' }] } }, res);
    assert.equal(res.code, 503); assert.equal(res.body.order, undefined);
  } finally { for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; } }
});

test('school saves reject malformed identifiers and clearly report duplicate identifiers', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const body = { school: { name: 'Test School', slug: school.slug, status: 'active' },
    period: { academic_year_id: id, name: 'Parent orders', opens_at: period.opens_at, closes_at: period.closes_at, status: 'open' },
    offerings: [{ grade_id: id, book_id: id, price_cents: 32000, expected_quantity: 5 }] };
  let inserts = 0;
  const handler = createSchoolSaveHandler({ checkOrigin() {}, authorize: async () => ({ user: { id }, staff: { role: 'administrator' } }),
    databaseFactory: () => ({ from(table) {
      const query = { select() { return query; }, in() { return query; }, insert() { inserts++; return query; },
        async single() { return { error: { code: '23505', message: 'duplicate' } }; },
        then(resolve) { return Promise.resolve({ data: [{ id, grade_id: id }], error: null }).then(resolve); } };
      assert.ok(['books', 'schools'].includes(table)); return query;
    } }) });
  const invalid = response(); await handler({ body: { ...body, school: { ...body.school, slug: '../bad' } } }, invalid);
  assert.equal(invalid.code, 400); assert.equal(inserts, 0);
  const duplicate = response(); await handler({ body }, duplicate);
  assert.equal(duplicate.code, 409); assert.match(duplicate.body.error, /identifier is already in use/); assert.equal(inserts, 1);
});
