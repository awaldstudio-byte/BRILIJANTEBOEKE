-- Test records use the established DEMO classification, excluded from live
-- financial totals. This atomic wrapper never marks an order paid.
create or replace function public.create_sandbox_school_order(
  p_token_hash text, p_idempotency_key text, p_order_access_hash text, p_parent jsonb, p_learners jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order jsonb; v_reference text;
begin
  if p_idempotency_key not like 'sandbox:%' or
     lower(coalesce(p_parent->>'email','')) <> 'technical@awaldstudio.com' or
     not exists (select 1 from public.school_access a where a.token_hash=p_token_hash
       and a.school_id='edabcd03-1854-43ca-ac93-45c71e9ef012'::uuid and a.revoked_at is null) then
    raise exception 'SANDBOX_ORDER_DENIED';
  end if;
  v_order := public.create_school_order(p_token_hash,p_idempotency_key,p_order_access_hash,p_parent,p_learners);
  select reference into v_reference from public.orders where id=(v_order->>'id')::uuid
    and school_id='edabcd03-1854-43ca-ac93-45c71e9ef012'::uuid and idempotency_key=p_idempotency_key
    and order_access_hash=p_order_access_hash for update;
  if v_reference is null then raise exception 'SANDBOX_ORDER_DENIED'; end if;
  if v_reference not like 'DEMO-BB-%' then
    v_reference := 'DEMO-' || v_reference;
    update public.orders set reference=v_reference where id=(v_order->>'id')::uuid and status='pending_payment';
    if not found then raise exception 'SANDBOX_ORDER_DENIED'; end if;
  end if;
  return jsonb_set(v_order,'{reference}',to_jsonb(v_reference));
end;
$$;
revoke all on function public.create_sandbox_school_order(text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_sandbox_school_order(text,text,text,jsonb,jsonb) to service_role;
