import test from 'node:test';
import assert from 'node:assert/strict';
import {shippingEmailContent,shippingEmailPreview} from '../api/_lib/shipping-email.js';
import {shippingSettings,shippingMessage,signShippingWork,verifyShippingWork,drainShippingMail,scheduleShippingMail} from '../api/_lib/shipping-mail.js';
import {createFulfilmentHandler} from '../api/admin-fulfilment.js';
import {allowedBatchStatuses,shippingUpdateSummary} from '../assets/shipping-status.js';
const batchId='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222',schoolId='edabcd03-1854-43ca-ac93-45c71e9ef012';
const payload={batch_id:batchId,event:'dispatched',demo:true,school_id:schoolId,school:'Test School 1',academic_year:2027,batch_label:'First delivery',occurred_at:'2026-10-23T12:00:00Z',recipient:'parent@example.test',parent_first_name:'Sole',items:[{learner_first_name:'Samuel',learner_last_name:'Smith',grade:'Grade 1',book:'Graad 1 Werkboek',quantity:1,order_reference:'DEMO-BB-26-ONE'},{learner_first_name:'Edith',learner_last_name:'Smith',grade:'Grade 6',book:'Graad 6 Werkboek',quantity:1,order_reference:'DEMO-BB-26-TWO'}]};
const job={id:jobId,batch_id:batchId,event:'dispatched',demo:true,recipient:payload.recipient,payload};
const source={DEMO_PAYMENTS_ENABLED:'true',VERCEL_ENV:'preview',APP_ORIGIN:'https://briljante-preview-awaldstudio.vercel.app',SUPABASE_URL:'https://cigyxjfzbjlgbrduzcpw.supabase.co',MAIL_ENABLED:'false',SMTP_HOST:'mail.example.test',SMTP_PORT:'465',SMTP_USER:'test',SMTP_PASSWORD:'test-only',MAIL_FROM:'orders@briljanteboeke.co.za',ORDER_TOKEN_SECRET:'synthetic-test-only-worker-secret'};
const settings=shippingSettings(source);
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};}
test('shipping mail uses the approved branding and lists only supplied batch children, without payment or tracking claims',()=>{
  const mail=shippingEmailContent(payload);assert.match(mail.html,/Samuel/);assert.match(mail.html,/Edith/);assert.doesNotMatch(mail.html,/Open admin|View order dashboard|school_progress|AMOUNT PAID/);assert.match(mail.text,/No physical dispatch or delivery/);assert.ok(mail.attachments[0].content.length>100);assert.match(shippingEmailPreview(payload),/src="data:image\/png;base64,/);
});
test('delivered copy means received by school, never collected by parent or learner',()=>{
  const mail=shippingEmailContent({...payload,event:'delivered',demo:false});assert.match(mail.text,/delivered to your school/);assert.match(mail.text,/does not confirm collection/);assert.match(mail.text,/Die skool sal/);assert.doesNotMatch(mail.text,/test notification/i);
});
test('untrusted names and school details are escaped in HTML',()=>{
  const mail=shippingEmailContent({...payload,school:'<script>bad()</script>',items:[{...payload.items[0],learner_first_name:'<img src=x onerror=bad()>',book:'A&B'}]});assert.doesNotMatch(mail.html,/<script>|<img src=x/);assert.match(mail.html,/A&amp;B/);
});
test('preview DEMO mail is delivered only to the technical mailbox, regardless of typed parent recipient',()=>{
  const mail=shippingMessage(job,settings);assert.equal(mail.to,'technical@awaldstudio.com');assert.match(mail.subject,/^\[DEMO\]/);assert.equal(mail.messageId,shippingMessage(job,settings).messageId);assert.equal(mail.disableUrlAccess,true);
});
test('live jobs require the correct live environment and keep the actual parent recipient',()=>{
  const live=shippingSettings({...source,DEMO_PAYMENTS_ENABLED:'false',VERCEL_ENV:'production',APP_ORIGIN:'https://www.briljanteboeke.co.za',MAIL_ENABLED:'true'});
  assert.equal(shippingMessage({...job,demo:false,payload:{...payload,demo:false}},live).to,payload.recipient);
  for(const p of [{...source,DEMO_PAYMENTS_ENABLED:'false'},{...source,APP_ORIGIN:'https://evil.example.test'},{...source,SUPABASE_URL:'https://other.supabase.co'}])assert.throws(()=>shippingSettings(p));
  assert.throws(()=>shippingMessage({...job,demo:false,payload:{...payload,demo:false}},settings));assert.throws(()=>shippingMessage({...job,payload:{...payload,school_id:batchId}},settings));
});
test('recipient, event, snapshot and batch mismatches cannot send an email',()=>{
  for(const change of [{recipient:'other@example.test'},{event:'delivered'},{batch_id:jobId},{payload:{...payload,items:[]}},{payload:{...payload,items:[{...payload.items[0],quantity:-1}]}},{payload:{...payload,occurred_at:'invalid'}}])assert.throws(()=>shippingMessage({...job,...change},settings));
});
test('worker signatures are bound to batch, hop and a short timestamp window',()=>{
  const now=Date.now(),work=signShippingWork(batchId,1,source,now);assert.equal(verifyShippingWork(work,source,now),true);
  for(const body of [{...work,batch_id:jobId},{...work,hop:2},{...work,timestamp:work.timestamp-61},{...work,signature:'x'.repeat(64)}])assert.equal(verifyShippingWork(body,source,now),false);
  assert.equal(verifyShippingWork(work,{...source,ORDER_TOKEN_SECRET:'another'},now),false);assert.throws(()=>signShippingWork(batchId,501,source));
});
function queueDatabase({jobs=[job],saveSent=true}={}){
  const updates=[];let claimed=false;
  return{updates,async rpc(name){assert.equal(name,'claim_shipping_notifications');if(claimed)return{data:[]};claimed=true;return{data:jobs};},from(){let value;const q={select(){return q;},eq(){return q;},limit:async()=>({data:[]}),update(v){value=v;updates.push(v);return q;},then(resolve){resolve({error:value?.status==='sent'&&!saveSent?{code:'TEST'}:null});}};return q;}};
}
test('a job is submitted once, records acceptance and closes its transport',async()=>{
  const db=queueDatabase();let sends=0,closed=0;const options={batchId,transportFactory:()=>({sendMail:async mail=>{sends++;return{accepted:[mail.to]};},close(){closed++;}})};
  assert.deepEqual(await drainShippingMail(db,settings,options),{claimed:1,sent:1,failed:0});assert.deepEqual(await drainShippingMail(db,settings,options),{claimed:0,sent:0,failed:0});assert.equal(sends,1);assert.equal(closed,1);assert.equal(db.updates[0].status,'sent');
});
test('uncertain SMTP and accepted-but-unsaved outcomes need review and are never blindly retried',async()=>{
  for(const accepted of [false,true]){const db=queueDatabase({saveSent:!accepted});let sends=0;const result=await drainShippingMail(db,settings,{batchId,transportFactory:()=>({sendMail:async mail=>{sends++;if(!accepted)throw Error('private SMTP diagnostic');return{accepted:[mail.to]};},close(){}})});assert.equal(sends,1);assert.equal(result.failed,1);assert.equal(db.updates.at(-1).status,'failed');assert.equal(db.updates.at(-1).last_error,accepted?'ACCEPTED_RECONCILE_REQUIRED':'MAIL_DELIVERY_UNCERTAIN');}
});
test('continuations use signed fixed-origin requests, never parent-controlled URLs',async()=>{
  const db=queueDatabase();db.from=()=>{const q={update(){return q;},eq(){return q;},select(){return q;},limit:async()=>({data:[{id:jobId}]}),then(resolve){resolve({error:null});}};return q;};let task,continuations=0;
  scheduleShippingMail({database:db,batchId,source,schedule:p=>{task=p;},transportFactory:()=>({sendMail:async()=>({accepted:['technical@awaldstudio.com']}),close(){}}),fetcher:async(url,options)=>{continuations++;assert.equal(url,source.APP_ORIGIN+'/api/admin-fulfilment/');assert.equal(options.redirect,'error');assert.equal(verifyShippingWork(JSON.parse(options.body),source),true);return{ok:true};}});await task;assert.equal(continuations,1);
});
test('unauthenticated, cross-origin and unsigned worker requests cannot access batch data',async()=>{
  let reads=0;const handler=createFulfilmentHandler({databaseFactory(){reads++;throw Error();},authorize:async()=>{throw Object.assign(Error('Denied'),{statusCode:401});},checkOrigin:()=>{throw Object.assign(Error('Denied'),{statusCode:403});},source});
  for(const req of [{method:'GET',headers:{},query:{}},{method:'PATCH',headers:{},body:{}},{method:'POST',headers:{'x-briljante-shipping-worker':'1'},body:{}}]){const res=response();await handler(req,res);assert.ok([401,403].includes(res.code));}assert.equal(reads,0);
});
test('shipping status changes require explicit parent-notification confirmation and use atomic RPC',async()=>{
  let transitions=0,launched=0;
  const db={from(table){const q={select(){return q;},eq(){return q;},order(){return q;},maybeSingle:async()=>({data:{id:batchId,school_id:schoolId,status:'ready'}}),limit:async()=>({data:[{order_reference:'DEMO-BB-TEST'}]})};return q;},async rpc(name,args){assert.equal(name,'transition_fulfilment_batch');assert.equal(args.p_demo,true);transitions++;return{data:{id:batchId,status:'dispatched',changed:true,queued:1}};}};
  const handler=createFulfilmentHandler({databaseFactory:()=>db,authorize:async()=>({user:{id:jobId,email:'technical@awaldstudio.com'}}),checkOrigin:()=>{},source,launch:()=>{launched++;return true;}});
  let res=response();await handler({method:'PATCH',headers:{},body:{id:batchId,status:'dispatched'}},res);assert.equal(res.code,409);assert.equal(transitions,0);
  res=response();await handler({method:'PATCH',headers:{},body:{id:batchId,status:'dispatched',confirm_notifications:true}},res);assert.equal(res.code,200);assert.equal(transitions,1);assert.equal(launched,1);
});
test('batch creation explains an invalid period or an empty allocation without leaking database errors',async()=>{
  const scenarios=[
    {error:{code:'P0001',message:'INVALID_SCHOOL_PERIOD'},status:400,message:/ordering period for this school/},
    {error:{code:'P0001',message:'NO_PAID_ITEMS_AVAILABLE'},status:409,message:/no paid books available/},
    {error:{code:'XX000',message:'private database detail'},status:500,message:/^The request could not be completed\.$/},
  ];
  for(const scenario of scenarios){
    const database={
      async rpc(name,args){
        assert.equal(name,'create_fulfilment_batch');
        assert.equal(args.p_school_id,schoolId);
        return {data:null,error:scenario.error};
      },
      from(){assert.fail('A rejected batch must not be audited as created');},
    };
    const handler=createFulfilmentHandler({
      authorize:async()=>({user:{id:jobId,email:'technical@awaldstudio.com'}}),
      checkOrigin(){},
      databaseFactory:()=>database,
      source,
    });
    const res=response();
    await handler({method:'POST',headers:{},body:{school_id:schoolId,period_id:batchId,label:'Test batch'}},res);
    assert.equal(res.code,scenario.status);
    assert.match(res.body.error,scenario.message);
    assert.doesNotMatch(res.body.error,/P0001|private database detail/);
  }
});
test('shipping UI exposes only valid transitions and reports counts without multiplying parents',()=>{
  assert.deepEqual(allowedBatchStatuses('dispatched'),['dispatched','delivered']);assert.deepEqual(allowedBatchStatuses('delivered'),['delivered']);assert.deepEqual(allowedBatchStatuses('cancelled'),['cancelled']);
  assert.deepEqual(shippingUpdateSummary([{event:'dispatched',status:'sent',count:2},{event:'delivered',status:'sent',count:2},{event:'dispatched',status:'failed',count:1}],'dispatched'),{sent:2,queued:0,processing:0,review:1});
});
