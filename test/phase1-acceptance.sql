begin;

insert into public.schools (id, slug, name)
values ('11111111-1111-4111-8111-111111111111', 'acceptance-school', 'Acceptance School');

insert into public.ordering_periods (
  id, school_id, academic_year_id, name, opens_at, closes_at, status, class_required
) values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  '92cd8cf0-5a03-4a48-934a-3d27d1377b9a',
  'Acceptance period', now() - interval '1 day', now() + interval '30 days', 'open', false
);

insert into public.school_access (
  school_id, ordering_period_id, token_hash
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  repeat('a', 64)
);

insert into public.school_grade_offerings (
  id, school_id, ordering_period_id, grade_id, book_id, price_cents, expected_quantity
)
select
  values_to_insert.id,
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  b.grade_id,
  b.id,
  values_to_insert.price_cents,
  values_to_insert.expected_quantity
from (
  values
    ('33333333-3333-4333-8333-333333333333'::uuid, '815', 32000, 90),
    ('44444444-4444-4444-8444-444444444444'::uuid, '825', 34000, 75)
) as values_to_insert(id, sku, price_cents, expected_quantity)
join public.books b on b.sku = values_to_insert.sku;

do $$
declare
  result jsonb;
  created_order uuid;
  learner_count integer;
  item_total integer;
  payment_attempt_id uuid;
  event_inserted boolean;
  paid_status text;
  notification_count integer;
begin
  select public.create_school_order(
    repeat('a', 64),
    '550e8400-e29b-41d4-a716-446655440000',
    repeat('b', 64),
    '{"first_name":"Annelie","last_name":"Jacobs","email":"annelie@example.com","mobile":"0825550123"}'::jsonb,
    '[
      {"first_name":"Mia","last_name":"Jacobs","offering_id":"33333333-3333-4333-8333-333333333333","class_name":"3A"},
      {"first_name":"Liam","last_name":"Jacobs","offering_id":"44444444-4444-4444-8444-444444444444","class_name":"5B"}
    ]'::jsonb
  ) into result;

  if (result->>'amount_cents')::integer <> 66000 then
    raise exception 'Server total was %, expected 66000', result->>'amount_cents';
  end if;

  created_order := (result->>'id')::uuid;
  select count(*) into learner_count from public.learners where order_id = created_order;
  select sum(line_total_cents) into item_total from public.order_items where order_id = created_order;
  if learner_count <> 2 or item_total <> 66000 then
    raise exception 'Order children/items mismatch: learners %, total %', learner_count, item_total;
  end if;

  insert into public.payment_attempts (order_id, merchant_payment_id, amount_cents, status)
  values (created_order, result->>'reference', 66000, 'pending')
  returning id into payment_attempt_id;

  select inserted, order_status into event_inserted, paid_status
  from public.process_payfast_notification(
    payment_attempt_id,
    repeat('c', 64),
    'pf-acceptance-1',
    'COMPLETE',
    'verified',
    '',
    '{"payment_status":"COMPLETE"}'::jsonb,
    array['staff@example.com']
  );

  select count(*) into notification_count
  from public.notification_jobs
  where order_id = created_order;

  if not event_inserted or paid_status <> 'paid' or notification_count <> 2 then
    raise exception 'Atomic payment processing failed: inserted %, status %, notifications %',
      event_inserted, paid_status, notification_count;
  end if;

  select inserted into event_inserted
  from public.process_payfast_notification(
    payment_attempt_id,
    repeat('c', 64),
    'pf-acceptance-1',
    'COMPLETE',
    'verified',
    '',
    '{"payment_status":"COMPLETE"}'::jsonb,
    array['staff@example.com']
  );

  select count(*) into notification_count
  from public.notification_jobs
  where order_id = created_order;

  if event_inserted or notification_count <> 2 then
    raise exception 'Duplicate PayFast event was not idempotent';
  end if;

  if has_function_privilege('anon', 'public.create_school_order(text,text,text,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_school_order(text,text,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'Public roles must not execute create_school_order';
  end if;

  if has_function_privilege('anon', 'public.process_payfast_notification(uuid,text,text,text,text,text,jsonb,text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.process_payfast_notification(uuid,text,text,text,text,text,jsonb,text[])', 'EXECUTE') then
    raise exception 'Public roles must not execute process_payfast_notification';
  end if;

  if has_table_privilege('anon', 'public.orders', 'SELECT')
     or has_table_privilege('authenticated', 'public.orders', 'SELECT') then
    raise exception 'Public roles must not read orders';
  end if;
end;
$$;

rollback;
