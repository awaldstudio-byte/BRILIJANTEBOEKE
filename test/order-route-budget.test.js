import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createAdminOrderRouter,createAdminOrdersHandler} from '../api/admin-orders.js';
import {createOrderManagementHandler} from '../api/_lib/admin-order-management-handler.js';

function response(){return {headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},end(body){this.body=body;return this;}};}

test('order router preserves request, response and query/body data for both handlers',async()=>{
  const seen=[];
  const router=createAdminOrderRouter({ordersHandler:(req,res)=>{seen.push(['orders',req,res]);return 'orders-result';},managementHandler:(req,res)=>{seen.push(['management',req,res]);return 'management-result';}});
  const ordinary={method:'GET',query:{search:'Parent',page:'2'}},ordinaryResponse=response();
  assert.equal(await router(ordinary,ordinaryResponse),'orders-result');
  const management={method:'POST',query:{management:'1',order_id:'order',related_page:'3'},body:{action:'correct-details',expected_version:2}},managementResponse=response();
  assert.equal(await router(management,managementResponse),'management-result');
  assert.deepEqual(seen,[['orders',ordinary,ordinaryResponse],['management',management,managementResponse]]);
  assert.deepEqual(management.query,{management:'1',order_id:'order',related_page:'3'});
  assert.deepEqual(management.body,{action:'correct-details',expected_version:2});
});

test('ambiguous route markers cannot dispatch a request',async()=>{
  let calls=0;const router=createAdminOrderRouter({ordersHandler(){calls++;},managementHandler(){calls++;}});
  for(const marker of [['1','0'],'0','',{},null]){const res=response();await router({query:{management:marker}},res);assert.equal(res.code,400);}
  assert.equal(calls,0);
});

test('both routed APIs retain origin and staff checks before database access',async()=>{
  let databaseCalls=0;
  const databaseFactory=()=>{databaseCalls++;throw Error('Must not access database');};
  for(const management of [undefined,'1']){
    for(const method of ['GET','POST']){
      const denied=Object.assign(Error('Staff access denied'),{statusCode:401});
      const deps={databaseFactory,checkOrigin(){},authorize:async()=>{throw denied;}};
      const router=createAdminOrderRouter({ordersHandler:createAdminOrdersHandler(deps),managementHandler:createOrderManagementHandler(deps)}),res=response();
      await router({method,query:management?{management}:{}},res);assert.equal(res.code,401);
    }
    const deps={databaseFactory,checkOrigin(){throw Object.assign(Error('Origin denied'),{statusCode:403});},authorize:async()=>{throw Error('Must not authorize');}};
    const router=createAdminOrderRouter({ordersHandler:createAdminOrdersHandler(deps),managementHandler:createOrderManagementHandler(deps)}),res=response();
    await router({method:'POST',query:management?{management}:{}},res);assert.equal(res.code,403);
  }
  assert.equal(databaseCalls,0);
});

test('management URL rewrites keep its canonical public route behind the order function',async()=>{
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  for(const pathname of ['/api/admin-order-management','/api/admin-order-management/']){
    const rewrite=config.rewrites.find(rule=>rule.source===pathname);
    assert.ok(rewrite,`Missing rewrite for ${pathname}`);
    const destination=new URL(rewrite.destination,'https://example.invalid');
    assert.equal(destination.pathname,'/api/admin-orders');assert.equal(destination.searchParams.get('management'),'1');
  }
  assert.equal((await readdir(new URL('../api/',import.meta.url))).includes('admin-order-management.js'),false);
});

test('deployable API handlers fit the current twelve-function hosting allowance',async()=>{
  const handlers=[];
  async function inspect(directory){for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.name.startsWith('_')||entry.name.startsWith('.'))continue;const path=new URL(`${entry.name}${entry.isDirectory()?'/':''}`,directory);if(entry.isDirectory())await inspect(path);else if(entry.name.endsWith('.js'))handlers.push(path.pathname);}}
  await inspect(new URL('../api/',import.meta.url));
  assert.ok(handlers.length<=12,`Found ${handlers.length} deployable API handlers; current hosting allowance is 12.`);
  assert.equal(handlers.length,12);
});
