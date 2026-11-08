import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminDashboardHandler} from '../api/admin-dashboard.js';
import {createAdminOrdersHandler} from '../api/admin-orders.js';
import {createFulfilmentHandler} from '../api/admin-fulfilment.js';
import {createOrderManagementHandler} from '../api/admin-order-management.js';
import {demoSchoolId,demoOrigin} from '../api/_lib/demo-payment.js';
const realSchool='11111111-1111-4111-8111-111111111111',demoOrder='22222222-2222-4222-8222-222222222222',realOrder='33333333-3333-4333-8333-333333333333',demoBatch='44444444-4444-4444-8444-444444444444',realBatch='55555555-5555-4555-8555-555555555555';
const preview={VERCEL_ENV:'preview',DEMO_PAYMENTS_ENABLED:'true',APP_ORIGIN:demoOrigin,SUPABASE_URL:'https://cigyxjfzbjlgbrduzcpw.supabase.co'},production={VERCEL_ENV:'production'};
const real={id:realOrder,reference:'BB-REAL',school_id:realSchool,status:'paid',amount_cents:32000,order_item_refunds:[],parent_email:'parent@example.test'},demo={id:demoOrder,reference:'DEMO-BB-TEST',school_id:demoSchoolId,status:'paid',amount_cents:34000,order_item_refunds:[],parent_email:'technical@awaldstudio.com'};
const tables={schools:[{id:realSchool,status:'active'},{id:demoSchoolId,status:'active'}],orders:[real,demo],ordering_periods:[{id:'r',school_id:realSchool,status:'open'},{id:'d',school_id:demoSchoolId,status:'open'}],school_grade_offerings:[{id:'r',school_id:realSchool,active:true,expected_quantity:1},{id:'d',school_id:demoSchoolId,active:true,expected_quantity:1}],order_items:[{id:'i1',offering_id:'r',quantity:1,order_item_refunds:[],orders:real},{id:'i2',offering_id:'d',quantity:1,order_item_refunds:[],orders:demo}],fulfilment_batches:[{id:realBatch,school_id:realSchool},{id:demoBatch,school_id:demoSchoolId}],fulfilment_batch_items:[{order_reference:'DEMO-BB-TEST',batch_id:demoBatch},{order_reference:'BB-REAL',batch_id:realBatch}],order_refund_requests:[{id:'rq1',status:'requested',orders:real},{id:'rq2',status:'requested',orders:demo}],audit_events:[]};
const get=(row,path)=>path.split('.').reduce((v,k)=>v?.[k],row);
function db(){return {from(table){let predicates=[],start=0,end=Infinity,head=false;const q={select(_value,options){head=!!options?.head;return q;},eq(k,v){predicates.push(x=>get(x,k)===v);return q;},neq(k,v){predicates.push(x=>get(x,k)!==v);return q;},not(k,op,v){assert.equal(op,'like');predicates.push(x=>!String(get(x,k)||'').startsWith(v.replace('%','')));return q;},in(k,values){predicates.push(x=>values.includes(get(x,k)));return q;},order(){return q;},limit(n){end=n-1;return q;},range(a,b){start=a;end=b;return q;},ilike(k,v){predicates.push(x=>String(get(x,k)||'').toLowerCase()===v.toLowerCase());return q;},or(){return q;},async maybeSingle(){return{data:(tables[table]||[]).filter(x=>predicates.every(f=>f(x)))[0]||null,error:null};},then(resolve){const filtered=(tables[table]||[]).filter(x=>predicates.every(f=>f(x)));resolve({data:head?null:filtered.slice(start,end+1),count:filtered.length,error:null});}};return q;},async rpc(){return{data:[],error:null};}};}
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}}),authorize=async()=>({staff:{role:'administrator'},user:{id:realOrder,email:'technical@awaldstudio.com'}});
test('dashboard and order search isolate test data in production and preserve it in test preview',async()=>{
 for(const [source,count,total] of [[production,1,32000],[preview,2,66000]]){
  let handler=createAdminDashboardHandler({authorize,databaseFactory:db,source}),res=response();await handler({method:'GET',query:{}},res);
  assert.equal(res.code,200);assert.equal(res.body.summary.active_schools,count);assert.equal(res.body.summary.paid_orders,count);assert.equal(res.body.summary.paid_total_cents,total);assert.equal(res.body.recent_orders.length,count);assert.equal(res.body.periods.length,count);assert.equal(res.body.progress.length,count);
  handler=createAdminOrdersHandler({authorize,databaseFactory:db,source});res=response();await handler({method:'GET',query:{}},res);assert.equal(res.code,200);assert.equal(res.body.orders.length,count);assert.equal(res.body.total,count);
 }
});
test('production hides the test batch, test refund requests and direct demo order detail',async()=>{
 let handler=createFulfilmentHandler({authorize,databaseFactory:db,source:production,checkOrigin(){}}),res=response();await handler({method:'GET',headers:{},query:{}},res);assert.equal(res.code,200);assert.deepEqual(res.body.batches.map(b=>b.id),[realBatch]);
 res=response();await handler({method:'GET',headers:{},query:{email_preview:demoBatch}},res);assert.equal(res.code,404);
 res=response();await handler({method:'POST',headers:{},body:{school_id:demoSchoolId,period_id:realSchool,label:'No test batch'}},res);assert.equal(res.code,404);
 handler=createOrderManagementHandler({authorize,databaseFactory:db,source:production});res=response();await handler({method:'GET',query:{requests:'1'}},res);assert.equal(res.code,200);assert.equal(res.body.requests.length,1);assert.equal(res.body.requests[0].orders.reference,'BB-REAL');
 res=response();await handler({method:'GET',query:{order_id:demoOrder}},res);assert.equal(res.code,404);
 handler=createOrderManagementHandler({authorize,databaseFactory:db,source:preview});res=response();await handler({method:'GET',query:{requests:'1'}},res);assert.equal(res.code,200);assert.equal(res.body.requests.length,2);
});
test('preview cannot create or change live batches and only the technical account may change demo batches',async()=>{
 for(const [account,method,body] of [
  ['technical@awaldstudio.com','POST',{school_id:realSchool,period_id:realSchool,label:'Real school'}],
  ['technical@awaldstudio.com','PATCH',{id:realBatch,status:'packing'}],
  ['other@example.com','POST',{school_id:demoSchoolId,period_id:realSchool,label:'Test school'}],
  ['other@example.com','PATCH',{id:demoBatch,status:'packing'}],
 ]){
  let calls=0;const database=db();database.rpc=async()=>{calls++;return{data:{},error:null};};
  const handler=createFulfilmentHandler({authorize:async()=>({user:{id:realOrder,email:account}}),databaseFactory:()=>database,source:preview,checkOrigin(){}}),res=response();
  await handler({method,headers:{},body},res);assert.equal(res.code,403);assert.equal(calls,0);
 }
 let calls=0;const database=db();database.rpc=async()=>{calls++;return{data:{id:demoBatch},error:null};};
 const handler=createFulfilmentHandler({authorize,databaseFactory:()=>database,source:preview,checkOrigin(){}}),res=response();
 await handler({method:'PATCH',headers:{},body:{id:demoBatch,status:'packing'}},res);assert.equal(res.code,200);assert.equal(calls,1);
 const from=database.from;database.from=table=>table==='audit_events'?{insert:async()=>({error:null})}:from(table);
 const created=response();await handler({method:'POST',headers:{},body:{school_id:demoSchoolId,period_id:realSchool,label:'Test school'}},created);assert.equal(created.code,201);assert.equal(calls,2);
});
