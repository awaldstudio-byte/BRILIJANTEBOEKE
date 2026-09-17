import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function deriveOrderToken(idempotencyKey, secret) {
  return createHmac("sha256", secret)
    .update(`briljante-order:${idempotencyKey}`, "utf8")
    .digest("base64url");
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
