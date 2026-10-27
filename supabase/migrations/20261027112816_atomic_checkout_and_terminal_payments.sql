-- Canonical checkout preparation: never reset an existing payment attempt.
create or replace function public.prepare_payfast_checkout(p_reference text,p_order_access_hash text,p_mode text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_order_id uuid;v_order public.orders;v_attempt public.payment_attempts;v_retry integer;v_count integer;
begin
  if p_mode is null or p_mode not in ('sandbox','live') then
    raise exception using errcode='P0001',message='CHECKOUT_ENVIRONMENT_DENIED';
  end if;
  select id into v_order_id from public.orders where reference=p_reference and order_access_hash=p_order_access_hash;
  if not found then raise exception using errcode='P0001',message='CHECKOUT_ORDER_NOT_FOUND'; end if;
  for v_retry in 1..3 loop
    begin
      -- Existing attempts always lock before the order, matching the callback.
      select * into v_attempt from public.payment_attempts where merchant_payment_id=p_reference for update;
      select * into v_order from public.orders where id=v_order_id and reference=p_reference
        and order_access_hash=p_order_access_hash for update;
      if not found then raise exception using errcode='P0001',message='CHECKOUT_ORDER_NOT_FOUND'; end if;
      if v_attempt.id is null and exists(select 1 from public.payment_attempts where merchant_payment_id=p_reference) then
        -- A first checkout committed while we waited. Release this iteration's
        -- order lock via the savepoint, then retry with the attempt locked first.
        raise exception using errcode='PZ001',message='RETRY_CHECKOUT_LOCK_ORDER';
      end if;
      if (p_mode='sandbox' and (v_order.school_id<>'edabcd03-1854-43ca-ac93-45c71e9ef012'::uuid
        or v_order.reference not like 'DEMO-BB-%' or v_order.idempotency_key not like 'sandbox:%'
        or lower(v_order.parent_email)<>'technical@awaldstudio.com'))
        or (p_mode='live' and (v_order.reference like 'DEMO-%' or v_order.idempotency_key like 'sandbox:%')) then
        raise exception using errcode='P0001',message='CHECKOUT_ENVIRONMENT_DENIED';
      end if;
      if v_order.status='paid' then raise exception using errcode='P0001',message='CHECKOUT_ALREADY_PAID'; end if;
      if v_order.status not in ('pending_payment','payment_failed') then
        raise exception using errcode='P0001',message='CHECKOUT_ORDER_NOT_PAYABLE';
      end if;
      if v_attempt.id is not null and (v_attempt.order_id<>v_order.id or v_attempt.amount_cents<>v_order.amount_cents
        or v_attempt.checkout_payload->>'mode' is distinct from p_mode or v_attempt.status in ('complete','refunded')) then
        raise exception using errcode='P0001',message='CHECKOUT_PAYMENT_REVIEW_REQUIRED';
      end if;
      if v_attempt.id is null then
        insert into public.payment_attempts(order_id,merchant_payment_id,amount_cents,status,checkout_payload)
        values(v_order.id,v_order.reference,v_order.amount_cents,'pending',
          jsonb_build_object('mode',p_mode,'amount',to_char(v_order.amount_cents::numeric/100,'FM9999999990.00'),'created_at',now()))
        returning * into v_attempt;
      end if;
      select count(*) into v_count from public.learners where order_id=v_order.id;
      return jsonb_build_object('id',v_order.id,'reference',v_order.reference,'status',v_order.status,
        'school_id',v_order.school_id,'idempotency_key',v_order.idempotency_key,'amount_cents',v_order.amount_cents,
        'parent_first_name',v_order.parent_first_name,'parent_last_name',v_order.parent_last_name,
        'parent_email',v_order.parent_email,'parent_mobile',v_order.parent_mobile,'learner_count',v_count,
        'payment_attempt_id',v_attempt.id);
    exception when sqlstate 'PZ001' or unique_violation then
      null; -- Savepoint rollback releases this iteration's locks before retry.
    end;
  end loop;
  raise exception using errcode='P0001',message='CHECKOUT_LOCK_RETRY';
end;
$$;
revoke all on function public.prepare_payfast_checkout(text,text,text) from public,anon,authenticated;
grant execute on function public.prepare_payfast_checkout(text,text,text) to service_role;

-- Completed receipts are terminal except for the separate audited refund action.
-- Also protects in-flight requests from the previous checkout deployment.
create or replace function public.keep_complete_attempt_terminal()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.status='complete' and new.status<>'refunded' then
    new.status:='complete';new.provider_payment_id:=old.provider_payment_id;
  end if;
  return new;
end;
$$;
create trigger complete_attempt_stays_terminal before update of status,provider_payment_id on public.payment_attempts
for each row execute function public.keep_complete_attempt_terminal();
revoke all on function public.keep_complete_attempt_terminal() from public,anon,authenticated;

create or replace function public.process_payfast_notification(
  p_payment_attempt_id uuid,p_event_key text,p_provider_payment_id text,p_payment_status text,
  p_verification_state text,p_rejection_reason text,p_raw_payload jsonb,p_staff_recipients text[] default '{}'::text[]
) returns table(inserted boolean,order_status text)
language plpgsql security invoker set search_path='' as $$
declare
  v_order_id uuid;v_parent_email text;v_event_id uuid;v_provider_status text:=upper(coalesce(p_payment_status,''));
  v_result_status text;v_order_changed uuid;v_attempt_status text;v_original_provider_id text;
begin
  if p_verification_state not in ('verified','rejected') then raise exception 'Invalid verification state'; end if;
  select pa.order_id,o.parent_email,pa.status,pa.provider_payment_id
    into v_order_id,v_parent_email,v_attempt_status,v_original_provider_id
    from public.payment_attempts pa join public.orders o on o.id=pa.order_id
    where pa.id=p_payment_attempt_id for update of pa,o;
  if v_order_id is null then raise exception 'Payment attempt not found'; end if;
  insert into public.payment_events(payment_attempt_id,event_key,provider_payment_id,payment_status,
    verification_state,rejection_reason,raw_payload,processed_at)
  values(p_payment_attempt_id,p_event_key,nullif(p_provider_payment_id,''),nullif(p_payment_status,''),
    p_verification_state,nullif(p_rejection_reason,''),coalesce(p_raw_payload,'{}'::jsonb),
    case when p_verification_state='verified' then now() else null end)
  on conflict(event_key) do nothing returning id into v_event_id;
  if v_event_id is null then
    select status into v_result_status from public.orders where id=v_order_id;
    return query select false,v_result_status;return;
  end if;
  if p_verification_state='verified' and v_provider_status='COMPLETE' then
    if v_attempt_status in ('complete','refunded') and v_original_provider_id is not null
      and v_original_provider_id is distinct from nullif(p_provider_payment_id,'') then
      -- Retain evidence of a possible duplicate charge without replacing the
      -- first receipt, reopening a refund or requeuing a paid confirmation.
      insert into public.audit_events(action,entity_type,entity_id,details)
      values('duplicate_payfast_payment_requires_review','order',v_order_id,
        jsonb_build_object('payment_attempt_id',p_payment_attempt_id,'payment_event_id',v_event_id,
          'original_provider_payment_id',v_original_provider_id,'additional_provider_payment_id',p_provider_payment_id,
          'order_reference',p_raw_payload->>'m_payment_id','money_moved',false));
    else
      update public.payment_attempts set status='complete',provider_payment_id=nullif(p_provider_payment_id,'')
        where id=p_payment_attempt_id and status not in ('complete','refunded');
      update public.orders set status='paid',paid_at=now() where id=v_order_id and status not in ('paid','refunded')
        returning id into v_order_changed;
      if v_order_changed is not null then
        insert into public.notification_jobs(order_id,kind,recipient) values(v_order_id,'parent_order_paid',v_parent_email);
        insert into public.notification_jobs(order_id,kind,recipient)
          select v_order_id,'staff_order_paid',recipient from unnest(coalesce(p_staff_recipients,'{}'::text[])) recipient where recipient<>'';
      end if;
    end if;
  elsif p_verification_state='verified' and v_provider_status in ('FAILED','CANCELLED') then
    update public.payment_attempts set status=case when v_provider_status='CANCELLED' then 'cancelled' else 'failed' end
      where id=p_payment_attempt_id and status not in ('complete','refunded');
    update public.orders set status=case when v_provider_status='CANCELLED' then 'cancelled' else 'payment_failed' end
      where id=v_order_id and status not in ('paid','refunded');
  end if;
  select status into v_result_status from public.orders where id=v_order_id;
  return query select true,v_result_status;
end;
$$;
revoke all on function public.process_payfast_notification(uuid,text,text,text,text,text,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.process_payfast_notification(uuid,text,text,text,text,text,jsonb,text[]) to service_role;
