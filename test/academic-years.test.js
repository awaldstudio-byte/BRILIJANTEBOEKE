import test from 'node:test';
import assert from 'node:assert/strict';
import { academicYearValue, addAcademicYear, assertPeriodYear } from '../api/_lib/academic-years.js';
import { createSchoolSaveHandler } from '../api/admin-schools.js';
import { periodForYear } from '../assets/academic-years.js';

const actor={user:{id:'11111111-1111-4111-8111-111111111111'},staff:{role:'administrator',active:true}};
function fakeDatabase(years=[]) {
  const calls=[], audits=[];let failure=null;
  const db={calls,audits,years,fail(error){failure=error;},from(table){
    const filters=[];let upsert,insert;
    const query={select(){return query;},eq(key,value){filters.push(row=>row[key]===value);return query;},
      upsert(row,options){upsert={row,options};return query;},insert(row){insert=row;return query;},
      async maybeSingle(){return execute();},then(resolve,reject){return execute().then(resolve,reject);}};
    async function execute(){calls.push({table,upsert,insert});if(failure)return {error:failure};
      if(insert){audits.push(insert);return {data:null};}
      if(upsert){assert.deepEqual(upsert.options,{onConflict:'year',ignoreDuplicates:true});
        if(years.some(year=>year.year===upsert.row.year))return {data:null};
        const row={id:`year-${upsert.row.year}`,...upsert.row};years.push(row);return {data:row};}
      const rows=table==='academic_years'?years:(db.periods||[]);
      return {data:rows.find(row=>filters.every(filter=>filter(row)))||null};
    }return query;
  }};return db;
}

test('academic year validation matches the supported integer range',()=>{
  for(const year of [2026,2027,2028,2100])assert.equal(academicYearValue(year),year);
  for(const year of [2025,2101,2028.5,'2028',null,true,NaN,Infinity])assert.throws(()=>academicYearValue(year),{statusCode:400});
});

test('only an active administrator can add a year',async()=>{
  for(const staff of [{role:'viewer',active:true},{role:'administrator',active:false},{}]){
    const db=fakeDatabase();await assert.rejects(addAcademicYear(db,{...actor,staff},{year:2028}),{statusCode:403});assert.equal(db.calls.length,0);
  }
});

test('a new year is persisted with a server-owned label and an audit event',async()=>{
  const db=fakeDatabase([{id:'old',year:2027,label:'Original',is_active:true}]);
  const result=await addAcademicYear(db,actor,{year:2028,label:'<script>',id:'old',is_active:false});
  assert.equal(result.created,true);assert.equal(result.academic_year.label,'2028 Academic Year');
  assert.equal(result.academic_year.is_active,true);assert.equal(db.years[0].label,'Original');
  assert.equal(db.audits.length,1);assert.equal(db.audits[0].actor_user_id,actor.user.id);
  assert.ok(db.calls.every(call=>['academic_years','audit_events'].includes(call.table)));
});

test('duplicate creation returns the original year without overwriting historical settings',async()=>{
  const original={id:'existing',year:2027,label:'Keep this label',is_active:false};
  const db=fakeDatabase([original]);const result=await addAcademicYear(db,actor,{year:2027});
  assert.equal(result.created,false);assert.deepEqual(result.academic_year,original);
  assert.equal(db.years.length,1);assert.equal(original.is_active,false);assert.equal(db.audits.length,0);
});

test('concurrent repeated requests create only one year and one creation audit',async()=>{
  const db=fakeDatabase();const results=await Promise.all([addAcademicYear(db,actor,{year:2028}),addAcademicYear(db,actor,{year:2028})]);
  assert.equal(db.years.length,1);assert.equal(db.audits.length,1);assert.equal(results.filter(result=>result.created).length,1);
});

test('database failures are not reported as a successful save',async()=>{
  const db=fakeDatabase();db.fail({message:'Unavailable',code:'TEST_FAILURE'});
  await assert.rejects(addAcademicYear(db,actor,{year:2028}),{code:'TEST_FAILURE'});
});

test('existing periods cannot be moved to another academic year or another school',async()=>{
  const db=fakeDatabase();db.periods=[{id:'period',school_id:'school',academic_year_id:'old-year'}];
  await assertPeriodYear(db,'school',{id:'period',academic_year_id:'old-year'});
  await assert.rejects(assertPeriodYear(db,'school',{id:'period',academic_year_id:'new-year'}),{statusCode:400});
  await assert.rejects(assertPeriodYear(db,'other-school',{id:'period',academic_year_id:'old-year'}),{statusCode:400});
  assert.ok(db.calls.every(call=>call.table==='ordering_periods'&&!call.upsert&&!call.insert));
});

test('a separate new ordering period does not mutate an old one',async()=>{
  const db=fakeDatabase();await assertPeriodYear(db,'school',{id:null,academic_year_id:'new-year'});assert.equal(db.calls.length,0);
});

test('year selection finds only the selected school and year without mutating the catalogue',()=>{
  const periods=[{id:'old',school_id:'school',academic_year_id:'2027',closes_at:'2026-12-01'},
    {id:'other',school_id:'other',academic_year_id:'2028',closes_at:'2028-12-01'},
    {id:'new',school_id:'school',academic_year_id:'2028',closes_at:'2027-12-01'}];
  const original=structuredClone(periods);
  assert.equal(periodForYear(periods,'school','2028').id,'new');
  assert.equal(periodForYear(periods,'school','2029'),undefined);assert.deepEqual(periods,original);
});

function response(){return {status(code){this.code=code;return this;},setHeader(){},json(body){this.body=body;return this;}};}
test('HTTP creation checks origin and administrator authorization before database writes',async()=>{
  for(const statusCode of [403,401]){
    let writes=0;const handler=createSchoolSaveHandler({
      checkOrigin(){if(statusCode===403)throw Object.assign(Error('Blocked origin'),{statusCode});},
      authorize:async(req,res,roles)=>{assert.deepEqual(roles,['administrator']);throw Object.assign(Error('Denied'),{statusCode});},
      databaseFactory(){writes++;throw Error('must not run');}});
    const res=response();await handler({body:{action:'create_academic_year',year:2028}},res);assert.equal(res.code,statusCode);assert.equal(writes,0);
  }
});

test('HTTP creation returns a saved year and 201, then 200 for a duplicate',async()=>{
  const db=fakeDatabase();const handler=createSchoolSaveHandler({checkOrigin(){},authorize:async()=>actor,databaseFactory:()=>db});
  for(const expected of [201,200]){const res=response();await handler({body:{action:'create_academic_year',year:2028}},res);assert.equal(res.code,expected);assert.equal(res.body.academic_year.year,2028);}
});
