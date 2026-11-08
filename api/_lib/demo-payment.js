import { requireStaff, requireSameOrigin } from './auth.js';

export const demoSchoolId = 'edabcd03-1854-43ca-ac93-45c71e9ef012';
export const demoStaffEmail = 'technical@awaldstudio.com';
export const demoOrigin = 'https://briljante-preview-awaldstudio.vercel.app';
export const isDemoRecord = record => record?.school_id === demoSchoolId || String(record?.reference || '').startsWith('DEMO-');
export const excludeDemoOrders = (query, prefix='') => query.not(`${prefix}reference`,'like','DEMO-%').neq(`${prefix}school_id`,demoSchoolId);
export function demoEnvironment(source = process.env) {
  return source.DEMO_PAYMENTS_ENABLED === 'true' && source.VERCEL_ENV === 'preview' &&
    source.APP_ORIGIN === demoOrigin && source.SUPABASE_URL === 'https://cigyxjfzbjlgbrduzcpw.supabase.co';
}
export async function requireDemoAccess(req, res, {source = process.env, authorise = requireStaff, checkOrigin = requireSameOrigin, mutation = true} = {}) {
  if (!demoEnvironment(source)) throw Object.assign(new Error('Demo payment is not available.'), {statusCode:404});
  const context = await authorise(req, res, ['administrator']);
  if (context.user.email?.toLowerCase() !== demoStaffEmail) throw Object.assign(new Error('Demo payment is restricted to the technical test account.'), {statusCode:403});
  if (mutation) checkOrigin(req);
  return context;
}
export async function canDemoPay(req, res, school, dependencies = {}) {
  if (school.id !== demoSchoolId || !demoEnvironment(dependencies.source)) return false;
  try { await requireDemoAccess(req, res, {...dependencies, mutation:false}); return true; } catch { return false; }
}
