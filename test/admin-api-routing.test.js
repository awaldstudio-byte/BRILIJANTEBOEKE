import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const app=await readFile(new URL('../assets/admin-app.js',import.meta.url),'utf8');
const helper=app.slice(app.indexOf('async function api('),app.indexOf('\nfunction emptyRow('));

test('admin API requests use canonical routes while preserving queries and mutation payloads',async()=>{
  const requests=[];
  const api=runInNewContext(`${helper}\napi`,{
    fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({accepted:true})};},
    tr:(_af,en)=>en,
  });
  for(const url of ['/api/admin-dashboard?session=1','/api/admin-orders/?status=paid','/api/admin-fulfilment']){
    await api(url);
  }
  const body=JSON.stringify({id:'synthetic-batch',status:'dispatched',confirm_notifications:true});
  await api('/api/admin-fulfilment',{method:'PATCH',body});
  await api('/api/admin-fulfilment/',{method:'POST',body:'{}'});
  assert.deepEqual(requests.map(request=>request.url),[
    '/api/admin-dashboard/?session=1','/api/admin-orders/?status=paid','/api/admin-fulfilment/',
    '/api/admin-fulfilment/','/api/admin-fulfilment/',
  ]);
  assert.equal(requests[3].options.method,'PATCH');
  assert.equal(requests[3].options.body,body);
  assert.equal(requests[3].options.credentials,'same-origin');
  assert.equal(requests[3].options.headers['Content-Type'],'application/json');
  assert.equal(requests[4].options.method,'POST');
});
