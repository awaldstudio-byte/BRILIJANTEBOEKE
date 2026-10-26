import { demoEnvironment, requireDemoAccess, demoSchoolId, demoStaffEmail } from './demo-payment.js';
const denied = () => Object.assign(new Error('PayFast sandbox testing is restricted to the technical test account and fictional school.'), { statusCode: 403 });
export function sandboxEnvironment(source = process.env) {
  return demoEnvironment(source) && source.PAYFAST_SANDBOX_TESTS_ENABLED === 'true' && source.PAYFAST_MODE === 'sandbox';
}
export async function requireSandboxAccess(req, res, { source = process.env, access = requireDemoAccess, mutation = true } = {}) {
  if (!sandboxEnvironment(source)) throw denied();
  return access(req, res, { source, mutation });
}
export function isSandboxOrder(order) {
  return order?.school_id === demoSchoolId && order?.reference?.startsWith('DEMO-BB-') &&
    order?.idempotency_key?.startsWith('sandbox:') && order?.parent_email?.toLowerCase() === demoStaffEmail;
}
export function assertPaymentEnvironment(order, mode, source = process.env) {
  if (mode === 'sandbox') {
    if (!sandboxEnvironment(source) || !isSandboxOrder(order)) throw denied();
  } else if (order?.reference?.startsWith('DEMO-') || order?.idempotency_key?.startsWith('sandbox:')) throw denied();
}
export async function canSandboxPay(req, res, school, { source = process.env, access = requireSandboxAccess } = {}) {
  if (school?.id !== demoSchoolId || !sandboxEnvironment(source)) return false;
  try { await access(req, res, { source, mutation: false }); return true; } catch { return false; }
}
