import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { buildReport,reportOptions,readReportRows,loadReport } from '../api/_lib/report-data.js';
import { reportXlsx,reportPdf,reportCsv,localDate } from '../api/_lib/report-documents.js';
import { createReportHandler } from '../api/admin-export.js';

const school={id:'11111111-1111-4111-8111-111111111111',name:'Test School'},period={id:'22222222-2222-4222-8222-222222222222',school_id:school.id,name:'Parent orders',academic_years:{year:2027}},capturedAt='2026-10-23T10:00:00Z';
const orders=[{id:'a',reference:'DEMO-BB-26-TEST',amount_cents:66000,parent_first_name:'Sole',parent_last_name:'Smith',parent_email:'parent@example.test',parent_mobile:'0601005000',paid_at:capturedAt,schools:{name:school.name},ordering_periods:period}];
const rows=[{school:school.name,year:2027,period:period.name,grade:'Graad 1',learner:'Samuel Smith',surname:'Smith',book:'Grade 1 Workbook',quantity:1,reference:orders[0].reference,paidAt:capturedAt,lineCents:32000},{school:school.name,year:2027,period:period.name,grade:'Graad 6',learner:'Edith Smith',surname:'Smith',book:'Grade 6 Workbook',quantity:1,reference:orders[0].reference,paidAt:capturedAt,lineCents:34000}];
const fixture=options=>buildReport({rows,orders,capturedAt,...options});
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};}

test('report options reject malformed/array filters, unknown formats and missing batch IDs',()=>{
  for(const query of [{school_id:'anything'},{period_id:['x']},{format:'html'},{report:'all-private-data'},{report:'batch'},{batch_id:'-'.repeat(36)}])assert.throws(()=>reportOptions(query),{statusCode:400});
  assert.equal(reportOptions().format,'xlsx');assert.equal(reportOptions({lang:'af'}).language,'af');
});
test('all report formats require staff authorization before reading data',async()=>{
  for(const format of ['pdf','xlsx','csv']){let reads=0;const handler=createReportHandler({authorize:async()=>{throw Object.assign(Error('Denied'),{statusCode:401});},databaseFactory(){reads++;}}),res=response();await handler({method:'GET',query:{format}},res);assert.equal(res.code,401);assert.equal(reads,0);assert.match(res.headers['Cache-Control'],/no-store/);}
});
test('asynchronous loader failures are caught and do not leak database errors',async()=>{
  const handler=createReportHandler({authorize:async()=>{},databaseFactory:()=>({}),load:async()=>{throw Error('secret database connection');}}),res=response();await handler({method:'GET',query:{}},res);assert.equal(res.code,500);assert.doesNotMatch(JSON.stringify(res.body),/secret/);
});
test('periods cannot be paired with a different school',async()=>{
  const db={from(){return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:{...period,school_id:'other'},error:null};}};}};
  await assert.rejects(loadReport(db,{school_id:school.id,period_id:period.id}),{statusCode:400});
});
test('keyset pagination reads beyond 1,000 rows and propagates later errors',async()=>{
  const records=Array.from({length:1201},(_,i)=>({id:String(i).padStart(5,'0')})),afters=[];
  const factory=()=>{let after='';return{order(){return this;},limit(){return this;},gt(key,value){assert.equal(key,'id');after=value;afters.push(value);return this;},then(resolve){resolve({data:records.filter(r=>r.id>after).slice(0,500),error:null});}};};
  assert.equal((await readReportRows(factory)).length,1201);assert.deepEqual(afters,['00499','00999']);
  await assert.rejects(readReportRows(()=>({order(){return this;},limit(){return Promise.resolve({data:null,error:{message:'bad'}});}})));
});
test('two children share one transaction total, not two copies of the payment',()=>{
  const report=fixture();assert.equal(report.quantity,2);assert.equal(report.orderCount,1);assert.equal(report.totalCents,66000);assert.equal(report.sections[1].rows.length,1);assert.equal(report.sections[1].rows[0].amount,660);assert.ok(!report.sections[0].columns.some(c=>c.key==='amount'));
});
test('school registers omit internal parent contact data, combined lists retain a separate transactions sheet',()=>{
  assert.equal(fixture({school,period}).sections.length,1);assert.equal(fixture().sections.length,2);
  assert.ok(!fixture({school,period}).sections.flatMap(s=>s.columns).some(c=>['email','mobile','amount'].includes(c.key)));
});
test('batch reports use only frozen snapshot rows for packing and learner allocation',()=>{
  const report=fixture({school,period,batch:{label:'Batch 1'}});assert.equal(report.sections.length,2);assert.equal(report.sections[0].rows.reduce((sum,r)=>sum+r.quantity,0),2);assert.equal(report.sections[1].rows.length,2);assert.ok(!report.sections[1].columns.some(c=>c.key==='paidAt'));
});
test('XLSX reopens with logos, readable widths, typed money/dates, filters, frozen headers and cached totals',async()=>{
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await reportXlsx(fixture()));
  const sheet=workbook.worksheets[0];assert.equal(sheet.getImages().length,1);assert.equal(sheet.getColumn(5).width,30);assert.equal(sheet.views[0].ySplit,10);assert.equal(sheet.views[0].showGridLines,false);assert.ok(sheet.autoFilter);assert.equal(sheet.getCell('G14').value.result,2);
  assert.equal(sheet.getCell('A2').fill.pattern,'none');assert.equal(sheet.getCell('A6').font.color.argb,'263B50');assert.equal(sheet.getCell('A10').fill.fgColor.argb,'17385F');
  const transactions=workbook.worksheets[1];assert.equal(transactions.getCell('G11').value,'0601005000');assert.equal(transactions.getCell('H11').value,660);assert.equal(transactions.getCell('H13').value.result,660);assert.equal(transactions.getCell('I11').value.getUTCHours(),12);assert.match(transactions.pageSetup.printArea,/A1:I/);
});
test('school logo is embedded only on explicitly school-scoped workbooks and PDFs',async()=>{
  const report=fixture({school,period});report.schoolLogo=await readFile(new URL('../assets/images/logo.png',import.meta.url));const wb=new ExcelJS.Workbook();await wb.xlsx.load(await reportXlsx(report));assert.equal(wb.worksheets[0].getImages().length,2);const pdf=await PDFDocument.load(await reportPdf(report));assert.equal(pdf.getPageCount(),1);
});
test('literal spreadsheet formulas cannot execute and CSV guards whitespace-prefixed formulas',async()=>{
  const report=fixture({rows:[{...rows[0],learner:'=HYPERLINK("https://example.test")',book:'  +CMD'}]});const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await reportXlsx(report));assert.equal(typeof workbook.worksheets[0].getCell('E11').value,'string');assert.equal(workbook.worksheets[0].getCell('E11').formula,undefined);const csv=reportCsv(report).toString();assert.match(csv,/'=HYPERLINK/);assert.match(csv,/'  \+CMD/);
});
test('long lists print as multiple A4 landscape pages, not one shrunken or clipped page',async()=>{
  const long=fixture({school,period,rows:Array.from({length:70},(_,i)=>({...rows[i%2],learner:`Long learner surname ${i}`,reference:`BB-2026-REFERENCE-${i}`}))});const pdf=await PDFDocument.load(await reportPdf(long));assert.ok(pdf.getPageCount()>3);for(const page of pdf.getPages()){assert.ok(Math.abs(page.getWidth()-841.89)<.1);assert.ok(Math.abs(page.getHeight()-595.28)<.1);}
});
test('empty and Afrikaans reports remain downloadable',async()=>{
  const report=fixture({language:'af',school,period,rows:[],orders:[]});assert.equal((await PDFDocument.load(await reportPdf(report))).getPageCount(),1);const wb=new ExcelJS.Workbook();await wb.xlsx.load(await reportXlsx(report));assert.match(wb.worksheets[0].getCell('A11').value,/Geen betaalde/);assert.match(localDate(capturedAt,'af'),/12:00/);
});

test('real report loader reconciles item amounts and loads a logo only for an explicit school filter',async()=>{
  const recorded=[];
  const items=rows.map((row,index)=>({id:String(index),order_id:'a',description_snapshot:row.book,quantity:row.quantity,line_total_cents:row.lineCents,learners:{first_name:row.learner.split(' ')[0],last_name:'Smith',grades:{name:row.grade}},orders:{status:'paid',paid_at:capturedAt,school_id:school.id,ordering_period_id:period.id}}));
  const db={from(table){let filters=[];const q={select(){return q;},eq(key,value){filters.push([key,value]);return q;},lte(){return q;},order(){return q;},limit(){return q;},gt(){return q;},maybeSingle:async()=>({data:table==='schools'?school:period,error:null}),then(resolve){recorded.push({table,filters});resolve({data:table==='orders'?orders:items,error:null});}};return q;}};
  let logos=0;const logoReader=async()=>{logos++;return null;};
  const all=await loadReport(db,{language:'en'}, {now:()=>capturedAt,logoReader});assert.equal(all.quantity,2);assert.equal(all.totalCents,66000);assert.equal(logos,0);
  const scoped=await loadReport(db,{language:'en',school_id:school.id,period_id:period.id},{now:()=>capturedAt,logoReader});assert.equal(scoped.school.name,school.name);assert.equal(logos,1);assert.ok(recorded.some(query=>query.table==='order_items'&&query.filters.some(([key,value])=>key==='orders.school_id'&&value===school.id)));
  items[0].line_total_cents=1;await assert.rejects(loadReport(db,{language:'en'},{now:()=>capturedAt,logoReader}),{statusCode:409});
});
test('download routes deliver matching attachments and reject unsupported methods',async()=>{
  const handler=createReportHandler({authorize:async()=>{},databaseFactory:()=>({}),load:async()=>fixture()});
  for(const format of ['xlsx','pdf','csv']){const res=response();await handler({method:'GET',query:{format}},res);assert.equal(res.code,200);assert.ok(Buffer.isBuffer(res.body));assert.match(res.headers['Content-Disposition'],new RegExp(`\\.${format}"$`));assert.equal(res.headers['X-Content-Type-Options'],'nosniff');}
  const res=response();await handler({method:'POST'},res);assert.equal(res.code,405);
});
