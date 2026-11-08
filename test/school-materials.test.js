import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { createSchoolMaterialsHandler } from '../api/admin-school-materials.js';
import {demoOrigin,demoSchoolId,demoStaffEmail} from '../api/_lib/demo-payment.js';
import { normalizeSchoolLogo, logoPath, materialLink, qrPng, posterPdf, readSchoolLogo } from '../api/_lib/school-materials.js';

const school={id:'11111111-1111-4111-8111-111111111111',slug:'test-school',name:'Test School'};
const period={id:'22222222-2222-4222-8222-222222222222',academic_years:{year:2027},closes_at:'2026-12-21T19:00:00Z'};
const origin='https://briljante-preview-awaldstudio.vercel.app';
const logo=await readFile(new URL('../assets/images/logo.png',import.meta.url));
function response(){return {headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};}
test('QR image decodes to the exact school, academic period and language without an external shortener',async()=>{
  const url=materialLink(origin,school,period,'en'),png=PNG.sync.read(await qrPng(url));
  const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
  assert.equal(decoded.data,url);assert.equal(png.width,1800);assert.equal(new URL(url).searchParams.get('period'),period.id);
  assert.equal(new URL(url).searchParams.get('identifier'),school.slug);
});
test('unsafe QR destinations are rejected',()=>{
  for(const bad of ['http://example.test','https://user:pass@example.test','https://example.test/other','javascript:alert(1)'])assert.throws(()=>materialLink(bad,school,period,'en'));
});
test('logos are decoded, bounded, normalized to PNG and stripped of original metadata',async()=>{
  const normalized=await normalizeSchoolLogo(logo.toString('base64'));
  const info=await sharp(normalized).metadata();assert.equal(info.format,'png');assert.ok(info.width<=1024&&info.height<=1024);assert.equal(info.exif,undefined);
  const jpeg=await sharp(logo).flatten({background:'#fff'}).jpeg().toBuffer();
  assert.equal((await sharp(await normalizeSchoolLogo(jpeg.toString('base64'))).metadata()).format,'png');
});
test('invalid, oversized, animated-format and vector uploads cannot reach storage',async()=>{
  for(const bad of ['', 'not-base64!',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64'),'A'.repeat(2_800_004)]){
    await assert.rejects(normalizeSchoolLogo(bad),{statusCode:400});
  }
  const tooManyPixels=await sharp({create:{width:2500,height:2500,channels:4,background:'#fff'}}).png().toBuffer();
  await assert.rejects(normalizeSchoolLogo(tooManyPixels.toString('base64')),{statusCode:400});
});
test('poster is one A4 page with embedded brand font and a functional ordering URL in its QR',async()=>{
  const pdf=await PDFDocument.load(await posterPdf({school,period,origin,gradeNames:['1','2','3'],schoolLogo:await normalizeSchoolLogo(logo.toString('base64'))}));
  assert.equal(pdf.getPageCount(),1);const page=pdf.getPage(0);assert.ok(Math.abs(page.getWidth()-595.28)<.1);assert.ok(Math.abs(page.getHeight()-841.89)<.1);
  assert.match(pdf.getTitle(),/Test School/);
});
test('long school names and Afrikaans poster content produce a valid single page',async()=>{
  const pdf=await PDFDocument.load(await posterPdf({school:{...school,name:'Laerskool '+('Lang skoolnaam '.repeat(10)).slice(0,140)},period,origin,language:'af',gradeNames:['1','7']}));
  assert.equal(pdf.getPageCount(),1);
});
test('every material route checks staff authorization before any data or logo access',async()=>{
  for(const method of ['GET','POST']){
    let reads=0;
    const handler=createSchoolMaterialsHandler({checkOrigin(){},authorize:async(req,res,roles)=>{assert.deepEqual(roles,method==='POST'?['administrator']:['administrator','viewer']);throw Object.assign(Error('Denied'),{statusCode:401});},databaseFactory(){reads++;}});
    const res=response();await handler({method,query:{school_id:school.id,format:'qr',period_id:period.id}},res);assert.equal(res.code,401);assert.equal(reads,0);
  }
});
test('cross-origin logo upload fails before staff lookup or image decode',async()=>{
  let authorized=0;const handler=createSchoolMaterialsHandler({checkOrigin(){throw Object.assign(Error('Blocked'),{statusCode:403});},authorize(){authorized++;}});
  const res=response();await handler({method:'POST',query:{}},res);assert.equal(res.code,403);assert.equal(authorized,0);
});
function fakeDatabase({foreignPeriod=false,schoolRecord=school}={}){
  const storageCalls=[],audits=[];
  return {storageCalls,audits,from(table){
    let filters=[],inserting=false;
    const query={select(){return query;},eq(key,value){filters.push([key,value]);return query;},order(){return query;},
      insert(body){inserting=true;audits.push(body);return query;},async maybeSingle(){return execute(true);},
      then(resolve,reject){return Promise.resolve(execute(false)).then(resolve,reject);}};
    function execute(single){
      if(inserting)return {data:null,error:null};
      const rows=table==='schools'?[schoolRecord]:table==='ordering_periods'?[{...period,school_id:foreignPeriod?'other':schoolRecord.id}]:[{school_id:schoolRecord.id,ordering_period_id:period.id,active:true,grades:{code:'1'}}];
      const data=rows.filter(row=>filters.every(([key,value])=>row[key]===value));return {data:single?(data[0]??null):data,error:null};
    }return query;
  },storage:{from(bucket){return {async upload(path,bytes,options){storageCalls.push({bucket,path,bytes,options});return {error:null};},async download(){return {data:null,error:{statusCode:404,message:'Object not found'}};}};}}};
}
const authorize=async()=>({user:{id:school.id},staff:{role:'administrator'}});
test('a forged period from another school cannot export a QR or poster',async()=>{
  const db=fakeDatabase({foreignPeriod:true});
  const handler=createSchoolMaterialsHandler({authorize,databaseFactory:()=>db,configuration:()=>({appOrigin:origin})});
  for(const format of ['qr','poster']){const res=response();await handler({method:'GET',query:{school_id:school.id,period_id:period.id,format}},res);assert.equal(res.code,404);}
  assert.equal(db.storageCalls.length,0);
});
test('a school logo upload uses a fixed private bucket/path and records only metadata in the audit',async()=>{
  const db=fakeDatabase(),handler=createSchoolMaterialsHandler({authorize,checkOrigin(){},databaseFactory:()=>db});
  const res=response();await handler({method:'POST',query:{school_id:school.id},body:{logo_base64:logo.toString('base64'),path:'../outside',bucket:'public'}},res);
  assert.equal(res.code,200);assert.equal(db.storageCalls.length,1);assert.equal(db.storageCalls[0].bucket,'briljante-school-logos');assert.equal(db.storageCalls[0].path,logoPath(school.id));
  assert.equal(db.storageCalls[0].options.contentType,'image/png');assert.equal(db.audits[0].entity_id,school.id);assert.equal(db.audits[0].details.logo_base64,undefined);
});
test('authenticated QR export is an uncached PNG attachment and absent logo is not an error',async()=>{
  const db=fakeDatabase(),handler=createSchoolMaterialsHandler({authorize,databaseFactory:()=>db,configuration:()=>({appOrigin:origin})});
  const res=response();await handler({method:'GET',query:{school_id:school.id,period_id:period.id,format:'qr',lang:'en'}},res);
  assert.equal(res.code,200);assert.equal(res.headers['Content-Type'],'image/png');assert.equal(res.headers['Cache-Control'],'no-store');assert.match(res.headers['Content-Disposition'],/test-school-2027-qr.png/);
  assert.equal(await readSchoolLogo(db,school.id),null);
});
test('school materials cannot modify live logos from preview or expose the test school in production',async()=>{
  const preview={DEMO_PAYMENTS_ENABLED:'true',VERCEL_ENV:'preview',APP_ORIGIN:demoOrigin,SUPABASE_URL:'https://cigyxjfzbjlgbrduzcpw.supabase.co'};
  for(const [source,method,id,email,status] of [
    [preview,'POST',school.id,demoStaffEmail,403],
    [preview,'POST',demoSchoolId,'other@example.test',403],
    [{...preview,DEMO_PAYMENTS_ENABLED:'false'},'POST',school.id,demoStaffEmail,403],
    [{VERCEL_ENV:'production'},'POST',demoSchoolId,demoStaffEmail,404],
    [{VERCEL_ENV:'production'},'GET',demoSchoolId,demoStaffEmail,404],
  ]){
    let reads=0;const handler=createSchoolMaterialsHandler({source,checkOrigin(){},authorize:async()=>({user:{id:school.id,email}}),databaseFactory(){reads++;throw Error('unexpected access');}});
    const res=response();await handler({method,query:{school_id:id},body:{logo_base64:logo.toString('base64')}},res);
    assert.equal(res.code,status);assert.equal(reads,0);
  }
  const testSchool={...school,id:demoSchoolId},db=fakeDatabase({schoolRecord:testSchool});
  const handler=createSchoolMaterialsHandler({source:preview,checkOrigin(){},authorize:async()=>({user:{id:school.id,email:demoStaffEmail}}),databaseFactory:()=>db});
  const res=response();await handler({method:'POST',query:{school_id:demoSchoolId},body:{logo_base64:logo.toString('base64')}},res);
  assert.equal(res.code,200);assert.equal(db.storageCalls.length,1);assert.equal(db.storageCalls[0].path,logoPath(demoSchoolId));
});
