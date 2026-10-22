import { createHmac } from 'node:crypto';
import { env } from './env.js';
import { assertDatabaseResult } from './supabase.js';
import { mailSettings, createMailTransport } from './order-mail.js';
import { staffVerificationContent } from './staff-email.js';
import { authCookies, opaqueToken, tokenHash, parseCookies, cookie, appendCookie,
  createStaffSession, attachProviderSession, setSessionCookies, hasStrongFactor, hasEnrolledFactor, authDenied } from './staff-session.js';

export function normaliseStaffEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) {
    throw Object.assign(new Error('Enter a valid email address.'), { statusCode: 400 });
  }
  return email;
}

export function validateNewStaffPassword(password, email) {
  if (typeof password !== 'string' || [...password].length < 16 || Buffer.byteLength(password, 'utf8') > 72 ||
      /\p{Cc}/u.test(password) || /^(.{1,4})\1+$/u.test(password) || password.toLowerCase().includes(email)) {
    throw Object.assign(new Error('Use a unique password of at least 16 characters (maximum 72 bytes).'), { statusCode: 400 });
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(password)).length;
  const words = new Set(password.trim().toLowerCase().split(/\s+/));
  if (classes < 3 && words.size < 5) throw Object.assign(new Error('Use a mix of letters, numbers and symbols, or a passphrase of five different words.'), { statusCode: 400 });
  return password;
}

export async function approvedEmail(database, email) {
  const result = await database.from('staff_access_approvals').select('*').eq('email', email).eq('active', true).maybeSingle();
  assertDatabaseResult(result.error);
  return result.data;
}

export async function limitStaffRequest(database, req, action, email = '') {
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const hash = value => createHmac('sha256', env().orderTokenSecret).update(`staff-auth:${value}`).digest('hex');
  const rules = [[`ip:${ip}`, 60, 900], [`${action}:ip:${ip}`, action === 'request-code' ? 10 : 20, 900]];
  if (email) rules.push([`${action}:email:${email}`, action === 'request-code' ? 3 : 10, 900]);
  if (action === 'request-code') rules.push(['outbound-code-global', 50, 3600]);
  for (const [key, limit, seconds] of rules) {
    const result = await database.rpc('consume_staff_auth_limit', { p_key: hash(key), p_limit: limit, p_seconds: seconds });
    assertDatabaseResult(result.error);
    if (result.data !== true) throw Object.assign(new Error('Too many attempts. Please try again later.'), { statusCode: 429 });
  }
}

export function staffCodeMessage(email, code, settings) {
  if (!/^\d{6,10}$/.test(code)) throw new Error('Invalid provider code.');
  return { from: { name: 'Briljante Boeke', address: settings.from }, to: normaliseStaffEmail(email), replyTo: settings.replyTo,
    subject: 'Briljante Boeke — account verification / rekeningverifikasie',
    ...staffVerificationContent(code, settings.replyTo || 'info@briljanteboeke.co.za'),
    disableFileAccess: true, disableUrlAccess: true };
}

export async function deliverStaffCode(database, approval, challengeHash, { source = process.env, transportFactory = createMailTransport } = {}) {
  let transport;
  try {
    if (source.AUTH_MAIL_ENABLED !== 'true') throw new Error('Authentication mail is disabled.');
    const current = await approvedEmail(database, approval.email);
    if (!current || current.id !== approval.id) throw new Error('Approval changed.');
    const generated = await database.auth.admin.generateLink({ type: 'magiclink', email: approval.email });
    if (generated.error || !generated.data?.user || !/^\d{6,10}$/.test(generated.data?.properties?.email_otp || '')) throw new Error('Provider code generation failed.');
    const user = generated.data.user;
    if (user.email?.toLowerCase() !== approval.email || (approval.auth_user_id && approval.auth_user_id !== user.id)) throw new Error('Identity mismatch.');
    const linked = await database.from('staff_access_approvals').update({ auth_user_id: user.id }).eq('id', approval.id).eq('active', true);
    assertDatabaseResult(linked.error);
    const staged = await database.from('staff_setup_challenges').update({ auth_user_id: user.id })
      .eq('token_hash', challengeHash).eq('status', 'queued');
    assertDatabaseResult(staged.error);
    const settings = mailSettings({ ...source, MAIL_ENABLED: 'true' });
    transport = transportFactory(settings);
    const result = await transport.sendMail(staffCodeMessage(approval.email, generated.data.properties.email_otp, settings));
    if (!result.accepted?.some(value => String(value).toLowerCase() === approval.email)) throw new Error('Code not accepted.');
    const sent = await database.from('staff_setup_challenges').update({ status: 'sent' })
      .eq('token_hash', challengeHash).eq('status', 'queued');
    assertDatabaseResult(sent.error);
  } catch {
    await database.from('staff_setup_challenges').update({ status: 'failed' }).eq('token_hash', challengeHash);
    console.error('staff-auth: code delivery requires review');
  } finally { transport?.close(); }
}

export async function requestStaffCode(database, res, email, remember, schedule, deliver = deliverStaffCode) {
  if (process.env.AUTH_MAIL_ENABLED !== 'true') throw Object.assign(new Error('Account setup is not available yet.'), { statusCode: 503 });
  const approval = await approvedEmail(database, email);
  const secret = opaqueToken();
  const hash = tokenHash(secret);
  const result = await database.from('staff_setup_challenges').insert({ token_hash: hash, approval_id: approval?.id || null, remember: remember === true });
  assertDatabaseResult(result.error);
  appendCookie(res, cookie(authCookies.challenge, secret, { maxAge: 900 }));
  // Unknown emails have the same response/cookie/database path; no outbound message.
  if (approval) schedule(deliver(database, approval, hash));
  return { next: 'code', message: 'If this address is approved, a verification code will be sent. Check your inbox and spam folder.' };
}

export async function verifyStaffCode(database, auth, req, res, code) {
  const invalid = () => Object.assign(new Error('The code is invalid or expired. Request a new code if needed.'), { statusCode: 400 });
  if (typeof code !== 'string' || !/^\d{6,10}$/.test(code)) throw invalid();
  const secret = parseCookies(req.headers.cookie || '')[authCookies.challenge] || '';
  if (!/^[a-f0-9]{64}$/.test(secret)) throw invalid();
  const hash = tokenHash(secret);
  const attempted = await database.rpc('consume_staff_setup_attempt', { p_hash: hash });
  assertDatabaseResult(attempted.error);
  const attempt = attempted.data?.[0];
  if (!attempt?.approval_id || !attempt.auth_user_id) throw invalid();
  const approved = await database.from('staff_access_approvals').select('*').eq('id', attempt.approval_id).eq('active', true).maybeSingle();
  assertDatabaseResult(approved.error);
  const approval = approved.data;
  if (!approval || approval.auth_user_id !== attempt.auth_user_id) throw invalid();
  const result = await auth.auth.verifyOtp({ email: approval.email, token: code, type: 'email' });
  if (result.error || result.data.user?.id !== attempt.auth_user_id || !result.data.session ||
      result.data.user.email?.toLowerCase() !== approval.email || !result.data.user.email_confirmed_at) throw invalid();
  const consumed = await database.from('staff_setup_challenges').update({ status: 'used' }).eq('token_hash', hash).eq('status', 'sent').select('token_hash').maybeSingle();
  assertDatabaseResult(consumed.error);
  if (!consumed.data) throw invalid();
  await createStaffSession(database, res, result.data.session, approval, 'verified', attempt.remember);
  appendCookie(res, cookie(authCookies.challenge, '', { maxAge: 0 }));
  return { next: 'new-password' };
}

export async function setStaffPassword(context, res, password, confirmation) {
  if (context.record.kind !== 'verified') throw authDenied();
  validateNewStaffPassword(password, context.approval.email);
  if (password !== confirmation) throw Object.assign(new Error('The passwords do not match.'), { statusCode: 400 });
  await attachProviderSession(context);
  const changed = await context.auth.auth.updateUser({ password });
  if (changed.error) throw Object.assign(new Error('The password could not be accepted. Use a different strong password or request a new verification code.'), { statusCode: 400 });
  const updated = await context.database.from('staff_access_approvals').update({ password_set_at: new Date().toISOString() }).eq('id', context.approval.id).eq('active', true);
  assertDatabaseResult(updated.error);
  const staged = await context.database.from('staff_login_sessions').update({ kind: 'password' }).eq('token_hash', context.record.token_hash).is('revoked_at', null);
  assertDatabaseResult(staged.error);
  const revoked = await context.database.from('staff_login_sessions').update({ revoked_at: new Date().toISOString() })
    .eq('auth_user_id', context.user.id).neq('token_hash', context.record.token_hash).is('revoked_at', null);
  assertDatabaseResult(revoked.error);
  const others = await context.auth.auth.signOut({ scope: 'others' });
  if (others.error) throw new Error('Provider session revocation failed.');
  const session = await context.auth.auth.getSession();
  if (!session.data.session) throw authDenied();
  setSessionCookies(res, session.data.session, { ...context.record, kind: 'password' }, context.secret);
  return { next: 'mfa' };
}

export async function staffMfaOptions(context, res) {
  if (!context.approval.password_set_at || !['password', 'ready'].includes(context.record.kind)) throw authDenied();
  await attachProviderSession(context);
  const listed = await context.auth.auth.mfa.listFactors();
  if (listed.error || !Array.isArray(listed.data?.all)) throw new Error('Authenticator lookup failed.');
  const verified = listed.data.all.find(factor => factor.status === 'verified');
  if (verified) {
    if (verified.factor_type !== 'totp') throw Object.assign(new Error('Contact technical support to use the verification method enabled on this account.'), { statusCode: 409 });
    return { next: 'mfa-code', factor_id: verified.id, enrolling: false, can_skip: false };
  }
  // Once an approved user has deferred setup, ordinary password logins should
  // not keep forcing the setup prompt. They can enable MFA in Account security.
  if (context.record.kind === 'password' && context.approval.setup_completed_at) return skipStaffMfa(context, res);
  return { next: 'mfa-choice' };
}

export async function skipStaffMfa(context, res) {
  if (!context.approval.password_set_at || context.record.kind !== 'password') throw authDenied();
  const session = await attachProviderSession(context);
  const checked = await context.auth.auth.getUser(session.access_token);
  if (checked.error || checked.data.user?.id !== context.user.id ||
      checked.data.user.email?.toLowerCase() !== context.approval.email || !checked.data.user.email_confirmed_at) throw authDenied();
  if (hasEnrolledFactor(checked.data.user)) {
    throw Object.assign(new Error('Two-step verification is already enabled. Enter your authenticator code to continue.'), { statusCode: 409 });
  }
  return completeStaffAccess({ ...context, user: checked.data.user }, res, session);
}

export async function beginStaffMfa(context) {
  if (!context.approval.password_set_at || !['password', 'ready'].includes(context.record.kind)) throw authDenied();
  await attachProviderSession(context);
  const listed = await context.auth.auth.mfa.listFactors();
  if (listed.error) throw new Error('Authenticator lookup failed.');
  if (!Array.isArray(listed.data?.all)) throw new Error('Authenticator lookup failed.');
  const verified = listed.data.all.find(factor => factor.status === 'verified');
  if (verified) {
    if (verified.factor_type !== 'totp') throw Object.assign(new Error('Contact technical support to use the verification method enabled on this account.'), { statusCode: 409 });
    return { next: 'mfa-code', factor_id: verified.id, enrolling: false, can_skip: false };
  }
  for (const factor of listed.data.all || []) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      const removed = await context.auth.auth.mfa.unenroll({ factorId: factor.id });
      if (removed.error) throw new Error('Incomplete enrolment cleanup failed.');
    }
  }
  const enrolled = await context.auth.auth.mfa.enroll({ factorType: 'totp', issuer: 'Briljante Boeke', friendlyName: 'Briljante staff authenticator' });
  if (enrolled.error || !enrolled.data?.totp?.qr_code?.startsWith('data:image/svg+xml')) throw new Error('Authenticator enrolment failed.');
  return { next: 'mfa-code', factor_id: enrolled.data.id, enrolling: true, can_skip: context.record.kind === 'password',
    can_cancel: context.record.kind === 'ready', qr_code: enrolled.data.totp.qr_code, manual_key: enrolled.data.totp.secret };
}

export async function finishStaffMfa(context, res, factorId, code) {
  if (!context.approval.password_set_at || !['password', 'ready'].includes(context.record.kind) ||
      typeof code !== 'string' || !/^\d{6}$/.test(code) || !/^[a-f0-9-]{36}$/i.test(factorId || '')) throw authDenied();
  await attachProviderSession(context);
  const result = await context.auth.auth.mfa.challengeAndVerify({ factorId, code });
  if (result.error || !result.data?.access_token) throw Object.assign(new Error('The authenticator code is incorrect or expired.'), { statusCode: 400 });
  const checked = await context.auth.auth.getUser(result.data.access_token);
  if (checked.error || checked.data.user?.id !== context.user.id) throw authDenied();
  if (!await hasStrongFactor({ ...context, accessToken: result.data.access_token, user: checked.data.user })) throw authDenied();
  return completeStaffAccess({ ...context, user: checked.data.user }, res, result.data);
}

async function completeStaffAccess(context, res, session) {
  const approval = await approvedEmail(context.database, context.approval.email);
  if (!approval || !approval.password_set_at || approval.id !== context.approval.id || approval.auth_user_id !== context.user.id) throw authDenied();
  const staff = { user_id: context.user.id, display_name: approval.display_name, role: approval.role, active: true };
  // The private approval directory is authoritative. Never activate the legacy
  // staff_users directory, which would unlock older password-only previews.
  const completed = await context.database.from('staff_access_approvals').update({ setup_completed_at: approval.setup_completed_at || new Date().toISOString() }).eq('id', approval.id).eq('active', true);
  assertDatabaseResult(completed.error);
  const ready = { ...context.record, kind: 'ready', expires_at: new Date(Date.now() + (context.record.remember ? 30 * 86400_000 : 8 * 3600_000)).toISOString() };
  const stored = await context.database.from('staff_login_sessions').update({ kind: ready.kind, expires_at: ready.expires_at })
    .eq('token_hash', context.record.token_hash).is('revoked_at', null).select('token_hash').maybeSingle();
  assertDatabaseResult(stored.error);
  if (!stored.data) throw authDenied();
  setSessionCookies(res, session, ready, context.secret);
  return { next: 'dashboard', staff: { display_name: staff.display_name, role: staff.role, mfa_enabled: hasEnrolledFactor(context.user) } };
}
