import test from 'node:test';
import assert from 'node:assert/strict';
import {refundBalance,isRefundedItem,readFinancialRows} from '../api/_lib/refund-balances.js';
import {calculateSchoolProgress} from '../api/_lib/school-payment-progress.js';
import {buildReport,loadReport} from '../api/_lib/report-data.js';

test('one refunded book preserves the original receipt and reduces only its net balance and paid grade count',()=>{
  const order={id:'order',reference:'BB-TEST',amount_cents:66000,order_item_refunds:[{amount_cents:32000}]};
  assert.deepEqual(refundBalance(order),{original_cents:66000,refunded_cents:32000,net_cents:34000});
  const offerings=[{id:'one',grade_id:'g1',price_cents:32000,expected_quantity:1,active:true},{id:'two',grade_id:'g5',price_cents:34000,expected_quantity:1,active:true}];
  const items=[{offering_id:'one',quantity:1,line_total_cents:32000,order_item_refunds:{id:'refund'}},{offering_id:'two',quantity:1,line_total_cents:34000,order_item_refunds:null}];
  const progress=calculateSchoolProgress(offerings,items);assert.equal(progress.totals.paid,1);assert.equal(progress.totals.paid_value_cents,34000);assert.equal(progress.totals.outstanding,1);
  const report=buildReport({orders:[order],rows:[{quantity:1,reference:order.reference}]});
  assert.equal(report.totalCents,34000);const transaction=report.sections.find(s=>s.internal);assert.equal(transaction.rows[0].originalAmount,660);assert.equal(transaction.rows[0].refundedAmount,320);assert.equal(transaction.rows[0].amount,340);assert.match(transaction.columns.find(c=>c.key==='amount').label,/Net paid/);
  assert.equal(order.amount_cents,66000);assert.equal(isRefundedItem(items[0]),true);
});
test('malformed and excessive refunds fail reconciliation rather than showing invented totals',()=>{
  for(const refunds of [[{amount_cents:66001}],[{amount_cents:-1}],[{amount_cents:'32000'}],{}])assert.throws(()=>refundBalance({amount_cents:66000,order_item_refunds:refunds}),{statusCode:503});
});
test('financial reads include later pages and propagate storage failures',async()=>{
  let page=0;const result=await readFinancialRows(()=>({range:async()=>({data:page++===0?Array.from({length:500},(_,i)=>({id:i})):[{id:500}]})}));assert.equal(result.data.length,501);
  await assert.rejects(readFinancialRows(()=>({range:async()=>({error:{code:'failed'}})})),{statusCode:503});
});
test('actual report loader omits the refunded learner and reconciles remaining item totals',async()=>{
  const order={id:'o',reference:'BB-TEST',amount_cents:66000,order_item_refunds:[{amount_cents:32000}]};
  const items=[{id:'a',order_id:'o',quantity:1,line_total_cents:32000,order_item_refunds:{id:'r'},learners:{first_name:'Refunded',last_name:'Learner',grades:{name:'Grade 1'}}},{id:'b',order_id:'o',quantity:1,line_total_cents:34000,order_item_refunds:null,learners:{first_name:'Retained',last_name:'Learner',grades:{name:'Grade 5'}}}];
  const db={from(table){const q={select(){return q;},eq(){return q;},lte(){return q;},not(){return q;},neq(){return q;},order(){return q;},limit(){return q;},then(resolve){resolve({data:table==='orders'?[order]:items,error:null});}};return q;}};
  const report=await loadReport(db,{language:'en'},{logoReader:async()=>null});assert.equal(report.quantity,1);assert.equal(report.rows[0].learner,'Retained Learner');assert.equal(report.totalCents,34000);
  items[1].line_total_cents=33000;await assert.rejects(loadReport(db,{language:'en'},{logoReader:async()=>null}),{statusCode:409});
});
