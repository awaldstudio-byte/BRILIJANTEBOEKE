import test from 'node:test';
import assert from 'node:assert/strict';
import {mailSettings,paidOrderMessage,createMailTransport,drainOrderMail,schedulePaidOrderMail} from '../api/_lib/order-mail.js';
const settings={from:'orders@briljanteboeke.co.za',replyTo:'info@briljanteboeke.co.za',staff:['info@briljanteboeke.co.za']};
const job={id:'11111111-1111-4111-8111-111111111111',kind:'parent_order_paid',recipient:'parent@example.com'};
const order={reference:'BB-12345',status:'paid',paid_at:'2026-10-22',amount_cents:66000,parent_email:'parent@example.com',schools:{name:'Test School'}};
test('mail stays disabled without explicit activation and full sender configuration',()=>{
  assert.throws(()=>mailSettings({}),/not configured/);
  assert.throws(()=>mailSettings({MAIL_ENABLED:'true',SMTP_HOST:'mail.example.com',SMTP_USER:'user',SMTP_PASSWORD:'secret',MAIL_FROM:'other@example.com'}),/not configured/);
});
test('SMTP requires encrypted transport, verified certificates and bounded timeouts',()=>{
  const transport=createMailTransport({...settings,host:'mail.example.com',port:587,user:'user',password:'secret'});
  assert.equal(transport.options.requireTLS,true);
  assert.equal(transport.options.tls.rejectUnauthorized,true);
  assert.equal(transport.options.disableUrlAccess,true);
  assert.ok(transport.options.socketTimeout<=12000);
  transport.close();
});
test('paid confirmation is bilingual, minimal and distinguishes payment from delivery',()=>{
  const message=paidOrderMessage(job,order,settings);
  assert.match(message.text,/660/);
  assert.match(message.text,/Payment confirmation is not a dispatch/);
  assert.match(message.text,/Betalingsbevestiging/);
  assert.equal(message.to,job.recipient);
  assert.equal(message.messageId,paidOrderMessage(job,order,settings).messageId);
  assert.doesNotMatch(JSON.stringify(message),/learner_first_name|access_token/);
});
test('unpaid orders and unauthorised recipients can never produce confirmations',()=>{
  assert.throws(()=>paidOrderMessage(job,{...order,status:'pending_payment'},settings),/verified paid/);
  assert.throws(()=>paidOrderMessage({...job,recipient:'stranger@example.com'},order,settings),/not authorised/);
  assert.throws(()=>paidOrderMessage({...job,kind:'staff_order_paid'},order,settings),/not authorised/);
  assert.throws(()=>paidOrderMessage(job,{...order,reference:'BB\r\nBcc: other'},settings),/Invalid/);
});
test('staff notices only go to configured staff recipients',()=>{
  assert.equal(paidOrderMessage({...job,kind:'staff_order_paid',recipient:settings.staff[0]},order,settings).to,settings.staff[0]);
});
test('background mail cannot run for disabled, rejected or incomplete payment notifications',()=>{
  for(const state of [{verified:false,paymentStatus:'COMPLETE',source:{MAIL_ENABLED:'true'}},{verified:true,paymentStatus:'FAILED',source:{MAIL_ENABLED:'true'}},{verified:true,paymentStatus:'COMPLETE',source:{MAIL_ENABLED:'false'}}]){
    assert.equal(schedulePaidOrderMail({...state,schedule(){throw Error('must not schedule');}}),false);
  }
});
test('verified payment schedules scoped background work and closes its transport',async()=>{
  const db=fakeDatabase();let task,closed=0,sends=0;
  const source={MAIL_ENABLED:'true',SMTP_HOST:'mail.example.com',SMTP_USER:'user',SMTP_PASSWORD:'secret',MAIL_FROM:settings.from,MAIL_REPLY_TO:settings.replyTo};
  assert.equal(schedulePaidOrderMail({database:db,orderId:'order',verified:true,paymentStatus:'COMPLETE',source,schedule(p){task=p;},transportFactory(){return {sendMail:async()=>{sends++;return {accepted:[job.recipient]};},close(){closed++;}};}}),true);
  await task;assert.equal(sends,1);assert.equal(closed,1);
});
function fakeDatabase({claimed=true,mailSaved=true}={}) {
  const updates=[];
  return {updates,from(table){let update;const q={select(){return q;},eq(){return q;},lte(){return q;},order(){return q;},limit:async()=>({data:[{...job,order_id:'order',attempts:0}]}),update(value){update=value;updates.push(value);return q;},maybeSingle:async()=>({data:claimed?{id:job.id}:null}),single:async()=>({data:order}),then(resolve){return Promise.resolve({error:update?.status==='sent'&&!mailSaved?{code:'DB_ERROR'}:null}).then(resolve);}};return q;}};
}
test('queue claims before sending and records accepted messages',async()=>{
  const db=fakeDatabase();let sends=0;
  assert.deepEqual(await drainOrderMail(db,{sendMail:async()=>{sends++;assert.equal(db.updates[0].status,'processing');return {accepted:[job.recipient]};}},settings),{sent:1,failed:0,skipped:0});
  assert.equal(sends,1);assert.equal(db.updates.at(-1).status,'sent');
});
test('a lost concurrent claim does not send',async()=>{
  const db=fakeDatabase({claimed:false});
  assert.deepEqual(await drainOrderMail(db,{sendMail:async()=>{throw Error('must not send');}},settings),{sent:0,failed:0,skipped:1});
});
test('uncertain SMTP failures and accepted-but-unsaved messages require review, not automatic resend',async()=>{
  for(const mailSaved of [true,false]){
    const db=fakeDatabase({mailSaved});let sends=0;
    const result=await drainOrderMail(db,{sendMail:async()=>{sends++;if(mailSaved)throw Error('contains private data');return {accepted:[job.recipient]};}},settings);
    assert.equal(result.failed,1);assert.equal(sends,1);assert.equal(db.updates.at(-1).status,'failed');
    assert.equal(db.updates.at(-1).last_error,mailSaved?'MAIL_DELIVERY_UNCERTAIN':'ACCEPTED_RECONCILE_REQUIRED');
  }
});
