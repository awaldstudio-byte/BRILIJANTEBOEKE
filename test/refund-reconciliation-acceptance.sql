-- Dedicated Briljante test project only. Synthetic clones, no provider or SMTP
-- calls. Every test row and helper is rolled back. Requires a paid DEMO test
-- order and the approved technical administrator as existing fixture templates.
begin;
create function pg_temp.refund_qa_order() returns uuid language plpgsql as $$
declare v_order public.orders;v_item public.order_items;v_learner public.learners;v_template uuid;v_id uuid:=gen_random_uuid();v_attempt uuid:=gen_random_uuid();
begin
  select * into strict v_order from public.orders where school_id='edabcd03-1854-43ca-ac93-45c71e9ef012'
    and status='paid' and reference like 'DEMO-%' order by created_at limit 1;
  v_template:=v_order.id;
  v_order.id:=v_id;v_order.reference:='DEMO-BB-REFUND-QA-'||left(v_id::text,8);v_order.idempotency_key:=v_id::text;
  v_order.parent_email:='refund-qa@example.invalid';v_order.created_at:=now()-interval '3 hours';
  v_order.paid_at:=now()-interval '2 hours';v_order.updated_at:=now();
  insert into public.orders select v_order.*;
  for v_item in select * from public.order_items where order_id=v_template loop
    select * into strict v_learner from public.learners where id=v_item.learner_id;
    v_learner.id:=gen_random_uuid();v_learner.order_id:=v_id;insert into public.learners select v_learner.*;
    v_item.id:=gen_random_uuid();v_item.order_id:=v_id;v_item.learner_id:=v_learner.id;insert into public.order_items select v_item.*;
  end loop;
  insert into public.payment_attempts(id,order_id,merchant_payment_id,provider_payment_id,amount_cents,status,checkout_payload)
    values(v_attempt,v_id,v_order.reference,v_id::text,v_order.amount_cents,'complete','{"mode":"sandbox","qa":"rollback-only"}');
  insert into public.payment_events(payment_attempt_id,event_key,provider_payment_id,payment_status,verification_state,raw_payload,processed_at)
    values(v_attempt,'refund-qa-complete-'||v_id,v_id::text,'COMPLETE','verified','{"qa":"synthetic acceptance, no real payment"}',now());
  return v_id;
end;
$$;
create function pg_temp.refund_qa_expect(
  p_order uuid,p_reference text,p_expected text,p_actor uuid,
  p_amount integer default null,p_payment text default null,p_date timestamptz default null
) returns void language plpgsql as $$
begin
  perform public.record_completed_full_refund(p_order,coalesce(p_payment,p_order::text),p_reference,
    coalesce(p_amount,(select amount_cents from public.orders where id=p_order)),
    coalesce(p_date,now()-interval '1 hour'),'Synthetic acceptance refund',p_actor);
  raise exception 'Expected refund operation to fail: %',p_expected;
exception when sqlstate 'P0001' then
  if sqlerrm<>p_expected then raise; end if;
end;
$$;
do $$
declare v_order uuid;v_other uuid;v_batch uuid;v_actor uuid;v_refund jsonb;v_attempt uuid;v_amount integer;v_count integer;v_status text;v_parent_status text;
begin
  select auth_user_id into strict v_actor from public.staff_access_approvals where active and role='administrator'
    and email='technical@awaldstudio.com' and password_set_at is not null;
  v_order:=pg_temp.refund_qa_order();
  select id,amount_cents into v_attempt,v_amount from public.payment_attempts where order_id=v_order;
  insert into public.notification_jobs(order_id,kind,recipient) values(v_order,'parent_order_paid','refund-qa@example.invalid');
  v_refund:=public.record_completed_full_refund(v_order,v_order::text,'QA-REFUND-'||v_order,v_amount,now()-interval '1 hour','Synthetic acceptance refund',v_actor);
  if (v_refund->>'reused')::boolean or v_refund->>'order_status'<>'refunded' then raise exception 'New refund result invalid'; end if;
  if (select status from public.orders where id=v_order)<>'refunded'
    or (select status from public.payment_attempts where id=v_attempt)<>'refunded' then raise exception 'Refund states not atomic'; end if;
  if exists(select 1 from public.notification_jobs where order_id=v_order and (status<>'failed' or last_error<>'ORDER_REFUNDED_NO_SEND')) then raise exception 'Queued confirmation not suppressed'; end if;
  if exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id where o.id=v_order and o.status='paid') then raise exception 'Refunded items remain in paid register'; end if;
  if (select count(*) from public.audit_events where action='order_full_refund_recorded' and entity_id=v_order::text)<>1 then raise exception 'Refund audit missing'; end if;
  v_refund:=public.record_completed_full_refund(v_order,v_order::text,'QA-REFUND-'||v_order,v_amount,now()-interval '1 hour','Synthetic acceptance refund',v_actor);
  if not (v_refund->>'reused')::boolean or (select count(*) from public.order_refunds where order_id=v_order)<>1
    or (select count(*) from public.audit_events where action='order_full_refund_recorded' and entity_id=v_order::text)<>1 then raise exception 'Repeat refund was not idempotent'; end if;
  perform pg_temp.refund_qa_expect(v_order,'QA-CONFLICT','REFUND_ALREADY_RECORDED',v_actor);

  -- Late signed provider statuses must leave both ledgers refunded and must not
  -- enqueue a second paid confirmation or overwrite the original transaction id.
  foreach v_status in array array['COMPLETE','FAILED','CANCELLED'] loop
    perform public.process_payfast_notification(v_attempt,'refund-qa-late-'||v_status||'-'||v_order,v_order::text,v_status,'verified','',jsonb_build_object('qa',true),'{}');
    if (select status from public.orders where id=v_order)<>'refunded'
      or (select status from public.payment_attempts where id=v_attempt)<>'refunded' then raise exception 'Late % reopened a refund',v_status; end if;
  end loop;
  update public.payment_attempts set provider_payment_id='replacement-qa-reference' where id=v_attempt;
  if (select provider_payment_id from public.payment_attempts where id=v_attempt)<>v_order::text then raise exception 'Refund payment id was overwritten'; end if;
  if (select count(*) from public.notification_jobs where order_id=v_order)<>1 then raise exception 'Late callback requeued paid emails'; end if;

  v_other:=pg_temp.refund_qa_order();
  perform pg_temp.refund_qa_expect(v_other,'QA-REFUND-'||v_order,'REFUND_ALREADY_RECORDED',v_actor);
  perform pg_temp.refund_qa_expect(v_other,'QA-PARTIAL','REFUND_PAYMENT_MISMATCH',v_actor,1);
  perform pg_temp.refund_qa_expect(v_other,'QA-WRONG-PAYMENT','REFUND_PAYMENT_MISMATCH',v_actor,null,'wrong-reference');
  perform pg_temp.refund_qa_expect(v_other,'QA-FUTURE','REFUND_DATE_INVALID',v_actor,null,null,now()+interval '1 hour');
  perform pg_temp.refund_qa_expect(v_other,'QA-BEFORE-PAID','REFUND_DATE_INVALID',v_actor,null,null,now()-interval '4 hours');
  perform pg_temp.refund_qa_expect(v_other,'QA-NO-ACTOR','REFUND_ADMIN_REQUIRED',null);
  if (select status from public.orders where id=v_other)<>'paid' or exists(select 1 from public.order_refunds where order_id=v_other) then raise exception 'Rejected reconciliation changed order'; end if;
  delete from public.payment_events where payment_attempt_id=(select id from public.payment_attempts where order_id=v_other);
  perform pg_temp.refund_qa_expect(v_other,'QA-NO-VERIFIED-PAYMENT','REFUND_PAYMENT_MISMATCH',v_actor);

  foreach v_status in array array['created','packing','ready','dispatched','delivered','cancelled'] loop
    v_other:=pg_temp.refund_qa_order();v_batch:=gen_random_uuid();
    insert into public.fulfilment_batches(id,school_id,ordering_period_id,label,status,created_by,dispatched_at)
      select v_batch,school_id,ordering_period_id,'Refund QA - rollback',v_status,v_actor,
        case when v_status in ('dispatched','delivered','cancelled') then now()-interval '1 hour' else null end from public.orders where id=v_other;
    insert into public.fulfilment_batch_items(batch_id,order_item_id,grade_id,book_title,learner_first_name,learner_last_name,order_reference,quantity)
      select v_batch,oi.id,l.grade_id,oi.description_snapshot,l.first_name,l.last_name,o.reference,oi.quantity
      from public.order_items oi join public.learners l on l.id=oi.learner_id join public.orders o on o.id=oi.order_id where o.id=v_other;
    perform pg_temp.refund_qa_expect(v_other,'QA-BATCH-'||v_batch,'REFUND_BATCH_REVIEW_REQUIRED',v_actor);
    if v_status in ('created','packing','ready') then
      perform public.transition_fulfilment_batch(v_batch,'cancelled',v_actor,true);
      v_refund:=public.record_completed_full_refund(v_other,v_other::text,'QA-CANCELLED-'||v_batch,
        (select amount_cents from public.orders where id=v_other),now()-interval '1 hour','Synthetic acceptance refund',v_actor);
      if v_refund->>'order_status'<>'refunded' then raise exception 'Cancelled unshipped batch could not reconcile'; end if;
    end if;
  end loop;
  v_other:=pg_temp.refund_qa_order();
  insert into public.notification_jobs(order_id,kind,recipient,status) values(v_other,'parent_order_paid','refund-qa@example.invalid','processing');
  perform pg_temp.refund_qa_expect(v_other,'QA-INFLIGHT-MAIL','REFUND_MAIL_IN_PROGRESS',v_actor);
  if exists(select 1 from public.order_refunds where order_id=v_other) then raise exception 'In-flight mail refund partially committed'; end if;
  if has_table_privilege('anon','public.order_refunds','select') or has_table_privilege('authenticated','public.order_refunds','select')
    or has_table_privilege('service_role','public.order_refunds','update') or has_table_privilege('service_role','public.order_refunds','delete') then raise exception 'Refund ledger grants too broad'; end if;
  if has_function_privilege('anon','public.record_completed_full_refund(uuid,text,text,integer,timestamptz,text,uuid)','execute')
    or has_function_privilege('authenticated','public.record_completed_full_refund(uuid,text,text,integer,timestamptz,text,uuid)','execute') then raise exception 'Refund RPC exposed'; end if;
  if not (select relrowsecurity from pg_class where oid='public.order_refunds'::regclass) then raise exception 'Refund RLS missing'; end if;
end;
$$;
select 'PASS: atomic audited full-refund record, repeat/conflict safety, provider evidence, amount/date checks, batch/mail blocking, terminal callbacks and private grants' as result;
rollback;
