import { requireStaff } from "./_lib/auth.js";
import { json, methodNotAllowed, publicError } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";
import { paidOrderColumns, paidOrderMessage } from './_lib/order-mail.js';
import { readSchoolPaymentProgress } from './_lib/school-payment-progress.js';
import { env } from './_lib/env.js';

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    await requireStaff(req, res);
    const database = serviceClient();
    // Authenticated read-only rendering for checking a notification without
    // resending it or changing any order/queue record.
    if (typeof req.query.email_preview === 'string') {
      const reference=req.query.email_preview;
      if (!/^(?:DEMO-)?BB-[A-Z0-9-]{4,35}$/.test(reference)) return json(res,404,{error:'Order not found.'});
      const result=await database.from('orders').select(paidOrderColumns).eq('reference',reference).maybeSingle();
      assertDatabaseResult(result.error);
      if (!result.data) return json(res,404,{error:'Order not found.'});
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
        "id, reference, amount_cents, status, parent_first_name, parent_last_name, parent_email, parent_mobile, created_at, paid_at, school_id, ordering_period_id, schools(name), ordering_periods(name, academic_years(year)), learners(first_name, last_name, grades(name))",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

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
}
