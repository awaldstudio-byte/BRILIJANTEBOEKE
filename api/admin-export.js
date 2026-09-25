import { requireStaff } from "./_lib/auth.js";
import { methodNotAllowed } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    await requireStaff(req, res);
    if (req.query?.report === "batch") return exportBatch(req, res);
    return exportPaidLearners(req, res);
  } catch (error) {
    console.error("admin-export", { code: error.code, message: error.message });
    return res.status(error.statusCode ?? 500).send("The report could not be generated.");
  }
}

async function exportPaidLearners(req, res) {
  const database = serviceClient();
  let query = database
    .from("orders")
    .select("reference, parent_first_name, parent_last_name, parent_email, parent_mobile, amount_cents, paid_at, school_id, ordering_period_id, schools(name), ordering_periods(name, academic_years(year)), learners(first_name, last_name, grades(name))")
    .eq("status", "paid")
    .order("paid_at", { ascending: true });
  if (typeof req.query.school_id === "string" && req.query.school_id) query = query.eq("school_id", req.query.school_id);
  if (typeof req.query.period_id === "string" && req.query.period_id) query = query.eq("ordering_period_id", req.query.period_id);
  const { data, error } = await query;
  assertDatabaseResult(error);
  const rows = [["School", "Academic year", "Ordering period", "Grade", "Learner first name", "Learner surname", "Parent first name", "Parent surname", "Parent email", "Parent mobile", "Order reference", "Order total", "Paid at"]];
  for (const order of data ?? []) {
    for (const learner of order.learners ?? []) {
      rows.push([order.schools?.name, order.ordering_periods?.academic_years?.year, order.ordering_periods?.name, learner.grades?.name, learner.first_name, learner.last_name, order.parent_first_name, order.parent_last_name, order.parent_email, order.parent_mobile, order.reference, (order.amount_cents / 100).toFixed(2), order.paid_at]);
    }
  }
  return sendCsv(res, rows, "briljante-paid-learners");
}

async function exportBatch(req, res) {
  const batchId = typeof req.query?.batch_id === "string" ? req.query.batch_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return res.status(400).send("A valid batch is required.");
  const database = serviceClient();
  const { data, error } = await database
    .from("fulfilment_batch_items")
    .select("book_title, learner_first_name, learner_last_name, order_reference, quantity, grades(name), fulfilment_batches!inner(label, schools(name), ordering_periods(name, academic_years(year)))")
    .eq("batch_id", batchId)
    .order("created_at");
  assertDatabaseResult(error);
  if (!data?.length) return res.status(404).send("The batch was not found.");
  const batch = data[0].fulfilment_batches;
  const totals = new Map();
  for (const item of data) {
    const key = `${item.grades?.name ?? ""}|${item.book_title}`;
    totals.set(key, { grade: item.grades?.name ?? "", book: item.book_title, quantity: (totals.get(key)?.quantity ?? 0) + item.quantity });
  }
  const rows = [
    ["Packing summary"], ["School", batch.schools?.name ?? ""], ["Academic year", batch.ordering_periods?.academic_years?.year ?? ""], ["Ordering period", batch.ordering_periods?.name ?? ""], ["Batch", batch.label], [],
    ["Grade", "Workbook", "Quantity"], ...[...totals.values()].sort((a, b) => a.grade.localeCompare(b.grade)).map((item) => [item.grade, item.book, item.quantity]), [],
    ["Learner allocation"], ["Grade", "Workbook", "Learner first name", "Learner surname", "Order reference", "Quantity"], ...data.map((item) => [item.grades?.name, item.book_title, item.learner_first_name, item.learner_last_name, item.order_reference, item.quantity]),
  ];
  return sendCsv(res, rows, "briljante-school-batch");
}

function sendCsv(res, rows, filename) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).send(`\uFEFF${csv}`);
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
