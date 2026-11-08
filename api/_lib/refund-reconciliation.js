import { uuid, text } from './validation.js';
import { assertDatabaseResult } from './supabase.js';

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const databaseErrors = {
  REFUND_ORDER_NOT_FOUND: ['The order was not found.', 404],
  REFUND_ADMIN_REQUIRED: ['Administrator access is required to record a refund.', 403],
  REFUND_NOT_PAID: ['Only a verified paid order can have a completed full refund recorded.', 409],
  REFUND_PAYMENT_MISMATCH: ['The PayFast transaction or full amount does not match the verified payment.', 409],
  REFUND_ALREADY_RECORDED: ['A different full refund record already exists for this order or confirmation reference. Review it before continuing.', 409],
  REFUND_PARTIAL_ALREADY_RECORDED: ['A book refund or this provider reference has already been recorded. Review the order before continuing.', 409],
  REFUND_BATCH_REVIEW_REQUIRED: ['This order is allocated to a fulfilment batch. Cancel its unshipped batch first. Dispatched or delivered books require an operational review before a refund can be recorded here.', 409],
  REFUND_MAIL_IN_PROGRESS: ['An order confirmation is being sent. Wait for its recorded outcome before recording the refund.', 409],
  REFUND_DATE_INVALID: ['The completed refund date must be after payment and cannot be in the future.', 400],
  REFUND_DETAILS_INVALID: ['Check the refund confirmation reference and reason.', 400],
};

export function refundInput(body, now = Date.now()) {
  if (body?.action !== 'record-full-refund' || body.confirm_external_refund !== true) {
    throw fail('Confirm that the full refund has already completed in PayFast. This action only records that completed refund.');
  }
  const orderId = uuid(body.order_id);
  const paymentId = text(body.provider_payment_id, 1, 100, 'Enter the original PayFast transaction reference.');
  const confirmation = text(body.provider_refund_reference, 2, 100, 'Enter the completed refund confirmation reference.');
  const reason = text(body.reason, 5, 500, 'Enter a brief refund reason (5 to 500 characters).');
  if ([paymentId, confirmation, reason].some(value => /[\u0000-\u001f\u007f]/.test(value))) throw fail('Refund details must not contain control characters.');
  if (!Number.isSafeInteger(body.amount_cents) || body.amount_cents <= 0) throw fail('Enter the full original order amount. Partial refunds are not supported here.');
  if (typeof body.refunded_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(body.refunded_at)) throw fail('Enter a valid completed refund date and time.');
  const refundedAt = Date.parse(body.refunded_at);
  if (!Number.isFinite(refundedAt) || refundedAt > now) throw fail('The completed refund date cannot be in the future.');
  return { p_order_id: orderId, p_provider_payment_id: paymentId, p_provider_refund_reference: confirmation,
    p_amount_cents: body.amount_cents, p_refunded_at: new Date(refundedAt).toISOString(), p_reason: reason };
}

export async function recordFullRefund(database, body, actor, now = Date.now()) {
  const input = refundInput(body, now);
  const result = await database.rpc('record_completed_full_refund', { ...input, p_actor: actor });
  if (result.error && databaseErrors[result.error.message]) throw fail(...databaseErrors[result.error.message]);
  assertDatabaseResult(result.error);
  return result.data;
}
