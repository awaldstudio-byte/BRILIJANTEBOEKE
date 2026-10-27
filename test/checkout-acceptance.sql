-- Synthetic dedicated Test School 1 clones only; no provider/SMTP calls.
-- All fixtures, state changes and temporary helpers roll back.
begin;
create function pg_temp.checkout_qa_order() returns uuid language plpgsql as $$
declare v_order public.orders;v_template uuid;v_id uuid:=gen_random_uuid();v_item public.order_items;v_learner public.learners;
begin
  select * into strict v_order from public.orders where school_id='edabcd03-1854-43ca-ac93-45c71e9ef012'
    and reference like 'DEMO-%' order by created_at limit 1;
  v_template:=v_order.id;v_order.id:=v_id;v_order.reference:='DEMO-BB-CKQA-'||left(v_id::text,8);
  v_order.idempotency_key:='sandbox:checkout-qa-'||v_id;v_order.order_access_hash:=repeat('a',64);
  v_order.parent_email:='technical@awaldstudio.com';v_order.status:='pending_payment';v_order.paid_at:=null;
  v_order.created_at:=now();v_order.updated_at:=now();insert into public.orders select v_order.*;
  for v_item in select * from public.order_items where order_id=v_template loop
    select * into strict v_learner from public.learners where id=v_item.learner_id;
    v_learner.id:=gen_random_uuid();v_learner.order_id:=v_id;insert into public.learners select v_learner.*;
    v_item.id:=gen_random_uuid();v_item.order_id:=v_id;v_item.learner_id:=v_learner.id;insert into public.order_items select v_item.*;
  end loop;
  return v_id;
end;
$$;
create function pg_temp.checkout_qa_error(p_reference text,p_hash text,p_mode text,p_expected text) returns void language plpgsql as $$
begin
  perform public.prepare_payfast_checkout(p_reference,p_hash,p_mode);
  raise exception 'Expected checkout failure: %',p_expected;
exception when sqlstate 'P0001' then if sqlerrm<>p_expected then raise;end if;
end;
$$;
do $$
declare v_order uuid;v_reference text;v_attempt uuid;v_first jsonb;v_again jsonb;v_before jsonb;v_status text;v_other uuid;v_other_reference text;
begin
  v_order:=pg_temp.checkout_qa_order();select reference into v_reference from public.orders where id=v_order;
  v_first:=public.prepare_payfast_checkout(v_reference,repeat('a',64),'sandbox');v_attempt:=(v_first->>'payment_attempt_id')::uuid;
  if v_attempt is null or v_first->>'status'<>'pending_payment'
    or (v_first->>'amount_cents')::integer<>(select amount_cents from public.orders where id=v_order)
    or (v_first->>'learner_count')::integer<>(select count(*) from public.learners where order_id=v_order) then raise exception 'Canonical preparation fields invalid';end if;
  select to_jsonb(pa) into v_before from public.payment_attempts pa where id=v_attempt;
  v_again:=public.prepare_payfast_checkout(v_reference,repeat('a',64),'sandbox');
  if v_again->>'payment_attempt_id'<>v_first->>'payment_attempt_id'
    or (select count(*) from public.payment_attempts where order_id=v_order)<>1
    or v_before<>(select to_jsonb(pa) from public.payment_attempts pa where id=v_attempt) then raise exception 'Repeated preparation mutated or duplicated attempt';end if;
  -- An actual failed checkout may be retried, but its status/provider metadata
  -- remains historical until a verified provider notification changes it.
  update public.payment_attempts set status='failed',provider_payment_id='QA-FAILED-'||v_order where id=v_attempt;
  update public.orders set status='payment_failed' where id=v_order;
  select to_jsonb(pa) into v_before from public.payment_attempts pa where id=v_attempt;
  perform public.prepare_payfast_checkout(v_reference,repeat('a',64),'sandbox');
  if v_before<>(select to_jsonb(pa) from public.payment_attempts pa where id=v_attempt) then raise exception 'Retry reset failed attempt history';end if;
  perform public.process_payfast_notification(v_attempt,'ckqa-first-'||v_order,'QA-FIRST-'||v_order,'COMPLETE','verified','',jsonb_build_object('m_payment_id',v_reference),array['technical@awaldstudio.com']);
  if (select status from public.orders where id=v_order)<>'paid' then raise exception 'Verified payment did not commit';end if;
  perform pg_temp.checkout_qa_error(v_reference,repeat('a',64),'sandbox','CHECKOUT_ALREADY_PAID');
  foreach v_status in array array['FAILED','CANCELLED','COMPLETE'] loop
    perform public.process_payfast_notification(v_attempt,'ckqa-late-'||v_status||'-'||v_order,'QA-FIRST-'||v_order,v_status,'verified','',jsonb_build_object('m_payment_id',v_reference),array['technical@awaldstudio.com']);
    if (select status from public.orders where id=v_order)<>'paid' or (select status from public.payment_attempts where id=v_attempt)<>'complete'
      or (select provider_payment_id from public.payment_attempts where id=v_attempt)<>'QA-FIRST-'||v_order then raise exception 'Late status demoted or replaced completed receipt';end if;
  end loop;
  -- An in-flight old deployment cannot demote the completed attempt either.
  update public.payment_attempts set status='pending',provider_payment_id='QA-STALE-RETRY' where id=v_attempt;
  if (select status from public.payment_attempts where id=v_attempt)<>'complete' or (select provider_payment_id from public.payment_attempts where id=v_attempt)<>'QA-FIRST-'||v_order then raise exception 'Stale writer demoted completed receipt';end if;
  perform public.process_payfast_notification(v_attempt,'ckqa-second-'||v_order,'QA-SECOND-'||v_order,'COMPLETE','verified','',jsonb_build_object('m_payment_id',v_reference),array['technical@awaldstudio.com']);
  perform public.process_payfast_notification(v_attempt,'ckqa-second-'||v_order,'QA-SECOND-'||v_order,'COMPLETE','verified','',jsonb_build_object('m_payment_id',v_reference),array['technical@awaldstudio.com']);
  if (select provider_payment_id from public.payment_attempts where id=v_attempt)<>'QA-FIRST-'||v_order
    or (select count(*) from public.payment_events where payment_attempt_id=v_attempt and provider_payment_id='QA-SECOND-'||v_order)<>1
    or (select count(*) from public.audit_events where action='duplicate_payfast_payment_requires_review' and entity_id=v_order::text
      and details->>'original_provider_payment_id'='QA-FIRST-'||v_order and details->>'additional_provider_payment_id'='QA-SECOND-'||v_order)<>1
    or (select count(*) from public.notification_jobs where order_id=v_order)<>2 then raise exception 'Second receipt overwrote original, lost evidence or requeued confirmations';end if;
  -- The existing audited refund action remains an allowed terminal transition.
  update public.orders set status='refunded' where id=v_order;update public.payment_attempts set status='refunded' where id=v_attempt;
  foreach v_status in array array['FAILED','CANCELLED','COMPLETE'] loop
    perform public.process_payfast_notification(v_attempt,'ckqa-refunded-'||v_status||'-'||v_order,'QA-FIRST-'||v_order,v_status,'verified','','{}','{}');
    if (select status from public.orders where id=v_order)<>'refunded' or (select status from public.payment_attempts where id=v_attempt)<>'refunded' then raise exception 'Refund reopened';end if;
  end loop;
  v_other:=pg_temp.checkout_qa_order();select reference into v_other_reference from public.orders where id=v_other;
  perform pg_temp.checkout_qa_error(v_other_reference,repeat('b',64),'sandbox','CHECKOUT_ORDER_NOT_FOUND');
  perform pg_temp.checkout_qa_error(v_other_reference,repeat('a',64),'live','CHECKOUT_ENVIRONMENT_DENIED');
  update public.orders set parent_email='another@example.invalid' where id=v_other;
  perform pg_temp.checkout_qa_error(v_other_reference,repeat('a',64),'sandbox','CHECKOUT_ENVIRONMENT_DENIED');
  if exists(select 1 from public.payment_attempts where order_id=v_other) then raise exception 'Rejected environment created payment attempt';end if;
  if has_function_privilege('anon','public.prepare_payfast_checkout(text,text,text)','execute')
    or has_function_privilege('authenticated','public.prepare_payfast_checkout(text,text,text)','execute') then raise exception 'Preparation RPC is public';end if;
end;
$$;
select 'PASS: canonical insert-only checkout, stable retry history, completed/refunded terminal states, duplicate-charge review evidence, no repeated confirmations and private RPC' as result;
rollback;
