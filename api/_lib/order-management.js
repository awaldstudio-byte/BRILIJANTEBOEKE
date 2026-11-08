import { uuid, text } from './validation.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const clean=(value,min,max,label)=>{const result=text(value,min,max,label);if(/[\u0000-\u001f\u007f]/.test(result))throw fail(label);return result;};
const keys=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw fail('One of the supplied fields is not supported.');};
function timestamp(value,now){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)>now)throw fail('Enter a valid completed date and time that is not in the future.');return new Date(value).toISOString();}
export function managementInput(body,now=Date.now()){
 keys(body,['action','order_id','expected_version','reason','item_ids','email_received_at','source_email_reference','request_id','decision','provider_payment_id','provider_refund_reference','refunded_at','confirm_external_refund','parent','learners']);
 const orderId=uuid(body.order_id),action=body.action;
 if(!['record-refund-request','review-refund-request','record-item-refund','correct-details'].includes(action))throw fail('Select a supported management action.');
 if(!Number.isSafeInteger(body.expected_version)||body.expected_version<0)throw fail('Reload the order before saving.');
 const reason=typeof body.reason==='string'?body.reason.replace(/[\r\n\t]+/g,' '):body.reason;
 const payload={reason:clean(reason,5,1000,'Enter a reason between 5 and 1000 characters.')};
 if(action==='record-refund-request'){
  if(!Array.isArray(body.item_ids)||body.item_ids.length<1||body.item_ids.length>20)throw fail('Select the books in the emailed request.');
  payload.item_ids=[...new Set(body.item_ids.map(value=>uuid(value)))];
  payload.email_received_at=timestamp(body.email_received_at,now);
  payload.source_email_reference=body.source_email_reference?clean(body.source_email_reference,1,200,'Enter a valid email reference.'):'';
 }else if(action==='review-refund-request'){
  payload.request_id=uuid(body.request_id);if(!['approved','rejected'].includes(body.decision))throw fail('Select approve or reject.');payload.decision=body.decision;
 }else if(action==='record-item-refund'){
  if(body.confirm_external_refund!==true)throw fail('Confirm that the selected amount has already been refunded in PayFast. This action cannot send money.');
  payload.request_id=uuid(body.request_id);payload.provider_payment_id=clean(body.provider_payment_id,1,100,'Enter the original payment reference.');
  payload.provider_refund_reference=clean(body.provider_refund_reference,2,100,'Enter the completed refund reference.');payload.refunded_at=timestamp(body.refunded_at,now);payload.confirm_external_refund=true;
 }else{
  keys(body.parent,['first_name','last_name','email','mobile']);
  const email=clean(body.parent.email,3,254,'Enter a valid parent email address.').toLowerCase();if(!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email))throw fail('Enter a valid parent email address.');
  payload.parent={first_name:clean(body.parent.first_name,1,80,'Enter the parent first name.'),last_name:clean(body.parent.last_name,1,80,'Enter the parent surname.'),email,mobile:clean(body.parent.mobile,8,25,'Enter a valid mobile number.')};
  if(!Array.isArray(body.learners)||!body.learners.length||body.learners.length>20)throw fail('Reload the order child details.');
  payload.learners=body.learners.map(child=>{keys(child,['id','first_name','last_name']);return{id:uuid(child.id),first_name:clean(child.first_name,1,80,'Enter the child first name.'),last_name:clean(child.last_name,1,80,'Enter the child surname.')};});
  if(new Set(payload.learners.map(child=>child.id)).size!==payload.learners.length)throw fail('Each child must be included once.');
 }
 return {orderId,action,expectedVersion:body.expected_version,payload};
}
export function managementError(error){
 const errors={MANAGEMENT_ADMIN_REQUIRED:[403,'Administrator access is required.'],MANAGEMENT_NOT_FOUND:[404,'Order or request not found.'],MANAGEMENT_INVALID:[400,'Check the request details and dates.'],MANAGEMENT_NOT_PAID:[409,'This order does not have a remaining verified payment.'],MANAGEMENT_ITEMS_INVALID:[409,'The selected books changed or already have a refund recorded. Reload the order.'],MANAGEMENT_PAYMENT_REQUIRED:[409,'The original verified payment does not match.'],MANAGEMENT_OPEN_REQUEST:[409,'This order already has an open refund request. Review it first.'],MANAGEMENT_VERSION_CONFLICT:[409,'This order changed. Reload it before saving.'],MANAGEMENT_REQUEST_FINAL:[409,'This request already has a decision.'],MANAGEMENT_RECEIPT_CONFLICT:[409,'This completed refund reference is already recorded or conflicts with existing evidence.'],MANAGEMENT_APPROVAL_REQUIRED:[409,'Approve this emailed request before recording a completed refund.'],MANAGEMENT_BATCH_REVIEW_REQUIRED:[409,'These books are allocated to a fulfilment batch. Cancel an unshipped batch first. Dispatched or delivered books need an operational review.'],MANAGEMENT_MAIL_IN_PROGRESS:[409,'An order or shipping message is queued or being sent. Review its outcome before changing this order.']};
 const mapped=errors[error?.message];return mapped?fail(mapped[1],mapped[0]):error;
}
export function withRefundTotals(order){
 const refunded=(order.order_refunds||[]).length?order.amount_cents:(order.order_item_refunds||[]).reduce((sum,item)=>sum+item.amount_cents,0);
 return {...order,refunded_amount_cents:refunded,remaining_paid_amount_cents:order.status==='paid'?Math.max(0,order.amount_cents-refunded):0};
}
