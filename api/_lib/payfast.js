import { createHash } from "node:crypto";
import { resolve4, resolve6 } from "node:dns/promises";
import { safeEqual } from "./crypto.js";

export const PAYFAST_HOSTS = {
  sandbox: "sandbox.payfast.co.za",
  live: "www.payfast.co.za",
};

const allowedSourceHosts = [
  "www.payfast.co.za",
  "w1w.payfast.co.za",
  "w2w.payfast.co.za",
  "sandbox.payfast.co.za",
];

export function phpUrlEncode(value) {
  const bytes = Buffer.from(String(value).trim(), "utf8");
  let output = "";
  for (const byte of bytes) {
    const alphaNumeric =
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a);
    if (alphaNumeric || byte === 0x2d || byte === 0x2e || byte === 0x5f) {
      output += String.fromCharCode(byte);
    } else if (byte === 0x20) {
      output += "+";
    } else {
      output += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return output;
}

export function parameterString(entries, { passphrase, excludeSignature = true } = {}) {
  const pairs = [];
  for (const [key, rawValue] of entries) {
    if (excludeSignature && key === "signature") continue;
    const value = String(rawValue ?? "").trim();
    if (!value) continue;
    pairs.push(`${key}=${phpUrlEncode(value)}`);
  }
  if (passphrase) pairs.push(`passphrase=${phpUrlEncode(passphrase)}`);
  return pairs.join("&");
}

export function signature(entries, passphrase) {
  return createHash("md5")
    .update(parameterString(entries, { passphrase }), "utf8")
    .digest("hex");
}

export function checkoutRequest({
  mode,
  merchantId,
  merchantKey,
  passphrase,
  appOrigin,
  language = "af",
  order,
}) {
  const fields = [
    ["merchant_id", merchantId],
    ["merchant_key", merchantKey],
    ["return_url", `${appOrigin}/order/status/?reference=${encodeURIComponent(order.reference)}&lang=${language}`],
    ["cancel_url", `${appOrigin}/order/status/?reference=${encodeURIComponent(order.reference)}&cancelled=1&lang=${language}`],
    ["notify_url", `${appOrigin}/api/payfast-notify`],
    ["name_first", order.parentFirstName],
    ["name_last", order.parentLastName],
    ["email_address", order.parentEmail],
    ["cell_number", order.parentMobile],
    ["m_payment_id", order.reference],
    ["amount", (order.amountCents / 100).toFixed(2)],
    ["item_name", `Briljante Boeke ${order.reference}`],
    ["item_description", `${order.learnerCount} learner workbook order`],
  ];
  fields.push(["signature", signature(fields, passphrase)]);

  return {
    action: `https://${PAYFAST_HOSTS[mode]}/eng/process`,
    fields: Object.fromEntries(fields),
  };
}

export function parseNotification(rawBody) {
  const params = new URLSearchParams(rawBody.toString("utf8"));
  const entries = [...params.entries()];
  return { entries, data: Object.fromEntries(entries) };
}

export async function verifyNotification({
  rawBody,
  requestIp,
  mode,
  merchantId,
  passphrase,
  expectedAmountCents,
  fetchImpl = fetch,
  resolve4Impl = resolve4,
  resolve6Impl = resolve6,
}) {
  const { entries, data } = parseNotification(rawBody);
  const reasons = [];

  const calculatedSignature = signature(entries, passphrase);
  if (!data.signature || !safeEqual(data.signature.toLowerCase(), calculatedSignature)) {
    reasons.push("signature_mismatch");
  }

  if (!safeEqual(data.merchant_id ?? "", merchantId)) reasons.push("merchant_mismatch");

  const amountCents = decimalToCents(data.amount_gross);
  if (amountCents == null || amountCents !== expectedAmountCents) reasons.push("amount_mismatch");

  const sourceIsValid = await isPayFastSource(requestIp, resolve4Impl, resolve6Impl);
  if (!sourceIsValid) reasons.push("source_ip_invalid");

  const confirmationBody = parameterString(entries, { excludeSignature: true });
  let serverConfirmed = false;
  try {
    const response = await fetchImpl(`https://${PAYFAST_HOSTS[mode]}/eng/query/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: confirmationBody,
      signal: AbortSignal.timeout(10_000),
    });
    serverConfirmed = response.ok && (await response.text()).trim() === "VALID";
  } catch {
    serverConfirmed = false;
  }
  if (!serverConfirmed) reasons.push("server_confirmation_failed");

  return {
    valid: reasons.length === 0,
    reasons,
    data,
    amountCents,
    eventKey: createHash("sha256")
      .update(`${data.pf_payment_id ?? ""}|${data.payment_status ?? ""}|${data.signature ?? ""}`)
      .digest("hex"),
  };
}

export function forwardedIp(headers) {
  const value = headers["x-forwarded-for"] ?? headers["x-real-ip"] ?? "";
  return String(Array.isArray(value) ? value[0] : value)
    .split(",")[0]
    .trim()
    .replace(/^::ffff:/, "");
}

async function isPayFastSource(requestIp, resolve4Impl, resolve6Impl) {
  if (!requestIp) return false;
  const validIps = new Set();
  await Promise.all(
    allowedSourceHosts.map(async (host) => {
      const [ipv4, ipv6] = await Promise.all([
        resolve4Impl(host).catch(() => []),
        resolve6Impl(host).catch(() => []),
      ]);
      for (const ip of [...ipv4, ...ipv6]) validIps.add(String(ip).replace(/^::ffff:/, ""));
    }),
  );
  return validIps.has(String(requestIp).replace(/^::ffff:/, ""));
}

function decimalToCents(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, decimal = ""] = value.split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}
