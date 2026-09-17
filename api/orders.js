import { deriveOrderToken, sha256 } from "./_lib/crypto.js";
import { env } from "./_lib/env.js";
import { json, methodNotAllowed, publicError, readJson } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";
import { validateOrderInput } from "./_lib/validation.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const input = validateOrderInput(await readJson(req));
    const config = env();
    const orderToken = deriveOrderToken(input.idempotencyKey, config.orderTokenSecret);
    const database = serviceClient();
    const { data, error } = await database.rpc("create_school_order", {
      p_token_hash: sha256(input.schoolToken),
      p_idempotency_key: input.idempotencyKey,
      p_order_access_hash: sha256(orderToken),
      p_parent: input.parent,
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
      CLASS_REQUIRED: "Enter the class for each learner.",
      LEARNER_DETAILS_INVALID: "Check the learner details and try again.",
      PARENT_DETAILS_INVALID: "Check the parent details and try again.",
    };
    if (known[error.message]) error = Object.assign(new Error(known[error.message]), { statusCode: 400 });
    else console.error("orders", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}
