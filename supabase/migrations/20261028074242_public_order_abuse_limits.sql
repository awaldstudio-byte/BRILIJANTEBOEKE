-- Private, short-lived receipts ensure a retry does not spend creation quota.
create table public.order_submission_limit_receipts (
  key_hash text not null check(key_hash ~ '^[a-f0-9]{64}$'),
  bucket bigint not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  primary key(key_hash,bucket,request_hash)
);
create index order_submission_limits_expiry_idx on public.order_submission_limit_receipts(expires_at);
alter table public.order_submission_limit_receipts enable row level security;
revoke all on public.order_submission_limit_receipts from public,anon,authenticated;
grant select,insert,delete on public.order_submission_limit_receipts to service_role;

-- Public traffic must not run the staff-login function's unrelated cleanup of
-- expired staff sessions/challenges. The existing private counter table is
-- shared safely through independently HMAC-namespaced keys.
create function public.consume_order_traffic_limit(p_key text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_bucket bigint;v_uses integer;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_limit is null or p_limit not between 1 and 1000
     or p_seconds is null or p_seconds not between 30 and 86400 then
    raise exception 'Invalid ordering quota parameters';
  end if;
  v_bucket:=floor(extract(epoch from now())/p_seconds);
  insert into public.staff_auth_limits(key_hash,bucket,uses,expires_at)
    values(p_key,v_bucket,1,now()+make_interval(secs=>p_seconds*2))
  on conflict(key_hash,bucket) do update set uses=least(public.staff_auth_limits.uses+1,p_limit+1)
  returning uses into v_uses;
  delete from public.staff_auth_limits where expires_at<now();
  return v_uses<=p_limit;
end $$;
revoke all on function public.consume_order_traffic_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_order_traffic_limit(text,integer,integer) to service_role;

create function public.consume_order_submission_limit(p_key text,p_request text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_bucket bigint;v_uses integer;
begin
  if p_key is null or p_request is null or p_key !~ '^[a-f0-9]{64}$' or p_request !~ '^[a-f0-9]{64}$'
     or p_limit is null or p_limit not between 1 and 1000 or p_seconds is null or p_seconds not between 30 and 86400 then
    raise exception 'Invalid ordering quota parameters';
  end if;
  v_bucket:=floor(extract(epoch from now())/p_seconds);
  perform pg_advisory_xact_lock(hashtextextended(p_key||':'||v_bucket::text,0));
  if exists(select 1 from public.order_submission_limit_receipts where key_hash=p_key and bucket=v_bucket and request_hash=p_request) then return true;end if;
  insert into public.staff_auth_limits(key_hash,bucket,uses,expires_at)
    values(p_key,v_bucket,1,now()+make_interval(secs=>p_seconds*2))
  on conflict(key_hash,bucket) do update set uses=least(public.staff_auth_limits.uses+1,p_limit+1)
  returning uses into v_uses;
  delete from public.order_submission_limit_receipts where expires_at<now();
  if v_uses>p_limit then return false;end if;
  insert into public.order_submission_limit_receipts(key_hash,bucket,request_hash,expires_at)
    values(p_key,v_bucket,p_request,now()+make_interval(secs=>p_seconds*2));
  return true;
end $$;
revoke all on function public.consume_order_submission_limit(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_order_submission_limit(text,text,integer,integer) to service_role;
