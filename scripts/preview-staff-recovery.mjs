import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

// Local visual fixture only. No Supabase, SMTP, real identities or credential storage.
const root = resolve(process.cwd());
let mailboxVerified = false, factorVerified = false, passwordChanged = false, requested = false;
const staff = { display_name: 'Local recovery fixture', role: 'administrator', mfa_enabled: true };
const factorId = '11111111-1111-4111-8111-111111111111';
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/admin-login' && req.method === 'POST') {
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 8000) return json(413, {}); }
    const body = JSON.parse(raw || '{}');
    if (body.action === 'status') return passwordChanged ? json(200, { next: 'dashboard', staff }) : json(401, { error: 'Local fixture is not signed in.' });
    if (body.action === 'email-check') return json(200, { next: 'password' });
    if (body.action === 'request-recovery') { requested = true; mailboxVerified = false; factorVerified = false; passwordChanged = false; return json(200, { next: 'code', recovery: true }); }
    if (body.action === 'verify-code') {
      if (!requested || body.code !== '12345678') return json(400, { error: 'The synthetic code is invalid.' });
      mailboxVerified = true; return json(200, { next: 'recovery', recovery: true });
    }
    if (body.action === 'mfa-options' && mailboxVerified) return passwordChanged ? json(200, { next: 'dashboard', staff }) : factorVerified
      ? json(200, { next: 'new-password', recovery: true })
      : json(200, { next: 'mfa-code', factor_id: factorId, enrolling: false, can_skip: false, recovery: true });
    if (body.action === 'mfa-verify' && mailboxVerified && body.factor_id === factorId && body.code === '123456') {
      factorVerified = true; return json(200, { next: 'new-password', recovery: true });
    }
    if (body.action === 'new-password' && mailboxVerified && factorVerified) { passwordChanged = true; return json(200, { next: 'mfa' }); }
    return json(400, { error: 'Unsupported synthetic fixture action.' });
  }
  if (url.pathname.startsWith('/api/')) {
    if (!passwordChanged) return json(401, {});
    if (url.pathname === '/api/admin-dashboard') return json(200, { staff, summary: { active_schools: 0, pending_orders: 0, paid_orders: 0, paid_total_cents: 0 }, periods: [], recent_orders: [], progress: [] });
    if (url.pathname === '/api/admin-schools') return json(200, { academic_years: [], grades: [], books: [], schools: [], periods: [], offerings: [], access_links: [] });
    if (url.pathname === '/api/admin-orders') return json(200, { orders: [] });
    if (url.pathname === '/api/admin-fulfilment') return json(200, { batches: [] });
    return json(404, {});
  }
  if (url.pathname !== '/admin/' && !url.pathname.startsWith('/assets/')) { res.writeHead(404); res.end(); return; }
  try {
    let file = resolve(root, `.${url.pathname}`); if (!file.startsWith(root + sep)) throw Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
}).listen(4331, '127.0.0.1', () => console.log('Synthetic recovery UI: http://127.0.0.1:4331/admin/?lang=en'));
