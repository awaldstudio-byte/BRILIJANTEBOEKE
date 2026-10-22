-- Approved staff identities are independent of Auth registration. No domain-wide signup.
create table public.staff_access_approvals (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and length(email) between 5 and 254),
  display_name text not null check (length(display_name) between 2 and 160),
  role text not null check (role in ('administrator', 'viewer')),
  active boolean not null default true,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  password_set_at timestamptz,
  setup_completed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.staff_setup_challenges (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  approval_id uuid references public.staff_access_approvals(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'sent', 'used', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  remember boolean not null default false,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);
create table public.staff_login_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  approval_id uuid not null references public.staff_access_approvals(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('verified', 'password', 'ready')),
  remember boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.staff_auth_limits (
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  bucket bigint not null,
  uses integer not null,
  expires_at timestamptz not null,
  primary key (key_hash, bucket)
);
create index staff_setup_expiry_idx on public.staff_setup_challenges(expires_at);
create index staff_sessions_user_idx on public.staff_login_sessions(auth_user_id);
create index staff_limits_expiry_idx on public.staff_auth_limits(expires_at);

alter table public.staff_access_approvals enable row level security;
alter table public.staff_setup_challenges enable row level security;
alter table public.staff_login_sessions enable row level security;
alter table public.staff_auth_limits enable row level security;
revoke all on public.staff_access_approvals, public.staff_setup_challenges,
  public.staff_login_sessions, public.staff_auth_limits from public, anon, authenticated;
grant all on public.staff_access_approvals, public.staff_setup_challenges,
  public.staff_login_sessions, public.staff_auth_limits to service_role;

create function public.consume_staff_auth_limit(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_bucket bigint; current_uses integer;
begin
  if p_key !~ '^[a-f0-9]{64}$' or p_limit not between 1 and 1000 or p_seconds not between 30 and 86400 then
    raise exception 'Invalid quota parameters';
  end if;
  current_bucket := floor(extract(epoch from now()) / p_seconds);
  insert into public.staff_auth_limits(key_hash, bucket, uses, expires_at)
    values (p_key, current_bucket, 1, now() + make_interval(secs => p_seconds * 2))
  on conflict (key_hash, bucket) do update
    set uses = least(public.staff_auth_limits.uses + 1, p_limit + 1)
  returning uses into current_uses;
  -- Only expiring, hashed quota counters are removed, not application records.
  delete from public.staff_auth_limits where expires_at < now();
  delete from public.staff_setup_challenges where expires_at < now() - interval '1 day';
  delete from public.staff_login_sessions where expires_at < now() - interval '1 day';
  return current_uses <= p_limit;
end $$;

create function public.consume_staff_setup_attempt(p_hash text)
returns table(approval_id uuid, auth_user_id uuid, remember boolean)
language sql security invoker set search_path = '' as $$
  update public.staff_setup_challenges c set attempts = c.attempts + 1
    where c.token_hash = p_hash and c.status = 'sent' and c.attempts < 5 and c.expires_at > now()
    returning c.approval_id, c.auth_user_id, c.remember;
$$;
revoke all on function public.consume_staff_auth_limit(text, integer, integer),
  public.consume_staff_setup_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_staff_auth_limit(text, integer, integer),
  public.consume_staff_setup_attempt(text) to service_role;

-- Explicit user approval in this task; client staff addresses will be added later.
insert into public.staff_access_approvals(email, display_name, role)
  values ('technical@awaldstudio.com', 'A WALD STUDIO Technical Support', 'administrator')
  on conflict (email) do nothing;
