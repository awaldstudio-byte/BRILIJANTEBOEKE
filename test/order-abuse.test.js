import assert from 'node:assert/strict';
import test from 'node:test';
import {trustedOrderingIp,protectPublicTraffic,protectOrderSubmission,protectCheckout} from '../api/_lib/order-abuse.js';
import {createOrderHandler} from '../api/orders.js';
import {createCheckoutHandler} from '../api/create-checkout.js';
const settings={appOrigin:'https://www.briljanteboeke.co.za',orderTokenSecret:'synthetic-server-secret-with-no-real-data',payfastMode:'live'};
const request=ip=>({headers:{origin:settings.appOrigin,'x-vercel-forwarded-for':ip},socket:{remoteAddress:ip}});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
const input={idempotencyKey:'synthetic-request-identifier',schoolIdentifier:'school-one',orderingPeriodId:'synthetic-period',parent:{email:'parent@example.invalid'}};
function database(outcome=true){const calls=[];return{calls,async rpc(name,args){calls.push({name,args});return typeof outcome==='function'?outcome(name,args):{data:outcome};}};}
test('hosted protection accepts only a single valid platform IP and fails closed without trusted hosting identity',()=>{
  assert.equal(trustedOrderingIp({...request('192.0.2.1'),headers:{'x-vercel-forwarded-for':'192.0.2.1','x-forwarded-for':'203.0.113.1'}},{VERCEL:'1'}),'192.0.2.1');
  for(const value of [undefined,['192.0.2.1'],'192.0.2.1,203.0.113.1','192.0.2.1:80',' 192.0.2.1','bogus'])assert.throws(()=>trustedOrderingIp({headers:{'x-vercel-forwarded-for':value},socket:{remoteAddress:'127.0.0.1'}},{VERCEL:'1'}),{statusCode:503});
  for(const source of [{},{VERCEL:'0'}])assert.throws(()=>trustedOrderingIp({headers:{'x-vercel-forwarded-for':'203.0.113.9'},socket:{remoteAddress:'::ffff:127.0.0.1'}},source),{statusCode:503});
});
test('cross-site requests and absent client identity fail before any quota or order lookup',async()=>{
  const db=database();
  await assert.rejects(protectPublicTraffic({req:{...request('192.0.2.1'),headers:{origin:'https://attacker.invalid'}},res:response(),database:db,settings,source:{}}),{statusCode:403});
  await assert.rejects(protectPublicTraffic({req:{headers:{origin:settings.appOrigin}},res:response(),database:db,settings,source:{VERCEL:'1'}}),{statusCode:503});
  assert.equal(db.calls.length,0);
});
test('request protection uses only hashed private persisted counters and bounds a shared network separately from each parent',async()=>{
  const db=database(),req=request('192.0.2.1'),res=response();
  await protectPublicTraffic({req,res,database:db,settings,source:{VERCEL:'1'}});
  await protectOrderSubmission({req,res,database:db,settings,input,source:{VERCEL:'1'}});
  assert.deepEqual(db.calls.map(c=>[c.name,c.args.p_limit,c.args.p_seconds]),[['consume_order_traffic_limit',240,60],['consume_order_traffic_limit',1000,3600],['consume_order_submission_limit',600,3600],['consume_order_submission_limit',20,3600]]);
  for(const {args}of db.calls)assert.match(args.p_key,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(db.calls),/192\.0\.2\.1|parent@example|school-one|synthetic-server-secret/);
});
test('submission retries reuse a receipt identity, while different schools/requests/parents/IPs remain separately scoped',async()=>{
  const db=database(),req=request('192.0.2.1'),res=response(),run=async(i=input,r=req)=>{await protectOrderSubmission({req:r,res,database:db,settings,input:i,source:{VERCEL:'1'}});return db.calls.slice(-2).map(c=>c.args);};
  const original=await run();assert.deepEqual(await run(),original);
  const otherSchool=await run({...input,schoolIdentifier:'school-two'});assert.notEqual(otherSchool[0].p_request,original[0].p_request);
  const another=await run({...input,idempotencyKey:'another-request'});assert.notEqual(another[0].p_request,original[0].p_request);
  const otherParent=await run({...input,parent:{email:'other@example.invalid'}});assert.equal(otherParent[0].p_key,original[0].p_key);assert.notEqual(otherParent[1].p_key,original[1].p_key);
  const otherIp=await run(input,request('192.0.2.2'));assert.notEqual(otherIp[0].p_key,original[0].p_key);assert.notEqual(otherIp[1].p_key,original[1].p_key);
});
test('quota exhaustion returns actionable 429; missing, malformed and failed storage outcomes fail closed',async()=>{
  const res=response();await assert.rejects(protectCheckout({res,database:database(false),settings,order:{id:'synthetic-order'}}),{statusCode:429});assert.equal(res.headers['Retry-After'],'3600');
  for(const db of [database(null),database(()=>({error:{message:'private database failure'}})),{async rpc(){throw Error('private database failure');}}]){
    await assert.rejects(protectCheckout({res:response(),database:db,settings,order:{id:'synthetic-order'}}),error=>error.statusCode===503&&!error.message.includes('database failure'));
  }
});
test('a rejected public creation quota stops before school resolution or order mutation',async()=>{
  let schoolReads=0,writes=0;
  const body={school_identifier:'school-one',ordering_period_id:'11111111-1111-4111-8111-111111111111',request_id:'synthetic-order-request',parent:{first_name:'Test',last_name:'Parent',email:'parent@example.invalid',mobile:'0820000000'},consent:{accepted:true,policy_version:'2026-10-20'},learners:[{first_name:'Test',last_name:'Child',offering_id:'22222222-2222-4222-8222-222222222222'}]};
  const db={from(){schoolReads++;throw Error('Should not read a school');},async rpc(){writes++;}};
  const handler=createOrderHandler({source:{VERCEL_ENV:'production'},configuration:()=>settings,checkPayments:x=>x,databaseFactory:()=>db,guardTraffic:async()=>{},guardSubmission:async()=>{throw Object.assign(Error('Wait'),{statusCode:429});}});
  const res=response();await handler({method:'POST',body},res);assert.equal(res.code,429);assert.equal(schoolReads,0);assert.equal(writes,0);
});
test('checkout order quota is consumed only after private-token verification and cannot emit a form when exhausted',async()=>{
  const sequence=[],body={reference:'BB-26-TEST',order_token:'synthetic-private-order-token',language:'en'},order={id:'private-order',status:'pending_payment'};
  const handler=createCheckoutHandler({source:{VERCEL_ENV:'production'},configuration:()=>settings,checkPayments:x=>x,databaseFactory:()=>({async rpc(){sequence.push('private-prepare');return{data:order};}}),guardTraffic:async()=>sequence.push('traffic'),checkLiveSchool:async()=>{},checkEnvironment:()=>sequence.push('environment'),guardCheckout:async({order:actual})=>{assert.equal(actual.id,order.id);sequence.push('private-quota');throw Object.assign(Error('Wait'),{statusCode:429});},buildRequest:()=>sequence.push('form')});
  const res=response();await handler({method:'POST',body},res);assert.equal(res.code,429);assert.deepEqual(sequence,['traffic','private-prepare','environment','private-quota']);
  let consumed=0;const denied=createCheckoutHandler({source:{VERCEL_ENV:'production'},configuration:()=>settings,checkPayments:x=>x,databaseFactory:()=>({async rpc(){return{error:{message:'CHECKOUT_ORDER_NOT_FOUND'}};}}),guardTraffic:async()=>{},checkLiveSchool:async()=>{},guardCheckout:async()=>consumed++});
  const missing=response();await denied({method:'POST',body},missing);assert.equal(missing.code,404);assert.equal(consumed,0);
});
