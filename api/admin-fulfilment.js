import { requireSameOrigin, requireStaff } from "./_lib/auth.js";
import { json, methodNotAllowed, publicError, readJson } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";
import { optionalText, uuid } from "./_lib/validation.js";

const statuses = new Set(["created", "packing", "ready", "dispatched", "delivered", "cancelled"]);

export default async function handler(req, res) {
  if (req.method === "GET") return list(req, res);
  if (req.method === "POST") return create(req, res);
  if (req.method === "PATCH") return updateStatus(req, res);
  return methodNotAllowed(res, ["GET", "POST", "PATCH"]);
}

async function list(req, res) {
  try {
    await requireStaff(req, res);
    const database = serviceClient();
    const { data, error } = await database
      .from("fulfilment_batches")
      .select("id, school_id, ordering_period_id, label, status, created_at, schools(name), ordering_periods(name, academic_years(year)), fulfilment_batch_items(count)")
      .order("created_at", { ascending: false });
    assertDatabaseResult(error);
    return json(res, 200, { batches: data ?? [] });
  } catch (error) {
    if (error.statusCode !== 401) console.error("admin-fulfilment-list", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}

async function create(req, res) {
  try {
    requireSameOrigin(req);
    const { user } = await requireStaff(req, res, ["administrator"]);
    const body = await readJson(req);
    const schoolId = uuid(body?.school_id);
    const periodId = uuid(body?.period_id);
    const label = optionalText(body?.label, 160);
    if (label.length < 2) {
      const error = new Error("Enter a batch name.");
      error.statusCode = 400;
      throw error;
    }
    const database = serviceClient();
    const { data, error } = await database.rpc("create_fulfilment_batch", {
      p_school_id: schoolId,
      p_ordering_period_id: periodId,
      p_label: label,
      p_created_by: user.id,
    });
    assertDatabaseResult(error);
    const { error: auditError } = await database.from("audit_events").insert({
      actor_user_id: user.id,
      action: "fulfilment_batch_created",
      entity_type: "fulfilment_batch",
      entity_id: data.id,
      details: { school_id: schoolId, ordering_period_id: periodId, item_count: data.item_count },
    });
    assertDatabaseResult(auditError);
    return json(res, 201, { batch: data });
  } catch (error) {
    if (error.statusCode !== 401) console.error("admin-fulfilment-create", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}

async function updateStatus(req, res) {
  try {
    requireSameOrigin(req);
    const { user } = await requireStaff(req, res, ["administrator"]);
    const body = await readJson(req);
    const id = uuid(body?.id);
    if (!statuses.has(body?.status)) {
      const error = new Error("Select a valid fulfilment status.");
      error.statusCode = 400;
      throw error;
    }
    const database = serviceClient();
    const { data, error } = await database.from("fulfilment_batches").update({ status: body.status }).eq("id", id).select("id, status").single();
    assertDatabaseResult(error);
    const { error: auditError } = await database.from("audit_events").insert({
      actor_user_id: user.id,
      action: "fulfilment_batch_status_updated",
      entity_type: "fulfilment_batch",
      entity_id: data.id,
      details: { status: data.status },
    });
    assertDatabaseResult(auditError);
    return json(res, 200, { batch: data });
  } catch (error) {
    if (error.statusCode !== 401) console.error("admin-fulfilment-status", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}
