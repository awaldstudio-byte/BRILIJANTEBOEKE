import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { checkoutRequest, parameterString, phpUrlEncode, signature, verifyNotification } from "../api/_lib/payfast.js";
import { requirePayFast } from "../api/_lib/env.js";

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
  assert.equal(result.fields.notify_url, "https://www.briljanteboeke.co.za/api/payfast-notify/");
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

const configured = {
  payfastMode: "sandbox", payfastMerchantId: "10000100", payfastMerchantKey: "test-key",
  payfastPassphrase: "test-passphrase", appOrigin: "https://example.com", payfastLiveEnabled: false,
};

test("live payments require an explicit release and non-sandbox merchant credentials", () => {
  assert.equal(requirePayFast(configured), configured);
  assert.throws(() => requirePayFast({ ...configured, payfastMode: "live" }), { statusCode: 503 });
  assert.throws(() => requirePayFast({ ...configured, payfastMode: "live", payfastLiveEnabled: true }), { statusCode: 503 });
  assert.throws(() => requirePayFast({ ...configured, appOrigin: "http://example.com" }), { statusCode: 503 });
  assert.throws(() => requirePayFast({ ...configured, payfastMerchantKey: " " }), { statusCode: 503 });
  const live = { ...configured, payfastMode: "live", payfastMerchantId: "12345678", payfastLiveEnabled: true };
  assert.equal(requirePayFast(live), live);
});

function notificationFixture(extraEntries = []) {
  const entries = [
    ["m_payment_id", "BB-26-ABC12345"], ["pf_payment_id", "1089250"],
    ["payment_status", "COMPLETE"], ["amount_gross", "660.00"], ["merchant_id", "10000100"], ...extraEntries,
  ];
  entries.push(["signature", signature(entries, "test-passphrase")]);
  return Buffer.from(new URLSearchParams(entries).toString());
}

function verifyFixture(overrides = {}) {
  return verifyNotification({
    rawBody: notificationFixture(), requestIp: "196.33.227.1", mode: "sandbox", merchantId: "10000100",
    passphrase: "test-passphrase", expectedAmountCents: 66000,
    fetchImpl: async () => ({ ok: true, text: async () => "VALID" }),
    resolve4Impl: async () => ["196.33.227.1"], resolve6Impl: async () => [], ...overrides,
  });
}

test("forged signatures, merchant mismatches and untrusted sources are rejected", async () => {
  const forged = await verifyFixture({ rawBody: Buffer.from(notificationFixture().toString().replace("COMPLETE", "FAILED")) });
  assert.ok(forged.reasons.includes("signature_mismatch"));
  assert.ok((await verifyFixture({ merchantId: "another-merchant" })).reasons.includes("merchant_mismatch"));
  assert.ok((await verifyFixture({ requestIp: "203.0.113.19" })).reasons.includes("source_ip_invalid"));
});

test("live verification does not trust the sandbox notification address", async () => {
  const result = await verifyFixture({
    mode: "live", resolve4Impl: async (host) => host === "sandbox.payfast.co.za" ? ["196.33.227.1"] : ["203.0.113.20"],
  });
  assert.ok(result.reasons.includes("source_ip_invalid"));
});

test("duplicate notification fields are rejected even when their signature matches", async () => {
  const result = await verifyFixture({ rawBody: notificationFixture([["amount_gross", "660.00"]]) });
  assert.ok(result.reasons.includes("duplicate_fields"));
  assert.equal(result.valid, false);
});

test("a rejected notification cannot consume the verified event's idempotency key", async () => {
  const verified = await verifyFixture();
  const repeated = await verifyFixture();
  const rejected = await verifyFixture({ requestIp: "203.0.113.19" });
  assert.equal(verified.eventKey, repeated.eventKey);
  assert.notEqual(verified.eventKey, rejected.eventKey);
});

test("provider validation failure remains distinguishable as a retryable condition", async () => {
  const result = await verifyFixture({ fetchImpl: async () => { throw new Error("temporary outage"); } });
  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons, ["server_confirmation_failed"]);
});

const providerFields = [
  ["m_payment_id", "BB-26-ABC12345"], ["pf_payment_id", "1089250"],
  ["payment_status", "COMPLETE"], ["amount_gross", "660.00"], ["merchant_id", "10000100"],
];
const providerBody = "m_payment_id=BB-26-ABC12345&pf_payment_id=1089250&payment_status=COMPLETE&amount_gross=660.00&merchant_id=10000100";

for (const fixture of [
  {
    name: "empty optional fields and zero values",
    entries: [...providerFields, ["custom_str1", ""], ["custom_int1", "0"]],
    body: `${providerBody}&custom_str1=&custom_int1=0`,
  },
  {
    name: "untrimmed values, Unicode and PHP encoding",
    entries: [...providerFields, ["name_first", " Anné + /~ "], ["custom_str1", "  "]],
    body: `${providerBody}&name_first=+Ann%C3%A9+%2B+%2F%7E+&custom_str1=++`,
  },
  {
    name: "received field order rather than sorted or checkout order",
    entries: [providerFields[4], ["custom_str1", ""], ...providerFields.slice(0, 4)],
    body: "merchant_id=10000100&custom_str1=&m_payment_id=BB-26-ABC12345&pf_payment_id=1089250&payment_status=COMPLETE&amount_gross=660.00",
  },
]) {
  test(`provider ITN retains ${fixture.name} for signature and server confirmation`, async () => {
    // These expected parameter strings follow PayFast's ITN rules independently
    // of the outbound checkout signature helper.
    const providerSignature = createHash("md5").update(`${fixture.body}&passphrase=test-passphrase`).digest("hex");
    const rawBody = Buffer.from(new URLSearchParams([...fixture.entries, ["signature", providerSignature]]).toString());
    let submittedBody;
    const result = await verifyFixture({
      rawBody,
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://sandbox.payfast.co.za/eng/query/validate");
        submittedBody = options.body;
        return { ok: true, text: async () => options.body === fixture.body ? "VALID" : "INVALID" };
      },
    });
    assert.equal(submittedBody, fixture.body);
    assert.equal(result.valid, true);
    assert.deepEqual(result.reasons, []);
  });
}

test("checkout signing continues to trim values and omit empty fields", () => {
  const entries = [["merchant_id", "10000100"], ["custom_str1", ""], ["name_first", " Parent "], ["custom_int1", "0"]];
  const expected = "merchant_id=10000100&name_first=Parent&custom_int1=0&passphrase=test-passphrase";
  assert.equal(parameterString(entries, { passphrase: "test-passphrase" }), expected);
  assert.equal(signature(entries, "test-passphrase"), createHash("md5").update(expected).digest("hex"));
});
