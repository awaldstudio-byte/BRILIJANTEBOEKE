import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
// Loopback-only responsive fixture. No live data, email, passwords or provider calls.
const root=resolve(process.cwd());
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.woff2':'font/woff2'};
createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const send=(code,type,body)=>{res.writeHead(code,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store'});res.end(body);};
  if(url.pathname==='/review'){
    const width=Math.min(1800,Math.max(320,Number(url.searchParams.get('width'))||1440)),height=Number(url.searchParams.get('height'))||900,view=['overview','orders','schools','reports','login'].includes(url.searchParams.get('view'))?url.searchParams.get('view'):'overview';
    return send(200,'text/html',`<!doctype html><html><head><title>Dashboard responsive review</title><style>html,body{margin:0;padding:0}iframe{display:block;border:0}output{display:block;white-space:pre-wrap;font:12px monospace;max-width:620px}</style></head><body><iframe title="Dashboard at ${width}px" width="${width}" height="${height}" src="/admin/?lang=en&${view==='login'?'login=1':'preview=1'}&review=${view}"></iframe><output id="layout-metrics" aria-label="Local layout diagnostics"></output><script>addEventListener('message',event=>{if(event.origin===location.origin&&event.data.type==='layout-metrics')document.querySelector('output').textContent=JSON.stringify(event.data,null,2);});</script></body></html>`);
  }
  if(url.pathname==='/review-fixture.js')return send(200,'text/javascript',`window.addEventListener('load',()=>{const query=new URLSearchParams(location.search),view=query.get('review');if(view&&view!=='login'){document.querySelector('#demo-data-notice').hidden=false;document.querySelector('[data-view="'+view+'"]').click();if(view==='orders'){const body=document.querySelector('#all-order-rows'),row=body.querySelector('tr');for(let i=0;row&&i<40;i++)body.append(row.cloneNode(true));}}const main=document.querySelector('.admin-main'),nav=document.querySelector('.admin-nav');function metrics(){const rect=element=>{const r=element.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),scrollTop:element.scrollTop,scrollLeft:element.scrollLeft};};parent.postMessage({type:'layout-metrics',width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,main:rect(main),nav:rect(nav),active:document.querySelectorAll('.admin-nav button.active').length},location.origin);}main.addEventListener('scroll',metrics);nav.addEventListener('scroll',metrics);metrics();});`);
  if(url.pathname==='/api/admin-login'){
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
    if(body.action==='email-check'){if(body.email==='existing@example.test')return send(200,'application/json',JSON.stringify({next:'password'}));if(body.email==='new@example.test')return send(200,'application/json',JSON.stringify({next:'setup'}));return send(403,'application/json',JSON.stringify({error:'Unable to continue with this email address. Check the spelling or contact technical support.'}));}
    if(body.action==='request-code')return send(200,'application/json',JSON.stringify({next:'code'}));
    return send(401,'application/json','{}');
  }
  if(url.pathname.startsWith('/api/'))return send(401,'application/json','{}');
  if(url.pathname!=='/admin/'&&!url.pathname.startsWith('/assets/'))return send(404,'text/plain','Not found');
  try{let file=resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+sep))throw Error();if((await stat(file)).isDirectory())file=resolve(file,'index.html');let bytes=await readFile(file);if(file.endsWith('index.html'))bytes=Buffer.from(bytes.toString().replace('</body>','<script src="/review-fixture.js"></script></body>'));return send(200,types[extname(file)]||'application/octet-stream',bytes);}catch{return send(404,'text/plain','Not found');}
}).listen(4326,'127.0.0.1',()=>console.log('Read-only dashboard review: http://127.0.0.1:4326/review?width=1440&view=overview'));
