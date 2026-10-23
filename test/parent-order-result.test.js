import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parentOrderResult} from '../assets/parent-order-result.js';
import {orderEmailContent} from '../api/_lib/order-email-design.js';
const parent={first_name:'Ayesha',last_name:'Dlamini',email:'ayesha@example.test'};
const order={reference:'DEMO-BB-26-CUSTOM',amount_cents:32000};

test('parent completion uses entered names and email with only the parent order-status link',()=>{
  for(const language of ['en','af']){
    const html=parentOrderResult({order,parent,language});
    assert.match(html,/Ayesha/);assert.match(html,/ayesha@example.test/);assert.match(html,/DEMO-BB-26-CUSTOM/);
    assert.match(html,/\/order\/status\//);
    assert.doesNotMatch(html,/\/admin\/|Open administration|technical@|notification records|mail server|Demo Parent/);
    assert.equal((html.match(/<a /g)||[]).length,1);
  }
});
test('parent HTML cannot turn entered names or addresses into markup',()=>{
  const html=parentOrderResult({order,parent:{...parent,first_name:'<img src=x>',email:'<script>@example.test'}});
  assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<img|<script/);
});
test('parent ordering and status screens contain no internal dashboard shortcut or staff routing',async()=>{
  for(const file of ['assets/order-app.js','assets/order-status.js','order/index.html','order/status/index.html']){
    const source=await readFile(new URL(`../${file}`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\/admin\/|Open administration|technical@awaldstudio\.com|notification records/);
  }
});
test('entered parent and learner names reach confirmation emails without demo-name substitution',()=>{
  const content=orderEmailContent({...order,parent_first_name:parent.first_name,parent_last_name:parent.last_name,parent_email:parent.email,
    order_items:[{description_snapshot:'Grade 1 Workbook',quantity:1,line_total_cents:32000,learners:{first_name:'Lebo',last_name:'Dlamini'}}]},
    {parent:true,demo:true,replyTo:'info@briljanteboeke.co.za',appOrigin:'https://example.test'});
  assert.match(content.html,/Hello Ayesha/);assert.match(content.html,/Lebo Dlamini/);
  assert.doesNotMatch(content.html,/Demo Parent|Demo Learner|\/admin\//);
});
