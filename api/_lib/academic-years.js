import { assertDatabaseResult } from './supabase.js';
import { badRequest, uuid } from './validation.js';

export function academicYearValue(value) {
  if (!Number.isInteger(value) || value < 2026 || value > 2100) throw badRequest('Enter a whole academic year between 2026 and 2100.');
  return value;
}

export async function addAcademicYear(database, actor, body) {
  if (!actor?.user?.id || actor.staff?.role !== 'administrator' || actor.staff.active !== true) {
    throw Object.assign(new Error('Administrator access is required.'), {statusCode:403});
  }
  const actorId = uuid(actor.user.id);
  const year = academicYearValue(body?.year);
  const inserted = await database.from('academic_years')
    .upsert({year,label:`${year} Academic Year`,is_active:true},{onConflict:'year',ignoreDuplicates:true})
    .select('id, year, label, is_active').maybeSingle();
  assertDatabaseResult(inserted.error);
  let saved = inserted.data;
  if (!saved) {
    const existing = await database.from('academic_years').select('id, year, label, is_active').eq('year',year).maybeSingle();
    assertDatabaseResult(existing.error); saved = existing.data;
  }
  if (!saved) throw new Error('Academic year could not be loaded.');
  if (inserted.data) {
    const audit = await database.from('audit_events').insert({actor_user_id:actorId,action:'academic_year_created',
      entity_type:'academic_year',entity_id:saved.id,details:{year}});
    assertDatabaseResult(audit.error);
  }
  return {academic_year:saved,created:!!inserted.data};
}

export async function assertPeriodYear(database, schoolId, period) {
  if (!period.id) return;
  if (!schoolId) throw badRequest('Select the school for this ordering period.');
  const existing = await database.from('ordering_periods').select('id, academic_year_id')
    .eq('id',period.id).eq('school_id',schoolId).maybeSingle();
  assertDatabaseResult(existing.error);
  if (!existing.data) throw badRequest('The ordering period does not belong to this school.');
  if (existing.data.academic_year_id !== period.academic_year_id) {
    throw badRequest('An existing ordering period cannot be moved to another academic year. Select the new year to create a separate ordering period.');
  }
}
