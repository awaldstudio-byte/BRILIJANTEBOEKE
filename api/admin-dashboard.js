import { requireStaff } from "./_lib/auth.js";
import { json, methodNotAllowed, publicError } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    const { staff } = await requireStaff(req, res);
    if (String(req.query?.session ?? "") === "1") return json(res, 200, { staff });

    const database = serviceClient();
    const [schools, pending, paid, revenue, recent, periods] = await Promise.all([
      database.from("schools").select("id", { count: "exact", head: true }).eq("status", "active"),
      database.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending_payment"),
      database.from("orders").select("id", { count: "exact", head: true }).eq("status", "paid"),
      database.from("orders").select("amount_cents").eq("status", "paid"),
      database
        .from("orders")
        .select("reference, amount_cents, status, created_at, paid_at, parent_first_name, parent_last_name, schools(name)")
        .order("created_at", { ascending: false })
        .limit(12),
      database
        .from("ordering_periods")
        .select("id, school_id, name, status, opens_at, closes_at, schools(name), academic_years(year)")
        .in("status", ["open", "closed"])
        .order("closes_at", { ascending: false })
        .limit(20),
    ]);
    for (const result of [schools, pending, paid, revenue, recent, periods]) assertDatabaseResult(result.error);

    return json(res, 200, {
      staff,
      summary: {
        active_schools: schools.count ?? 0,
        pending_orders: pending.count ?? 0,
        paid_orders: paid.count ?? 0,
        paid_total_cents: (revenue.data ?? []).reduce((sum, item) => sum + item.amount_cents, 0),
      },
      recent_orders: recent.data ?? [],
      periods: periods.data ?? [],
    });
  } catch (error) {
    if (error.statusCode !== 401) console.error("admin-dashboard", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}
