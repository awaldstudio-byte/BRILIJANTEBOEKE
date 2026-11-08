import { requireStaff, requireSameOrigin } from "./_lib/auth.js";
import { json, methodNotAllowed, publicError, readJson } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";
import { paidOrderColumns, paidOrderMessage } from './_lib/order-mail.js';
import { readSchoolPaymentProgress } from './_lib/school-payment-progress.js';
import { env } from './_lib/env.js';
import {recordFullRefund,refundInput} from './_lib/refund-reconciliation.js';
import {demoEnvironment,demoStaffEmail,excludeDemoOrders,isDemoRecord} from './_lib/demo-payment.js';
import {createOrderManagementHandler} from './_lib/admin-order-management-handler.js';

export function createAdminOrdersHandler({ authorize = requireStaff, checkOrigin = requireSameOrigin, databaseFactory = serviceClient, now = Date.now, source=process.env } = {}) {
return async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return methodNotAllowed(res, ["GET", "POST"]);
  try {
    if (req.method === 'POST') checkOrigin(req);
    const { user } = await authorize(req, res, req.method === 'POST' ? ['administrator'] : ['administrator', 'viewer']);
    const database = databaseFactory();
    if (req.method === 'POST') {
      const body=await readJson(req,4000),input=refundInput(body,now());
      const lookup=await database.from('orders').select('reference,school_id').eq('id',input.p_order_id).maybeSingle();
      assertDatabaseResult(lookup.error);if(!lookup.data)throw Object.assign(new Error('Order not found.'),{statusCode:404});
      if(isDemoRecord(lookup.data)) {
        if(!demoEnvironment(source)||user.email?.toLowerCase()!==demoStaffEmail)throw Object.assign(new Error('Demo refunds require the dedicated technical test account.'),{statusCode:403});
      } else if(source.VERCEL_ENV!=='production')throw Object.assign(new Error('Real parent records cannot be changed from this preview.'),{statusCode:403});
      const refund = await recordFullRefund(database, body, user.id, now());
      return json(res, refund.reused ? 200 : 201, { refund, money_moved: false });
    }
    // Authenticated read-only rendering for checking a notification without
    // resending it or changing any order/queue record.
    if (typeof req.query.email_preview === 'string') {
      const reference=req.query.email_preview;
      if (!/^(?:DEMO-)?BB-[A-Z0-9-]{4,35}$/.test(reference)) return json(res,404,{error:'Order not found.'});
      const result=await database.from('orders').select(paidOrderColumns).eq('reference',reference).maybeSingle();
      assertDatabaseResult(result.error);
      if (!result.data) return json(res,404,{error:'Order not found.'});
      if (!demoEnvironment(source) && isDemoRecord(result.data)) return json(res,404,{error:'Order not found.'});
      result.data.school_progress=await readSchoolPaymentProgress(database,result.data);
      const recipient='technical@awaldstudio.com';
      const message=paidOrderMessage({id:'00000000-0000-4000-8000-000000000001',kind:'staff_order_paid',recipient},result.data,
        {from:'orders@briljanteboeke.co.za',replyTo:'info@briljanteboeke.co.za',appOrigin:env().appOrigin,staff:[recipient],demoOnly:reference.startsWith('DEMO-')});
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
      return res.status(200).send(message.html.replace(`cid:${message.attachments[0].cid}`,`data:image/png;base64,${message.attachments[0].content.toString('base64')}`));
    }
    const page = Math.max(1, Number.parseInt(req.query.page ?? "1", 10) || 1);
    const pageSize = 50;
    let query = database
      .from("orders")
      .select(
        "id, reference, amount_cents, status, parent_first_name, parent_last_name, parent_email, parent_mobile, created_at, paid_at, school_id, ordering_period_id, schools(name), ordering_periods(name, academic_years(year)), learners(first_name, last_name, grades(name)), payment_attempts(provider_payment_id,status), order_item_refunds(amount_cents), order_refunds(provider_refund_reference,refunded_at,amount_cents,recorded_at)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (!demoEnvironment(source)) query=excludeDemoOrders(query);

    if (typeof req.query.status === "string" && req.query.status) query = query.eq("status", req.query.status);
    if (typeof req.query.school_id === "string" && req.query.school_id) query = query.eq("school_id", req.query.school_id);
    if (typeof req.query.period_id === "string" && req.query.period_id) query = query.eq("ordering_period_id", req.query.period_id);
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const value = req.query.search.trim().replace(/[,%()]/g, "");
      query = query.or(`reference.ilike.%${value}%,parent_last_name.ilike.%${value}%,parent_email.ilike.%${value}%`);
    }

    const { data, error, count } = await query;
    assertDatabaseResult(error);
    return json(res, 200, { orders: data ?? [], page, page_size: pageSize, total: count ?? 0 });
  } catch (error) {
    if (error.statusCode !== 401) console.error("admin-orders", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
};
}
// Both public routes use this function so the application remains within the
// hosting plan's function allowance. Each handler retains its own authorization.
export function createAdminOrderRouter({ordersHandler=createAdminOrdersHandler(),managementHandler=createOrderManagementHandler()}={}) {
  return function handler(req,res) {
    const management=req.query?.management;
    if(management!==undefined&&management!=='1')return json(res,400,{error:'Invalid order route.'});
    return management==='1'?managementHandler(req,res):ordersHandler(req,res);
  };
}
export default createAdminOrderRouter();
