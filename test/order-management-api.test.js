import assert from 'node:assert/strict';
import test from 'node:test';
import {managementInput,managementError,withRefundTotals} from '../api/_lib/order-management.js';
import {createOrderManagementHandler} from '../api/admin-order-management.js';
const id='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',item='33333333-3333-4333-8333-333333333333';
const now=Date.parse('2026-10-28T08:00:00Z');
const request={action:'record-refund-request',order_id:id,expected_version:0,item_ids:[item],reason:'Parent requested one book refund',email_received_at:'2026-10-28T07:00:00Z'};
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
function database({allow=true,error=null}={}){const calls=[];return{calls,from(){return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:{id,reference:'BB-26-MANAGEMENT',school_id:id}};}};},async rpc(name,args){calls.push({name,args});return name==='consume_staff_auth_limit'?{data:allow}:{data:{status:'requested',management_version:1,reused:false},error};}};}
test('email-only book requests accept selected items and never accept a posted financial amount',()=>{
 const input=managementInput(request,now);assert.deepEqual(input.payload.item_ids,[item]);assert.equal(input.payload.source_email_reference,'');
 for(const change of [{amount_cents:1},{item_ids:[]},{item_ids:['invalid']},{email_received_at:'2027-01-01T00:00:00Z'},{reason:'x'},{expected_version:-1}])assert.throws(()=>managementInput({...request,...change},now));
});
test('completed book refunds require explicit external completion and dated provider evidence',()=>{
 const body={action:'record-item-refund',order_id:id,request_id:item,expected_version:2,reason:'Refund completed externally',provider_payment_id:'3480217',provider_refund_reference:'RF-123',refunded_at:'2026-10-28T07:30:00Z',confirm_external_refund:true};
 assert.equal(managementInput(body,now).payload.confirm_external_refund,true);
 for(const change of [{confirm_external_refund:false},{provider_refund_reference:'x'},{refunded_at:'2026-10-28T07:30'}])assert.throws(()=>managementInput({...body,...change},now));
});
test('corrections reject financial fields, duplicate learners and unsafe text',()=>{
 const body={action:'correct-details',order_id:id,expected_version:0,reason:'Correct spelling from parent email',parent:{first_name:'Parent',last_name:'Example',email:'PARENT@EXAMPLE.TEST',mobile:'0820000000'},learners:[{id:item,first_name:'Child',last_name:'Example'}]};
 assert.equal(managementInput(body,now).payload.parent.email,'parent@example.test');
 assert.equal(managementInput({...body,reason:'Correct spelling\nper parent email'},now).payload.reason,'Correct spelling per parent email');
 for(const change of [{parent:{...body.parent,amount_cents:1}},{learners:[{...body.learners[0],grade_id:id}]},{learners:[{...body.learners[0],class_name:'New class'}]},{learners:[...body.learners,...body.learners]},{reason:'Bad\u0000reason'}])assert.throws(()=>managementInput({...body,...change},now));
});
test('authentication and origin checks occur before any database creation',async()=>{
 for(const which of ['auth','origin']){let opened=false;const handler=createOrderManagementHandler({authorize:async()=>{if(which==='auth')throw Object.assign(Error('Denied'),{statusCode:401});return{user:{id:actor}};},checkOrigin(){if(which==='origin')throw Object.assign(Error('Denied'),{statusCode:403});},databaseFactory(){opened=true;throw Error('unexpected');}});const res=response();await handler({method:'POST',body:request},res);assert.equal(res.code,which==='auth'?401:403);assert.equal(opened,false);}
});
test('trusted actor and server-owned payload reach only the management RPC after durable limit',async()=>{
 const db=database(),handler=createOrderManagementHandler({databaseFactory:()=>db,authorize:async()=>({user:{id:actor}}),checkOrigin(){},source:{VERCEL_ENV:'production'},now:()=>now});const res=response();await handler({method:'POST',body:request},res);
 assert.equal(res.code,201);assert.equal(res.body.money_moved,false);assert.equal(db.calls[1].name,'manage_order_record');assert.equal(db.calls[1].args.p_actor,actor);assert.equal(db.calls[1].args.p_payload.amount_cents,undefined);
});
test('rate denial and preview real-order denial cannot execute management mutation',async()=>{
 for(const source of [{VERCEL_ENV:'production'},{VERCEL_ENV:'preview'}]){const db=database({allow:false}),handler=createOrderManagementHandler({databaseFactory:()=>db,authorize:async()=>({user:{id:actor}}),checkOrigin(){},source,now:()=>now});const res=response();await handler({method:'POST',body:request},res);assert.equal(res.code,source.VERCEL_ENV==='production'?429:403);assert.equal(db.calls.some(call=>call.name==='manage_order_record'),false);}
});
test('conflict errors remain actionable and refund totals preserve original payment amount',()=>{
 assert.equal(managementError({message:'MANAGEMENT_VERSION_CONFLICT'}).statusCode,409);
 const order=withRefundTotals({status:'paid',amount_cents:66000,order_item_refunds:[{amount_cents:32000}]});assert.equal(order.amount_cents,66000);assert.equal(order.refunded_amount_cents,32000);assert.equal(order.remaining_paid_amount_cents,34000);
});
test('request queue shows open work first and explicitly paginates without hiding older requests',async()=>{
 const filters=[],sort=[],ranges=[];
 const data=Array.from({length:101},(_,n)=>({id:String(n),status:'requested'}));
 const q={select(){return q;},in(key,values){filters.push([key,values]);return q;},not(key,op,value){filters.push([key,op,value]);return q;},neq(key,value){filters.push([key,'neq',value]);return q;},order(key,opts){sort.push([key,opts]);return q;},async range(start,end){ranges.push([start,end]);return{data,error:null};}};
 const handler=createOrderManagementHandler({databaseFactory:()=>({from(){return q;}}),authorize:async()=>({user:{id:actor}})}),res=response();
 await handler({method:'GET',query:{requests:'1',page:'2'}},res);
 assert.equal(res.code,200);assert.deepEqual(filters[0],['status',['requested','approved']]);assert.ok(filters.some(x=>x[0]==='orders.reference'));assert.ok(filters.some(x=>x[0]==='orders.school_id'));assert.deepEqual(sort.map(x=>x[0]),['created_at','id']);assert.deepEqual(ranges,[[100,200]]);assert.equal(res.body.requests.length,100);assert.equal(res.body.page,2);assert.equal(res.body.has_more,true);
 const invalid=response();await handler({method:'GET',query:{requests:'1',page:'0'}},invalid);assert.equal(invalid.code,400);
});
test('related order history is paginated in stable order and invalid page requests fail before record lookup',async()=>{
 let lookups=0;const sort=[],ranges=[];
 const db={from(table){const q={select(){return q;},eq(){return q;},ilike(){return q;},not(){return q;},neq(){return q;},order(key){sort.push([table,key]);return q;},limit(){return q;},async maybeSingle(){lookups++;return{data:{id,reference:'BB-REAL',school_id:item,parent_email:'parent@example.test',amount_cents:32000,status:'paid'},error:null};},async range(start,end){ranges.push([start,end]);return{data:Array.from({length:51},(_,i)=>({id:String(i)})),error:null};},then(resolve){resolve({data:[],error:null});}};return q;}};
 const handler=createOrderManagementHandler({databaseFactory:()=>db,authorize:async()=>({user:{id:actor}}),source:{VERCEL_ENV:'production'}}),res=response();
 await handler({method:'GET',query:{order_id:id,related_page:'2'}},res);assert.equal(res.code,200);assert.equal(res.body.related_page,2);assert.equal(res.body.related_orders.length,50);assert.equal(res.body.related_has_more,true);assert.deepEqual(ranges,[[50,100]]);assert.deepEqual(sort.filter(x=>x[0]==='orders').map(x=>x[1]),['created_at','id']);
 const before=lookups,bad=response();await handler({method:'GET',query:{order_id:id,related_page:'-1'}},bad);assert.equal(bad.code,400);assert.equal(lookups,before);
});
