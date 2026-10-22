begin;
do $$
declare n integer; allowed boolean; t text;
begin
  if exists (select 1 from public.staff_users where active) then raise exception 'Legacy password-only preview permissions must stay empty'; end if;
  foreach t in array array['staff_access_approvals','staff_setup_challenges','staff_login_sessions','staff_auth_limits'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS missing'; end if;
    if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'SELECT') then raise exception 'Private table exposed'; end if;
  end loop;
  if has_function_privilege('anon','public.consume_staff_auth_limit(text,integer,integer)','EXECUTE') then raise exception 'Quota function exposed'; end if;
  if has_function_privilege('authenticated','public.consume_staff_setup_attempt(text)','EXECUTE') then raise exception 'Challenge function exposed'; end if;
  allowed := public.consume_staff_auth_limit(repeat('9',64),1,900);
  if not allowed then raise exception 'First quota request denied'; end if;
  allowed := public.consume_staff_auth_limit(repeat('9',64),1,900);
  if allowed then raise exception 'Quota not enforced'; end if;
  insert into public.staff_setup_challenges(token_hash,status) values (repeat('8',64),'sent');
  for i in 1..5 loop
    select count(*) into n from public.consume_staff_setup_attempt(repeat('8',64));
    if n<>1 then raise exception 'Unexpected challenge attempt'; end if;
  end loop;
  select count(*) into n from public.consume_staff_setup_attempt(repeat('8',64));
  if n<>0 then raise exception 'Challenge brute-force limit not enforced'; end if;
  update public.staff_setup_challenges set attempts=0,status='used' where token_hash=repeat('8',64);
  select count(*) into n from public.consume_staff_setup_attempt(repeat('8',64));
  if n<>0 then raise exception 'Used challenge was replayed'; end if;
  update public.staff_setup_challenges set status='sent',expires_at=now()-interval '1 minute' where token_hash=repeat('8',64);
  select count(*) into n from public.consume_staff_setup_attempt(repeat('8',64));
  if n<>0 then raise exception 'Expired challenge accepted'; end if;
end $$;
select 'PASS: RLS, private RPCs, durable quotas and bounded single-use challenges' as staff_access_acceptance;
rollback;
