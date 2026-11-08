import test from 'node:test';
import assert from 'node:assert/strict';
import {createSchoolListHandler,createSchoolSaveHandler} from '../api/admin-schools.js';
import {demoOrigin,demoSchoolId,demoStaffEmail} from '../api/_lib/demo-payment.js';

const realSchool='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
const preview={DEMO_PAYMENTS_ENABLED:'true',VERCEL_ENV:'preview',APP_ORIGIN:demoOrigin,SUPABASE_URL:'https://cigyxjfzbjlgbrduzcpw.supabase.co'};
const production={VERCEL_ENV:'production'};
const technical={user:{id,email:demoStaffEmail},staff:{role:'administrator',active:true}};
const another={...technical,user:{id,email:'admin@example.test'}};
const response=()=>({status(code){this.code=code;return this;},setHeader(){},json(body){this.body=body;return this;}});
function listDatabase() {
  const records={
    schools:[{id:demoSchoolId},{id:realSchool}],
    ordering_periods:[{school_id:demoSchoolId},{school_id:realSchool}],
    school_grade_offerings:[{school_id:demoSchoolId},{school_id:realSchool}],
    school_access:[{school_id:demoSchoolId,revoked_at:null},{school_id:realSchool,revoked_at:null}],
    academic_years:[{id}],grades:[{id}],books:[{id}],
  };
  return {from(table){const filters=[];const query={
    select(){return query;},order(){return query;},is(key,value){filters.push(row=>row[key]===value);return query;},
    neq(key,value){filters.push(row=>row[key]!==value);return query;},
    then(resolve,reject){return Promise.resolve({data:records[table].filter(row=>filters.every(f=>f(row))),error:null}).then(resolve,reject);},
  };return query;}};
}
function body(schoolId){return {school:{id:schoolId,slug:'some-school',name:'Some School',status:'active'},
  period:{academic_year_id:id,name:'2027',opens_at:'2026-01-01',closes_at:'2028-01-01',status:'open'},
  offerings:[{grade_id:id,book_id:id,price_cents:100,expected_quantity:10}]};}

test('live school catalog excludes the test school and every linked collection',async()=>{
  for(const [source,expected] of [[production,1],[preview,2]]){
    const res=response();await createSchoolListHandler({authorize:async()=>technical,databaseFactory:listDatabase,source})({},res);
    assert.equal(res.code,200);
    for(const key of ['schools','periods','offerings','access_links'])assert.equal(res.body[key].length,expected,key);
    assert.equal(res.body.books.length,1);assert.equal(res.body.academic_years.length,1);
  }
});

test('live test-school writes and preview writes to live schools or shared years are rejected before database operations',async()=>{
  for(const [source,actor,payload,status] of [
    [production,technical,body(demoSchoolId),404],
    [preview,technical,body(realSchool),403],
    [preview,technical,body(null),403],
    [preview,another,body(demoSchoolId),404],
    [preview,technical,{action:'create_academic_year',year:2028},403],
    [{...preview,DEMO_PAYMENTS_ENABLED:'false'},technical,body(realSchool),403],
  ]){
    let queries=0;const db={from(){queries++;throw Error('Unexpected database operation');}};
    const handler=createSchoolSaveHandler({checkOrigin(){},authorize:async()=>actor,databaseFactory:()=>db,source});
    const res=response();await handler({body:payload},res);assert.equal(res.code,status);assert.equal(queries,0);
  }
});

test('production can reach validation for a real school and the dedicated technical account can reach validation for the preview school',async()=>{
  for(const [source,schoolId] of [[production,realSchool],[preview,demoSchoolId]]){
    let queries=0;const db={from(table){queries++;assert.equal(table,'books');const query={select(){return query;},in(){return Promise.resolve({data:[],error:null});}};return query;}};
    const handler=createSchoolSaveHandler({checkOrigin(){},authorize:async()=>technical,databaseFactory:()=>db,source});
    const res=response();await handler({body:body(schoolId)},res);assert.equal(res.code,400);assert.match(res.body.error,/book does not match/i);assert.equal(queries,1);
  }
});

test('a preview school edit cannot attach or mutate a different school’s period',async()=>{
  let writes=0;const db={from(table){assert.equal(table,'ordering_periods');const query={select(){return query;},eq(){return query;},
    maybeSingle:async()=>({data:null,error:null}),update(){writes++;throw Error('Unexpected write');},insert(){writes++;throw Error('Unexpected write');}};return query;}};
  const payload=body(demoSchoolId);payload.period.id=id;
  const handler=createSchoolSaveHandler({checkOrigin(){},authorize:async()=>technical,databaseFactory:()=>db,source:preview});
  const res=response();await handler({body:payload},res);
  assert.equal(res.code,400);assert.match(res.body.error,/does not belong/i);assert.equal(writes,0);
});

test('school setup rejects enabling class collection before any database query',async()=>{
  for(const value of [true,'true',1]){
    const payload=body(realSchool);payload.period.class_required=value;let queries=0;
    const handler=createSchoolSaveHandler({checkOrigin(){},authorize:async()=>technical,databaseFactory:()=>({from(){queries++;throw Error('Unexpected database query');}}),source:production});
    const res=response();await handler({body:payload},res);assert.equal(res.code,400);assert.match(res.body.error,/Classes are not collected/);assert.equal(queries,0);
  }
});
