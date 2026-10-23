import { env, requirePayFast } from './_lib/env.js';
import { json, methodNotAllowed, publicError } from './_lib/http.js';
import { assertDatabaseResult, serviceClient } from './_lib/supabase.js';
import { resolveSchoolOrdering } from './_lib/school-ordering.js';
import { canDemoPay } from './_lib/demo-payment.js';

export default createPublicSchoolHandler();
export function createPublicSchoolHandler({ databaseFactory = serviceClient, configuration = env, checkPayments = requirePayFast, now = () => Date.now() } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    try {
      const database = databaseFactory();
      const { school, period, open } = await resolveSchoolOrdering(database, {
        token: typeof req.query.token === 'string' ? req.query.token.trim() : '',
        identifier: typeof req.query.identifier === 'string' ? req.query.identifier.trim() : '',
        periodId: typeof req.query.period === 'string' ? req.query.period : '',
      }, now());
      const { data: offerings, error } = await database.from('school_grade_offerings')
        .select('id, price_cents, grades(id, code, name, sort_order), books(id, sku, title, cover_path)')
        .eq('school_id', school.id).eq('ordering_period_id', period.id).eq('active', true)
        .order('sort_order', { referencedTable: 'grades', ascending: true });
      assertDatabaseResult(error);
      let paymentsEnabled = false;
      try { checkPayments(configuration()); paymentsEnabled = true; } catch { /* Checkout remains disabled until configured. */ }
      return json(res, 200, {
        payments_enabled: paymentsEnabled,
        demo_payments_enabled: open && await canDemoPay(req,res,school),
        school: { slug: school.slug, name: school.name },
        period: { id: period.id, name: period.name, academic_year: period.academic_years, opens_at: period.opens_at,
          closes_at: period.closes_at, delivery_note: period.delivery_note, open },
        offerings: (offerings ?? []).map(item => ({ id: item.id, price_cents: item.price_cents, grade: item.grades, book: item.books })),
      });
    } catch (error) {
      if (error.statusCode !== 404) console.error('public-school', { code: error.code, message: error.message });
      const result = publicError(error); return json(res, result.status, { error: result.message });
    }
  };
}
