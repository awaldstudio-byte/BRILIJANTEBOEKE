import { deriveOrderToken, sha256 } from './crypto.js';
import { env, requirePayFast } from './env.js';
import { json, publicError } from './http.js';
import { serviceClient, assertDatabaseResult } from './supabase.js';
import { validateOrderInput } from './validation.js';
import { resolveSchoolOrdering, internalSchoolOrderHash } from './school-ordering.js';
import { demoSchoolId, demoStaffEmail } from './demo-payment.js';
import { requireSandboxAccess, isSandboxOrder } from './sandbox-payment.js';
export function createSandboxOrderHandler({ access = requireSandboxAccess, databaseFactory = serviceClient,
  configuration = env, checkPayments = requirePayFast, now = () => Date.now() } = {}) {
  return async function handler(req, res, body) {
    try {
      const context = await access(req, res);
      const input = validateOrderInput(body), settings = checkPayments(configuration());
      if (settings.payfastMode !== 'sandbox' || body.confirm_sandbox !== true || input.parent.email.toLowerCase() !== demoStaffEmail) {
        throw Object.assign(new Error('Use the technical test mailbox for this sandbox order.'), { statusCode: 403 });
      }
      const database = databaseFactory();
      const { school, period } = await resolveSchoolOrdering(database, { identifier: input.schoolIdentifier, periodId: input.orderingPeriodId }, now());
      if (school.id !== demoSchoolId) throw Object.assign(new Error('Choose Test School 1 for sandbox acceptance.'), { statusCode: 403 });
      const rate = await database.rpc('consume_staff_auth_limit', { p_key: sha256(`sandbox-payment:${context.user.id}`), p_limit: 20, p_seconds: 3600 });
      assertDatabaseResult(rate.error);
      if (rate.data !== true) throw Object.assign(new Error('Sandbox test limit reached.'), { statusCode: 429 });
      const requestId = `sandbox:${input.idempotencyKey}`;
      const token = deriveOrderToken(requestId, settings.orderTokenSecret);
      const created = await database.rpc('create_sandbox_school_order', {
        p_token_hash: await internalSchoolOrderHash(database, school, period, now()), p_idempotency_key: requestId,
        p_order_access_hash: sha256(token), p_parent: { ...input.parent, consent: input.consent }, p_learners: input.learners,
      });
      assertDatabaseResult(created.error);
      const order = created.data;
      if (!order || !isSandboxOrder({ ...order, school_id: school.id, parent_email: input.parent.email, idempotency_key: requestId })) throw new Error('Sandbox order could not be confirmed.');
      return json(res, order.reused ? 200 : 201, { sandbox: true, order: { reference: order.reference, amount_cents: order.amount_cents, status: order.status, access_token: token } });
    } catch (error) { const result = publicError(error); return json(res, result.status, { error: result.message }); }
  };
}
