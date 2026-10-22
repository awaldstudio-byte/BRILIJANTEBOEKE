import { waitUntil } from '@vercel/functions';
import { requireSameOrigin } from './_lib/auth.js';
import { json, methodNotAllowed, publicError, readJson } from './_lib/http.js';
import { serviceClient, publicAuthClient, assertDatabaseResult } from './_lib/supabase.js';
import { clearSessionCookies, parseCookies, authCookies, tokenHash, loadStaffSession,
  createStaffSession, authorisedStaff } from './_lib/staff-session.js';
import { normaliseStaffEmail, approvedEmail, limitStaffRequest, requestStaffCode, verifyStaffCode,
  setStaffPassword, beginStaffMfa, finishStaffMfa, staffMfaOptions, skipStaffMfa } from './_lib/staff-onboarding.js';

export function createStaffLoginHandler({ databaseFactory = serviceClient, authFactory = publicAuthClient, schedule = waitUntil } = {}) {
  return async function handler(req, res) {
    if (!['POST', 'DELETE'].includes(req.method)) return methodNotAllowed(res, ['POST', 'DELETE']);
    try {
      requireSameOrigin(req);
      const database = databaseFactory();
      const auth = authFactory();
      if (req.method === 'DELETE') {
        const secret = parseCookies(req.headers.cookie || '')[authCookies.session] || '';
        if (/^[a-f0-9]{64}$/.test(secret)) {
          const revoked = await database.from('staff_login_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', tokenHash(secret));
          assertDatabaseResult(revoked.error);
        }
        clearSessionCookies(res);
        return json(res, 200, { ok: true });
      }
      const body = await readJson(req, 8_000);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Invalid account request.' });
      const action = typeof body.action === 'string' ? body.action : 'password';
      if (!['password', 'request-code', 'verify-code', 'status', 'new-password', 'mfa-options', 'mfa-begin', 'mfa-verify', 'mfa-skip'].includes(action)) {
        return json(res, 400, { error: 'Invalid account action.' });
      }
      const email = ['password', 'request-code'].includes(action) ? normaliseStaffEmail(body.email) : '';
      if (action !== 'status') await limitStaffRequest(database, req, action, email);
      if (action === 'request-code') return json(res, 200, await requestStaffCode(database, res, email, body.remember, schedule));
      if (action === 'verify-code') return json(res, 200, await verifyStaffCode(database, auth, req, res, body.code));
      if (action === 'password') {
        const denied = () => json(res, 401, { error: 'The email address or password is incorrect. For first-time access, use account setup.' });
        const approval = await approvedEmail(database, email);
        if (!approval?.auth_user_id || !approval.password_set_at || typeof body.password !== 'string' || body.password.length > 200) return denied();
        const result = await auth.auth.signInWithPassword({ email, password: body.password });
        if (result.error || !result.data.session || result.data.user?.id !== approval.auth_user_id || !result.data.user.email_confirmed_at) return denied();
        await createStaffSession(database, res, result.data.session, approval, 'password', body.remember);
        return json(res, 200, { next: 'mfa' });
      }
      const context = await loadStaffSession(req, res, { database, auth });
      if (action === 'new-password') return json(res, 200, await setStaffPassword(context, res, body.password, body.confirmation));
      if (action === 'mfa-options') return json(res, 200, await staffMfaOptions(context, res));
      if (action === 'mfa-skip') return json(res, 200, await skipStaffMfa(context, res));
      if (action === 'mfa-begin') return json(res, 200, await beginStaffMfa(context));
      if (action === 'mfa-verify') return json(res, 200, await finishStaffMfa(context, res, body.factor_id, body.code));
      if (context.record.kind === 'verified') return json(res, 200, { next: 'new-password' });
      if (context.record.kind === 'password') return json(res, 200, { next: 'mfa' });
      const staff = await authorisedStaff(context);
      return json(res, 200, { next: 'dashboard', staff });
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) console.error('staff-auth: account request requires review');
      const result = publicError(error);
      return json(res, result.status, { error: result.message });
    }
  };
}
export default createStaffLoginHandler();
