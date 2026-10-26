import assert from 'node:assert/strict';
import test from 'node:test';
import { refundInput, recordFullRefund } from '../api/_lib/refund-reconciliation.js';
import { createAdminOrdersHandler } from '../api/admin-orders.js';
import { refundPayment, refundAction, refundDialogHtml } from '../assets/refund-reconciliation.js';

const orderId='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const now=Date.parse('2026-10-26T15:00:00Z');
const input={action:'record-full-refund',order_id:orderId,provider_payment_id:'12345678',provider_refund_reference:'REFUND-123',
  amount_cents:66000,refunded_at:'2026-10-26T14:00:00Z',reason:'Customer requested cancellation',confirm_external_refund:true};
const order={id:orderId,reference:'BB-26-REFUND-QA',status:'paid',amount_cents:66000,schools:{name:'Test School'},parent_first_name:'Example',parent_last_name:'Parent',payment_attempts:[{status:'complete',provider_payment_id:'12345678'}]};
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}

test('refund reconciliation requires explicit external completion, full integer amount and a past timestamp',()=>{
  const result=refundInput(input,now);
  assert.equal(result.p_amount_cents,66000);assert.equal(result.p_refunded_at,'2026-10-26T14:00:00.000Z');
  for(const change of [{confirm_external_refund:false},{action:'refund'},{order_id:'other'},{amount_cents:660.1},{amount_cents:0},
    {refunded_at:'2026-10-27T14:00:00Z'},{refunded_at:'2026-10-26T14:00'},{provider_payment_id:''},{provider_refund_reference:'x'},
    {reason:'short\nreason'},{provider_payment_id:'123\r\n456'}])assert.throws(()=>refundInput({...input,...change},now));
});

test('recording uses only the reconciliation RPC and trusted authenticated actor',async()=>{
  let call;
  const db={async rpc(name,args){call={name,args};return {data:{order_status:'refunded',reused:false}};}};
  const result=await recordFullRefund(db,{...input,p_actor:'attacker',status:'paid',parent_email:'other@example.invalid'},actor,now);
  assert.equal(call.name,'record_completed_full_refund');assert.equal(call.args.p_actor,actor);
  assert.deepEqual(Object.keys(call.args).sort(),['p_order_id','p_provider_payment_id','p_provider_refund_reference','p_amount_cents','p_refunded_at','p_reason','p_actor'].sort());
  assert.equal(result.order_status,'refunded');
});

test('anonymous, viewer and cross-site refund requests cannot read or mutate records',async()=>{
  let accesses=0;
  for(const mode of ['anonymous','viewer','cross-site']){
    const handler=createAdminOrdersHandler({databaseFactory(){accesses++;throw Error('Must not access database');},
      checkOrigin(){if(mode==='cross-site')throw Object.assign(Error('Origin denied'),{statusCode:403});},
      authorize:async(_req,_res,roles)=>{assert.deepEqual(roles,['administrator']);throw Object.assign(Error('Access denied'),{statusCode:mode==='anonymous'?401:403});},now:()=>now});
    const res=response();await handler({method:'POST',headers:{},body:input},res);assert.equal(res.code,mode==='anonymous'?401:403);
  }
  assert.equal(accesses,0);
});

test('invalid confirmation never invokes the refund RPC',async()=>{
  let calls=0;const handler=createAdminOrdersHandler({databaseFactory:()=>({rpc(){calls++;}}),checkOrigin(){},authorize:async()=>({user:{id:actor}}),now:()=>now});
  const res=response();await handler({method:'POST',body:{...input,confirm_external_refund:false}},res);assert.equal(res.code,400);assert.equal(calls,0);
});

test('new and idempotently repeated recordings return their distinct result without moving money',async()=>{
  for(const reused of [false,true]){
    const handler=createAdminOrdersHandler({databaseFactory:()=>({async rpc(name,args){assert.equal(name,'record_completed_full_refund');assert.equal(args.p_actor,actor);return{data:{order_status:'refunded',reused}};}}),checkOrigin(){},authorize:async()=>({user:{id:actor}}),now:()=>now});
    const res=response();await handler({method:'POST',body:input},res);assert.equal(res.code,reused?200:201);assert.equal(res.body.money_moved,false);assert.equal(res.headers['Cache-Control'],'no-store');
  }
});

test('mismatched payment, duplicate record, active batch and in-flight mail failures stay actionable',async()=>{
  for(const code of ['REFUND_PAYMENT_MISMATCH','REFUND_ALREADY_RECORDED','REFUND_BATCH_REVIEW_REQUIRED','REFUND_MAIL_IN_PROGRESS']){
    const handler=createAdminOrdersHandler({databaseFactory:()=>({async rpc(){return{error:{message:code}};}}),checkOrigin(){},authorize:async()=>({user:{id:actor}}),now:()=>now});
    const res=response();await handler({method:'POST',body:input},res);assert.equal(res.code,409);assert.doesNotMatch(res.body.error,/REFUND_/);
  }
});

test('refund UI only offers recording to an administrator with one verified-looking completed payment',()=>{
  assert.ok(refundPayment(order));assert.match(refundAction(order,{administrator:true,language:'en'}),/Record completed refund/);
  for(const options of [{administrator:false},{administrator:true,preview:true}])assert.equal(refundAction(order,options),'');
  for(const item of [{...order,status:'refunded'},{...order,payment_attempts:[]},{...order,payment_attempts:[...order.payment_attempts,...order.payment_attempts]}])assert.equal(refundPayment(item),null);
  assert.equal(refundAction({...order,payment_attempts:[]},{administrator:true}),'');
});

test('refund form shows exact original amount/reference, warns no money is sent, and escapes untrusted data',()=>{
  for(const language of ['en','af']){
    const html=refundDialogHtml({...order,parent_first_name:'<script>bad()</script>'},{language,now:new Date(now)});
    assert.match(html,/BB-26-REFUND-QA/);assert.match(html,/12345678/);assert.match(html,/660/);assert.match(html,/datetime-local/);
    assert.match(html,/name="confirm_external_refund"[^>]*required/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
    assert.match(html,language==='en'?/cannot send money/:/kan geen geld stuur nie/);
  }
  assert.match(refundAction({...order,status:'refunded',order_refunds:[{provider_refund_reference:'<unsafe>'}]},{language:'en'}),/&lt;unsafe&gt;/);
});
