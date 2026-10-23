import { sha256 } from './crypto.js';
import { assertDatabaseResult } from './supabase.js';
import { uuid } from './validation.js';

const schoolColumns = 'id, slug, name, status';
const periodColumns = 'id, school_id, name, opens_at, closes_at, status, delivery_note, academic_years(year, label)';
export function schoolIsOpen(school, period, now = Date.now()) {
  return school?.status === 'active' && period?.status === 'open' && Date.parse(period.opens_at) <= now && Date.parse(period.closes_at) > now;
}
function unavailable() { return Object.assign(new Error('This school ordering link is unavailable.'), { statusCode: 404 }); }

// Resolves catalogue identity only, never learner, parent or order records.
export async function resolveSchoolOrdering(database, { identifier = '', periodId = '', token = '' }, now = Date.now()) {
  if (identifier && (identifier.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identifier))) throw unavailable();
  if (periodId) { try { uuid(periodId); } catch { throw unavailable(); } }
  let school, period;
  if (token) {
    if (token.length < 8 || token.length > 300) throw unavailable();
    const result = await database.from('school_access').select('school_id, ordering_period_id, expires_at, revoked_at').eq('token_hash', sha256(token)).maybeSingle();
    assertDatabaseResult(result.error);
    const access = result.data;
    if (!access || access.revoked_at || (access.expires_at && Date.parse(access.expires_at) <= now)) throw unavailable();
    const [schoolResult, periodResult] = await Promise.all([
      database.from('schools').select(schoolColumns).eq('id', access.school_id).maybeSingle(),
      database.from('ordering_periods').select(periodColumns).eq('id', access.ordering_period_id).eq('school_id', access.school_id).maybeSingle(),
    ]);
    assertDatabaseResult(schoolResult.error); assertDatabaseResult(periodResult.error);
    school = schoolResult.data; period = periodResult.data;
    if ((identifier && school?.slug !== identifier) || (periodId && period?.id !== periodId)) throw unavailable();
  } else {
    if (!identifier) throw unavailable();
    const schoolResult = await database.from('schools').select(schoolColumns).eq('slug', identifier).maybeSingle();
    assertDatabaseResult(schoolResult.error); school = schoolResult.data;
    if (!school || school.status !== 'active') throw unavailable();
    let periodsQuery = database.from('ordering_periods').select(periodColumns).eq('school_id', school.id);
    if (periodId) periodsQuery = periodsQuery.eq('id', periodId);
    const result = await periodsQuery.order('closes_at', { ascending: false }).order('id');
    assertDatabaseResult(result.error);
    // A pinned year never silently switches. Generic school links prefer an
    // open period, otherwise the latest period's closed/unavailable state.
    const periods = result.data ?? [];
    period = periods.find(item => schoolIsOpen(school, item, now)) ?? periods[0];
  }
  if (!school || !period) throw unavailable();
  return { school, period, open: schoolIsOpen(school, period, now) };
}

// The existing transactional RPC takes an internal hash. Resolve it only here,
// bound to this school and period; never return it in the public response.
export async function internalSchoolOrderHash(database, school, period, now = Date.now()) {
  if (!schoolIsOpen(school, period, now)) throw Object.assign(new Error('ORDERING_UNAVAILABLE'), { statusCode: 400 });
  const result = await database.from('school_access').select('token_hash, expires_at').eq('school_id', school.id).eq('ordering_period_id', period.id).is('revoked_at', null).order('created_at', { ascending: false });
  assertDatabaseResult(result.error);
  const access = (result.data ?? []).find(item => !item.expires_at || Date.parse(item.expires_at) > now);
  if (!access) throw Object.assign(new Error('ORDERING_UNAVAILABLE'), { statusCode: 400 });
  return access.token_hash;
}
