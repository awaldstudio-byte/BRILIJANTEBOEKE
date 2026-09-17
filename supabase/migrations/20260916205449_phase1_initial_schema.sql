create extension if not exists pgcrypto with schema extensions;

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  year integer not null unique check (year between 2026 and 2100),
  label text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 160),
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  contact_name text,
  contact_email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.grades (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null unique,
  created_at timestamptz not null default now()
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  grade_id uuid not null references public.grades(id) on delete restrict,
  sku text not null unique,
  title text not null,
  default_price_cents integer not null check (default_price_cents >= 0),
  cover_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ordering_periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  name text not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'archived')),
  class_required boolean not null default false,
  delivery_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ordering_period_dates_valid check (closes_at > opens_at),
  unique (school_id, academic_year_id, name)
);

create table public.school_grade_offerings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  ordering_period_id uuid not null references public.ordering_periods(id) on delete cascade,
  grade_id uuid not null references public.grades(id) on delete restrict,
  book_id uuid not null references public.books(id) on delete restrict,
  price_cents integer not null check (price_cents >= 0),
  expected_quantity integer not null default 0 check (expected_quantity >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ordering_period_id, grade_id),
  unique (id, school_id, ordering_period_id)
);

create table public.school_access (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  ordering_period_id uuid not null references public.ordering_periods(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  label text not null default 'Parent order link',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  school_id uuid not null references public.schools(id) on delete restrict,
  ordering_period_id uuid not null references public.ordering_periods(id) on delete restrict,
  idempotency_key text not null,
  order_access_hash text not null check (order_access_hash ~ '^[a-f0-9]{64}$'),
  parent_first_name text not null,
  parent_last_name text not null,
  parent_email text not null,
  parent_mobile text not null,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'cancelled', 'payment_failed', 'refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, idempotency_key)
);

create table public.learners (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  grade_id uuid not null references public.grades(id) on delete restrict,
  class_name text,
  created_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  learner_id uuid not null references public.learners(id) on delete cascade,
  offering_id uuid not null references public.school_grade_offerings(id) on delete restrict,
  description_snapshot text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null default 1 check (quantity > 0),
  line_total_cents integer not null check (line_total_cents >= 0),
  created_at timestamptz not null default now()
);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null default 'payfast' check (provider = 'payfast'),
  merchant_payment_id text not null unique,
  provider_payment_id text unique,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'created' check (status in ('created', 'pending', 'complete', 'failed', 'cancelled', 'refunded')),
  checkout_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid references public.payment_attempts(id) on delete set null,
  event_key text not null unique,
  provider text not null default 'payfast' check (provider = 'payfast'),
  provider_payment_id text,
  payment_status text,
  verification_state text not null check (verification_state in ('verified', 'rejected')),
  rejection_reason text,
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.staff_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'administrator' check (role in ('administrator', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  kind text not null check (kind in ('parent_order_paid', 'staff_order_paid')),
  recipient text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ordering_periods_school_year_idx on public.ordering_periods (school_id, academic_year_id);
create index offerings_period_active_idx on public.school_grade_offerings (ordering_period_id, active);
create index orders_school_period_status_idx on public.orders (school_id, ordering_period_id, status);
create index orders_created_at_idx on public.orders (created_at desc);
create index learners_order_grade_idx on public.learners (order_id, grade_id);
create index payment_attempts_order_idx on public.payment_attempts (order_id, created_at desc);
create index payment_events_attempt_idx on public.payment_events (payment_attempt_id, received_at desc);
create index notification_jobs_due_idx on public.notification_jobs (status, next_attempt_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger academic_years_set_updated_at before update on public.academic_years
for each row execute function public.set_updated_at();
create trigger schools_set_updated_at before update on public.schools
for each row execute function public.set_updated_at();
create trigger books_set_updated_at before update on public.books
for each row execute function public.set_updated_at();
create trigger ordering_periods_set_updated_at before update on public.ordering_periods
for each row execute function public.set_updated_at();
create trigger offerings_set_updated_at before update on public.school_grade_offerings
for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();
create trigger payment_attempts_set_updated_at before update on public.payment_attempts
for each row execute function public.set_updated_at();
create trigger staff_users_set_updated_at before update on public.staff_users
for each row execute function public.set_updated_at();
create trigger notification_jobs_set_updated_at before update on public.notification_jobs
for each row execute function public.set_updated_at();

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

  select
    sa.school_id,
    sa.ordering_period_id,
    op.class_required
  into v_access
  from public.school_access sa
  join public.ordering_periods op on op.id = sa.ordering_period_id
  join public.schools s on s.id = sa.school_id
  where sa.token_hash = p_token_hash
    and sa.revoked_at is null
    and (sa.expires_at is null or sa.expires_at > now())
    and s.status = 'active'
    and op.school_id = sa.school_id
    and op.status = 'open'
    and op.opens_at <= now()
    and op.closes_at > now()
  for update of sa;

  if not found then
    raise exception using errcode = 'P0001', message = 'ORDERING_UNAVAILABLE';
  end if;

  select id, reference, amount_cents, status
  into v_existing
  from public.orders
  where school_id = v_access.school_id and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'id', v_existing.id,
      'reference', v_existing.reference,
      'amount_cents', v_existing.amount_cents,
      'status', v_existing.status,
      'reused', true
    );
  end if;

  if char_length(trim(coalesce(p_parent->>'first_name', ''))) not between 2 and 100
     or char_length(trim(coalesce(p_parent->>'last_name', ''))) not between 2 and 100
     or char_length(trim(coalesce(p_parent->>'email', ''))) not between 5 and 254
     or char_length(trim(coalesce(p_parent->>'mobile', ''))) not between 7 and 30 then
    raise exception using errcode = 'P0001', message = 'PARENT_DETAILS_INVALID';
  end if;

  insert into public.orders (
    id, reference, school_id, ordering_period_id, idempotency_key, order_access_hash,
    parent_first_name, parent_last_name, parent_email, parent_mobile
  ) values (
    v_order_id, v_reference, v_access.school_id, v_access.ordering_period_id,
    p_idempotency_key, p_order_access_hash,
    trim(p_parent->>'first_name'), trim(p_parent->>'last_name'),
    lower(trim(p_parent->>'email')), trim(p_parent->>'mobile')
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

    select
      sgo.id,
      sgo.grade_id,
      sgo.price_cents,
      g.name as grade_name,
      b.title as book_title
    into v_offering
    from public.school_grade_offerings sgo
    join public.grades g on g.id = sgo.grade_id
    join public.books b on b.id = sgo.book_id
    where sgo.id = (v_learner->>'offering_id')::uuid
      and sgo.school_id = v_access.school_id
      and sgo.ordering_period_id = v_access.ordering_period_id
      and sgo.active = true
      and b.active = true;

    if not found then
      raise exception using errcode = 'P0001', message = 'BOOK_NOT_AVAILABLE';
    end if;

    insert into public.learners (order_id, first_name, last_name, grade_id, class_name)
    values (
      v_order_id,
      trim(v_learner->>'first_name'),
      trim(v_learner->>'last_name'),
      v_offering.grade_id,
      nullif(trim(coalesce(v_learner->>'class_name', '')), '')
    )
    returning id into v_learner_id;

    insert into public.order_items (
      order_id, learner_id, offering_id, description_snapshot,
      unit_price_cents, quantity, line_total_cents
    ) values (
      v_order_id, v_learner_id, v_offering.id,
      v_offering.book_title || ' - ' || v_offering.grade_name,
      v_offering.price_cents, 1, v_offering.price_cents
    );

    v_total := v_total + v_offering.price_cents;
  end loop;

  update public.orders set amount_cents = v_total where id = v_order_id;
  update public.school_access set last_used_at = now() where token_hash = p_token_hash;

  return jsonb_build_object(
    'id', v_order_id,
    'reference', v_reference,
    'amount_cents', v_total,
    'status', 'pending_payment',
    'reused', false
  );
end;
$$;

alter table public.academic_years enable row level security;
alter table public.schools enable row level security;
alter table public.grades enable row level security;
alter table public.books enable row level security;
alter table public.ordering_periods enable row level security;
alter table public.school_grade_offerings enable row level security;
alter table public.school_access enable row level security;
alter table public.orders enable row level security;
alter table public.learners enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;
alter table public.staff_users enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.audit_events enable row level security;

revoke all on table public.academic_years, public.schools, public.grades, public.books,
  public.ordering_periods, public.school_grade_offerings, public.school_access,
  public.orders, public.learners, public.order_items, public.payment_attempts,
  public.payment_events, public.staff_users, public.notification_jobs, public.audit_events
  from anon, authenticated;
grant select, insert, update, delete on table public.academic_years, public.schools, public.grades, public.books,
  public.ordering_periods, public.school_grade_offerings, public.school_access,
  public.orders, public.learners, public.order_items, public.payment_attempts,
  public.payment_events, public.staff_users, public.notification_jobs, public.audit_events
  to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.create_school_order(text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_school_order(text, text, text, jsonb, jsonb) to service_role;

insert into public.academic_years (id, year, label, is_active)
values ('92cd8cf0-5a03-4a48-934a-3d27d1377b9a', 2027, '2027 Academic Year', true);

insert into public.grades (id, code, name, sort_order) values
  ('5dc50b47-660a-4ff4-8532-a245188ec803', '3', 'Graad 3', 3),
  ('dfc52037-530e-436e-9703-c1d80288aee3', '4', 'Graad 4', 4),
  ('0b65911f-171c-49f3-8ea5-1b15596fe76b', '5', 'Graad 5', 5),
  ('2cd27b9c-b343-42d9-888d-300934eaa181', '6', 'Graad 6', 6),
  ('35827cbc-2e68-4dd3-8815-786e3f953739', '7', 'Graad 7', 7);

insert into public.books (grade_id, sku, title, default_price_cents, cover_path) values
  ('5dc50b47-660a-4ff4-8532-a245188ec803', '815', 'Graad 3 Werkboek', 32000, '/assets/images/815-Book-Cover-Graad-3.png'),
  ('dfc52037-530e-436e-9703-c1d80288aee3', '820', 'Graad 4 Werkboek', 34000, '/assets/images/820-Book-Cover-Graad-4.png'),
  ('0b65911f-171c-49f3-8ea5-1b15596fe76b', '825', 'Graad 5 Werkboek', 34000, '/assets/images/825-Book-Cover-Graad-5-1.png'),
  ('2cd27b9c-b343-42d9-888d-300934eaa181', '830', 'Graad 6 Werkboek', 34000, '/assets/images/830-Book-Cover-Graad-6.png'),
  ('35827cbc-2e68-4dd3-8815-786e3f953739', '835', 'Graad 7 Werkboek', 34000, '/assets/images/835-Book-Cover-Graad-7.png');
