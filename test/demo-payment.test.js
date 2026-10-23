import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {readFile} from 'node:fs/promises';
import {createDemoPaymentHandler} from '../api/_lib/demo-payment-handler.js';
import {demoEnvironment,requireDemoAccess,canDemoPay,demoSchoolId,demoStaffEmail,demoOrigin} from '../api/_lib/demo-payment.js';
import {paidOrderMessage} from '../api/_lib/order-mail.js';

const source={DEMO_PAYMENTS_ENABLED:'true',VERCEL_ENV:'preview',APP_ORIGIN:demoOrigin,SUPABASE_URL:'https://cigyxjfzbjlgbrduzcpw.supabase.co',
  SMTP_HOST:'smtp.example.test',SMTP_USER:'orders@briljanteboeke.co.za',SMTP_PASSWORD:'test-only',MAIL_FROM:'orders@briljanteboeke.co.za'};
const school={id:demoSchoolId,slug:'test-school-1',name:'Test School 1',status:'active'};
const period={id:'87c7f749-f232-4eb0-b81e-69b10bd83f72',school_id:demoSchoolId,status:'open',opens_at:'2026-10-01',closes_at:'2026-12-21'};
const body={confirm_demo:true,school_identifier:school.slug,ordering_period_id:period.id,request_id:'550e8400-e29b-41d4-a716-446655440000',
  parent:{first_name:'Demo',last_name:'Parent',email:'chosen-parent@example.test',mobile:'0820000000'},
  consent:{accepted:true,policy_version:'2026-10-20'},learners:[{first_name:'Demo',last_name:'Learner',offering_id:'2de1d6a7-02b5-41e0-b9ee-b276c4d65041'}]};
const now=()=>Date.parse('2026-10-23T10:00:00Z');
const auth=async()=>({user:{id:'test-operator',email:demoStaffEmail}});
function response(){return {status(c){this.code=c;return this;},setHeader(){},json(b){this.body=b;return this;}};}
function database({foreignSchool=false,limit=true}={}){
  const tables={schools:[{...school,...(foreignSchool?{id:'other-school'}:{})}],ordering_periods:[{...period,...(foreignSchool?{school_id:'other-school'}:{})}],school_access:[{school_id:demoSchoolId,ordering_period_id:period.id,token_hash:'a'.repeat(64),revoked_at:null}],orders:[],notification_jobs:[]};
  const rpcCalls=[];
  return {tables,rpcCalls,async rpc(name,p){rpcCalls.push([name,p]);if(name==='consume_staff_auth_limit')return {data:limit};
    let row=tables.orders.find(o=>o.idempotency_key===p.p_idempotency_key);
    const reused=!!row;
    if(!row){row={id:'11111111-1111-4111-8111-111111111111',reference:'BB-26-12345678',amount_cents:32000,status:'pending_payment',school_id:demoSchoolId,order_access_hash:p.p_order_access_hash,idempotency_key:p.p_idempotency_key,
      ordering_period_id:period.id,parent_email:p.p_parent.email,parent_first_name:p.p_parent.first_name,parent_last_name:p.p_parent.last_name,schools:{name:school.name}};tables.orders.push(row);}
    return {data:{...row,reused}};
  },from(table){let filters=[],update,upsert;
    const offering={id:body.learners[0].offering_id,school_id:demoSchoolId,ordering_period_id:period.id,grade_id:'grade-1',active:true,price_cents:32000,expected_quantity:2,grades:{name:'Grade 1',sort_order:1}};
    if(table==='school_grade_offerings')tables[table]=[offering];
    if(table==='order_items')tables[table]=tables.orders.map(o=>({id:'item-1',offering_id:offering.id,quantity:1,line_total_cents:32000,orders:o}));
    const run=()=>{if(upsert){for(const job of upsert)if(!tables[table].some(row=>row.id===job.id))tables[table].push({...job,status:'queued',attempts:0});return {data:null};}
      const rows=tables[table].filter(row=>filters.every(([k,v])=>k.split('.').reduce((a,b)=>a?.[b],row)===v));if(update)rows.forEach(row=>Object.assign(row,update));return {data:rows};};
    const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){return q.eq(k,v);},order(){return q;},lte(){return q;},limit(){return q;},range(){return q;},like(){return q;},not(){return q;},
      update(v){update=v;return q;},upsert(v,options){assert.equal(options.ignoreDuplicates,true);upsert=v;return q;},
      async single(){const r=run();return {data:r.data[0]};},async maybeSingle(){const r=run();return {data:r.data[0]||null};},then(resolve,reject){return Promise.resolve(run()).then(resolve,reject);}};return q;
  }};
}
test('demo is unavailable without the explicit switch, exact preview origin, project and preview environment',()=>{
  assert.equal(demoEnvironment(source),true);
  for(const change of [{DEMO_PAYMENTS_ENABLED:'false'},{VERCEL_ENV:'production'},{APP_ORIGIN:'https://www.briljanteboeke.co.za'},{SUPABASE_URL:'https://other.supabase.co'}])assert.equal(demoEnvironment({...source,...change}),false);
});
test('demo requires the existing administrator session and technical identity, not a browser claim',async()=>{
  let origins=0;
  await requireDemoAccess({},response(),{source,authorise:async(req,res,roles)=>{assert.deepEqual(roles,['administrator']);return auth();},checkOrigin(){origins++;}});
  assert.equal(origins,1);
  await assert.rejects(requireDemoAccess({},response(),{source,authorise:async()=>({user:{email:'other@example.test'}}),checkOrigin(){throw Error('must not reach');}}),{statusCode:403});
  await assert.rejects(requireDemoAccess({},response(),{source,authorise:async()=>{throw Object.assign(Error('Sign in required'),{statusCode:401});}}),{statusCode:401});
  assert.equal(await canDemoPay({},response(),{id:'other-school'},{source}),false);
});
test('cancelled/unconfirmed and unauthenticated requests make no database writes',async()=>{
  for(const unconfirmed of [false,undefined]){
    let writes=0;const res=response();await createDemoPaymentHandler({access:auth,databaseFactory(){writes++;}})({method:'POST',body:{...body,confirm_demo:unconfirmed}},res);
    assert.equal(res.code,400);assert.equal(writes,0);
  }
  let writes=0;const res=response();await createDemoPaymentHandler({access:async()=>{throw Object.assign(Error('Denied'),{statusCode:401});},databaseFactory(){writes++;}})({method:'POST',body},res);
  assert.equal(res.code,401);assert.equal(writes,0);
});
test('demo preserves the typed parent email, staff goes only to technical, and repeated submits never resend',async()=>{
  const db=database(),messages=[];let closed=0;
  const handler=createDemoPaymentHandler({access:auth,databaseFactory:()=>db,configuration:()=>({orderTokenSecret:'test-only'}),source,now,
    transportFactory:()=>({async sendMail(message){messages.push(message);return {accepted:[message.to]};},close(){closed++;}})});
  const first=response();await handler({method:'POST',body:{...body,amount_cents:1,staff_email:'attacker@example.test'}},first);
  assert.equal(first.code,200);assert.equal(first.body.demo,true);assert.equal(first.body.order.amount_cents,32000);
  assert.match(first.body.order.reference,/^DEMO-/);assert.deepEqual(messages.map(m=>m.to),[body.parent.email,demoStaffEmail]);
  for(const m of messages){assert.match(m.subject,/^\[DEMO\]/);assert.match(m.html,/No money was charged/);assert.ok(m.attachments[0].content.length);}
  const second=response();await handler({method:'POST',body},second);
  assert.equal(second.code,200);assert.equal(db.tables.orders.length,1);assert.equal(db.tables.notification_jobs.length,2);assert.equal(messages.length,2);assert.equal(closed,2);
  assert.equal(second.body.order.access_token,first.body.order.access_token);
  assert.ok(db.rpcCalls.every(([name])=>name!=='process_payfast_notification'));
});
test('foreign school and durable quota denial cannot create a demo order',async()=>{
  for(const [options,status] of [[{foreignSchool:true},403],[{limit:false},429]]){
    const db=database(options),res=response();await createDemoPaymentHandler({access:auth,databaseFactory:()=>db,configuration:()=>({}),source,now})({method:'POST',body},res);
    assert.equal(res.code,status);assert.equal(db.tables.orders.length,0);
  }
});
test('demo SMTP failure is recorded once without deleting the successful demo order or resending on retry',async()=>{
  const db=database();let sends=0;
  const handler=createDemoPaymentHandler({access:auth,databaseFactory:()=>db,configuration:()=>({orderTokenSecret:'test'}),source,now,
    transportFactory:()=>({async sendMail(){sends++;throw Error('uncertain');},close(){}})});
  for(let i=0;i<2;i++){const res=response();await handler({method:'POST',body},res);assert.equal(res.code,200);}
  assert.equal(sends,2);assert.equal(db.tables.orders[0].status,'paid');assert.ok(db.tables.notification_jobs.every(j=>j.status==='failed'));
});
test('branded confirmations include multipart MIME, exact CID logo, line items and escaped user content',async()=>{
  const order={reference:'BB-26-12345678',status:'paid',paid_at:'2026-10-23',amount_cents:32000,parent_email:body.parent.email,parent_first_name:'<script>bad</script>',schools:{name:'Test School 1'},
    order_items:[{description_snapshot:'Grade 1 Workbook',quantity:1,line_total_cents:32000,learners:{first_name:'Demo',last_name:'Learner'}}]};
  const settings={from:'orders@briljanteboeke.co.za',replyTo:'info@briljanteboeke.co.za',staff:[demoStaffEmail],appOrigin:demoOrigin};
  const message=paidOrderMessage({id:'11111111-1111-4111-8111-111111111111',kind:'parent_order_paid',recipient:body.parent.email},order,settings);
  assert.match(message.html,/&lt;script&gt;/);assert.doesNotMatch(message.html,/<script|<form|access_token|https:\/\/.*\.png/);
  assert.match(message.html,/Grade 1 Workbook/);assert.match(message.text,/Demo Learner/);
  const transport=nodemailer.createTransport({streamTransport:true,buffer:true});const mime=await transport.sendMail(message);
  assert.match(mime.message.toString(),/multipart\/alternative/);assert.match(mime.message.toString(),/Content-ID: <briljante-order-logo/);
  assert.deepEqual(message.attachments[0].content,await readFile(new URL('../assets/images/logo.png',import.meta.url)));
  assert.throws(()=>paidOrderMessage({id:'11111111-1111-4111-8111-111111111111',kind:'parent_order_paid',recipient:body.parent.email},{...order,reference:'DEMO-BB-26-12345678'},settings),/dedicated test sender/);
});
