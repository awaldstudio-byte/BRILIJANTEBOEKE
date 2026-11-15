const invalid = () => Object.assign(new Error('Refund balances could not be reconciled.'), {statusCode:503});
export function refundBalance(order) {
  if (!Number.isSafeInteger(order.amount_cents) || order.amount_cents < 0) throw invalid();
  const refunds = order.order_item_refunds ?? [];
  if (!Array.isArray(refunds)) throw invalid();
  const refunded = refunds.reduce((sum,row) => {
    if (!Number.isSafeInteger(row.amount_cents) || row.amount_cents <= 0) throw invalid();
    return sum + row.amount_cents;
  },0);
  if (!Number.isSafeInteger(refunded) || refunded > order.amount_cents) throw invalid();
  return {original_cents:order.amount_cents,refunded_cents:refunded,net_cents:order.amount_cents-refunded};
}
export function isRefundedItem(item) {
  const refund = item.order_item_refunds;
  if (refund == null) return false;
  if (Array.isArray(refund)) return refund.length > 0;
  // A unique order_item_id makes this a to-one relationship in PostgREST.
  if (typeof refund === 'object' && typeof refund.id === 'string' && refund.id) return true;
  throw invalid();
}
export async function readFinancialRows(factory) {
  const rows=[];
  for(let page=0;page<200;page++) {
    const result=await factory().range(page*500,(page+1)*500-1);
    if(result.error || !Array.isArray(result.data)) throw invalid();
    rows.push(...result.data);
    if(result.data.length<500) return {data:rows};
  }
  throw invalid();
}
