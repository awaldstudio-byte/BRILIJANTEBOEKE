-- Run only against the dedicated Briljante project. All test data rolls back.
begin;
create function pg_temp.shipping_test_order(p_template uuid,p_email text) returns uuid
language plpgsql as $$
declare v_order public.orders;v_item public.order_items;v_learner public.learners;v_id uuid:=gen_random_uuid();
begin
  select * into strict v_order from public.orders where id=p_template;
  v_order.id:=v_id;v_order.reference:='DEMO-BB-SHIPPING-QA-'||left(v_id::text,8);
  v_order.idempotency_key:=v_id::text;v_order.parent_email:=p_email;
  v_order.created_at:=now();v_order.paid_at:=now();v_order.updated_at:=now();
  insert into public.orders select v_order.*;
  for v_item in select * from public.order_items where order_id=p_template loop
    select * into strict v_learner from public.learners where id=v_item.learner_id;
    v_learner.id:=gen_random_uuid();v_learner.order_id:=v_id;
    insert into public.learners select v_learner.*;
    v_item.id:=gen_random_uuid();v_item.order_id:=v_id;v_item.learner_id:=v_learner.id;
    insert into public.order_items select v_item.*;
  end loop;
  return v_id;
end;
$$;
do $$
declare
  v_template public.orders;v_actor uuid;v_batch uuid:=gen_random_uuid();
  v_one uuid;v_two uuid;v_other uuid;v_late uuid;v_count integer;v_payload jsonb;v_result jsonb;
begin
  select * into strict v_template from public.orders
    where school_id='edabcd03-1854-43ca-ac93-45c71e9ef012' and status='paid' and reference like 'DEMO-%'
    order by created_at limit 1;
  select auth_user_id into strict v_actor from public.staff_access_approvals
    where active and email='technical@awaldstudio.com';
  v_one:=pg_temp.shipping_test_order(v_template.id,'technical@awaldstudio.com');
  v_two:=pg_temp.shipping_test_order(v_template.id,'technical@awaldstudio.com');
  v_other:=pg_temp.shipping_test_order(v_template.id,'parent-two@example.invalid');
  insert into public.fulfilment_batches(id,school_id,ordering_period_id,label,status,created_by)
    values(v_batch,v_template.school_id,v_template.ordering_period_id,'Shipping acceptance — ROLLBACK','ready',v_actor);
  insert into public.fulfilment_batch_items(batch_id,order_item_id,grade_id,book_title,learner_first_name,learner_last_name,order_reference,quantity)
  select v_batch,oi.id,l.grade_id,oi.description_snapshot,l.first_name,l.last_name,o.reference,oi.quantity
    from public.order_items oi join public.learners l on l.id=oi.learner_id join public.orders o on o.id=oi.order_id
    where oi.order_id=any(array[v_one,v_two,v_other]);
  v_late:=pg_temp.shipping_test_order(v_template.id,'technical@awaldstudio.com');
  v_result:=public.transition_fulfilment_batch(v_batch,'dispatched',v_actor,true);
  if (v_result->>'queued')::integer<>2 then raise exception 'Expected exactly two parent dispatch jobs'; end if;
  select payload into strict v_payload from public.shipping_notification_jobs where batch_id=v_batch and recipient='technical@awaldstudio.com';
  select count(*) into v_count from public.order_items where order_id=any(array[v_one,v_two]);
  if jsonb_array_length(v_payload->'items')<>v_count then raise exception 'Parent grouping or fixed batch membership failed'; end if;
  if exists(select 1 from jsonb_array_elements(v_payload->'items') i where i->>'order_reference'=(select reference from public.orders where id=v_late)) then raise exception 'Late order leaked into frozen batch'; end if;
  v_result:=public.transition_fulfilment_batch(v_batch,'dispatched',v_actor,true);
  if (v_result->>'changed')::boolean or (v_result->>'queued')::integer<>0 then raise exception 'Repeated dispatch queued duplicate jobs'; end if;
  select count(*) into v_count from public.claim_shipping_notifications(v_batch,20);
  if v_count<>2 then raise exception 'Expected two atomic claims'; end if;
  select count(*) into v_count from public.claim_shipping_notifications(v_batch,20);
  if v_count<>0 then raise exception 'A processing message was claimed twice'; end if;
  v_result:=public.transition_fulfilment_batch(v_batch,'delivered',v_actor,true);
  if (v_result->>'queued')::integer<>2 then raise exception 'Expected exactly two school-delivery jobs'; end if;
  select count(*) into v_count from public.claim_shipping_notifications(v_batch,20);
  if v_count<>0 then raise exception 'Delivery overtook an in-flight dispatch'; end if;
  -- Simulate recorded SMTP acceptance, without sending any email.
  update public.shipping_notification_jobs set status='sent',sent_at=now() where batch_id=v_batch and event='dispatched';
  select count(*) into v_count from public.claim_shipping_notifications(v_batch,20);
  if v_count<>2 then raise exception 'Delivery did not proceed after dispatch completion'; end if;
  v_result:=public.transition_fulfilment_batch(v_batch,'delivered',v_actor,true);
  if (v_result->>'changed')::boolean then raise exception 'Delivery was not idempotent'; end if;
  begin
    perform public.transition_fulfilment_batch(v_batch,'dispatched',v_actor,true);
    raise exception 'A delivered batch was reopened';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'INVALID_BATCH_TRANSITION' then raise; end if;
  end;
  if has_table_privilege('anon','public.shipping_notification_jobs','select') or has_table_privilege('authenticated','public.shipping_notification_jobs','select') then raise exception 'Private queue exposed'; end if;
  if has_function_privilege('anon','public.transition_fulfilment_batch(uuid,text,uuid,boolean)','execute') or has_function_privilege('authenticated','public.claim_shipping_notifications(uuid,integer)','execute') then raise exception 'Worker RPC exposed'; end if;
  if not (select relrowsecurity from pg_class where oid='public.shipping_notification_jobs'::regclass) then raise exception 'Queue RLS missing'; end if;
end;
$$;
select 'PASS: fixed school batch, grouped parent recipients, late-order exclusion, duplicate protection, event order, private permissions' as result;
rollback;
