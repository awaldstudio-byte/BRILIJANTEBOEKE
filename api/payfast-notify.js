import { env, requirePayFast } from "./_lib/env.js";
import { methodNotAllowed, readRaw } from "./_lib/http.js";
import { forwardedIp, parseNotification, verifyNotification } from "./_lib/payfast.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const settings = requirePayFast(env());
    const rawBody = await readRaw(req, 64_000);
    const preliminary = parseNotification(rawBody).data;
    const reference = String(preliminary.m_payment_id ?? "").trim().toUpperCase();
    if (!reference) return res.status(200).send("OK");

    const database = serviceClient();
    const { data: attempt, error: attemptError } = await database
      .from("payment_attempts")
      .select("id, order_id, amount_cents, status, orders(id, reference, status, parent_email)")
      .eq("merchant_payment_id", reference)
      .maybeSingle();
    assertDatabaseResult(attemptError);
    if (!attempt) return res.status(200).send("OK");

    const verification = await verifyNotification({
      rawBody,
      requestIp: forwardedIp(req.headers),
      mode: settings.payfastMode,
      merchantId: settings.payfastMerchantId,
      passphrase: settings.payfastPassphrase,
      expectedAmountCents: attempt.amount_cents,
    });

    const transientOnly =
      !verification.valid &&
      verification.reasons.length === 1 &&
      verification.reasons[0] === "server_confirmation_failed";
    if (transientOnly) return res.status(503).send("RETRY");

    const { error: processError } = await database.rpc("process_payfast_notification", {
      p_payment_attempt_id: attempt.id,
      p_event_key: verification.eventKey,
      p_provider_payment_id: verification.data.pf_payment_id || "",
      p_payment_status: verification.data.payment_status || "",
      p_verification_state: verification.valid ? "verified" : "rejected",
      p_rejection_reason: verification.reasons.join(","),
      p_raw_payload: verification.data,
      p_staff_recipients: settings.notificationEmails,
    });
    assertDatabaseResult(processError);

    return res.status(200).send("OK");
  } catch (error) {
    console.error("payfast-notify", { code: error.code, message: error.message });
    return res.status(500).send("RETRY");
  }
}
