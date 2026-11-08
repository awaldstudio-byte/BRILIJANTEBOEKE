import { deriveOrderToken, sha256 } from "./_lib/crypto.js";
import { env, requirePayFast } from "./_lib/env.js";
import { json, methodNotAllowed, publicError, readJson } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";
import { validateOrderInput } from "./_lib/validation.js";
import { resolveSchoolOrdering, internalSchoolOrderHash } from './_lib/school-ordering.js';
import { createDemoPaymentHandler } from './_lib/demo-payment-handler.js';
import { createSandboxOrderHandler } from './_lib/sandbox-order-handler.js';
import { protectPublicTraffic, protectOrderSubmission } from './_lib/order-abuse.js';
import { demoSchoolId } from './_lib/demo-payment.js';

export default createOrderHandler();
export function createOrderHandler({ databaseFactory = serviceClient, configuration = env, checkPayments = requirePayFast, now = () => Date.now(), demoHandler = createDemoPaymentHandler(), sandboxHandler = createSandboxOrderHandler(), guardTraffic = protectPublicTraffic, guardSubmission = protectOrderSubmission, source = process.env } = {}) {
return async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const body = await readJson(req);
    if (body.confirm_sandbox === true) return sandboxHandler(req,res,body);
    if (body.confirm_demo === true) { req.body = body; return demoHandler(req,res); }
    const input = validateOrderInput(body);
    const config = checkPayments(configuration());
    if (config.payfastMode === 'sandbox') throw Object.assign(new Error('Sandbox orders require the authorised technical test flow.'), { statusCode: 403 });
    if (source.VERCEL_ENV !== 'production') throw Object.assign(new Error('Live ordering is available only on the production website.'), {statusCode:403});
    const orderToken = deriveOrderToken(input.idempotencyKey, config.orderTokenSecret);
    const database = databaseFactory();
    await guardTraffic({req,res,database,settings:config});
    await guardSubmission({req,res,database,settings:config,input});
    // Resolve both legacy tokens and direct links before any order creation.
    // Otherwise a valid old test-school token could bypass a slug-only guard.
    const { school, period, open } = await resolveSchoolOrdering(database, { identifier: input.schoolIdentifier, periodId: input.orderingPeriodId, token: input.schoolToken }, now());
    if (school.id === demoSchoolId) throw Object.assign(new Error('This school ordering link is unavailable.'), {statusCode:404});
    if (!open) throw Object.assign(new Error('ORDERING_UNAVAILABLE'), {statusCode:400});
    const tokenHash = input.schoolToken ? sha256(input.schoolToken) : await internalSchoolOrderHash(database, school, period, now());
    const { data, error } = await database.rpc("create_school_order", {
      p_token_hash: tokenHash,
      p_idempotency_key: input.idempotencyKey,
      p_order_access_hash: sha256(orderToken),
      p_parent: { ...input.parent, consent: input.consent },
      p_learners: input.learners,
    });
    assertDatabaseResult(error);

    return json(res, data.reused ? 200 : 201, {
      order: {
        reference: data.reference,
        amount_cents: data.amount_cents,
        status: data.status,
        access_token: orderToken,
      },
    });
  } catch (error) {
    const known = {
      ORDERING_UNAVAILABLE: "This school's ordering period is not currently open.",
      BOOK_NOT_AVAILABLE: "One of the selected books is no longer available for this school.",
      CLASS_REQUIRED: "This ordering period needs review. Please contact Briljante Boeke.",
      LEARNER_DETAILS_INVALID: "Check the child details and try again.",
      PARENT_DETAILS_INVALID: "Check the parent details and try again.",
      CONSENT_REQUIRED: "Accept the terms and privacy policy before continuing.",
    };
    if (known[error.message]) error = Object.assign(new Error(known[error.message]), { statusCode: 400 });
    else console.error("orders", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
};
}
