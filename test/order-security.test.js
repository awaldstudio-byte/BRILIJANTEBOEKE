import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deriveOrderToken, sha256 } from "../api/_lib/crypto.js";
import { validateOrderInput } from "../api/_lib/validation.js";

test("order tokens are deterministic per request but stored only as a hash", () => {
  const token = deriveOrderToken("550e8400-e29b-41d4-a716-446655440000", "a-long-project-secret-used-only-in-tests");
  assert.equal(token, deriveOrderToken("550e8400-e29b-41d4-a716-446655440000", "a-long-project-secret-used-only-in-tests"));
  assert.match(sha256(token), /^[a-f0-9]{64}$/);
  assert.notEqual(token, sha256(token));
});

test("order input accepts multiple learners and rejects malformed offerings", () => {
  const input = validateOrderInput({
    school_token: "school-token-with-sufficient-length",
    request_id: "550e8400-e29b-41d4-a716-446655440000",
    parent: { first_name: "Annelie", last_name: "Jacobs", email: "annelie@example.com", mobile: "0825550123" },
    consent: { accepted: true, policy_version: "2026-09-26" },
    learners: [
      { first_name: "Mia", last_name: "Jacobs", offering_id: "2de1d6a7-02b5-41e0-b9ee-b276c4d65041", class_name: "3A" },
      { first_name: "Liam", last_name: "Jacobs", offering_id: "ec3e1131-5fe0-4516-bc90-2f1b2757d15c", class_name: "5B" },
    ],
  });
  assert.equal(input.learners.length, 2);
  assert.throws(() => validateOrderInput({
    school_token: input.schoolToken,
    request_id: input.idempotencyKey,
    parent: input.parent,
    consent: input.consent,
    learners: [{ ...input.learners[0], offering_id: "not-a-uuid" }],
  }), /available grade/i);
});

test("order input accepts a generated school access code but rejects undersized codes", () => {
  const base = {
    school_token: "ABCDE-23456",
    request_id: "550e8400-e29b-41d4-a716-446655440000",
    parent: { first_name: "Annelie", last_name: "Jacobs", email: "annelie@example.com", mobile: "0825550123" },
    consent: { accepted: true, policy_version: "2026-09-26" },
    learners: [
      { first_name: "Mia", last_name: "Jacobs", offering_id: "2de1d6a7-02b5-41e0-b9ee-b276c4d65041", class_name: "3A" },
    ],
  };

  assert.equal(validateOrderInput(base).schoolToken, "ABCDE-23456");
  assert.throws(() => validateOrderInput({ ...base, school_token: "ABC-123" }), /school link/i);
  assert.throws(() => validateOrderInput({ ...base, consent: { accepted: false, policy_version: "2026-09-26" } }), /Accept the terms/i);
});

test("database migration locks every Phase 1 table behind RLS and service access", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260916205449_phase1_initial_schema.sql", import.meta.url), "utf8");
  const tables = ["schools", "ordering_periods", "school_grade_offerings", "school_access", "orders", "learners", "order_items", "payment_attempts", "payment_events", "staff_users", "notification_jobs", "audit_events"];
  for (const table of tables) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"), `${table} must enable RLS`);
  }
  assert.match(migration, /revoke all on function public\.create_school_order[\s\S]+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.create_school_order[\s\S]+to service_role/i);
});
