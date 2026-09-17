import { sha256 } from "./_lib/crypto.js";
import { json, methodNotAllowed, publicError } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    const reference = typeof req.query.reference === "string" ? req.query.reference.trim().toUpperCase() : "";
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (!reference || token.length < 20) return json(res, 404, { error: "Order not found." });

    const database = serviceClient();
    const { data: order, error } = await database
      .from("orders")
      .select("id, reference, amount_cents, status, paid_at, created_at, schools(name), ordering_periods(name, academic_years(year))")
      .eq("reference", reference)
      .eq("order_access_hash", sha256(token))
      .maybeSingle();
    assertDatabaseResult(error);
    if (!order) return json(res, 404, { error: "Order not found." });

    const { data: learners, error: learnerError } = await database
      .from("learners")
      .select("first_name, last_name, class_name, grades(name)")
      .eq("order_id", order.id);
    assertDatabaseResult(learnerError);

    return json(res, 200, {
      order: {
        reference: order.reference,
        amount_cents: order.amount_cents,
        status: order.status,
        paid_at: order.paid_at,
        created_at: order.created_at,
        school: order.schools,
        period: order.ordering_periods,
        learners: learners ?? [],
      },
    });
  } catch (error) {
    console.error("order-status", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}
