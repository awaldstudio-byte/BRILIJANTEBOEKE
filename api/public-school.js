import { sha256 } from "./_lib/crypto.js";
import { json, methodNotAllowed, publicError } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (token.length < 8 || token.length > 300) return json(res, 404, { error: "This school link or access code is unavailable." });

    const database = serviceClient();
    const tokenHash = sha256(token);
    const { data: access, error: accessError } = await database
      .from("school_access")
      .select("school_id, ordering_period_id, expires_at, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    assertDatabaseResult(accessError);
    if (!access || access.revoked_at || (access.expires_at && new Date(access.expires_at) <= new Date())) {
      return json(res, 404, { error: "This school link or access code is unavailable." });
    }

    const [{ data: school, error: schoolError }, { data: period, error: periodError }] = await Promise.all([
      database.from("schools").select("id, slug, name, status").eq("id", access.school_id).maybeSingle(),
      database
        .from("ordering_periods")
        .select("id, name, opens_at, closes_at, status, delivery_note, academic_years(year, label)")
        .eq("id", access.ordering_period_id)
        .eq("school_id", access.school_id)
        .maybeSingle(),
    ]);
    assertDatabaseResult(schoolError);
    assertDatabaseResult(periodError);

    const now = Date.now();
    const open =
      school?.status === "active" &&
      period?.status === "open" &&
      Date.parse(period.opens_at) <= now &&
      Date.parse(period.closes_at) > now;
    if (!school || !period) return json(res, 404, { error: "This school link or access code is unavailable." });

    const { data: offerings, error: offeringsError } = await database
      .from("school_grade_offerings")
      .select("id, price_cents, expected_quantity, grades(id, code, name, sort_order), books(id, sku, title, cover_path)")
      .eq("school_id", access.school_id)
      .eq("ordering_period_id", access.ordering_period_id)
      .eq("active", true)
      .order("sort_order", { referencedTable: "grades", ascending: true });
    assertDatabaseResult(offeringsError);

    return json(res, 200, {
      school: { slug: school.slug, name: school.name },
      period: {
        name: period.name,
        academic_year: period.academic_years,
        opens_at: period.opens_at,
        closes_at: period.closes_at,
        delivery_note: period.delivery_note,
        open,
      },
      offerings: (offerings ?? []).map((item) => ({
        id: item.id,
        price_cents: item.price_cents,
        expected_quantity: item.expected_quantity,
        grade: item.grades,
        book: item.books,
      })),
    });
  } catch (error) {
    console.error("public-school", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}
