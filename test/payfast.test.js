import assert from "node:assert/strict";
import test from "node:test";
import { checkoutRequest, parameterString, phpUrlEncode, signature, verifyNotification } from "../api/_lib/payfast.js";

test("PayFast encoding matches PHP urlencode rules", () => {
  assert.equal(phpUrlEncode("A value / ~"), "A+value+%2F+%7E");
  assert.equal(phpUrlEncode("Mia & Liam"), "Mia+%26+Liam");
});

test("custom integration signature preserves documented field order", () => {
  const fields = [
    ["merchant_id", "10000100"],
    ["merchant_key", "46f0cd694581a"],
    ["return_url", "https://example.com/return"],
    ["amount", "10.00"],
    ["item_name", "Test Product"],
  ];
  assert.equal(
    parameterString(fields, { passphrase: "jt7NOE43FZPn" }),
    "merchant_id=10000100&merchant_key=46f0cd694581a&return_url=https%3A%2F%2Fexample.com%2Freturn&amount=10.00&item_name=Test+Product&passphrase=jt7NOE43FZPn",
  );
  assert.match(signature(fields, "jt7NOE43FZPn"), /^[a-f0-9]{32}$/);
});

test("checkout fields never disclose the parent order access token", () => {
  const result = checkoutRequest({
    mode: "sandbox",
    merchantId: "10000100",
    merchantKey: "46f0cd694581a",
    passphrase: "jt7NOE43FZPn",
    appOrigin: "https://www.briljanteboeke.co.za",
    order: {
      reference: "BB-26-ABC12345",
      amountCents: 66000,
      orderToken: "must-not-leave-the-site",
      parentFirstName: "Annelie",
      parentLastName: "Jacobs",
      parentEmail: "annelie@example.com",
      parentMobile: "0825550123",
      learnerCount: 2,
    },
  });
  assert.equal(result.action, "https://sandbox.payfast.co.za/eng/process");
  assert.equal(JSON.stringify(result).includes("must-not-leave-the-site"), false);
  assert.equal(result.fields.amount, "660.00");
});

test("ITN validation requires signature, merchant, amount, source and server confirmation", async () => {
  const passphrase = "test-passphrase";
  const entries = [
    ["m_payment_id", "BB-26-ABC12345"],
    ["pf_payment_id", "1089250"],
    ["payment_status", "COMPLETE"],
    ["amount_gross", "660.00"],
    ["merchant_id", "10000100"],
  ];
  entries.push(["signature", signature(entries, passphrase)]);
  const rawBody = Buffer.from(entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&"));
  const result = await verifyNotification({
    rawBody,
    requestIp: "196.33.227.1",
    mode: "sandbox",
    merchantId: "10000100",
    passphrase,
    expectedAmountCents: 66000,
    fetchImpl: async () => ({ ok: true, text: async () => "VALID" }),
    resolve4Impl: async () => ["196.33.227.1"],
    resolve6Impl: async () => [],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.reasons, []);
});

test("ITN amount mismatch cannot mark an order paid", async () => {
  const passphrase = "test-passphrase";
  const entries = [
    ["m_payment_id", "BB-26-ABC12345"],
    ["pf_payment_id", "1089250"],
    ["payment_status", "COMPLETE"],
    ["amount_gross", "10.00"],
    ["merchant_id", "10000100"],
  ];
  entries.push(["signature", signature(entries, passphrase)]);
  const rawBody = Buffer.from(entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&"));
  const result = await verifyNotification({
    rawBody,
    requestIp: "196.33.227.1",
    mode: "sandbox",
    merchantId: "10000100",
    passphrase,
    expectedAmountCents: 66000,
    fetchImpl: async () => ({ ok: true, text: async () => "VALID" }),
    resolve4Impl: async () => ["196.33.227.1"],
    resolve6Impl: async () => [],
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("amount_mismatch"));
});
