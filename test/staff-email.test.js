import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { staffVerificationContent, staffLogoCid } from '../api/_lib/staff-email.js';

test('verification has bilingual HTML and complete text fallback with a visible selectable code',()=>{
  const message=staffVerificationContent('12345678','info@briljanteboeke.co.za');
  assert.match(message.html,/<html lang="en">/);
  assert.match(message.html,/lang="af"/);
  assert.match(message.html,/>12345678<\/p>/);
  assert.match(message.text,/12345678/);
  assert.match(message.text,/15 minutes/);
  assert.match(message.html,/Single use only/);
  assert.match(message.html,/max-width:480px/);
});

test('email uses the exact approved local logo inline, not a remote tracking image',()=>{
  const message=staffVerificationContent('12345678','info@briljanteboeke.co.za');
  assert.match(message.html,new RegExp(`src="cid:${staffLogoCid}"`));
  assert.equal(message.attachments[0].contentDisposition,'inline');
  assert.deepEqual(message.attachments[0].content,readFileSync(new URL('../assets/images/logo.png',import.meta.url)));
  assert.doesNotMatch(message.html,/<img[^>]+src="https?:/i);
});

test('email contains no fake copy button, scripts, forms or credential-bearing links',()=>{
  const message=staffVerificationContent('12345678','info@briljanteboeke.co.za');
  assert.doesNotMatch(message.html,/<script|<button|<form|onclick|javascript:|navigator\.clipboard|access_token|refresh_token/i);
  for(const [,href] of message.html.matchAll(/href="([^"]+)"/g)) assert.doesNotMatch(href,/12345678|token|code=/i);
});

test('malformed codes and injected support addresses are rejected before rendering',()=>{
  for(const code of ['12345','12345678901','<script>','12345678\n']) assert.throws(()=>staffVerificationContent(code,'info@briljanteboeke.co.za'));
  assert.throws(()=>staffVerificationContent('12345678','a@example.com" onmouseover="alert(1)'));
  assert.throws(()=>staffVerificationContent('12345678','a@example.com\r\nBcc: x@example.com'));
});

test('MIME includes text, HTML and the CID image with file and remote access disabled',async()=>{
  const transport=nodemailer.createTransport({streamTransport:true,buffer:true,disableFileAccess:true,disableUrlAccess:true});
  const result=await transport.sendMail({from:'orders@briljanteboeke.co.za',to:'test@example.test',
    subject:'Synthetic verification test',...staffVerificationContent('12345678','info@briljanteboeke.co.za'),disableFileAccess:true,disableUrlAccess:true});
  const mime=result.message.toString();
  assert.match(mime,/multipart\/alternative/);assert.match(mime,/multipart\/related/);
  assert.match(mime,/Content-Type: text\/plain/);assert.match(mime,/Content-Type: text\/html/);
  assert.ok(mime.includes(`Content-ID: <${staffLogoCid}>`));
  assert.match(mime,/Content-Disposition: inline/);
  transport.close();
});
