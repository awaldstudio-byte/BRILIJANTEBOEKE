import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

// Loopback-only UI fixture: no database, credentials, outbound mail or real data.
const root=resolve(process.cwd());
let signedIn=false, enrolled=false;
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
    if(url.pathname==='/api/admin-dashboard')return json(200,{staff:staff(),summary:{active_schools:0,pending_orders:0,paid_orders:0,paid_total_cents:0},periods:[],recent_orders:[],progress:[]});
    if(url.pathname==='/api/admin-schools')return json(200,{academic_years:[],grades:[],books:[],schools:[],periods:[],offerings:[],access_links:[]});
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
