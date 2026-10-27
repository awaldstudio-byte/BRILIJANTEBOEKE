import { createHash } from "node:crypto";
import { resolve4, resolve6 } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { safeEqual } from "./crypto.js";

export const PAYFAST_HOSTS = {
  sandbox: "sandbox.payfast.co.za",
  live: "www.payfast.co.za",
};

const liveSourceHosts = [
  "www.payfast.co.za",
  "w1w.payfast.co.za",
  "w2w.payfast.co.za",
];

// PayFast's published ITN infrastructure, reviewed 27 October 2026:
// https://developers.payfast.co.za/docs#ports-ips
// These ranges are shared infrastructure, not environment-specific credentials.
// Mode-specific order checks, signatures, merchant/amount checks and server
// confirmation against the selected sandbox/live endpoint remain mandatory.
export const PAYFAST_SOURCE_CIDRS = Object.freeze([
  '197.97.145.144/28', '41.74.179.192/27', '102.216.36.0/28',
  '102.216.36.128/28', '144.126.193.139/32',
]);
const publishedSourceNetworks = new BlockList();
for (const cidr of PAYFAST_SOURCE_CIDRS) {
  const [network, prefix] = cidr.split('/');
  publishedSourceNetworks.addSubnet(network, Number(prefix), 'ipv4');
}
function normalizedIp(value) {
  if (typeof value !== 'string') return '';
  const ip = value.trim().replace(/^::ffff:/i, '');
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return '';
  try { return new URL(`https://[${ip}]/`).hostname.slice(1, -1); } catch { return ''; }
}
export function isPublishedPayFastSource(value) {
  const ip = normalizedIp(value);
  return isIP(ip) === 4 && publishedSourceNetworks.check(ip, 'ipv4');
}

export function phpUrlEncode(value) {
  return encodePhp(String(value).trim());
}

function encodePhp(value) {
  const bytes = Buffer.from(String(value), "utf8");
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
    ["notify_url", `${appOrigin}/api/payfast-notify/`],
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

function notificationParameterString(entries) {
  // ITNs sign every posted value, including empty fields and surrounding spaces.
  // Checkout requests use different rules: trim values and omit empty fields.
  return entries
    .filter(([key]) => key !== "signature")
    .map(([key, value]) => `${key}=${encodePhp(value)}`)
    .join("&");
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

  const confirmationBody = notificationParameterString(entries);
  const signedBody = passphrase == null
    ? confirmationBody
    : `${confirmationBody}&passphrase=${encodePhp(passphrase)}`;
  const calculatedSignature = createHash("md5").update(signedBody, "utf8").digest("hex");
  if (!data.signature || !safeEqual(data.signature.toLowerCase(), calculatedSignature)) {
    reasons.push("signature_mismatch");
  }

  if (!safeEqual(data.merchant_id ?? "", merchantId)) reasons.push("merchant_mismatch");

  const amountCents = decimalToCents(data.amount_gross);
  if (amountCents == null || amountCents !== expectedAmountCents) reasons.push("amount_mismatch");

  if (!data.pf_payment_id || !data.payment_status || !data.m_payment_id) reasons.push("missing_payment_details");
  if (new Set(entries.map(([key]) => key)).size !== entries.length) reasons.push("duplicate_fields");
  const sourceIsValid = await isPayFastSource(requestIp, mode, resolve4Impl, resolve6Impl);
  if (!sourceIsValid) reasons.push("source_ip_invalid");

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
      .update(`${data.pf_payment_id ?? ""}|${data.payment_status ?? ""}|${data.signature ?? ""}|${reasons.length === 0 ? "verified" : "rejected"}`)
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

async function isPayFastSource(requestIp, mode, resolve4Impl, resolve6Impl) {
  const sourceIp = normalizedIp(requestIp);
  if (!sourceIp || !['sandbox', 'live'].includes(mode)) return false;
  if (isPublishedPayFastSource(sourceIp)) return true;
  const validIps = new Set();
  await Promise.all(
    (mode === "sandbox" ? ["sandbox.payfast.co.za"] : liveSourceHosts).map(async (host) => {
      const [ipv4, ipv6] = await Promise.all([
        resolve4Impl(host).catch(() => []),
        resolve6Impl(host).catch(() => []),
      ]);
      for (const ip of [...ipv4, ...ipv6]) {
        const normalized = normalizedIp(ip);
        if (normalized) validIps.add(normalized);
      }
    }),
  );
  return validIps.has(sourceIp);
}

function decimalToCents(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, decimal = ""] = value.split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}
