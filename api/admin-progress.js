import { requireStaff } from "./_lib/auth.js";
import { json, methodNotAllowed, publicError } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    await requireStaff(req, res);
    const database = serviceClient();
    const [offerings, paidItems] = await Promise.all([
      database
        .from("school_grade_offerings")
        .select("id, school_id, ordering_period_id, expected_quantity, price_cents, active, schools(name), ordering_periods(name, academic_years(year)), grades(name, sort_order)")
        .eq("active", true),
      database
        .from("order_items")
        .select("offering_id, orders!inner(status)")
        .eq("orders.status", "paid"),
    ]);
    assertDatabaseResult(offerings.error);
    assertDatabaseResult(paidItems.error);
    const paidByOffering = new Map();
    for (const item of paidItems.data ?? []) {
      paidByOffering.set(item.offering_id, (paidByOffering.get(item.offering_id) ?? 0) + 1);
    }
    const progress = (offerings.data ?? []).map((offering) => {
      const paid = paidByOffering.get(offering.id) ?? 0;
      return { ...offering, paid_quantity: paid, remaining_quantity: Math.max(0, offering.expected_quantity - paid) };
    });
    return json(res, 200, { progress });
  } catch (error) {
    if (error.statusCode !== 401) console.error("admin-progress", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}
