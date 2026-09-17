create or replace function public.process_payfast_notification(
  p_payment_attempt_id uuid,
  p_event_key text,
  p_provider_payment_id text,
  p_payment_status text,
  p_verification_state text,
  p_rejection_reason text,
  p_raw_payload jsonb,
  p_staff_recipients text[] default '{}'::text[]
)
returns table (inserted boolean, order_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_parent_email text;
  v_event_id uuid;
  v_provider_status text := upper(coalesce(p_payment_status, ''));
  v_result_status text;
  v_order_changed uuid;
begin
  if p_verification_state not in ('verified', 'rejected') then
    raise exception 'Invalid verification state';
  end if;

  select pa.order_id, o.parent_email
    into v_order_id, v_parent_email
  from public.payment_attempts pa
  join public.orders o on o.id = pa.order_id
  where pa.id = p_payment_attempt_id
  for update of pa, o;

  if v_order_id is null then
    raise exception 'Payment attempt not found';
  end if;

  insert into public.payment_events (
    payment_attempt_id,
    event_key,
    provider_payment_id,
    payment_status,
    verification_state,
    rejection_reason,
    raw_payload,
    processed_at
  ) values (
    p_payment_attempt_id,
    p_event_key,
    nullif(p_provider_payment_id, ''),
    nullif(p_payment_status, ''),
    p_verification_state,
    nullif(p_rejection_reason, ''),
    coalesce(p_raw_payload, '{}'::jsonb),
    case when p_verification_state = 'verified' then now() else null end
  )
  on conflict (event_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select status into v_result_status from public.orders where id = v_order_id;
    return query select false, v_result_status;
    return;
  end if;

  if p_verification_state = 'verified' and v_provider_status = 'COMPLETE' then
    update public.payment_attempts
      set status = 'complete', provider_payment_id = nullif(p_provider_payment_id, '')
      where id = p_payment_attempt_id;

    update public.orders
      set status = 'paid', paid_at = now()
      where id = v_order_id
        and status not in ('paid', 'refunded')
      returning id into v_order_changed;

    if v_order_changed is not null then
      insert into public.notification_jobs (order_id, kind, recipient)
      values (v_order_id, 'parent_order_paid', v_parent_email);

      insert into public.notification_jobs (order_id, kind, recipient)
      select v_order_id, 'staff_order_paid', recipient
      from unnest(coalesce(p_staff_recipients, '{}'::text[])) as recipient
      where recipient <> '';
    end if;
  elsif p_verification_state = 'verified' and v_provider_status in ('FAILED', 'CANCELLED') then
    update public.payment_attempts
      set status = case when v_provider_status = 'CANCELLED' then 'cancelled' else 'failed' end
      where id = p_payment_attempt_id;

    update public.orders
      set status = case when v_provider_status = 'CANCELLED' then 'cancelled' else 'payment_failed' end
      where id = v_order_id
        and status <> 'paid';
  end if;

  select status into v_result_status from public.orders where id = v_order_id;
  return query select true, v_result_status;
end;
$$;

revoke all on function public.process_payfast_notification(uuid, text, text, text, text, text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.process_payfast_notification(uuid, text, text, text, text, text, jsonb, text[]) to service_role;
