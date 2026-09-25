import { requireStaff } from "./_lib/auth.js";
import { methodNotAllowed } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    await requireStaff(req, res);
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
      ["Packing summary"],
      ["School", batch.schools?.name ?? ""],
      ["Academic year", batch.ordering_periods?.academic_years?.year ?? ""],
      ["Ordering period", batch.ordering_periods?.name ?? ""],
      ["Batch", batch.label],
      [],
      ["Grade", "Workbook", "Quantity"],
      ...[...totals.values()].sort((a, b) => a.grade.localeCompare(b.grade)).map((item) => [item.grade, item.book, item.quantity]),
      [],
      ["Learner allocation"],
      ["Grade", "Workbook", "Learner first name", "Learner surname", "Order reference", "Quantity"],
      ...data.map((item) => [item.grades?.name, item.book_title, item.learner_first_name, item.learner_last_name, item.order_reference, item.quantity]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="briljante-school-batch-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(`\uFEFF${csv}`);
  } catch (error) {
    console.error("admin-batch-export", { code: error.code, message: error.message });
    return res.status(error.statusCode ?? 500).send("The batch report could not be generated.");
  }
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
