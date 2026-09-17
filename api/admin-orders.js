import { requireStaff } from "./_lib/auth.js";
import { json, methodNotAllowed, publicError } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    await requireStaff(req, res);
    const database = serviceClient();
    const page = Math.max(1, Number.parseInt(req.query.page ?? "1", 10) || 1);
    const pageSize = 50;
    let query = database
      .from("orders")
      .select(
        "id, reference, amount_cents, status, parent_first_name, parent_last_name, parent_email, parent_mobile, created_at, paid_at, school_id, ordering_period_id, schools(name), ordering_periods(name, academic_years(year)), learners(first_name, last_name, class_name, grades(name))",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (typeof req.query.status === "string" && req.query.status) query = query.eq("status", req.query.status);
    if (typeof req.query.school_id === "string" && req.query.school_id) query = query.eq("school_id", req.query.school_id);
    if (typeof req.query.period_id === "string" && req.query.period_id) query = query.eq("ordering_period_id", req.query.period_id);
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const value = req.query.search.trim().replace(/[,%()]/g, "");
      query = query.or(`reference.ilike.%${value}%,parent_last_name.ilike.%${value}%,parent_email.ilike.%${value}%`);
    }

    const { data, error, count } = await query;
    assertDatabaseResult(error);
    return json(res, 200, { orders: data ?? [], page, page_size: pageSize, total: count ?? 0 });
  } catch (error) {
    if (error.statusCode !== 401) console.error("admin-orders", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}
