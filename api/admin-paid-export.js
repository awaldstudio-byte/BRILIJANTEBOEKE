import { requireStaff } from "./_lib/auth.js";
import { methodNotAllowed } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    await requireStaff(req, res);
    const database = serviceClient();
    let query = database
      .from("orders")
      .select("reference, parent_first_name, parent_last_name, parent_email, parent_mobile, amount_cents, paid_at, school_id, ordering_period_id, schools(name), ordering_periods(name, academic_years(year)), learners(first_name, last_name, class_name, grades(name))")
      .eq("status", "paid")
      .order("paid_at", { ascending: true });
    if (typeof req.query.school_id === "string" && req.query.school_id) query = query.eq("school_id", req.query.school_id);
    if (typeof req.query.period_id === "string" && req.query.period_id) query = query.eq("ordering_period_id", req.query.period_id);
    const { data, error } = await query;
    assertDatabaseResult(error);

    const rows = [[
      "School", "Academic year", "Ordering period", "Grade", "Class", "Learner first name", "Learner surname",
      "Parent first name", "Parent surname", "Parent email", "Parent mobile", "Order reference", "Order total", "Paid at",
    ]];
    for (const order of data ?? []) {
      for (const learner of order.learners ?? []) {
        rows.push([
          order.schools?.name,
          order.ordering_periods?.academic_years?.year,
          order.ordering_periods?.name,
          learner.grades?.name,
          learner.class_name,
          learner.first_name,
          learner.last_name,
          order.parent_first_name,
          order.parent_last_name,
          order.parent_email,
          order.parent_mobile,
          order.reference,
          (order.amount_cents / 100).toFixed(2),
          order.paid_at,
        ]);
      }
    }

    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="briljante-paid-learners-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(`\uFEFF${csv}`);
  } catch (error) {
    console.error("admin-paid-export", { code: error.code, message: error.message });
    return res.status(error.statusCode ?? 500).send("The report could not be generated.");
  }
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
