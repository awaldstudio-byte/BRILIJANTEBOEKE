import { sha256 } from "./_lib/crypto.js";
import { env, requirePayFast } from "./_lib/env.js";
import { json, methodNotAllowed, publicError, readJson } from "./_lib/http.js";
import { checkoutRequest } from "./_lib/payfast.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";
import { validateStatusInput } from "./_lib/validation.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const input = validateStatusInput(await readJson(req));
    const config = requirePayFast(env());
    const database = serviceClient();
    const { data: order, error: orderError } = await database
      .from("orders")
      .select("id, reference, amount_cents, status, parent_first_name, parent_last_name, parent_email, parent_mobile")
      .eq("reference", input.reference)
      .eq("order_access_hash", sha256(input.orderToken))
      .maybeSingle();
    assertDatabaseResult(orderError);
    if (!order) return json(res, 404, { error: "Order not found." });
    if (order.status === "paid") return json(res, 409, { error: "This order has already been paid." });
    if (order.status !== "pending_payment" && order.status !== "payment_failed") {
      return json(res, 409, { error: "This order cannot be paid in its current state." });
    }

    const { count: learnerCount, error: countError } = await database
      .from("learners")
      .select("id", { count: "exact", head: true })
      .eq("order_id", order.id);
    assertDatabaseResult(countError);

    const request = checkoutRequest({
      mode: config.payfastMode,
      merchantId: config.payfastMerchantId,
      merchantKey: config.payfastMerchantKey,
      passphrase: config.payfastPassphrase,
      appOrigin: config.appOrigin,
      language: input.language,
      order: {
        reference: order.reference,
        amountCents: order.amount_cents,
        parentFirstName: order.parent_first_name,
        parentLastName: order.parent_last_name,
        parentEmail: order.parent_email,
        parentMobile: order.parent_mobile,
        learnerCount: learnerCount ?? 1,
      },
    });

    const { error: attemptError } = await database.from("payment_attempts").upsert(
      {
        order_id: order.id,
        merchant_payment_id: order.reference,
        amount_cents: order.amount_cents,
        status: "pending",
        checkout_payload: {
          mode: config.payfastMode,
          amount: request.fields.amount,
          created_at: new Date().toISOString(),
        },
      },
      { onConflict: "merchant_payment_id" },
    );
    assertDatabaseResult(attemptError);

    return json(res, 200, request);
  } catch (error) {
    console.error("create-checkout", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}
