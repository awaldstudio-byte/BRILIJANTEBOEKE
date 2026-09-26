alter table public.orders
  add column if not exists consent_version text,
  add column if not exists consent_accepted_at timestamptz;

create or replace function public.create_school_order(
  p_token_hash text,
  p_idempotency_key text,
  p_order_access_hash text,
  p_parent jsonb,
  p_learners jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access record;
  v_existing record;
  v_order_id uuid := gen_random_uuid();
  v_reference text := 'BB-' || to_char(now(), 'YY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_learner jsonb;
  v_offering record;
  v_learner_id uuid;
  v_total integer := 0;
  v_count integer;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_order_access_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_ACCESS_TOKEN';
  end if;
  if char_length(p_idempotency_key) < 16 or char_length(p_idempotency_key) > 100 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST_ID';
  end if;
  if jsonb_typeof(p_learners) <> 'array' then
    raise exception using errcode = 'P0001', message = 'LEARNERS_REQUIRED';
  end if;
  v_count := jsonb_array_length(p_learners);
  if v_count < 1 or v_count > 10 then
    raise exception using errcode = 'P0001', message = 'LEARNER_COUNT_INVALID';
  end if;

  select sa.school_id, sa.ordering_period_id, op.class_required
  into v_access
  from public.school_access sa
  join public.ordering_periods op on op.id = sa.ordering_period_id
  join public.schools s on s.id = sa.school_id
  where sa.token_hash = p_token_hash and sa.revoked_at is null
    and (sa.expires_at is null or sa.expires_at > now())
    and s.status = 'active' and op.school_id = sa.school_id and op.status = 'open'
    and op.opens_at <= now() and op.closes_at > now()
  for update of sa;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDERING_UNAVAILABLE';
  end if;

  select id, reference, amount_cents, status into v_existing
  from public.orders
  where school_id = v_access.school_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', v_existing.id, 'reference', v_existing.reference, 'amount_cents', v_existing.amount_cents, 'status', v_existing.status, 'reused', true);
  end if;

  if char_length(trim(coalesce(p_parent->>'first_name', ''))) not between 2 and 100
     or char_length(trim(coalesce(p_parent->>'last_name', ''))) not between 2 and 100
     or char_length(trim(coalesce(p_parent->>'email', ''))) not between 5 and 254
     or char_length(trim(coalesce(p_parent->>'mobile', ''))) not between 7 and 30 then
    raise exception using errcode = 'P0001', message = 'PARENT_DETAILS_INVALID';
  end if;
  if coalesce(p_parent->'consent'->>'accepted', '') <> 'true'
     or char_length(trim(coalesce(p_parent->'consent'->>'policy_version', ''))) not between 8 and 64 then
    raise exception using errcode = 'P0001', message = 'CONSENT_REQUIRED';
  end if;

  insert into public.orders (
    id, reference, school_id, ordering_period_id, idempotency_key, order_access_hash,
    parent_first_name, parent_last_name, parent_email, parent_mobile,
    consent_version, consent_accepted_at
  ) values (
    v_order_id, v_reference, v_access.school_id, v_access.ordering_period_id,
    p_idempotency_key, p_order_access_hash,
    trim(p_parent->>'first_name'), trim(p_parent->>'last_name'),
    lower(trim(p_parent->>'email')), trim(p_parent->>'mobile'),
    trim(p_parent->'consent'->>'policy_version'), now()
  );

  for v_learner in select value from jsonb_array_elements(p_learners)
  loop
    if char_length(trim(coalesce(v_learner->>'first_name', ''))) not between 2 and 100
       or char_length(trim(coalesce(v_learner->>'last_name', ''))) not between 2 and 100 then
      raise exception using errcode = 'P0001', message = 'LEARNER_DETAILS_INVALID';
    end if;
    if v_access.class_required and char_length(trim(coalesce(v_learner->>'class_name', ''))) < 1 then
      raise exception using errcode = 'P0001', message = 'CLASS_REQUIRED';
    end if;

    select sgo.id, sgo.grade_id, sgo.price_cents, g.name as grade_name, b.title as book_title
    into v_offering
    from public.school_grade_offerings sgo
    join public.grades g on g.id = sgo.grade_id
    join public.books b on b.id = sgo.book_id
    where sgo.id = (v_learner->>'offering_id')::uuid
      and sgo.school_id = v_access.school_id and sgo.ordering_period_id = v_access.ordering_period_id
      and sgo.active = true and b.active = true;
    if not found then
      raise exception using errcode = 'P0001', message = 'BOOK_NOT_AVAILABLE';
    end if;

    insert into public.learners (order_id, first_name, last_name, grade_id, class_name)
    values (v_order_id, trim(v_learner->>'first_name'), trim(v_learner->>'last_name'), v_offering.grade_id, nullif(trim(coalesce(v_learner->>'class_name', '')), ''))
    returning id into v_learner_id;
    insert into public.order_items (order_id, learner_id, offering_id, description_snapshot, unit_price_cents, quantity, line_total_cents)
    values (v_order_id, v_learner_id, v_offering.id, v_offering.book_title || ' - ' || v_offering.grade_name, v_offering.price_cents, 1, v_offering.price_cents);
    v_total := v_total + v_offering.price_cents;
  end loop;

  update public.orders set amount_cents = v_total where id = v_order_id;
  update public.school_access set last_used_at = now() where token_hash = p_token_hash;
  return jsonb_build_object('id', v_order_id, 'reference', v_reference, 'amount_cents', v_total, 'status', 'pending_payment', 'reused', false);
end;
$$;

revoke all on function public.create_school_order(text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_school_order(text, text, text, jsonb, jsonb) to service_role;
