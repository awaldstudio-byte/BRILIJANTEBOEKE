import {createServer} from 'node:http';
import {orderEmailContent,orderLogoCid} from '../api/_lib/order-email-design.js';
const order={reference:'DEMO-BB-26-EXAMPLE1',status:'paid',amount_cents:66000,parent_first_name:'Demo',parent_last_name:'Parent',parent_email:'parent@example.test',parent_mobile:'0820000000',
  schools:{name:'Test School 1'},ordering_periods:{academic_years:{year:2027}},order_items:[
    {description_snapshot:'Graad 1 Werkboek - Graad 1',quantity:1,line_total_cents:32000,learners:{first_name:'Emma',last_name:'Example'}},
    {description_snapshot:'Graad 5 Werkboek - Graad 5',quantity:1,line_total_cents:34000,learners:{first_name:'Liam',last_name:'Example'}}]};
createServer((req,res)=>{
  const review = /^\/review-(parent|staff)-(320|390|768)$/.exec(req.url);
  if (review) {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<html><head><title>Email responsive review</title></head><body style="margin:0;background:#dae2e8"><iframe title="${review[1]} email at ${review[2]} pixels" src="/${review[1]}" width="${review[2]}" height="2300" style="border:0;display:block"></iframe></body></html>`);return;}
  if(!['/parent','/staff'].includes(req.url)){res.writeHead(404);res.end();return;}
  const content=orderEmailContent(order,{parent:req.url==='/parent',demo:true,replyTo:'info@briljanteboeke.co.za',appOrigin:'https://briljante-preview-awaldstudio.vercel.app'});
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(content.html.replace(`cid:${orderLogoCid}`,`data:image/png;base64,${content.attachments[0].content.toString('base64')}`));
}).listen(Number(process.env.ORDER_EMAIL_PREVIEW_PORT || 4321),'127.0.0.1',()=>console.log('Synthetic order-email preview is ready.'));
