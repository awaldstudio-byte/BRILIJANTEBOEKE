-- A fulfilment batch is always for one school and one ordering period.
-- Creating a batch takes a fixed snapshot of paid, unallocated items; later
-- payments remain available for the next batch.

insert into public.grades (id, code, name, sort_order)
values
  ('b748a5f4-b1d8-4f85-8bb8-2c157da1b8e1', '1', 'Graad 1', 1),
  ('f8a60f45-23e4-4fdc-8a2d-bf30cba2b1f6', '2', 'Graad 2', 2)
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into public.books (grade_id, sku, title, default_price_cents, cover_path, active)
values
  ('b748a5f4-b1d8-4f85-8bb8-2c157da1b8e1', 'GRADE-1-PENDING', 'Graad 1 Werkboek', 0, null, false),
  ('f8a60f45-23e4-4fdc-8a2d-bf30cba2b1f6', 'GRADE-2-PENDING', 'Graad 2 Werkboek', 0, null, false)
on conflict (sku) do nothing;

update public.ordering_periods set class_required = false where class_required = true;

create table public.fulfilment_batches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  ordering_period_id uuid not null references public.ordering_periods(id) on delete restrict,
  label text not null check (char_length(label) between 2 and 160),
  status text not null default 'created' check (status in ('created', 'packing', 'ready', 'dispatched', 'delivered', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fulfilment_batch_period_matches_school check (school_id is not null and ordering_period_id is not null)
);

create table public.fulfilment_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fulfilment_batches(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  grade_id uuid not null references public.grades(id) on delete restrict,
  book_title text not null,
  learner_first_name text not null,
  learner_last_name text not null,
  order_reference text not null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (batch_id, order_item_id)
);

create index fulfilment_batches_school_period_idx on public.fulfilment_batches (school_id, ordering_period_id, created_at desc);
create index fulfilment_batch_items_batch_idx on public.fulfilment_batch_items (batch_id, grade_id);
create index fulfilment_batch_items_order_item_idx on public.fulfilment_batch_items (order_item_id);

create trigger fulfilment_batches_set_updated_at before update on public.fulfilment_batches
for each row execute function public.set_updated_at();

create or replace function public.create_fulfilment_batch(
  p_school_id uuid,
  p_ordering_period_id uuid,
  p_label text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.fulfilment_batches;
  v_item_count integer;
begin
  if not exists (
    select 1 from public.ordering_periods
    where id = p_ordering_period_id and school_id = p_school_id
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_SCHOOL_PERIOD';
  end if;

  insert into public.fulfilment_batches (school_id, ordering_period_id, label, created_by)
  values (p_school_id, p_ordering_period_id, trim(p_label), p_created_by)
  returning * into v_batch;

  insert into public.fulfilment_batch_items (
    batch_id, order_item_id, grade_id, book_title, learner_first_name,
    learner_last_name, order_reference, quantity
  )
  select
    v_batch.id, oi.id, l.grade_id, oi.description_snapshot, l.first_name,
    l.last_name, o.reference, oi.quantity
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.learners l on l.id = oi.learner_id
  where o.school_id = p_school_id
    and o.ordering_period_id = p_ordering_period_id
    and o.status = 'paid'
    and not exists (
      select 1
      from public.fulfilment_batch_items fbi
      join public.fulfilment_batches fb on fb.id = fbi.batch_id
      where fbi.order_item_id = oi.id and fb.status <> 'cancelled'
    );

  get diagnostics v_item_count = row_count;
  if v_item_count = 0 then
    delete from public.fulfilment_batches where id = v_batch.id;
    raise exception using errcode = 'P0001', message = 'NO_PAID_ITEMS_AVAILABLE';
  end if;

  return jsonb_build_object('id', v_batch.id, 'item_count', v_item_count, 'status', v_batch.status);
end;
$$;

alter table public.fulfilment_batches enable row level security;
alter table public.fulfilment_batch_items enable row level security;
revoke all on table public.fulfilment_batches, public.fulfilment_batch_items from anon, authenticated;
grant select, insert, update, delete on table public.fulfilment_batches, public.fulfilment_batch_items to service_role;
revoke all on function public.create_fulfilment_batch(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_fulfilment_batch(uuid, uuid, text, uuid) to service_role;
