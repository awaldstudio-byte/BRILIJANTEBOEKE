import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxEnvironment, requireSandboxAccess, canSandboxPay, isSandboxOrder, assertPaymentEnvironment } from '../api/_lib/sandbox-payment.js';
import { createSandboxOrderHandler } from '../api/_lib/sandbox-order-handler.js';
import { createOrderHandler } from '../api/orders.js';
import { demoSchoolId, demoOrigin, demoStaffEmail } from '../api/_lib/demo-payment.js';
import { requirePayFast } from '../api/_lib/env.js';
const source = { DEMO_PAYMENTS_ENABLED:'true',PAYFAST_SANDBOX_TESTS_ENABLED:'true',PAYFAST_MODE:'sandbox',VERCEL_ENV:'preview',APP_ORIGIN:demoOrigin,SUPABASE_URL:'https://cigyxjfzbjlgbrduzcpw.supabase.co' };
const order = {school_id:demoSchoolId,reference:'DEMO-BB-26-ABC12345',idempotency_key:'sandbox:request-1234567890',parent_email:demoStaffEmail};
const response=()=>({status(n){this.code=n;return this;},json(body){this.body=body;return this;},setHeader(){}});
test('sandbox activation requires every explicit preview, origin, database and mode boundary',()=>{
  assert.equal(sandboxEnvironment(source),true);
  for(const key of Object.keys(source)) assert.equal(sandboxEnvironment({...source,[key]:'wrong'}),false,key);
  assert.equal(sandboxEnvironment({...source,VERCEL_ENV:'production'}),false);
});
test('both public PayFast sandbox merchant accounts remain forbidden in live mode',()=>{
  for(const payfastMerchantId of ['10000100','10004002']) assert.throws(()=>requirePayFast({payfastMode:'live',payfastLiveEnabled:true,payfastMerchantId,payfastMerchantKey:'public-test-key',payfastPassphrase:'public-test-passphrase',appOrigin:demoOrigin}),{statusCode:503});
});
test('sandbox access retains technical staff authorization and same-origin mutation checks',async()=>{
  let options;
  const access=async(_req,_res,opts)=>{options=opts;return {user:{id:'technical'}};};
  assert.equal((await requireSandboxAccess({},response(),{source,access})).user.id,'technical');
  assert.equal(options.mutation,true);
  await assert.rejects(requireSandboxAccess({},response(),{source:{...source,VERCEL_ENV:'production'},access}),{statusCode:403});
  assert.equal(await canSandboxPay({},response(),{id:demoSchoolId},{source,access:async()=>{throw Error();}}),false);
  assert.equal(await canSandboxPay({},response(),{id:'another-school'},{source,access}),false);
});
test('sandbox callbacks cannot touch real, legacy demo, other-school or other-recipient orders',()=>{
  assert.equal(isSandboxOrder(order),true);
  assert.doesNotThrow(()=>assertPaymentEnvironment(order,'sandbox',source));
  for(const changed of [{school_id:'another-school'},{reference:'BB-26-ABC12345'},{idempotency_key:'demo:request'},{parent_email:'parent@example.com'}]){
    assert.throws(()=>assertPaymentEnvironment({...order,...changed},'sandbox',source),{statusCode:403});
  }
  assert.throws(()=>assertPaymentEnvironment(order,'live',source),{statusCode:403});
  assert.doesNotThrow(()=>assertPaymentEnvironment({...order,reference:'BB-26-ABC12345',idempotency_key:'normal-request'},'live',source));
});
const body={confirm_sandbox:true,school_identifier:'test-school-1',ordering_period_id:'22222222-2222-4222-8222-222222222222',request_id:'33333333-3333-4333-8333-333333333333',parent:{first_name:'Sandbox',last_name:'Parent',email:demoStaffEmail,mobile:'0820000000'},consent:{accepted:true,policy_version:'2026-10-20'},learners:[{first_name:'Fictional',last_name:'Learner',offering_id:'44444444-4444-4444-8444-444444444444',class_name:''}]};
function database({allow=true}={}){
  const calls=[];
  return {calls,from(table){const rows=table==='schools'?[{id:demoSchoolId,slug:'test-school-1',status:'active'}]:table==='ordering_periods'?[{id:body.ordering_period_id,school_id:demoSchoolId,status:'open',opens_at:'2026-01-01',closes_at:'2026-12-31'}]:[{token_hash:'a'.repeat(64),expires_at:'2026-12-31'}];
    return {select(){return this;},eq(){return this;},is(){return this;},order(){return this;},maybeSingle(){return {data:rows[0]};},then(resolve){resolve({data:rows});}};},
    async rpc(name,args){calls.push({name,args});return name==='consume_staff_auth_limit'?{data:allow}:{data:{id:'order',reference:order.reference,status:'pending_payment',amount_cents:32000,reused:false}};}};
}
test('sandbox order creation stays pending and calls only atomic test RPC with stable private token',async()=>{
  const db=database();const tokens=[];
  const handler=createSandboxOrderHandler({access:async()=>({user:{id:'technical'}}),databaseFactory:()=>db,configuration:()=>({payfastMode:'sandbox',orderTokenSecret:'test-secret'}),checkPayments:x=>x,now:()=>Date.parse('2026-10-26')});
  for(let i=0;i<2;i++){const res=response();await handler({},res,body);assert.equal(res.code,201);assert.equal(res.body.order.status,'pending_payment');tokens.push(res.body.order.access_token);}
  assert.equal(tokens[0],tokens[1]);
  for(const call of db.calls.filter(x=>x.name!=='consume_staff_auth_limit')){assert.equal(call.name,'create_sandbox_school_order');assert.equal(call.args.p_idempotency_key,'sandbox:'+body.request_id);assert.equal(call.args.p_parent.email,demoStaffEmail);assert.match(call.args.p_order_access_hash,/^[a-f0-9]{64}$/);assert.notEqual(call.args.p_order_access_hash,tokens[0]);}
});
test('sandbox denies foreign mailboxes and exhausted quotas before creating an order',async()=>{
  for(const [input,allow,status] of [[{...body,parent:{...body.parent,email:'parent@example.com'}},true,403],[body,false,429]]){
    const db=database({allow}),res=response();await createSandboxOrderHandler({access:async()=>({user:{id:'technical'}}),databaseFactory:()=>db,configuration:()=>({payfastMode:'sandbox'}),checkPayments:x=>x,now:()=>Date.parse('2026-10-26')})({},res,input);
    assert.equal(res.code,status);assert.equal(db.calls.some(x=>x.name==='create_sandbox_school_order'),false);
  }
});
test('ordinary guest submission cannot bypass restricted sandbox handler',async()=>{
  let writes=0;const res=response();
  await createOrderHandler({configuration:()=>({payfastMode:'sandbox'}),checkPayments:x=>x,databaseFactory:()=>{writes++;throw Error();}})({method:'POST',body:{...body,confirm_sandbox:false}},res);
  assert.equal(res.code,403);assert.equal(writes,0);
});
