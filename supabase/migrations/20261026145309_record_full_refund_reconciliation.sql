-- Records a full refund ALREADY completed in PayFast. This never calls a payment
-- provider, moves money, sends mail or accepts partial/post-fulfilment refunds.
create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  payment_attempt_id uuid not null unique references public.payment_attempts(id) on delete restrict,
  provider_mode text not null check (provider_mode in ('sandbox','live')),
  provider_payment_id text not null check (char_length(provider_payment_id) between 1 and 100),
  provider_refund_reference text not null check (char_length(provider_refund_reference) between 2 and 100),
  amount_cents integer not null check (amount_cents > 0),
  refunded_at timestamptz not null,
  reason text not null check (char_length(reason) between 5 and 500),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique(provider_mode,provider_refund_reference)
);
alter table public.order_refunds enable row level security;
revoke all on public.order_refunds from public,anon,authenticated,service_role;
grant select,insert on public.order_refunds to service_role;

create or replace function public.record_completed_full_refund(
  p_order_id uuid,p_provider_payment_id text,p_provider_refund_reference text,
  p_amount_cents integer,p_refunded_at timestamptz,p_reason text,p_actor uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_period uuid; v_order public.orders; v_attempt public.payment_attempts;
  v_refund public.order_refunds; v_mode text; v_attempt_count integer;
begin
  if not exists(select 1 from public.staff_access_approvals
    where auth_user_id=p_actor and active and role='administrator' and password_set_at is not null) then
    raise exception using errcode='P0001',message='REFUND_ADMIN_REQUIRED';
  end if;
  if p_provider_payment_id is null or p_provider_refund_reference is null or p_reason is null
    or char_length(trim(p_provider_payment_id)) not between 1 and 100
    or char_length(trim(p_provider_refund_reference)) not between 2 and 100
    or char_length(trim(p_reason)) not between 5 and 500
    or (p_provider_payment_id||p_provider_refund_reference||p_reason) ~ '[[:cntrl:]]'
    or p_amount_cents is null or p_amount_cents<=0 then
    raise exception using errcode='P0001',message='REFUND_DETAILS_INVALID';
  end if;
  p_provider_payment_id:=trim(p_provider_payment_id);
  p_provider_refund_reference:=trim(p_provider_refund_reference);
  p_reason:=trim(p_reason);
  if p_refunded_at is null or not isfinite(p_refunded_at) or p_refunded_at>now() then
    raise exception using errcode='P0001',message='REFUND_DATE_INVALID';
  end if;

  select ordering_period_id into v_period from public.orders where id=p_order_id;
  if not found then raise exception using errcode='P0001',message='REFUND_ORDER_NOT_FOUND'; end if;
  -- create_fulfilment_batch takes the same period lock: allocation and refunds
  -- cannot both observe this order as available/paid in concurrent requests.
  perform 1 from public.ordering_periods where id=v_period for update;
  -- Match the payment callback's payment-attempt/order locking order.
  perform pa.id from public.payment_attempts pa join public.orders o on o.id=pa.order_id
    where o.id=p_order_id order by pa.id for update of pa,o;
  select * into strict v_order from public.orders where id=p_order_id for update;
  select * into v_refund from public.order_refunds where order_id=p_order_id;
  if found then
    if v_order.status='refunded' and v_refund.provider_payment_id=p_provider_payment_id
      and v_refund.provider_refund_reference=p_provider_refund_reference and v_refund.amount_cents=p_amount_cents
      and v_refund.refunded_at=p_refunded_at and v_refund.reason=p_reason then
      return to_jsonb(v_refund)||jsonb_build_object('reused',true,'order_status','refunded');
    end if;
    raise exception using errcode='P0001',message='REFUND_ALREADY_RECORDED';
  end if;
  if v_order.status<>'paid' or v_order.paid_at is null then
    raise exception using errcode='P0001',message='REFUND_NOT_PAID';
  end if;
  select count(*) into v_attempt_count from public.payment_attempts
    where order_id=p_order_id and status='complete';
  select * into v_attempt from public.payment_attempts
    where order_id=p_order_id and provider='payfast' and provider_payment_id=p_provider_payment_id and status='complete';
  v_mode:=v_attempt.checkout_payload->>'mode';
  if v_attempt.id is null or v_attempt_count<>1 or v_mode not in ('sandbox','live') or v_mode is null
    or p_amount_cents<>v_order.amount_cents or p_amount_cents<>v_attempt.amount_cents
    or not exists(select 1 from public.payment_events where payment_attempt_id=v_attempt.id
      and provider_payment_id=p_provider_payment_id and verification_state='verified' and upper(payment_status)='COMPLETE') then
    raise exception using errcode='P0001',message='REFUND_PAYMENT_MISMATCH';
  end if;
  if p_refunded_at<v_order.paid_at then
    raise exception using errcode='P0001',message='REFUND_DATE_INVALID';
  end if;
  if exists(select 1 from public.fulfilment_batch_items bi
    join public.order_items oi on oi.id=bi.order_item_id
    join public.fulfilment_batches b on b.id=bi.batch_id
    where oi.order_id=p_order_id and (b.status<>'cancelled' or b.dispatched_at is not null or b.delivered_at is not null)) then
    raise exception using errcode='P0001',message='REFUND_BATCH_REVIEW_REQUIRED';
  end if;
  perform id from public.notification_jobs where order_id=p_order_id order by id for update;
  if exists(select 1 from public.notification_jobs where order_id=p_order_id and status='processing') then
    raise exception using errcode='P0001',message='REFUND_MAIL_IN_PROGRESS';
  end if;
  begin
    insert into public.order_refunds(order_id,payment_attempt_id,provider_mode,provider_payment_id,
      provider_refund_reference,amount_cents,refunded_at,reason,recorded_by)
    values(p_order_id,v_attempt.id,v_mode,p_provider_payment_id,p_provider_refund_reference,
      p_amount_cents,p_refunded_at,p_reason,p_actor) returning * into v_refund;
  exception when unique_violation then
    raise exception using errcode='P0001',message='REFUND_ALREADY_RECORDED';
  end;
  update public.orders set status='refunded' where id=p_order_id;
  update public.payment_attempts set status='refunded' where id=v_attempt.id;
  update public.notification_jobs set status='failed',last_error='ORDER_REFUNDED_NO_SEND'
    where order_id=p_order_id and status='queued';
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,details)
  values(p_actor,'order_full_refund_recorded','order',p_order_id,
    jsonb_build_object('refund_id',v_refund.id,'provider_mode',v_mode,'provider_payment_id',p_provider_payment_id,
      'provider_refund_reference',p_provider_refund_reference,'amount_cents',p_amount_cents,
      'refunded_at',p_refunded_at,'reason',p_reason,'money_moved',false));
  return to_jsonb(v_refund)||jsonb_build_object('reused',false,'order_status','refunded');
end;
$$;
revoke all on function public.record_completed_full_refund(uuid,text,text,integer,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.record_completed_full_refund(uuid,text,text,integer,timestamptz,text,uuid) to service_role;

-- Late or repeated provider callbacks must not reopen a completed full refund.
-- Preserve the terminal status without rejecting the callback acknowledgement.
create or replace function public.keep_refunded_order_terminal()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.status='refunded' then new.status:='refunded'; end if;
  return new;
end;
$$;
create trigger refunded_order_stays_terminal before update of status on public.orders
for each row execute function public.keep_refunded_order_terminal();
create or replace function public.keep_refunded_attempt_terminal()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.status='refunded' then
    new.status:='refunded'; new.provider_payment_id:=old.provider_payment_id;
  end if;
  return new;
end;
$$;
create trigger refunded_attempt_stays_terminal before update of status,provider_payment_id on public.payment_attempts
for each row execute function public.keep_refunded_attempt_terminal();
revoke all on function public.keep_refunded_order_terminal() from public,anon,authenticated;
revoke all on function public.keep_refunded_attempt_terminal() from public,anon,authenticated;
