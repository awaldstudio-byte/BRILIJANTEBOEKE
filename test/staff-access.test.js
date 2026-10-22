import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaffLoginHandler } from '../api/admin-login.js';
import { normaliseStaffEmail, validateNewStaffPassword, requestStaffCode, verifyStaffCode, staffCodeMessage, setStaffPassword, limitStaffRequest, beginStaffMfa, finishStaffMfa } from '../api/_lib/staff-onboarding.js';
import { parseCookies, cookie, sessionCookieAge, tokenHash, opaqueToken, loadStaffSession, authorisedStaff } from '../api/_lib/staff-session.js';
import { readJson } from '../api/_lib/http.js';

Object.assign(process.env, { APP_ORIGIN:'https://staff.example.test', SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SECRET_KEY:'test-only', SUPABASE_PUBLISHABLE_KEY:'test-only', ORDER_TOKEN_SECRET:'synthetic-test-secret-not-for-production', AUTH_MAIL_ENABLED:'true' });
const approval = { id:'approval', email:'technical@awaldstudio.com', auth_user_id:'user', active:true, role:'administrator',
  display_name:'Technical support', password_set_at:'2026-10-22', setup_completed_at:'2026-10-22' };
const secret = 'a'.repeat(64);
const record = { token_hash:tokenHash(secret), auth_user_id:'user', approval_id:'approval',kind:'ready',remember:true,
  expires_at:new Date(Date.now()+86400_000).toISOString(),revoked_at:null };
const user = { id:'user',email:approval.email,email_confirmed_at:'2026-10-22', factors:[{factor_type:'totp',status:'verified'}] };
function response() { return { headers:{},setHeader(key,value){this.headers[key]=value;},getHeader(key){return this.headers[key];},
  status(code){this.code=code;return this;},json(body){this.body=body;return this;} }; }
function database(tables = {}) {
  const calls=[]; const db={calls, rpc:async(name,args)=>{calls.push({name,args});return {data:name==='consume_staff_auth_limit'?true:[]};},from(table){
    const filters=[];let mutation,insert;
    const query={select(){return query;},eq(key,value){filters.push(row=>row[key]===value);return query;},
      neq(key,value){filters.push(row=>row[key]!==value);return query;},is(key,value){filters.push(row=>(row[key]??null)===value);return query;},
      update(value){mutation=value;return query;},insert(value){insert=value;return query;},upsert(value){insert=value;return query;},
      maybeSingle:async()=>{const result=await execute();return {...result,data:result.data[0]||null};},then(resolve,reject){return execute().then(resolve,reject);}};
    async function execute(){calls.push({table,mutation,insert});if(insert){(tables[table] ||= []).push({...insert});return {data:[]};}
      const rows=(tables[table]||[]).filter(row=>filters.every(filter=>filter(row)));if(mutation)rows.forEach(row=>Object.assign(row,mutation));return {data:rows};}
    return query;
  }};return db;
}
function auth({level='aal2',identity=user}={}) { return {auth:{getUser:async()=>({data:{user:identity}}),
  mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:level}})}}}; }

test('email normalisation does not approve domains or permit header injection',()=>{
  assert.equal(normaliseStaffEmail(' Technical@AWALDSTUDIO.com '),approval.email);
  assert.throws(()=>normaliseStaffEmail('a@example.com\r\nBcc: x@evil.test'));
});
test('password policy accepts long mixed passwords/passphrases and rejects weak/oversize values',()=>{
  for(const password of ['short','aaaaaaaaaaaaaaaa','abcdefghijklmnop','é'.repeat(40)]) assert.throws(()=>validateNewStaffPassword(password,approval.email));
  assert.equal(validateNewStaffPassword('Maple!River-Copper42',approval.email),'Maple!River-Copper42');
  assert.ok(validateNewStaffPassword('orchard lantern winter river velvet',approval.email));
});
test('cookies are HttpOnly Secure Strict; malformed cookie input never grants identity',()=>{
  assert.match(cookie('test','value'),/HttpOnly; SameSite=Strict; Secure/);
  assert.deepEqual(parseCookies('bad=%ZZ; ok=hello%20there'),{ok:'hello there'});
  assert.equal(tokenHash(opaqueToken()).length,64);
});
test('remembered cookies expire at the absolute session deadline, nonremembered ready cookies are session-only',()=>{
  const now=Date.now();const expires_at=new Date(now+30000).toISOString();
  assert.equal(sessionCookieAge({...record,expires_at},now),30);
  assert.equal(sessionCookieAge({...record,remember:false},now),undefined);
  assert.equal(sessionCookieAge({...record,kind:'verified',remember:false,expires_at},now),30);
  assert.equal(sessionCookieAge({...record,expires_at:new Date(now-1000).toISOString()},now),0);
});
test('provider tokens without an app session do not confer staff access',async()=>{
  const db=database();await assert.rejects(loadStaffSession({headers:{cookie:'bb_admin_access=token'}},response(),{database:db,auth:auth()}),{statusCode:401});
  assert.equal(db.calls.length,0);
});
test('expired, revoked, unknown and disabled app sessions are denied before provider use',async()=>{
  for(const change of [{expires_at:'2000-01-01'},{revoked_at:'2026-10-22'}]) {
    const db=database({staff_login_sessions:[{...record,...change}]});
    await assert.rejects(loadStaffSession({headers:{cookie:`bb_admin_sid=${secret}`}},response(),{database:db,auth:auth()}),{statusCode:401});
  }
  const db=database({staff_login_sessions:[record],staff_access_approvals:[{...approval,active:false}]});
  await assert.rejects(loadStaffSession({headers:{cookie:`bb_admin_sid=${secret}`}},response(),{database:db,auth:auth()}),{statusCode:401});
});
test('verified provider identity must match the approved email and app-session user',async()=>{
  const db=database({staff_login_sessions:[record],staff_access_approvals:[approval]});
  await assert.rejects(loadStaffSession({headers:{cookie:`bb_admin_sid=${secret}; bb_admin_access=token`}},response(),{database:db,auth:auth({identity:{...user,id:'stranger'}})}),{statusCode:401});
});
test('stage sessions and first-factor-only tokens cannot open protected staff APIs',async()=>{
  const db=database({staff_users:[{user_id:'user',display_name:'Technical',role:'administrator',active:true}]});
  for(const change of [{record:{...record,kind:'password'}},{auth:auth({level:'aal1'})},{user:{...user,factors:[]}},
    {approval:{...approval,setup_completed_at:null}}]) {
    await assert.rejects(authorisedStaff({database:db,auth:auth(),record,approval,user,accessToken:'token',...change}),{statusCode:401});
  }
});
test('verified MFA plus an approved role grants access without activating legacy preview permissions',async()=>{
  const db=database();
  const context={database:db,auth:auth(),record,approval,user,accessToken:'token'};
  assert.equal((await authorisedStaff(context)).role,'administrator');
  assert.equal(db.calls.length,0);
  await assert.rejects(authorisedStaff({...context,approval:{...approval,role:'viewer'}},['administrator']),{statusCode:401});
  await assert.rejects(authorisedStaff({...context,approval:{...approval,active:false}}),{statusCode:401});
});
test('setup request gives unknown and approved addresses the same public response and never emails unknown users',async()=>{
  let scheduled=0;const bodies=[];
  for(const known of [false,true]){
    const db=database({staff_access_approvals:known?[approval]:[]});const res=response();
    bodies.push(await requestStaffCode(db,res,known?approval.email:'unknown@briljanteboeke.co.za',false,()=>{scheduled++;},async()=>{}));
    assert.match(res.headers['Set-Cookie'][0],/^bb_setup_challenge=[a-f0-9]{64};/);
    const row=db.calls.find(call=>call.insert).insert;
    assert.match(row.token_hash,/^[a-f0-9]{64}$/);assert.equal('code' in row,false);
  }
  assert.deepEqual(bodies[0],bodies[1]);assert.equal(scheduled,1);
});
test('password creation requires the mailbox-verified stage, not a supplied email or password login',async()=>{
  await assert.rejects(setStaffPassword({record:{kind:'password'}},response(),'Maple!River-Copper42','Maple!River-Copper42'),{statusCode:401});
});
test('verification requires an opaque browser challenge before contacting the provider',async()=>{
  let verified=0;const provider={auth:{verifyOtp:async()=>{verified++;}}};
  await assert.rejects(verifyStaffCode(database(),provider,{headers:{}},response(),'12345678'),{statusCode:400});
  assert.equal(verified,0);
});
test('code messages use a fixed sender, no login URLs, no passwords and a bounded numeric code',()=>{
  const message=staffCodeMessage(approval.email,'12345678',{from:'orders@briljanteboeke.co.za',replyTo:'info@briljanteboeke.co.za'});
  assert.equal(message.to,approval.email);assert.equal(message.from.address,'orders@briljanteboeke.co.za');
  assert.doesNotMatch(message.text,/https?:\/\/|access_token|refresh_token|password=/);
  assert.throws(()=>staffCodeMessage(approval.email,'invalid',{from:'orders@briljanteboeke.co.za'}));
});
test('shared quota keys contain no raw email/IP and denial stops requests',async()=>{
  const db=database();await limitStaffRequest(db,{headers:{'x-vercel-forwarded-for':'192.0.2.1'}},'request-code',approval.email);
  for(const call of db.calls) assert.match(call.args.p_key,/^[a-f0-9]{64}$/);
  db.rpc=async()=>({data:false});await assert.rejects(limitStaffRequest(db,{headers:{}},'password',approval.email),{statusCode:429});
});
test('cross-site requests are rejected before any database/auth lookup',async()=>{
  const handler=createStaffLoginHandler({databaseFactory(){throw Error('must not run');}});const res=response();
  await handler({method:'POST',headers:{origin:'https://evil.test'},body:{}},res);assert.equal(res.code,403);
});
test('unknown and unconfigured approved accounts share the same password error without provider calls',async()=>{
  const results=[];
  for(const rows of [[],[{...approval,password_set_at:null}]]) {
    const db=database({staff_access_approvals:rows});const res=response();
    const handler=createStaffLoginHandler({databaseFactory:()=>db,authFactory:()=>({auth:{signInWithPassword(){throw Error('must not run');}}})});
    await handler({method:'POST',headers:{origin:process.env.APP_ORIGIN},body:{email:approval.email,password:'irrelevant'}},res);
    assert.equal(res.code,401);results.push(res.body);
  }
  assert.deepEqual(results[0],results[1]);
});
test('parsed JSON cannot bypass the request size limit',async()=>{
  await assert.rejects(readJson({body:{password:'x'.repeat(9000)}},8000),{statusCode:413});
});

test('existing verified authenticators are challenged and never removed or re-enrolled',async()=>{
  const provider={auth:{setSession:async()=>({data:{user,session:{access_token:'token'}}}),mfa:{
    listFactors:async()=>({data:{totp:[{id:'existing',status:'verified'}]}}),
    unenroll(){throw Error('must not remove verified factor');},enroll(){throw Error('must not replace verified factor');}
  }}};
  const result=await beginStaffMfa({auth:provider,user,approval,record:{...record,kind:'password'}});
  assert.deepEqual(result,{next:'mfa-code',factor_id:'existing',enrolling:false});
});

test('MFA completion never grants the legacy password-only preview directory',async()=>{
  const db=database({staff_access_approvals:[{...approval}],staff_login_sessions:[{...record}]});
  const provider=auth();
  provider.auth.setSession=async()=>({data:{user,session:{access_token:'token'}}});
  provider.auth.mfa.challengeAndVerify=async()=>({data:{access_token:'token',refresh_token:'refresh'}});
  const result=await finishStaffMfa({database:db,auth:provider,user,approval,record:{...record,kind:'password'},secret},response(),'11111111-1111-1111-1111-111111111111','123456');
  assert.equal(result.next,'dashboard');
  assert.ok(db.calls.every(call=>call.table!=='staff_users'));
});

test('MFA result without provider-confirmed aal2 cannot activate staff access',async()=>{
  const db=database();const provider=auth({level:'aal1'});
  provider.auth.setSession=async()=>({data:{user,session:{access_token:'token'}}});
  provider.auth.mfa.challengeAndVerify=async()=>({data:{access_token:'token',refresh_token:'refresh'}});
  await assert.rejects(finishStaffMfa({database:db,auth:provider,user,approval,record:{...record,kind:'password'}},response(),'11111111-1111-1111-1111-111111111111','123456'),{statusCode:401});
  assert.equal(db.calls.length,0);
});
