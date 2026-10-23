import fs from 'node:fs/promises';
import { buildReport } from '../api/_lib/report-data.js';
import { reportPdf,reportXlsx } from '../api/_lib/report-documents.js';
const output=new URL('../../../outputs/briljante-reports/',import.meta.url);await fs.mkdir(output,{recursive:true});
const school={name:'Test School 1'},period={name:'Parent orders',academic_years:{year:2027}},capturedAt='2026-10-23T11:17:19.031Z';
const rows=[['Graad 1','Samuel Smith','Grade 1 Workbook',32000],['Graad 6','Edith Smith','Grade 6 Workbook',34000]].map(([grade,learner,book,lineCents])=>({school:school.name,year:2027,period:period.name,grade,learner,surname:'Smith',book,lineCents,quantity:1,reference:'DEMO-BB-26-4FC27DF4',paidAt:capturedAt}));
const orders=[{id:'fixture',reference:rows[0].reference,amount_cents:66000,parent_first_name:'Sole',parent_last_name:'Smith',parent_email:'parent@example.test',parent_mobile:'0601005000',paid_at:capturedAt,schools:school,ordering_periods:period}];
const schoolLogo=await fs.readFile(new URL('../../../outputs/school-materials/test-school-1-demo-logo.png',import.meta.url));
for(const [name,options]of[['school',{school,period}],['combined',{}],['batch',{school,period,batch:{label:'Test School · Batch 01',status:'packing'}}],['long',{school,period,rows:Array.from({length:55},(_,i)=>({...rows[i%2],learner:`${i===3?'Alexander Michael Very-Long-Surname':'Learner'} ${i+1}`,reference:`DEMO-BB-26-TEST-${String(i+1).padStart(4,'0')}`}))}],['empty',{school,period,rows:[],orders:[]} ]]){
  const report=buildReport({rows,orders,capturedAt,...options});if(report.school)report.schoolLogo=schoolLogo;
  await fs.writeFile(new URL(`${name}.pdf`,output),await reportPdf(report));await fs.writeFile(new URL(`${name}.xlsx`,output),await reportXlsx(report));console.log(name,report.quantity,report.totalCents);
}
