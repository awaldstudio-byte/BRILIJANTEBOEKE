import { randomBytes } from "node:crypto";
import { requireSameOrigin, requireStaff } from "./_lib/auth.js";
import { sha256 } from "./_lib/crypto.js";
import { env } from "./_lib/env.js";
import { json, methodNotAllowed, publicError, readJson } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";
import { optionalText, text, uuid } from "./_lib/validation.js";

export default async function handler(req, res) {
  if (req.method === "GET") return list(req, res);
  if (req.method === "POST") return save(req, res);
  return methodNotAllowed(res, ["GET", "POST"]);
}

async function list(req, res) {
  try {
    await requireStaff(req, res);
    const database = serviceClient();
    const [years, grades, books, schools, periods, offerings, access] = await Promise.all([
      database.from("academic_years").select("id, year, label, is_active").order("year", { ascending: false }),
      database.from("grades").select("id, code, name, sort_order").order("sort_order"),
      database.from("books").select("id, grade_id, sku, title, default_price_cents, cover_path, active"),
      database.from("schools").select("id, slug, name, status, contact_name, contact_email, notes").order("name"),
      database.from("ordering_periods").select("id, school_id, academic_year_id, name, opens_at, closes_at, status, delivery_note"),
      database.from("school_grade_offerings").select("id, school_id, ordering_period_id, grade_id, book_id, price_cents, expected_quantity, active"),
      database.from("school_access").select("id, school_id, ordering_period_id, label, code_hint, expires_at, revoked_at, last_used_at, created_at").is("revoked_at", null),
    ]);
    for (const result of [years, grades, books, schools, periods, offerings, access]) assertDatabaseResult(result.error);
    return json(res, 200, {
      academic_years: years.data,
      grades: grades.data,
      books: books.data,
      schools: schools.data,
      periods: periods.data,
      offerings: offerings.data,
      access_links: access.data,
    });
  } catch (error) {
    if (error.statusCode !== 401) console.error("admin-schools-list", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}

async function save(req, res) {
  try {
    requireSameOrigin(req);
    const { user } = await requireStaff(req, res, ["administrator"]);
    const input = validate(await readJson(req, 64_000));
    const database = serviceClient();

    const { data: catalog, error: catalogError } = await database
      .from("books")
      .select("id, grade_id")
      .in("id", input.offerings.map((item) => item.book_id));
    assertDatabaseResult(catalogError);
    const bookGrades = new Map((catalog ?? []).map((item) => [item.id, item.grade_id]));
    if (input.offerings.some((item) => bookGrades.get(item.book_id) !== item.grade_id)) {
      const error = new Error("A selected book does not match its grade.");
      error.statusCode = 400;
      throw error;
    }

    const schoolPayload = {
      slug: input.school.slug,
      name: input.school.name,
      status: input.school.status,
      contact_name: input.school.contact_name || null,
      contact_email: input.school.contact_email || null,
      notes: input.school.notes || null,
    };
    let schoolResult;
    if (input.school.id) {
      schoolResult = await database.from("schools").update(schoolPayload).eq("id", input.school.id).select().single();
    } else {
      schoolResult = await database.from("schools").insert(schoolPayload).select().single();
    }
    assertDatabaseResult(schoolResult.error);
    const school = schoolResult.data;

    const periodPayload = {
      school_id: school.id,
      academic_year_id: input.period.academic_year_id,
      name: input.period.name,
      opens_at: input.period.opens_at,
      closes_at: input.period.closes_at,
      status: input.period.status,
      class_required: false,
      delivery_note: input.period.delivery_note || null,
    };
    let periodResult;
    if (input.period.id) {
      periodResult = await database
        .from("ordering_periods")
        .update(periodPayload)
        .eq("id", input.period.id)
        .eq("school_id", school.id)
        .select()
        .single();
    } else {
      periodResult = await database.from("ordering_periods").insert(periodPayload).select().single();
    }
    assertDatabaseResult(periodResult.error);
    const period = periodResult.data;

    const { error: deactivateError } = await database
      .from("school_grade_offerings")
      .update({ active: false })
      .eq("ordering_period_id", period.id);
    assertDatabaseResult(deactivateError);
    const { error: offeringError } = await database.from("school_grade_offerings").upsert(
      input.offerings.map((item) => ({
        ...item,
        school_id: school.id,
        ordering_period_id: period.id,
        active: true,
      })),
      { onConflict: "ordering_period_id,grade_id" },
    );
    assertDatabaseResult(offeringError);

    let generatedLink = null;
    let generatedCode = null;
    const { data: currentAccess, error: accessError } = await database
      .from("school_access")
      .select("id")
      .eq("school_id", school.id)
      .eq("ordering_period_id", period.id)
      .is("revoked_at", null);
    assertDatabaseResult(accessError);

    if (!currentAccess?.length || input.replace_link) {
      if (currentAccess?.length) {
        const { error: revokeError } = await database
          .from("school_access")
          .update({ revoked_at: new Date().toISOString() })
          .in("id", currentAccess.map((item) => item.id));
        assertDatabaseResult(revokeError);
      }
      const rawToken = accessCode();
      const { error: newAccessError } = await database.from("school_access").insert({
        school_id: school.id,
        ordering_period_id: period.id,
        token_hash: sha256(rawToken),
        code_hint: rawToken.replace("-", "").slice(-4),
        label: `${school.name} parent access code`,
        expires_at: period.closes_at,
      });
      assertDatabaseResult(newAccessError);
      generatedCode = rawToken;
      generatedLink = `${env().appOrigin}/order/?school=${encodeURIComponent(rawToken)}&lang=en`;
    }

    const { error: auditError } = await database.from("audit_events").insert({
      actor_user_id: user.id,
      action: input.school.id ? "school_configuration_updated" : "school_configuration_created",
      entity_type: "school",
      entity_id: school.id,
      details: { period_id: period.id, grade_count: input.offerings.length, access_link_replaced: input.replace_link },
    });
    assertDatabaseResult(auditError);

    return json(res, input.school.id ? 200 : 201, {
      school,
      period,
      generated_link: generatedLink,
      generated_code: generatedCode,
    });
  } catch (error) {
    if (error.statusCode !== 401) console.error("admin-schools-save", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}

function validate(body) {
  const school = body?.school ?? {};
  const period = body?.period ?? {};
  const offerings = Array.isArray(body?.offerings) ? body.offerings : [];
  if (offerings.length < 1 || offerings.length > 7) {
    const error = new Error("Select at least one participating grade.");
    error.statusCode = 400;
    throw error;
  }
  const opensAt = validDate(period.opens_at, "Enter a valid opening date.");
  const closesAt = validDate(period.closes_at, "Enter a valid closing date.");
  if (Date.parse(closesAt) <= Date.parse(opensAt)) {
    const error = new Error("The closing date must be after the opening date.");
    error.statusCode = 400;
    throw error;
  }

  return {
    school: {
      id: school.id ? uuid(school.id) : null,
      slug: slug(school.slug),
      name: text(school.name, 2, 160, "Enter the school name."),
      status: choice(school.status, ["active", "inactive", "archived"], "Select a valid school status."),
      contact_name: optionalText(school.contact_name, 160),
      contact_email: optionalText(school.contact_email, 254).toLowerCase(),
      notes: optionalText(school.notes, 2_000),
    },
    period: {
      id: period.id ? uuid(period.id) : null,
      academic_year_id: uuid(period.academic_year_id),
      name: text(period.name, 2, 160, "Enter the ordering period name."),
      opens_at: opensAt,
      closes_at: closesAt,
      status: choice(period.status, ["draft", "open", "closed", "archived"], "Select a valid ordering status."),
      delivery_note: optionalText(period.delivery_note, 1_000),
    },
    offerings: offerings.map((item) => ({
      grade_id: uuid(item.grade_id),
      book_id: uuid(item.book_id),
      price_cents: integer(item.price_cents, 0, 10_000_000, "Enter a valid price."),
      expected_quantity: integer(item.expected_quantity, 0, 100_000, "Enter a valid expected quantity."),
    })),
    replace_link: Boolean(body.replace_link),
  };
}

function slug(value) {
  const clean = text(value, 2, 120, "Enter a valid school link name.").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) {
    const error = new Error("Use lowercase letters, numbers and hyphens for the school link name.");
    error.statusCode = 400;
    throw error;
  }
  return clean;
}

function choice(value, allowed, message) {
  if (!allowed.includes(value)) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function integer(value, min, max, message) {
  if (!Number.isInteger(value) || value < min || value > max) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function validDate(value, message) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
  return new Date(value).toISOString();
}

function accessCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const characters = [...bytes].map((byte) => alphabet[byte % alphabet.length]);
  return `${characters.slice(0, 5).join("")}-${characters.slice(5).join("")}`;
}
