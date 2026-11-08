import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../assets/admin-app.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function renderOrderPagination(){'),source.indexOf('$("#order-filters").addEventListener'));
function harness(api){
  const elements=new Map(['#orders-pagination','#orders-previous','#orders-next','#orders-page-info','#order-filters'].map(key=>[key,{hidden:false,disabled:false,textContent:'',setAttribute(name,value){this[name]=value;}}]));
  let rendered=[];
  const context={URLSearchParams,preview:false,api,tr:(_af,en)=>en,$:key=>elements.get(key),renderOrders:orders=>{rendered=orders;},FormData:class{*[Symbol.iterator](){yield ['search','Parent'];yield ['status','paid'];}},alert:message=>{throw Error(message);}};
  const result=runInNewContext(`let orderPage=1,orderTotal=0,orderPageSize=50,orderLoadGeneration=0;const state={orders:[]};${functions};({loadOrderPage,state,getPage:()=>orderPage})`,context);
  return {...result,elements,rendered:()=>rendered};
}
test('order pages preserve search filters and expose only valid previous and next navigation',async()=>{
  const requests=[];const page=harness(async url=>{requests.push(url);return {orders:[{id:'match'}],page:2,page_size:50,total:120};});
  await page.loadOrderPage(2);const url=new URL(requests[0],'https://example.test');assert.equal(url.searchParams.get('search'),'Parent');assert.equal(url.searchParams.get('status'),'paid');assert.equal(url.searchParams.get('page'),'2');
  assert.equal(page.getPage(),2);assert.equal(page.rendered()[0].id,'match');assert.equal(page.elements.get('#orders-previous').disabled,false);assert.equal(page.elements.get('#orders-next').disabled,false);assert.equal(page.elements.get('#orders-page-info').textContent,'Page 2 of 3');
});
test('a stale page response cannot overwrite a newer search result',async()=>{
  const waiting=[];const page=harness(url=>new Promise(resolve=>waiting.push({url,resolve})));
  const old=page.loadOrderPage(2),latest=page.loadOrderPage(1);waiting[1].resolve({orders:[{id:'new'}],page:1,page_size:50,total:1});await latest;waiting[0].resolve({orders:[{id:'old'}],page:2,page_size:50,total:80});await old;
  assert.equal(page.rendered()[0].id,'new');assert.equal(page.getPage(),1);assert.equal(page.elements.get('#orders-pagination').hidden,true);
});
