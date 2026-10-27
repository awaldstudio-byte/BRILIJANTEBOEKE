import { sha256 } from './_lib/crypto.js';
import { env, requirePayFast } from './_lib/env.js';
import { json, methodNotAllowed, publicError, readJson } from './_lib/http.js';
import { checkoutRequest } from './_lib/payfast.js';
import { assertDatabaseResult, serviceClient } from './_lib/supabase.js';
import { validateStatusInput } from './_lib/validation.js';
import { requireSandboxAccess, assertPaymentEnvironment } from './_lib/sandbox-payment.js';

const preparationErrors = {
  CHECKOUT_ORDER_NOT_FOUND: [404, 'Order not found.'],
  CHECKOUT_ALREADY_PAID: [409, 'This order has already been paid.'],
  CHECKOUT_ORDER_NOT_PAYABLE: [409, 'This order cannot be paid in its current state.'],
  CHECKOUT_PAYMENT_REVIEW_REQUIRED: [409, 'The payment record needs review before another checkout can be opened.'],
  CHECKOUT_ENVIRONMENT_DENIED: [403, 'This order cannot be paid in this payment environment.'],
  CHECKOUT_LOCK_RETRY: [503, 'The payment record changed. Please check the order status and try again.'],
};

export function createCheckoutHandler({ databaseFactory = serviceClient, configuration = env, checkPayments = requirePayFast,
  sandboxAccess = requireSandboxAccess, checkEnvironment = assertPaymentEnvironment, buildRequest = checkoutRequest } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const input = validateStatusInput(await readJson(req));
      const settings = checkPayments(configuration());
      if (settings.payfastMode === 'sandbox') await sandboxAccess(req, res);
      const database = databaseFactory();
      // The RPC locks and rechecks the canonical order and attempt together.
      // Existing attempts are reused without resetting status or provider IDs.
      const prepared = await database.rpc('prepare_payfast_checkout', {
        p_reference: input.reference, p_order_access_hash: sha256(input.orderToken), p_mode: settings.payfastMode,
      });
      if (prepared.error && preparationErrors[prepared.error.message]) {
        const [statusCode, message] = preparationErrors[prepared.error.message];
        throw Object.assign(new Error(message), { statusCode });
      }
      assertDatabaseResult(prepared.error);
      const order = prepared.data;
      if (!order) throw new Error('Checkout preparation returned no order.');
      checkEnvironment(order, settings.payfastMode);
      const request = buildRequest({ mode: settings.payfastMode, merchantId: settings.payfastMerchantId,
        merchantKey: settings.payfastMerchantKey, passphrase: settings.payfastPassphrase, appOrigin: settings.appOrigin,
        language: input.language, order: { reference: order.reference, amountCents: order.amount_cents,
          parentFirstName: order.parent_first_name, parentLastName: order.parent_last_name,
          parentEmail: order.parent_email, parentMobile: order.parent_mobile, learnerCount: order.learner_count } });
      return json(res, 200, request);
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) console.error('create-checkout', { code: error.code });
      const result = publicError(error);
      return json(res, result.status, { error: result.message });
    }
  };
}
export default createCheckoutHandler();
