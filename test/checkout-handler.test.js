import assert from 'node:assert/strict';
import test from 'node:test';
import {createCheckoutHandler} from '../api/create-checkout.js';
import {sha256} from '../api/_lib/crypto.js';
const input={reference:'BB-26-CKQA',order_token:'synthetic-order-token-no-real-data',language:'en',amount_cents:1};
const order={id:'qa',reference:input.reference,amount_cents:66000,status:'pending_payment',school_id:'qa-school',idempotency_key:'qa-request',parent_first_name:'Synthetic',parent_last_name:'Parent',parent_email:'parent@example.invalid',parent_mobile:'0820000000',learner_count:2};
const settings={payfastMode:'live',payfastMerchantId:'test-only',payfastMerchantKey:'test-only',payfastPassphrase:'test-only',appOrigin:'https://www.briljanteboeke.co.za'};
const response=()=>({setHeader(){},status(value){this.code=value;return this;},json(value){this.body=value;return this;}});
test('checkout uses only the atomic preparation RPC and canonical amount, never a status-reset upsert',async()=>{
  let calls=0;
  const handler=createCheckoutHandler({configuration:()=>settings,checkPayments:x=>x,databaseFactory:()=>({async rpc(name,args){calls++;assert.equal(name,'prepare_payfast_checkout');assert.deepEqual(args,{p_reference:input.reference,p_order_access_hash:sha256(input.order_token),p_mode:'live'});return{data:order};}})});
  const res=response();await handler({method:'POST',body:input},res);
  assert.equal(res.code,200);assert.equal(calls,1);assert.equal(res.body.fields.amount,'660.00');assert.equal(res.body.fields.notify_url,'https://www.briljanteboeke.co.za/api/payfast-notify/');
  assert.equal(JSON.stringify(res.body).includes(input.order_token),false);
});
test('when verified payment wins preparation, no further payment form is returned',async()=>{
  let forms=0;
  const handler=createCheckoutHandler({configuration:()=>settings,checkPayments:x=>x,databaseFactory:()=>({async rpc(){return{error:{message:'CHECKOUT_ALREADY_PAID'}};}}),buildRequest(){forms++;throw Error('Must not create another payment form');}});
  const res=response();await handler({method:'POST',body:input},res);assert.equal(res.code,409);assert.equal(forms,0);assert.match(res.body.error,/already been paid/);
});
test('sandbox authorization fails before any attempt preparation or payment form',async()=>{
  let databases=0;
  const handler=createCheckoutHandler({configuration:()=>({...settings,payfastMode:'sandbox'}),checkPayments:x=>x,
    sandboxAccess:async()=>{throw Object.assign(Error('Denied'),{statusCode:403});},databaseFactory(){databases++;throw Error();}});
  const res=response();await handler({method:'POST',body:input},res);assert.equal(res.code,403);assert.equal(databases,0);
});
test('environment, terminal state and inconsistent payment rejections cannot emit a checkout form',async()=>{
  for(const [message,status] of [['CHECKOUT_ENVIRONMENT_DENIED',403],['CHECKOUT_ORDER_NOT_PAYABLE',409],['CHECKOUT_PAYMENT_REVIEW_REQUIRED',409],['CHECKOUT_ORDER_NOT_FOUND',404]]){
    let forms=0;const handler=createCheckoutHandler({configuration:()=>settings,checkPayments:x=>x,databaseFactory:()=>({async rpc(){return{error:{message}};}}),buildRequest(){forms++;}});
    const res=response();await handler({method:'POST',body:input},res);assert.equal(res.code,status);assert.equal(forms,0);
  }
});
