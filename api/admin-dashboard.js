import { requireStaff } from "./_lib/auth.js";
import { json, methodNotAllowed, publicError } from "./_lib/http.js";
import { assertDatabaseResult, serviceClient } from "./_lib/supabase.js";
import {demoEnvironment,demoSchoolId,excludeDemoOrders} from './_lib/demo-payment.js';
import {refundBalance,isRefundedItem,readFinancialRows} from './_lib/refund-balances.js';

export function createAdminDashboardHandler({authorize=requireStaff,databaseFactory=serviceClient,source=process.env}={}) {
return async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    const { staff } = await authorize(req, res);
    if (String(req.query?.session ?? "") === "1") return json(res, 200, { staff });

    const database = databaseFactory();
    const demoMode = demoEnvironment(source);
    const financialOrders = query => demoMode ? query : excludeDemoOrders(query);
    const realSchools = (query,column='school_id') => demoMode ? query : query.neq(column,demoSchoolId);
    const [schools, pending, paid, revenue, recent, periods, offerings, paidItems] = await Promise.all([
      realSchools(database.from("schools").select("id", { count: "exact", head: true }).eq("status", "active"),'id'),
      financialOrders(database.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending_payment")),
      financialOrders(database.from("orders").select("id", { count: "exact", head: true }).eq("status", "paid")),
      readFinancialRows(()=>financialOrders(database.from("orders").select("id,amount_cents,order_item_refunds(amount_cents)").eq("status", "paid")).order('id')),
      financialOrders(database
        .from("orders")
        .select("reference, amount_cents, status, created_at, paid_at, parent_first_name, parent_last_name, schools(name)")
        .order("created_at", { ascending: false })
        .limit(12)),
      realSchools(database
        .from("ordering_periods")
        .select("id, school_id, name, status, opens_at, closes_at, schools(name), academic_years(year)")
        .in("status", ["open", "closed"])
        .order("closes_at", { ascending: false })
        .limit(20)),
      realSchools(database
        .from("school_grade_offerings")
        .select("id, school_id, ordering_period_id, expected_quantity, price_cents, active, schools(name), ordering_periods(name, academic_years(year)), grades(name, sort_order)")
        .eq("active", true)),
      readFinancialRows(()=>{
        let query=database
        .from("order_items")
        .select("id,offering_id,quantity,order_item_refunds(id),orders!inner(status,reference,school_id)")
        .eq("orders.status", "paid").order('id');
        return demoMode?query:excludeDemoOrders(query,'orders.');
      }),
    ]);
    for (const result of [schools, pending, paid, revenue, recent, periods, offerings, paidItems]) assertDatabaseResult(result.error);
    const paidByOffering = new Map();
    for (const item of paidItems.data ?? []) {
      if(isRefundedItem(item) || (!demoMode && item.orders?.reference?.startsWith('DEMO-'))) continue;
      paidByOffering.set(item.offering_id, (paidByOffering.get(item.offering_id) ?? 0) + item.quantity);
    }

    return json(res, 200, {
      staff,
      demo_mode: demoMode,
      summary: {
        active_schools: schools.count ?? 0,
        pending_orders: pending.count ?? 0,
        paid_orders: paid.count ?? 0,
        paid_total_cents: (revenue.data ?? []).reduce((sum, item) => sum + refundBalance(item).net_cents, 0),
      },
      recent_orders: recent.data ?? [],
      periods: periods.data ?? [],
      progress: (offerings.data ?? []).map((offering) => {
        const paidQuantity = paidByOffering.get(offering.id) ?? 0;
        return { ...offering, paid_quantity: paidQuantity, remaining_quantity: Math.max(0, offering.expected_quantity - paidQuantity) };
      }),
    });
  } catch (error) {
    if (error.statusCode !== 401) console.error("admin-dashboard", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
};
}
export default createAdminDashboardHandler();
