import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSchoolProgress,readSchoolPaymentProgress} from '../api/_lib/school-payment-progress.js';
import {orderEmailContent} from '../api/_lib/order-email-design.js';
import {paidOrderMessage} from '../api/_lib/order-mail.js';
const offerings=[1,2].map(n=>({id:`offering-${n}`,grade_id:`grade-${n}`,school_id:'school-1',ordering_period_id:'period-1',active:true,expected_quantity:2,price_cents:n===1?32000:34000,grades:{name:`Grade ${n}`,sort_order:n}}));
const clock='2026-10-23T12:00:00Z';
test('school totals include paid quantities and actual recorded prices, with no cross-grade offset',()=>{
  const result=calculateSchoolProgress(offerings,[{offering_id:'offering-1',quantity:3,line_total_cents:90000}],clock);
  assert.deepEqual(result.totals,{expected:4,paid:3,outstanding:2,expected_value_cents:132000,paid_value_cents:90000,outstanding_value_cents:68000});
  assert.equal(result.grades[0].outstanding,0);assert.equal(result.grades[1].outstanding,2);assert.equal(result.captured_at,clock);
});
test('inactive grades have no expected allocation but their previous paid lines remain visible',()=>{
  const result=calculateSchoolProgress([{...offerings[0],active:false}],[{offering_id:'offering-1',quantity:1,line_total_cents:30000}],clock);
  assert.equal(result.totals.expected,0);assert.equal(result.totals.paid,1);assert.equal(result.totals.paid_value_cents,30000);assert.equal(result.totals.outstanding,0);
});
test('invalid totals fail rather than sending an invented or negative figure',()=>{
  assert.throws(()=>calculateSchoolProgress([{...offerings[0],expected_quantity:-1}],[]),/could not/);
  assert.throws(()=>calculateSchoolProgress(offerings,[{offering_id:'offering-1',quantity:1,line_total_cents:'32000'}]),/could not/);
});
function database(){
  const calls=[];
  const paid={school_id:'school-1',ordering_period_id:'period-1',status:'paid',reference:'BB-26-ONE'};
  const tables={school_grade_offerings:[...offerings,{...offerings[0],school_id:'other-school',expected_quantity:999}],order_items:[
    ...Array.from({length:1001},(_,i)=>({id:String(i).padStart(5,'0'),offering_id:'offering-1',quantity:1,line_total_cents:32000,orders:paid})),
    {id:'other',offering_id:'offering-1',quantity:999,line_total_cents:999,orders:{...paid,school_id:'other-school'}},
    {id:'year',offering_id:'offering-1',quantity:999,line_total_cents:999,orders:{...paid,ordering_period_id:'other-period'}},
    {id:'pending',offering_id:'offering-1',quantity:999,line_total_cents:999,orders:{...paid,status:'pending_payment'}},
    {id:'refunded',offering_id:'offering-1',quantity:999,line_total_cents:999,orders:{...paid,status:'refunded'}},
    {id:'demo',offering_id:'offering-2',quantity:1,line_total_cents:34000,orders:{...paid,reference:'DEMO-BB-26-ONE'}},
  ]};
  return {calls,from(table){const predicates=[];const value=(row,key)=>key.split('.').reduce((a,b)=>a?.[b],row);const q={select(){return q;},order(){return q;},
    eq(key,expected){calls.push([table,key,expected]);predicates.push(row=>value(row,key)===expected);return q;},
    like(key){predicates.push(row=>value(row,key).startsWith('DEMO-'));return q;},not(key){predicates.push(row=>!value(row,key).startsWith('DEMO-'));return q;},
    async range(from,to){calls.push(['range',from,to]);return {data:tables[table].filter(row=>predicates.every(p=>p(row))).slice(from,to+1)};}};return q;}};
}
test('loader paginates all paid items and isolates the school, period, paid status and real/demo category',async()=>{
  for(const [reference,quantity,value] of [['BB-26-ONE',1001,32032000],['DEMO-BB-26-ONE',1,34000]]){
    const db=database();const result=await readSchoolPaymentProgress(db,{school_id:'school-1',ordering_period_id:'period-1',reference},{now:()=>clock});
    assert.equal(result.totals.expected,4);assert.equal(result.totals.paid,quantity);assert.equal(result.totals.paid_value_cents,value);
    if(quantity>1000)assert.ok(db.calls.some(call=>call[0]==='range'&&call[1]===1000));
  }
});
test('staff HTML and text contain progress; parent confirmation never receives school-wide totals',()=>{
  const school_progress=calculateSchoolProgress(offerings,[{offering_id:'offering-1',quantity:1,line_total_cents:32000}],clock);
  const order={reference:'BB-26-ONE',amount_cents:32000,schools:{name:'Test School'},ordering_periods:{academic_years:{year:2027}},school_progress};
  const options={replyTo:'info@briljanteboeke.co.za',appOrigin:'https://example.test'};
  const staff=orderEmailContent(order,{...options,parent:false});
  assert.match(staff.html,/School progress/);assert.match(staff.html,/Progress by grade/);assert.match(staff.html,/Outstanding value/);assert.match(staff.text,/expected 4 \| paid 1 \| outstanding 3/);
  assert.match(staff.text,/not an identified list of children with unpaid orders/);assert.match(staff.text,/Grade 2: expected 2 \| paid 0 \| outstanding 2/);
  const parent=orderEmailContent(order,{...options,parent:true});assert.doesNotMatch(parent.html,/School progress|Progress by grade|Outstanding value/);assert.doesNotMatch(parent.text,/Books: expected/);
});
test('a staff notification cannot silently omit progress when the lookup fails',()=>{
  assert.throws(()=>paidOrderMessage({id:'11111111-1111-4111-8111-111111111111',kind:'staff_order_paid',recipient:'technical@awaldstudio.com'},
    {status:'paid',paid_at:clock,reference:'BB-26-ONE',amount_cents:32000,parent_email:'parent@example.test'},
    {staff:['technical@awaldstudio.com']}),/School progress is required/);
});
test('email-safe overall and grade bars are labelled, bounded and do not count overpaid grades against another grade',()=>{
  const school_progress=calculateSchoolProgress(offerings,[{offering_id:'offering-1',quantity:3,line_total_cents:96000}],clock);
  const content=orderEmailContent({reference:'BB-26-ONE',amount_cents:96000,school_progress},{parent:false,replyTo:'info@briljanteboeke.co.za',appOrigin:'https://example.test'});
  assert.match(content.text,/Overall progress: 50%/);assert.match(content.html,/Overall progress: 50%/);
  assert.match(content.html,/100% of expected books paid/);assert.match(content.html,/0% of expected books paid/);
  assert.doesNotMatch(content.html,/<script|<progress|width="150%"/);assert.match(content.html,/width="50%"/);
});
