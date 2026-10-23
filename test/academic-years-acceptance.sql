begin;
do $$
declare test_year integer; test_id uuid; duplicate_id uuid; before_periods text; after_periods text;
begin
  if not (select relrowsecurity from pg_class where oid='public.academic_years'::regclass) then raise exception 'Academic year RLS missing'; end if;
  if has_table_privilege('anon','public.academic_years','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.academic_years','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Academic years exposed to browser roles'; end if;
  select min(y) into test_year from generate_series(2026,2100) y where not exists(select 1 from public.academic_years a where a.year=y);
  if test_year is null then raise exception 'No unused year available for rollback-only test'; end if;
  select md5(coalesce(string_agg(id::text||academic_year_id::text,',' order by id),'')) into before_periods from public.ordering_periods;
  insert into public.academic_years(year,label,is_active) values(test_year,'Rollback-only academic year test',false) returning id into test_id;
  insert into public.academic_years(year,label,is_active) values(test_year,'Must not overwrite',true) on conflict(year) do nothing returning id into duplicate_id;
  if duplicate_id is not null then raise exception 'Duplicate year was inserted'; end if;
  if not exists(select 1 from public.academic_years where id=test_id and label='Rollback-only academic year test' and is_active=false) then raise exception 'Existing year was overwritten'; end if;
  select md5(coalesce(string_agg(id::text||academic_year_id::text,',' order by id),'')) into after_periods from public.ordering_periods;
  if before_periods<>after_periods then raise exception 'Existing period year links changed'; end if;
end $$;
select 'PASS: private RLS, year creation, duplicate prevention and unchanged historical period links' as academic_year_acceptance;
rollback;
