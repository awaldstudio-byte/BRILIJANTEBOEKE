import { deriveOrderToken, sha256 } from './crypto.js';
import { env } from './env.js';
import { json, methodNotAllowed, publicError, readJson } from './http.js';
import { serviceClient, assertDatabaseResult } from './supabase.js';
import { validateOrderInput } from './validation.js';
import { resolveSchoolOrdering, internalSchoolOrderHash } from './school-ordering.js';
import { requireDemoAccess, demoSchoolId, demoStaffEmail } from './demo-payment.js';
import { mailSettings, createMailTransport, drainOrderMail } from './order-mail.js';

// Fixed test school, authenticated technical administrator, exact preview and
// explicit server-side switch. This never calls or fabricates a PayFast event.
export default createDemoPaymentHandler();
export function createDemoPaymentHandler({access = requireDemoAccess, databaseFactory = serviceClient, configuration = env,
  source = process.env, transportFactory = createMailTransport, now = () => Date.now()} = {}) {
  return async (req, res) => {
    if (req.method !== 'POST') return methodNotAllowed(res,['POST']);
    let transport;
    try {
      const context = await access(req,res);
      const body = await readJson(req);
      if (body.confirm_demo !== true) throw Object.assign(new Error('Confirm that no real payment will be made.'),{statusCode:400});
      const input = validateOrderInput(body), config = configuration(), database = databaseFactory();
      const {school,period} = await resolveSchoolOrdering(database,{identifier:input.schoolIdentifier,periodId:input.orderingPeriodId},now());
      if (school.id !== demoSchoolId) throw Object.assign(new Error('Demo payments are available only for Test School 1.'),{statusCode:403});
      // Validate mail before storing anything. Parent keeps their typed address;
      // only the staff notification is redirected to our technical mailbox.
      const settings = {...mailSettings({...source,MAIL_ENABLED:'true',BRILJANTE_NOTIFICATION_EMAILS:demoStaffEmail}),demoOnly:true};
      const limit = await database.rpc('consume_staff_auth_limit', {p_key:sha256(`demo-payment:${context.user.id}`),p_limit:20,p_seconds:3600});
      assertDatabaseResult(limit.error);
      if (limit.data !== true) throw Object.assign(new Error('Demo test limit reached. Please try again later.'),{statusCode:429});
      const hash = await internalSchoolOrderHash(database,school,period,now());
      const requestId = `demo:${input.idempotencyKey}`;
      const token = deriveOrderToken(requestId,config.orderTokenSecret);
      const created = await database.rpc('create_school_order', {p_token_hash:hash,p_idempotency_key:requestId,p_order_access_hash:sha256(token),
        p_parent:{...input.parent,consent:input.consent},p_learners:input.learners});
      assertDatabaseResult(created.error);
      const order = created.data;
      const reference = order.reference.startsWith('DEMO-') ? order.reference : `DEMO-${order.reference}`;
      const changed = await database.from('orders').update({reference,status:'paid',paid_at:new Date(now()).toISOString()})
        .eq('id',order.id).eq('school_id',demoSchoolId).eq('order_access_hash',sha256(token)).eq('status','pending_payment');
      assertDatabaseResult(changed.error);
      const current = await database.from('orders').select('id,reference,status,parent_email').eq('id',order.id).eq('school_id',demoSchoolId).eq('order_access_hash',sha256(token)).single();
      assertDatabaseResult(current.error);
      if (current.data.status !== 'paid' || !current.data.reference.startsWith('DEMO-')) throw new Error('Demo order state could not be confirmed.');
      // Stable primary keys plus ignoreDuplicates preserve sent/failed jobs on
      // retries and recover a crash between order update and enqueue.
      const jobs = ['parent_order_paid','staff_order_paid'].map(kind => {
        const h = sha256(`demo-mail:${order.id}:${kind}`);
        return {id:`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`,
          order_id:order.id,kind,recipient:kind==='parent_order_paid'?current.data.parent_email:demoStaffEmail};
      });
      const queued = await database.from('notification_jobs').upsert(jobs,{onConflict:'id',ignoreDuplicates:true});
      assertDatabaseResult(queued.error);
      transport = transportFactory(settings);
      let delivery;
      try { delivery = await drainOrderMail(database,transport,settings,{orderId:order.id}); }
      catch { delivery = {sent:0,failed:0,review_required:true}; }
      return json(res,200,{demo:true,order:{reference:current.data.reference,amount_cents:order.amount_cents,status:'paid',access_token:token},email:delivery});
    } catch(error) {
      const result = publicError(error);
      return json(res,result.status,{error:result.message});
    } finally { transport?.close(); }
  };
}
