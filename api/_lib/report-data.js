import { assertDatabaseResult } from './supabase.js';
import { readSchoolLogo } from './school-materials.js';
import {refundBalance,isRefundedItem} from './refund-balances.js';
import {demoEnvironment,demoSchoolId,excludeDemoOrders} from './demo-payment.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export function reportOptions(query = {}) {
  const result = { language: query.lang === 'af' ? 'af' : 'en', format: query.format || 'xlsx', report: query.report || 'paid' };
  if (!['xlsx', 'pdf', 'csv'].includes(result.format) || !['paid', 'batch'].includes(result.report)) throw fail('Choose a supported report format.');
  for (const key of ['school_id', 'period_id', 'batch_id']) {
    if (query[key] != null && query[key] !== '') {
      if (typeof query[key] !== 'string' || !uuid.test(query[key])) throw fail('Choose a valid school, ordering period or batch.');
      result[key] = query[key];
    }
  }
  if (result.report === 'batch' && !result.batch_id) throw fail('Choose a fulfilment batch.');
  return result;
}

// Keyset pagination is stable when other orders arrive during an export. Never silently truncate.
export async function readReportRows(factory) {
  const rows = []; let after;
  for (let page = 0; page < 100; page++) {
    let query = factory().order('id', { ascending: true }).limit(500);
    if (after) query = query.gt('id', after);
    const { data, error } = await query;
    assertDatabaseResult(error);
    if (!Array.isArray(data)) throw fail('The report data could not be loaded.', 503);
    rows.push(...data);
    if (data.length < 500) return rows;
    after = data.at(-1).id;
    if (!after) throw fail('The report data could not be paginated.', 503);
  }
  throw fail('This report is too large. Select a school or ordering period and try again.', 413);
}
async function single(query, message) {
  const { data, error } = await query.maybeSingle(); assertDatabaseResult(error);
  if (!data) throw fail(message, 404);
  return data;
}
export async function loadReport(database, options, { now = () => new Date().toISOString(), logoReader = readSchoolLogo, demoMode = demoEnvironment() } = {}) {
  const capturedAt = now();
  let school = null, period = null, batch = null;
  if (options.report === 'batch') {
    batch = await single(database.from('fulfilment_batches').select('id,label,status,created_at,school_id,ordering_period_id').eq('id', options.batch_id), 'The batch was not found.');
    if (!demoMode && batch.school_id===demoSchoolId) throw fail('The batch was not found.',404);
    if ((options.school_id && options.school_id !== batch.school_id) || (options.period_id && options.period_id !== batch.ordering_period_id)) throw fail('The batch does not match the selected school or period.');
    options = { ...options, school_id: batch.school_id, period_id: batch.ordering_period_id };
  }
  if (options.period_id) {
    period = await single(database.from('ordering_periods').select('id,name,school_id,academic_years(year)').eq('id', options.period_id), 'The ordering period was not found.');
    if (options.school_id && options.school_id !== period.school_id) throw fail('The ordering period does not belong to this school.');
    options = { ...options, school_id: period.school_id };
  }
  if (options.school_id) school = await single(database.from('schools').select('id,name').eq('id', options.school_id), 'The school was not found.');
  let rows, orders = [];
  if (batch) {
    rows = await readReportRows(() => database.from('fulfilment_batch_items').select('id,book_title,learner_first_name,learner_last_name,order_reference,quantity,grades(name)').eq('batch_id', batch.id));
    if (!demoMode && rows.some(row=>row.order_reference?.startsWith('DEMO-'))) throw fail('The batch was not found.',404);
    rows = rows.map(row => ({ school: school.name, year: period.academic_years?.year, period: period.name, grade: row.grades?.name || '', learner: `${row.learner_first_name} ${row.learner_last_name}`, surname: row.learner_last_name, book: row.book_title, reference: row.order_reference, quantity: row.quantity }));
  } else {
    const filter = (query, prefix = '') => {
      query = query.eq(`${prefix}status`, 'paid').lte(`${prefix}paid_at`, capturedAt);
      if (!demoMode) query=excludeDemoOrders(query,prefix);
      if (options.school_id) query = query.eq(`${prefix}school_id`, options.school_id);
      if (options.period_id) query = query.eq(`${prefix}ordering_period_id`, options.period_id);
      return query;
    };
    orders = await readReportRows(() => filter(database.from('orders').select('id,reference,school_id,ordering_period_id,parent_first_name,parent_last_name,parent_email,parent_mobile,amount_cents,order_item_refunds(amount_cents),paid_at,schools(name),ordering_periods(name,academic_years(year))')));
    const items = (await readReportRows(() => filter(database.from('order_items').select('id,order_id,description_snapshot,quantity,line_total_cents,order_item_refunds(id),learners!inner(first_name,last_name,class_name,grades(name)),orders!inner(reference,status,paid_at,school_id,ordering_period_id)'), 'orders.'))).filter(item=>!isRefundedItem(item));
    const byOrder = new Map(orders.map(order => [order.id, order]));
    rows = items.map(item => {
      const order = byOrder.get(item.order_id);
      if (!order) throw fail('Orders changed while this report was being prepared. Please download it again.', 409);
      return { school: order.schools?.name || '', year: order.ordering_periods?.academic_years?.year, period: order.ordering_periods?.name || '', grade: item.learners.grades?.name || '', learner: `${item.learners.first_name} ${item.learners.last_name}`, surname: item.learners.last_name, class: item.learners.class_name || '', book: item.description_snapshot, quantity: item.quantity, reference: order.reference, paidAt: order.paid_at, lineCents: item.line_total_cents };
    });
    // Detect a concurrent status change instead of emitting a partial register with conflicting totals.
    const totals = new Map();
    for (const item of items) totals.set(item.order_id, (totals.get(item.order_id) || 0) + item.line_total_cents);
    if (orders.some(order => totals.get(order.id) !== refundBalance(order).net_cents)) throw fail('Payment records changed or could not be reconciled. Please download the report again.', 409);
  }
  const report = buildReport({ ...options, school, period, batch, rows, orders, capturedAt });
  report.schoolLogo = school ? await logoReader(database, school.id) : null;
  return report;
}

export function buildReport({ language = 'en', school = null, period = null, batch = null, rows = [], orders = [], capturedAt = new Date().toISOString() }) {
  const tr = (en, af) => language === 'af' ? af : en;
  const compare = (a,b) => String(a ?? '').localeCompare(String(b ?? ''), language, { numeric: true, sensitivity: 'base' });
  rows = rows.map(row=>({...row,grade:String(row.grade||'').replace(language==='af'?/^Grade\s/i:/^Graad\s/i,language==='af'?'Graad ':'Grade ')})).sort((a,b) => compare(a.school,b.school) || compare(a.year,b.year) || compare(a.period,b.period) || compare(a.grade,b.grade) || compare(a.surname,b.surname) || compare(a.learner,b.learner) || compare(a.reference,b.reference));
  const col = (key, en, af, width, type = 'text') => ({ key, label: tr(en, af), width, type });
  const columns = [
    ...(!school ? [col('school','School','Skool',28),col('year','Year','Jaar',9,'integer'),col('period','Ordering period','Bestelperiode',25)] : !period ? [col('year','Year','Jaar',9,'integer'),col('period','Ordering period','Bestelperiode',25)] : []),
    col('grade','Grade','Graad',12),col('learner','Learner','Leerder',30),
    ...(rows.some(row=>row.class) ? [col('class','Class','Klas',12)] : []),
    col('book','Workbook','Werkboek',38),col('quantity','Books','Boeke',10,'integer'),col('reference','Order reference','Bestelverwysing',30),
    ...(!batch ? [col('paidAt','Paid on (SAST)','Betaal op (SAST)',23,'date')] : []),
  ];
  const sections = [];
  if (batch) {
    const packing = new Map();
    for (const row of rows) { const key=JSON.stringify([row.grade,row.book]); const current=packing.get(key); packing.set(key,{grade:row.grade,book:row.book,quantity:(current?.quantity||0)+row.quantity}); }
    sections.push({ name: tr('Packing summary','Pakopsomming'), columns:[col('grade','Grade','Graad',14),col('book','Workbook','Werkboek',60),col('quantity','Books','Boeke',12,'integer')], rows:[...packing.values()] });
  }
  sections.push({ name: batch ? tr('Learner allocation','Leerdertoewysing') : tr('Paid learner register','Betaalde leerderlys'), columns, rows });
  if (!school && !batch) {
    const hasRefunds=orders.some(order=>refundBalance(order).refunded_cents>0);
    sections.push({name:tr('Transactions','Transaksies'),internal:true,columns:[
      col('school','School','Skool',28),col('year','Year','Jaar',9,'integer'),col('period','Ordering period','Bestelperiode',25),col('reference','Order reference','Bestelverwysing',30),col('parent','Parent','Ouer',28),col('email','Parent email','Ouer se e-pos',38),col('mobile','Parent mobile','Ouer se selfoon',20),
      ...(hasRefunds?[col('originalAmount','Original total (ZAR)','Oorspronklike totaal (ZAR)',22,'money'),col('refundedAmount','Refunded (ZAR)','Terugbetaal (ZAR)',22,'money')]:[]),
      col('amount',hasRefunds?'Net paid (ZAR)':'Order total (ZAR)',hasRefunds?'Netto betaal (ZAR)':'Besteltotaal (ZAR)',22,'money'),col('paidAt','Paid on (SAST)','Betaal op (SAST)',23,'date')],
      rows:orders.map(order=>{const balance=refundBalance(order);return {school:order.schools?.name||'',year:order.ordering_periods?.academic_years?.year,period:order.ordering_periods?.name||'',reference:order.reference,parent:`${order.parent_first_name} ${order.parent_last_name}`,email:order.parent_email,mobile:order.parent_mobile,originalAmount:balance.original_cents/100,refundedAmount:balance.refunded_cents/100,amount:balance.net_cents/100,paidAt:order.paid_at};})});
  }
  return { language, school, period, batch, rows, orders, sections, capturedAt, schoolLogo:null,
    title: batch ? tr('School fulfilment batch','Skoolafleweringsbatch') : tr('Paid learner register','Betaalde leerderlys'),
    scope: school?.name || tr('All schools','Alle skole'),
    quantity: rows.reduce((sum,row)=>sum+row.quantity,0), orderCount: new Set(rows.map(row=>row.reference)).size,
    totalCents:orders.reduce((sum,order)=>sum+refundBalance(order).net_cents,0),
    hasDemo:rows.some(row=>row.reference?.startsWith('DEMO-')),
  };
}
