import assert from 'node:assert/strict';
import test from 'node:test';
import {managementDialogHtml,managementPayload,refundableItems,requestQueueHtml,orderManagementAction,orderRefundNote,initOrderManagement} from '../assets/order-management.js';

const order={id:'11111111-1111-4111-8111-111111111111',reference:'BB-26-MANAGEMENT',status:'paid',management_version:7,amount_cents:66000,refunded_amount_cents:0,remaining_paid_amount_cents:66000,parent_first_name:'Test',parent_last_name:'Parent',parent_email:'parent@example.invalid',parent_mobile:'0820000000',schools:{name:'Fictional School'},learners:[{id:'child-1',first_name:'First',last_name:'Child',class_name:'A',grades:{name:'Grade 1'}},{id:'child-2',first_name:'Second',last_name:'Child',class_name:'B',grades:{name:'Grade 5'}}],order_items:[{id:'item-1',learner_id:'child-1',description_snapshot:'Grade 1 workbook',quantity:1,line_total_cents:32000},{id:'item-2',learner_id:'child-2',description_snapshot:'Grade 5 workbook',quantity:1,line_total_cents:34000}],payment_attempts:[{status:'complete',provider_payment_id:'12345'}],order_refunds:[],order_item_refunds:[],refund_requests:[]};
const detail={order,related_orders:[{id:'other-order',reference:'BB-26-OTHER',status:'paid',schools:{name:'Other School'}}],audit:[{action:'details_corrected',created_at:'2026-10-28T07:00:00Z',details:{before:'Old',after:'New'}}]};
test('staff management is readable by viewers while all mutation forms are administrator-only',()=>{
  for(const language of ['en','af']){
    const viewer=managementDialogHtml(detail,{language}),admin=managementDialogHtml(detail,{language,administrator:true});
    assert.match(viewer,/parent@example.invalid/);assert.match(viewer,/BB-26-OTHER/);assert.match(viewer,/details_corrected/);
    assert.doesNotMatch(viewer,/data-management-form=/);assert.match(admin,/data-management-form="correct-details"/);assert.match(admin,/data-management-form="record-refund-request"/);assert.doesNotMatch(admin,/learner_class_|names\/classes|name\/klasse/);
    assert.match(orderManagementAction(order,{language}),/data-manage-order=/);assert.equal(orderManagementAction(order,{preview:true}),'');
  }
});
test('request recording is per book, email-origin, and excludes previously refunded books or an open request',()=>{
  assert.deepEqual(refundableItems(order).map(item=>item.id),['item-1','item-2']);
  const partial={...order,order_item_refunds:[{order_item_id:'item-1',amount_cents:32000}],refunded_amount_cents:32000,remaining_paid_amount_cents:34000};
  assert.deepEqual(refundableItems(partial).map(item=>item.id),['item-2']);
  const html=managementDialogHtml({order:partial},{administrator:true,language:'en'});
  assert.doesNotMatch(html,/name="item_ids" value="item-1"/);assert.match(html,/name="item_ids" value="item-2"/);assert.match(html,/Parents request refunds by emailing/);assert.match(html,/do not automatically send email/);assert.match(html,/Partially refunded/);
  const requested=managementDialogHtml({order:{...order,refund_requests:[{id:'request-1',status:'requested',item_ids:['item-1'],amount_cents:32000,reason:'Email request'}]}},{administrator:true,language:'en'});
  assert.doesNotMatch(requested,/data-management-form="record-refund-request"/);assert.match(requested,/data-management-form="review-refund-request"/);assert.doesNotMatch(requested,/data-management-form="record-item-refund"/);
  assert.equal(refundableItems({...order,status:'refunded'}).length,0);
});
test('approval and completed provider refund are distinct UI actions with explicit evidence and no refund API',()=>{
  const approved=managementDialogHtml({order:{...order,refund_requests:[{id:'request-1',status:'approved',item_ids:['item-1'],amount_cents:32000,reason:'Email request'}]}},{administrator:true,language:'en'});
  assert.match(approved,/Approved; refund pending/);assert.match(approved,/data-management-form="record-item-refund"/);assert.match(approved,/Complete the refund in PayFast first/);assert.match(approved,/name="confirm_external_refund" type="checkbox" required/);assert.match(approved,/name="provider_payment_id" value="12345" readonly/);
  assert.doesNotMatch(approved,/api\.payfast|Send refund now|type="submit">Approve/);
});
test('untrusted contact, learner, audit and email subject data are escaped in detail and queue rendering',()=>{
  const malicious='<img src=x onerror=alert(1)>';
  const html=managementDialogHtml({...detail,order:{...order,parent_first_name:malicious,refund_requests:[{id:'request-1',status:'rejected',item_ids:[],reason:malicious,source_email_reference:malicious}]},audit:[{action:malicious,created_at:'2026-10-28T07:00:00Z',details:{value:malicious}}]},{administrator:true});
  assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img src=x/);
  const queue=requestQueueHtml([{id:'request-1',order_id:order.id,status:'requested',reason:malicious,amount_cents:32000,orders:{...order,parent_first_name:malicious}}]);assert.doesNotMatch(queue,/<img src=x/);
});
test('submitted management payloads retain canonical version and selected items without client financial edits',()=>{
  const request=managementPayload('record-refund-request',{reason:'Parent emailed',email_received_at:'2026-10-28T07:00:00Z',source_email_reference:'Received subject',amount_cents:1},order,{itemIds:['item-2']});
  assert.deepEqual(request.item_ids,['item-2']);assert.equal(request.expected_version,7);assert.equal(request.email_received_at,'2026-10-28T07:00:00.000Z');assert.equal('amount_cents' in request,false);
  assert.throws(()=>managementPayload('record-refund-request',{email_received_at:'invalid'},order,{itemIds:[]}));
  const corrected=managementPayload('correct-details',{reason:'Typo correction',parent_first_name:'Changed',parent_last_name:'Parent',parent_email:'parent@example.invalid',parent_mobile:'0820000000','learner_first_child-1':'First','learner_last_child-1':'Child','learner_class_child-1':'A','learner_first_child-2':'Second','learner_last_child-2':'Child'},order);
  assert.deepEqual(Object.keys(corrected.parent).sort(),['email','first_name','last_name','mobile']);assert.equal(corrected.learners.length,2);assert.equal('grade_id' in corrected.learners[0],false);assert.equal('class_name' in corrected.learners[0],false);assert.equal('amount_cents' in corrected,false);
  const completed=managementPayload('record-item-refund',{reason:'Completed in PayFast',provider_payment_id:'12345',provider_refund_reference:'R-1',refunded_at:'2026-10-28T07:00:00Z',confirm_external_refund:'on'},order,{requestId:'request-1'});
  assert.equal(completed.request_id,'request-1');assert.equal(completed.confirm_external_refund,true);assert.equal('amount_cents' in completed,false);assert.throws(()=>managementPayload('record-item-refund',{confirm_external_refund:''},order));
});
test('order row shows partial refund and remaining paid amounts without replacing original amount',()=>{
  assert.equal(orderRefundNote(order),'');const html=orderRefundNote({...order,order_item_refunds:[{amount_cents:32000}]},{language:'en'});assert.match(html,/Refunded/);assert.match(html,/Remaining paid/);assert.match(html,/320/);assert.match(html,/340/);
});
test('refund queue explains pending approval status in both supported languages',()=>{
  const requests=[{order_id:'order-1',status:'approved',amount_cents:32000,orders:{reference:'BB-TEST'}}];
  assert.match(requestQueueHtml(requests,{language:'en'}),/Approved; refund pending/);
  assert.match(requestQueueHtml(requests,{language:'af'}),/Goedgekeur; terugbetaling hangend/);
});
test('open refund requests remain navigable beyond the first page',()=>{
  const first=requestQueueHtml([],{language:'en',page:1,hasMore:true});assert.match(first,/Open refund requests/);assert.match(first,/data-queue-page="2"/);assert.doesNotMatch(first,/data-queue-page="0"/);
  const next=requestQueueHtml([],{language:'af',page:2,hasMore:false});assert.match(next,/data-queue-page="1"/);assert.doesNotMatch(next,/data-queue-page="3"/);assert.match(next,/Voltooide en afgekeurde/);
});
test('related orders show previous and next page controls when more matches exist',()=>{
  const first=managementDialogHtml({...detail,related_page:1,related_has_more:true},{language:'en'});assert.match(first,/data-related-page="2"/);assert.doesNotMatch(first,/data-related-page="0"/);
  const next=managementDialogHtml({...detail,related_page:2,related_has_more:false},{language:'af'});assert.match(next,/data-related-page="1"/);assert.doesNotMatch(next,/data-related-page="3"/);
});
test('the open-request queue loads later pages and can navigate back',async()=>{
  const original=globalThis.document,rows={addEventListener(){}},queue={addEventListener(_event,handler){this.click=handler;},focus(){}},requests=[],dialogs=[];
  const heading={focus(){}};
  globalThis.document={body:{append(dialog){dialogs.push(dialog);}},createElement(){return {open:false,events:{},innerHTML:'',setAttribute(){},addEventListener(name,handler){this.events[name]=handler;},showModal(){this.open=true;},close(){this.open=false;this.events.close();},remove(){},querySelector(){return heading;},querySelectorAll(){return []}};}};
  try{
    initOrderManagement({rows,queueButton:queue,getStaff:()=>({role:'viewer'}),preview:false,language:'en',api:async url=>{requests.push(url);const page=Number(new URL(url,'https://example.test').searchParams.get('page'));return {requests:[],page,has_more:page===1};}});
    queue.click();await new Promise(setImmediate);assert.match(dialogs[0].innerHTML,/data-queue-page="2"/);
    dialogs[0].events.click({target:{closest:selector=>selector==='[data-queue-page]'?{dataset:{queuePage:'2'}}:null}});await new Promise(setImmediate);
    assert.match(requests[1],/requests=1&page=2/);assert.match(dialogs[0].innerHTML,/data-queue-page="1"/);assert.doesNotMatch(dialogs[0].innerHTML,/data-queue-page="3"/);
  }finally{globalThis.document=original;}
});
test('related-order page buttons reload the same order with the requested page',async()=>{
  const original=globalThis.document,rows={addEventListener(_event,handler){this.click=handler;}},requests=[],dialogs=[],heading={focus(){}},feedback={textContent:''};
  globalThis.document={body:{append(dialog){dialogs.push(dialog);}},createElement(){return {open:false,events:{},innerHTML:'',setAttribute(){},addEventListener(name,handler){this.events[name]=handler;},showModal(){this.open=true;},close(){this.open=false;this.events.close();},remove(){},querySelector(selector){return selector==='h2'?heading:feedback;},querySelectorAll(){return []}};}};
  try{
    initOrderManagement({rows,getStaff:()=>({role:'viewer'}),preview:false,language:'en',api:async url=>{requests.push(url);return {...detail,related_page:requests.length,related_has_more:requests.length===1};}});
    rows.click({target:{closest:selector=>selector==='[data-manage-order]'?{dataset:{manageOrder:order.id},focus(){}}:null}});await new Promise(setImmediate);assert.match(dialogs[0].innerHTML,/data-related-page="2"/);
    dialogs[0].events.click({target:{closest:selector=>selector==='[data-related-page]'?{dataset:{relatedPage:'2'}}:null}});await new Promise(setImmediate);
    assert.match(requests[1],new RegExp(`order_id=${order.id}&related_page=2`));assert.match(dialogs[0].innerHTML,/data-related-page="1"/);
  }finally{globalThis.document=original;}
});

test('stale detail responses cannot overwrite the newer order or a closed dialog',async()=>{
  const original=globalThis.document,rows={addEventListener(_event,handler){this.click=handler;}},dialogs=[],requests=[];
  function control(){return {disabled:false,focus(){},matches(selector){return selector==='[data-management-close]';}};}
  globalThis.document={body:{append(dialog){dialogs.push(dialog);}},createElement(){const title=control(),feedback={textContent:''};return {open:false,events:{},innerHTML:'',setAttribute(){},addEventListener(name,handler){this.events[name]=handler;},showModal(){this.open=true;},close(){this.open=false;this.events.close();},remove(){this.removed=true;},querySelector(selector){return selector==='h2'?title:feedback;},querySelectorAll(){return []}};}};
  try{
    initOrderManagement({rows,getStaff:()=>({role:'viewer'}),preview:false,language:'en',api:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject}))});
    const first={dataset:{manageOrder:'order-first'},focus(){}};rows.click({target:{closest:()=>first}});
    const second={dataset:{manageOrder:'order-second'},focus(){}};rows.click({target:{closest:()=>second}});
    requests[1].resolve({...detail,order:{...order,reference:'BB-26-NEWER'}});await new Promise(setImmediate);
    requests[0].resolve({...detail,order:{...order,reference:'BB-26-STALE'}});await new Promise(setImmediate);
    assert.match(dialogs[1].innerHTML,/BB-26-NEWER/);assert.doesNotMatch(dialogs[1].innerHTML,/BB-26-STALE/);
    dialogs[1].close();assert.equal(dialogs[1].removed,true);
    rows.click({target:{closest:()=>first}});requests[2].reject(Error('<unsafe error>'));await new Promise(setImmediate);
    assert.match(dialogs[2].innerHTML,/role="alert"/);assert.match(dialogs[2].innerHTML,/&lt;unsafe error&gt;/);
  }finally{globalThis.document=original;}
});
