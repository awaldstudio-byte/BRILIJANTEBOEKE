begin;
do $$
declare
  v_school uuid := 'edabcd03-1854-43ca-ac93-45c71e9ef012';
  v_period uuid := gen_random_uuid(); v_hash text := repeat('b',64); v_order jsonb; v_repeat jsonb;
  v_parent jsonb := '{"first_name":"Sandbox","last_name":"Acceptance","email":"technical@awaldstudio.com","mobile":"0820000000","consent":{"accepted":true,"policy_version":"2026-10-20"}}';
  v_learners jsonb; v_total integer;
begin
  insert into public.schools(id,slug,name) values(v_school,'sandbox-acceptance-school','Sandbox Acceptance School') on conflict(id) do nothing;
  insert into public.ordering_periods(id,school_id,academic_year_id,name,opens_at,closes_at,status)
    select v_period,v_school,id,'Rollback-only sandbox acceptance',now()-interval '1 day',now()+interval '1 day','open' from public.academic_years where year=2027;
  insert into public.school_grade_offerings(school_id,ordering_period_id,grade_id,book_id,price_cents,expected_quantity)
    select v_school,v_period,grade_id,id,default_price_cents,2 from public.books where active order by sku limit 2;
  insert into public.school_access(school_id,ordering_period_id,token_hash) values(v_school,v_period,v_hash);
  select jsonb_agg(jsonb_build_object('first_name','Fictional','last_name','Learner','offering_id',id)),sum(price_cents)
    into v_learners,v_total from public.school_grade_offerings where ordering_period_id=v_period;
  v_order := public.create_sandbox_school_order(v_hash,'sandbox:rollback-acceptance-20261026',repeat('a',64),v_parent,v_learners);
  v_repeat := public.create_sandbox_school_order(v_hash,'sandbox:rollback-acceptance-20261026',repeat('a',64),v_parent,v_learners);
  if v_order->>'status'<>'pending_payment' or v_order->>'reference' not like 'DEMO-BB-%' or (v_order->>'amount_cents')::integer<>v_total or v_repeat->>'id'<>v_order->>'id' or v_repeat->>'reused'<>'true' then raise exception 'Sandbox order/idempotency/amount assertion failed'; end if;
  if exists(select 1 from public.notification_jobs where order_id=(v_order->>'id')::uuid) then raise exception 'Sandbox created a paid notification before provider verification'; end if;
  begin
    perform public.create_sandbox_school_order(v_hash,'sandbox:rollback-denied-20261026',repeat('c',64),v_parent||'{"email":"parent@example.com"}'::jsonb,v_learners);
    raise exception 'Foreign recipient was accepted';
  exception when others then if sqlerrm<>'SANDBOX_ORDER_DENIED' then raise; end if; end;
  if has_function_privilege('anon','public.create_sandbox_school_order(text,text,text,jsonb,jsonb)','execute') or has_function_privilege('authenticated','public.create_sandbox_school_order(text,text,text,jsonb,jsonb)','execute') then raise exception 'Sandbox RPC exposed to public users'; end if;
end;
$$;
rollback;
select 'Sandbox atomic-order, amount, idempotency, recipient and privilege checks passed; all fixtures rolled back.' as result;
