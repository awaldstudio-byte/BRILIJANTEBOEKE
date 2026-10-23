const invalid = () => Object.assign(new Error('School progress could not be calculated.'), {code:'PROGRESS_LOOKUP_FAILED'});
function integer(value) { if (!Number.isSafeInteger(value) || value < 0) throw invalid(); return value; }

export function calculateSchoolProgress(offerings, items, capturedAt = new Date().toISOString()) {
  const byGrade = new Map(), byOffering = new Map(offerings.map(row => [row.id,row]));
  const getGrade = (id,name,sort) => {
    if (!id) throw invalid();
    if (!byGrade.has(id)) byGrade.set(id,{grade_id:id,name:name || 'Grade',sort:sort ?? 999,expected:0,paid:0,expected_value_cents:0,paid_value_cents:0});
    return byGrade.get(id);
  };
  for (const row of offerings) {
    if (!row.active) continue;
    const grade = getGrade(row.grade_id,row.grades?.name,row.grades?.sort_order);
    grade.expected += integer(row.expected_quantity);
    grade.expected_value_cents += integer(row.expected_quantity) * integer(row.price_cents);
  }
  for (const row of items) {
    const offering = byOffering.get(row.offering_id);
    const grade = getGrade(offering?.grade_id || row.learners?.grade_id,offering?.grades?.name || row.learners?.grades?.name,offering?.grades?.sort_order || row.learners?.grades?.sort_order);
    grade.paid += integer(row.quantity);
    grade.paid_value_cents += integer(row.line_total_cents);
  }
  const grades = [...byGrade.values()].sort((a,b)=>a.sort-b.sort || a.name.localeCompare(b.name)).map(row => ({...row,
    outstanding:Math.max(0,row.expected-row.paid),outstanding_value_cents:Math.max(0,row.expected_value_cents-row.paid_value_cents)}));
  const totals = {expected:0,paid:0,outstanding:0,expected_value_cents:0,paid_value_cents:0,outstanding_value_cents:0};
  for (const grade of grades) for (const key of Object.keys(totals)) totals[key] = integer(totals[key]+integer(grade[key]));
  return {captured_at:capturedAt,grades,totals};
}

// Explicit pagination avoids silently reporting only the first API row limit.
async function allRows(queryFactory) {
  const rows = [], size = 500;
  for (let page=0; page<200; page++) {
    const result = await queryFactory().range(page*size,(page+1)*size-1);
    if (result.error || !Array.isArray(result.data)) throw invalid();
    rows.push(...result.data);
    if (result.data.length < size) return rows;
  }
  throw invalid(); // Never send a silently truncated progress total.
}
export async function readSchoolPaymentProgress(database,order,{now=()=>new Date().toISOString()}={}) {
  if (!order.school_id || !order.ordering_period_id) throw invalid();
  const demo = order.reference.startsWith('DEMO-');
  const [offerings,items] = await Promise.all([
    allRows(()=>database.from('school_grade_offerings').select('id,grade_id,price_cents,expected_quantity,active,grades(name,sort_order)')
      .eq('school_id',order.school_id).eq('ordering_period_id',order.ordering_period_id).order('id')),
    allRows(()=>{
      let query=database.from('order_items').select('id,offering_id,quantity,line_total_cents,learners(grade_id,grades(name,sort_order)),orders!inner(reference,school_id,ordering_period_id,status)')
        .eq('orders.school_id',order.school_id).eq('orders.ordering_period_id',order.ordering_period_id).eq('orders.status','paid').order('id');
      return demo ? query.like('orders.reference','DEMO-%') : query.not('orders.reference','like','DEMO-%');
    }),
  ]);
  return calculateSchoolProgress(offerings,items,now());
}
