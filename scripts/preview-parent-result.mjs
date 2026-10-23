import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {parentOrderResult} from '../assets/parent-order-result.js';
const result=parentOrderResult({order:{reference:'DEMO-BB-26-4FC27DF4',amount_cents:66000},parent:{first_name:'Sole',email:'technical@awaldstudio.com'},language:'en'});
createServer(async(req,res)=>{
  if(req.url==='/assets/phase1.css'){res.writeHead(200,{'Content-Type':'text/css'});res.end(await readFile(new URL('../assets/phase1.css',import.meta.url)));return;}
  if(req.url==='/mobile'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<iframe title="Parent result at 320 pixels" src="/" width="320" height="900" style="border:0"></iframe>');return;}
  if(req.url!=='/'){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parent order result review</title><link rel="stylesheet" href="/assets/phase1.css"></head><body><main style="max-width:520px;margin:24px auto;padding:16px"><section id="demo-result" class="checkout-card">${result}</section></main></body></html>`);
}).listen(4323,'127.0.0.1',()=>console.log('Read-only parent result preview ready. No order or email is submitted.'));
