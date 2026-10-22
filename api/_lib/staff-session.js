import { randomBytes, createHash } from 'node:crypto';
import { env } from './env.js';
import { serviceClient, publicAuthClient, assertDatabaseResult } from './supabase.js';

export const authCookies = { access: 'bb_admin_access', refresh: 'bb_admin_refresh', session: 'bb_admin_sid', challenge: 'bb_setup_challenge' };
export const opaqueToken = () => randomBytes(32).toString('hex');
export const tokenHash = value => createHash('sha256').update(value).digest('hex');
export const authDenied = () => Object.assign(new Error('Sign in is required.'), { statusCode: 401 });

export function parseCookies(value = '') {
  const result = {};
  for (const part of value.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    try { result[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1)); } catch { /* malformed cookies confer no access */ }
  }
  return result;
}

export function appendCookie(res, value) {
  const previous = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [previous] : []), value]);
}

export function cookie(name, value, { maxAge, secure = env().appOrigin.startsWith('https://') } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}${maxAge === undefined ? '' : `; Max-Age=${Math.max(0, Math.floor(maxAge))}`}`;
}

export function sessionCookieAge(record, now = Date.now()) {
  if (record.kind === 'ready' && !record.remember) return undefined;
  return Math.max(0, Math.floor((Date.parse(record.expires_at) - now) / 1000));
}

export function setSessionCookies(res, providerSession, record, secret) {
  const maxAge = sessionCookieAge(record);
  for (const [key, value] of [['access', providerSession.access_token], ['refresh', providerSession.refresh_token], ['session', secret]]) {
    if (typeof value !== 'string' || !value) throw authDenied();
    appendCookie(res, cookie(authCookies[key], value, { maxAge }));
  }
}

export function clearSessionCookies(res) {
  for (const name of Object.values(authCookies)) appendCookie(res, cookie(name, '', { maxAge: 0 }));
}

export async function createStaffSession(database, res, providerSession, approval, kind, remember) {
  const secret = opaqueToken();
  const record = { token_hash: tokenHash(secret), approval_id: approval.id, auth_user_id: providerSession.user.id,
    kind, remember: remember === true, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() };
  const result = await database.from('staff_login_sessions').insert(record);
  assertDatabaseResult(result.error);
  setSessionCookies(res, providerSession, record, secret);
  return record;
}

export async function loadStaffSession(req, res, { database = serviceClient(), auth = publicAuthClient() } = {}) {
  const cookies = parseCookies(req.headers.cookie || '');
  const secret = cookies[authCookies.session] || '';
  if (!/^[a-f0-9]{64}$/.test(secret)) throw authDenied();
  const sessionResult = await database.from('staff_login_sessions').select('*').eq('token_hash', tokenHash(secret)).maybeSingle();
  assertDatabaseResult(sessionResult.error);
  const record = sessionResult.data;
  if (!record || record.revoked_at || Date.parse(record.expires_at) <= Date.now()) throw authDenied();
  const approvalResult = await database.from('staff_access_approvals').select('*').eq('id', record.approval_id).eq('active', true).maybeSingle();
  assertDatabaseResult(approvalResult.error);
  const approval = approvalResult.data;
  if (!approval || approval.auth_user_id !== record.auth_user_id) throw authDenied();
  let access = cookies[authCookies.access];
  let refresh = cookies[authCookies.refresh];
  let user = null;
  if (access) {
    const checked = await auth.auth.getUser(access);
    if (!checked.error) user = checked.data.user;
  }
  if (!user && refresh) {
    const refreshed = await auth.auth.refreshSession({ refresh_token: refresh });
    if (!refreshed.error && refreshed.data.session) {
      user = refreshed.data.user;
      access = refreshed.data.session.access_token;
      refresh = refreshed.data.session.refresh_token;
      setSessionCookies(res, refreshed.data.session, record, secret);
    }
  }
  if (!user || user.id !== record.auth_user_id || user.email?.toLowerCase() !== approval.email || !user.email_confirmed_at) throw authDenied();
  return { database, auth, user, approval, record, secret, accessToken: access, refreshToken: refresh };
}

export async function attachProviderSession(context) {
  const result = await context.auth.auth.setSession({ access_token: context.accessToken, refresh_token: context.refreshToken });
  if (result.error || result.data.user?.id !== context.user.id || !result.data.session) throw authDenied();
  return result.data.session;
}

export async function hasStrongFactor(context) {
  const result = await context.auth.auth.mfa.getAuthenticatorAssuranceLevel(context.accessToken);
  return !result.error && result.data?.currentLevel === 'aal2' &&
    context.user.factors?.some(factor => factor.factor_type === 'totp' && factor.status === 'verified') === true;
}

export async function authorisedStaff(context, roles = ['administrator', 'viewer']) {
  if (context.record.kind !== 'ready' || !context.approval.password_set_at || !context.approval.setup_completed_at ||
      !await hasStrongFactor(context)) throw authDenied();
  if (!context.approval.active || !roles.includes(context.approval.role)) throw authDenied();
  // Deliberately do not grant legacy staff_users access: older immutable previews
  // consult that directory without the new session and MFA requirements.
  return { user_id: context.user.id, display_name: context.approval.display_name,
    role: context.approval.role, active: true };
}
