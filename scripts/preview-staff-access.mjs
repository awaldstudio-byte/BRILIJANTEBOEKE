import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { academicYearValue } from '../api/_lib/academic-years.js';

// Loopback-only UI fixture: no database, credentials, outbound mail or real data.
const root=resolve(process.cwd());
const yearsFixture=process.argv.includes('--years');
let signedIn=yearsFixture, enrolled=false;
const years=[{id:'92cd8cf0-5a03-4a48-934a-3d27d1377b9a',year:2027,label:'2027 Academic Year',is_active:true}];
const school={id:'11111111-1111-4111-8111-111111111111',name:'Local test school',slug:'local-test-school',status:'active',contact_name:'Test contact',contact_email:'test@example.test'};
const period={id:'22222222-2222-4222-8222-222222222222',school_id:school.id,academic_year_id:years[0].id,name:'Parent orders',opens_at:'2026-09-01T08:00:00Z',closes_at:'2026-11-30T18:00:00Z',status:'open'};
const grade={id:'33333333-3333-4333-8333-333333333333',name:'Grade 3',sort_order:3};
const book={id:'44444444-4444-4444-8444-444444444444',grade_id:grade.id,title:'Test workbook',default_price_cents:32000,active:true};
const staff=()=>({display_name:'Local UI test',role:'administrator',mfa_enabled:enrolled});
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff'};
createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(url.pathname==='/api/admin-login'&&req.method==='POST'){
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8000)return json(413,{});}
    const {action}=JSON.parse(raw||'{}');
    if(action==='status')return json(200,signedIn?{next:'dashboard',staff:staff()}:{next:'mfa'});
    if(action==='mfa-options')return json(200,enrolled?{next:'mfa-code',factor_id:'fixture',enrolling:false,can_skip:false}:{next:'mfa-choice'});
    if(action==='mfa-skip'){if(enrolled)return json(409,{error:'Cannot skip enabled verification.'});signedIn=true;return json(200,{next:'dashboard',staff:staff()});}
    if(action==='mfa-begin')return json(200,{next:'mfa-code',factor_id:'fixture',enrolling:true,can_skip:!signedIn,can_cancel:signedIn});
    if(action==='mfa-verify'){enrolled=true;signedIn=true;return json(200,{next:'dashboard',staff:staff()});}
    return json(400,{error:'Unsupported fixture action.'});
  }
  if(url.pathname.startsWith('/api/')){
    if(!signedIn)return json(401,{error:'Fixture is not signed in.'});
    if(url.pathname==='/api/admin-schools'&&req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);if(body.action!=='create_academic_year')return json(400,{error:'Only year creation is supported in this fixture.'});
      try{academicYearValue(body.year);}catch(error){return json(400,{error:error.message});}
      const existing=years.find(year=>year.year===body.year);
      if(existing)return json(200,{academic_year:existing,created:false});
      const added={id:randomUUID(),year:body.year,label:`${body.year} Academic Year`,is_active:true};years.push(added);
      return json(201,{academic_year:added,created:true});
    }
    if(url.pathname==='/api/admin-dashboard')return json(200,{staff:staff(),summary:{active_schools:yearsFixture?1:0,pending_orders:0,paid_orders:0,paid_total_cents:0},periods:[],recent_orders:[],progress:[]});
    if(url.pathname==='/api/admin-schools')return json(200,{academic_years:years.toSorted((a,b)=>b.year-a.year),grades:yearsFixture?[grade]:[],books:yearsFixture?[book]:[],schools:yearsFixture?[school]:[],periods:yearsFixture?[period]:[],offerings:yearsFixture?[{ordering_period_id:period.id,grade_id:grade.id,book_id:book.id,price_cents:32000,expected_quantity:30,active:true}]:[],access_links:[]});
    if(url.pathname==='/api/admin-orders')return json(200,{orders:[]});
    if(url.pathname==='/api/admin-fulfilment')return json(200,{batches:[]});
    return json(404,{});
  }
  if(url.pathname!=='/admin/'&&!url.pathname.startsWith('/assets/')){res.writeHead(404);res.end();return;}
  try{
    let file=resolve(root,`.${url.pathname}`);if(!file.startsWith(root+sep))throw Error('Invalid path');
    if((await stat(file)).isDirectory())file=resolve(file,'index.html');
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
}).listen(4320,'127.0.0.1',()=>console.log('Staff access UI fixture: http://127.0.0.1:4320/admin/?lang=en'));
