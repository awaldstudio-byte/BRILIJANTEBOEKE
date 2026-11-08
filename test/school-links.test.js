import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { schoolAccess, schoolOrderLink, paymentReadiness } from '../assets/school-links.js';
import { createPublicSchoolHandler } from '../api/public-school.js';
import { sha256 } from '../api/_lib/crypto.js';
import orders, { createOrderHandler } from '../api/orders.js';
import { resolveSchoolOrdering } from '../api/_lib/school-ordering.js';
import { demoSchoolId } from '../api/_lib/demo-payment.js';
import { createSchoolSaveHandler } from '../api/admin-schools.js';

const token = 'ABCDE-23456';
const clock = Date.parse('2026-10-23T08:00:00Z');
const school = { id: '11111111-1111-4111-8111-111111111111', slug: 'test-school-1', name: 'Test School 1', status: 'active' };
const period = { id: '22222222-2222-4222-8222-222222222222', status: 'open', opens_at: '2026-10-01T00:00:00Z', closes_at: '2026-12-01T00:00:00Z' };
function fixture({ schoolOverride = {}, periodOverride = {}, accessOverride = {}, missingAccess = false } = {}) {
  const tables = {
    school_access: missingAccess ? [] : [{ school_id: school.id, ordering_period_id: period.id, token_hash: sha256(token), expires_at: period.closes_at, revoked_at: null, ...accessOverride }],
    schools: [{ ...school, ...schoolOverride }],
    ordering_periods: [{ ...period, school_id: school.id, ...periodOverride }],
    school_grade_offerings: [{ id: 'o', school_id: school.id, ordering_period_id: period.id, active: true, price_cents: 32000, grades: { code: '1' }, books: { title: 'Grade 1 Workbook' } }],
  };
  const reads = [];
  return { reads, tables, from(table) {
    reads.push(table); const filters = [];
    const run = () => ({ data: tables[table].filter(row => filters.every(([key, value]) => row[key] === value)), error: null });
    const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, is(key,value) { return query.eq(key,value); }, order() { return query; },
      async maybeSingle() { const result = run(); return { ...result, data: result.data[0] ?? null }; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); } };
    return query;
  } };
}
function response() { return { status(code) { this.code = code; return this; }, setHeader() {}, json(body) { this.body = body; return this; } }; }
async function lookup(options = {}, query = { token, identifier: school.slug }, paymentReady = false) {
  const db = fixture(options), res = response();
  await createPublicSchoolHandler({ databaseFactory: () => db, configuration: () => ({}), now: () => clock, source:{VERCEL_ENV:'production'},
    checkPayments() { if (!paymentReady) throw Error('Not configured'); } })({ method: 'GET', query }, res);
  return { res, db };
}

test('school links contain only their identifier, optional period and language, never access codes', () => {
  const link = schoolOrderLink('https://example.test/', school.slug, 'en', period.id);
  assert.deepEqual(schoolAccess(new URL(link).search), { identifier: school.slug, token: '', periodId: period.id });
  assert.equal(new URL(link).searchParams.get('lang'), 'en');
  assert.deepEqual(schoolAccess(new URL(schoolOrderLink('https://example.test', school.slug, 'af')).search), { identifier: school.slug, token: '', periodId: '' });
  assert.equal(new URL(link).searchParams.has('code'),false); assert.equal(new URL(link).searchParams.has('school'),false);
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
test('malformed, invalid, revoked and expired legacy access is denied', async () => {
  for (const [options, query] of [[{}, {}], [{}, { token, identifier: '../school' }],
    [{}, { token: 'WRONG-23456' }], [{ missingAccess: true }, { token }],
    [{ accessOverride: { revoked_at: '2026-10-22' } }, { token }],
    [{ accessOverride: { expires_at: '2026-10-22T00:00:00Z' } }, { token }]]) {
    const { res } = await lookup(options, query); assert.equal(res.code, 404); assert.equal(res.body.school, undefined);
  }
});

test('identifier-only catalogue access needs no code and discloses no private records or internal hash', async () => {
  const {res,db}=await lookup({}, {identifier:school.slug});
  assert.equal(res.code,200); assert.equal(res.body.period.open,true); assert.equal(res.body.period.id,period.id);
  assert.deepEqual(db.reads,['schools','ordering_periods','school_grade_offerings']);
  assert.doesNotMatch(JSON.stringify(res.body),/token_hash|parent|learners|expected_quantity|contact_email/);
});
test('unknown schools, inactive schools and a period from another school fail closed',async()=>{
  for(const [options,query] of [[{},{identifier:'unknown-school'}],
    [{schoolOverride:{status:'inactive'}},{identifier:school.slug}],
    [{periodOverride:{school_id:'other-school'}},{identifier:school.slug,period:period.id}]]) {
    const {res}=await lookup(options,query); assert.equal(res.code,404); assert.equal(res.body.school,undefined);
  }
});
test('generic school link prefers an open period; a year-specific link never jumps to another year',async()=>{
  const db=fixture();
  const future={...db.tables.ordering_periods[0],id:'33333333-3333-4333-8333-333333333333',opens_at:'2027-01-01',closes_at:'2027-12-01'};
  db.tables.ordering_periods.unshift(future);
  assert.equal((await resolveSchoolOrdering(db,{identifier:school.slug},clock)).period.id,period.id);
  const pinned=await resolveSchoolOrdering(db,{identifier:school.slug,periodId:future.id},clock);
  assert.equal(pinned.period.id,future.id); assert.equal(pinned.open,false);
});
test('direct school order resolves the correct internal RPC hash and ignores injected prices/hashes',async()=>{
  const db=fixture(); let rpcCount=0,params;
  db.rpc=async(name,body)=>{rpcCount++; assert.equal(name,'create_school_order');params=body;
    return {data:{reused:false,reference:'BB-TEST',amount_cents:32000,status:'pending_payment'}};};
  const handler=createOrderHandler({source:{VERCEL_ENV:'production'},databaseFactory:()=>db,configuration:()=>({orderTokenSecret:'test-only-secret'}),checkPayments:config=>config,now:()=>clock,guardTraffic:async()=>{},guardSubmission:async()=>{}});
  const input={school_identifier:school.slug,ordering_period_id:period.id,token_hash:'injected',amount_cents:1,
    request_id:'550e8400-e29b-41d4-a716-446655440000',parent:{first_name:'Test',last_name:'Parent',email:'test@example.test',mobile:'0820000000'},
    consent:{accepted:true,policy_version:'2026-10-20'},learners:[{first_name:'Test',last_name:'Child',offering_id:'2de1d6a7-02b5-41e0-b9ee-b276c4d65041'}]};
  const res=response();await handler({method:'POST',body:input},res);
  assert.equal(res.code,201);assert.equal(rpcCount,1);assert.equal(params.p_token_hash,sha256(token));
  assert.equal(params.amount_cents,undefined);assert.equal(res.body.order.amount_cents,32000);
  assert.equal(JSON.stringify(res.body).includes(sha256(token)),false);
  for(const change of [{ordering_period_id:'33333333-3333-4333-8333-333333333333'},{school_identifier:'other-school'}]){
    const denied=response();await handler({method:'POST',body:{...input,...change}},denied);assert.equal(denied.code,404);assert.equal(rpcCount,1);
  }
  db.tables.ordering_periods[0].status='closed';
  const closed=response();await handler({method:'POST',body:input},closed);assert.equal(closed.code,400);assert.equal(rpcCount,1);
});
test('legacy links are not required to supply an identifier', async () => {
  assert.equal((await lookup({}, { token })).res.code, 200);
});
test('live test school catalogue and order creation are denied for both link types', async () => {
  for (const query of [{identifier:school.slug}, {token}]) {
    const db=fixture();
    db.tables.schools[0].id=demoSchoolId;
    for (const table of ['ordering_periods','school_access','school_grade_offerings']) db.tables[table][0].school_id=demoSchoolId;
    let mutations=0;
    db.rpc=async()=>{ mutations++; throw new Error('Must not create an order'); };
    const read=response();
    await createPublicSchoolHandler({databaseFactory:()=>db,configuration:()=>({payfastMode:'live'}),checkPayments:x=>x,now:()=>clock,source:{VERCEL_ENV:'production'}})({method:'GET',query},read);
    assert.equal(read.code,404);
    assert.ok(!db.reads.includes('school_grade_offerings'));
    const body={...(query.token?{school_token:token}:{school_identifier:school.slug,ordering_period_id:period.id}),
      request_id:'550e8400-e29b-41d4-a716-446655440000',parent:{first_name:'Test',last_name:'Parent',email:'test@example.test',mobile:'0820000000'},
      consent:{accepted:true,policy_version:'2026-10-20'},learners:[{first_name:'Test',last_name:'Child',offering_id:'2de1d6a7-02b5-41e0-b9ee-b276c4d65041'}]};
    const res=response();
    await createOrderHandler({source:{VERCEL_ENV:'production'},databaseFactory:()=>db,configuration:()=>({payfastMode:'live',orderTokenSecret:'test-only-secret'}),checkPayments:x=>x,now:()=>clock,guardTraffic:async()=>{},guardSubmission:async()=>{}})({method:'POST',body},res);
    assert.equal(res.code,404); assert.equal(mutations,0);
  }
});
test('preview with live credentials cannot advertise or create a live order',async()=>{
  const db=fixture(), source={VERCEL_ENV:'preview'};
  const read=response();await createPublicSchoolHandler({source,databaseFactory:()=>db,configuration:()=>({payfastMode:'live'}),checkPayments:x=>x,now:()=>clock})({method:'GET',query:{identifier:school.slug}},read);
  assert.equal(read.code,200); assert.equal(read.body.payments_enabled,false);
  let databases=0;const handler=createOrderHandler({source,configuration:()=>({payfastMode:'live'}),checkPayments:x=>x,databaseFactory(){databases++;}});
  const body={school_identifier:school.slug,ordering_period_id:period.id,request_id:'550e8400-e29b-41d4-a716-446655440000',parent:{first_name:'Test',last_name:'Parent',email:'test@example.test',mobile:'0820000000'},consent:{accepted:true,policy_version:'2026-10-20'},learners:[{first_name:'Test',last_name:'Child',offering_id:'2de1d6a7-02b5-41e0-b9ee-b276c4d65041'}]};
  const res=response();await handler({method:'POST',body},res);assert.equal(res.code,403);assert.equal(databases,0);
});
test('restricted preview can view the test school but cannot enable live payments',async()=>{
  const db=fixture(); db.tables.schools[0].id=demoSchoolId;
  for(const table of ['ordering_periods','school_access','school_grade_offerings']) db.tables[table][0].school_id=demoSchoolId;
  const source={DEMO_PAYMENTS_ENABLED:'true',VERCEL_ENV:'preview',APP_ORIGIN:'https://briljante-preview-awaldstudio.vercel.app',SUPABASE_URL:'https://cigyxjfzbjlgbrduzcpw.supabase.co'};
  const res=response();
  await createPublicSchoolHandler({databaseFactory:()=>db,configuration:()=>({payfastMode:'live'}),checkPayments:x=>x,now:()=>clock,source})({method:'GET',query:{identifier:school.slug}},res);
  assert.equal(res.code,200); assert.equal(res.body.payments_enabled,false);
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
