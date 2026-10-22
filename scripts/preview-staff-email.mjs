import { createServer } from 'node:http';
import { staffVerificationContent, staffLogoCid } from '../api/_lib/staff-email.js';

// Local-only design preview. Never reads the database or a live verification code.
const message = staffVerificationContent('12345678', 'info@briljanteboeke.co.za');
const image = `data:image/png;base64,${message.attachments[0].content.toString('base64')}`;
const html = message.html.replace(`cid:${staffLogoCid}`, image);
createServer((req, res) => {
  if (req.url !== '/') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(html);
}).listen(4319,'127.0.0.1',()=>console.log('Sample verification email: http://127.0.0.1:4319'));
