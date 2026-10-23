-- Private durable outbox. One parent mailbox receives one event per frozen school batch.
alter table public.fulfilment_batches add column if not exists dispatched_at timestamptz;
alter table public.fulfilment_batches add column if not exists delivered_at timestamptz;

create table public.shipping_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fulfilment_batches(id) on delete restrict,
  event text not null check (event in ('dispatched','delivered')),
  recipient text not null check (recipient=lower(trim(recipient)) and char_length(recipient) between 3 and 254),
  demo boolean not null,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  status text not null default 'queued' check (status in ('queued','processing','sent','failed')),
  attempts integer not null default 0 check (attempts between 0 and 1),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  sent_at timestamptz,
  last_error text,
  unique(batch_id,event,recipient)
);
create index shipping_jobs_pending_idx on public.shipping_notification_jobs(batch_id,created_at,id) where status='queued';
create index shipping_jobs_batch_status_idx on public.shipping_notification_jobs(batch_id,status);
alter table public.shipping_notification_jobs enable row level security;
revoke all on public.shipping_notification_jobs from public,anon,authenticated;
grant select,insert,update on public.shipping_notification_jobs to service_role;

create or replace function public.shipping_batch_recipients(p_batch_id uuid,p_event text,p_demo boolean,p_occurred_at timestamptz)
returns table(recipient text,payload jsonb) language sql stable security invoker set search_path='' as $$
  select lower(trim(o.parent_email)),jsonb_build_object(
    'batch_id',fb.id,'event',p_event,'demo',p_demo,'school_id',fb.school_id,
    'school',s.name,'academic_year',ay.year,'batch_label',fb.label,'occurred_at',p_occurred_at,
    'recipient',lower(trim(o.parent_email)),
    'parent_first_name',case when count(distinct o.parent_first_name)=1 then min(o.parent_first_name) else '' end,
    'items',jsonb_agg(jsonb_build_object('learner_first_name',bi.learner_first_name,'learner_last_name',bi.learner_last_name,
      'grade',g.name,'book',bi.book_title,'quantity',bi.quantity,'order_reference',bi.order_reference)
      order by g.sort_order,bi.learner_last_name,bi.learner_first_name,bi.id))
  from public.fulfilment_batches fb join public.fulfilment_batch_items bi on bi.batch_id=fb.id
  join public.order_items oi on oi.id=bi.order_item_id join public.orders o on o.id=oi.order_id
  join public.schools s on s.id=fb.school_id join public.ordering_periods op on op.id=fb.ordering_period_id
  join public.academic_years ay on ay.id=op.academic_year_id join public.grades g on g.id=bi.grade_id
  where fb.id=p_batch_id and o.school_id=fb.school_id and o.ordering_period_id=fb.ordering_period_id
    and o.status='paid' and (o.reference like 'DEMO-%')=p_demo and p_event in ('dispatched','delivered')
  group by lower(trim(o.parent_email)),fb.id,s.name,ay.year order by lower(trim(o.parent_email));
$$;

create or replace function public.transition_fulfilment_batch(
  p_batch_id uuid,p_status text,p_actor uuid,p_demo boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_batch public.fulfilment_batches; v_queued integer:=0; v_now timestamptz:=now();
begin
  if p_status not in ('created','packing','ready','dispatched','delivered','cancelled') then
    raise exception using errcode='P0001',message='INVALID_BATCH_STATUS';
  end if;
  select * into v_batch from public.fulfilment_batches where id=p_batch_id for update;
  if not found then raise exception using errcode='P0001',message='BATCH_NOT_FOUND'; end if;
  if v_batch.status=p_status then
    return jsonb_build_object('id',v_batch.id,'status',v_batch.status,'changed',false,'queued',0);
  end if;
  if v_batch.status in ('cancelled','delivered') or
     (v_batch.status='dispatched' and p_status<>'delivered') or
     (p_status='delivered' and v_batch.status<>'dispatched') then
    raise exception using errcode='P0001',message='INVALID_BATCH_TRANSITION';
  end if;
  if p_status in ('dispatched','delivered') then
    if p_demo and v_batch.school_id<>'edabcd03-1854-43ca-ac93-45c71e9ef012'::uuid then
      raise exception using errcode='P0001',message='INVALID_DEMO_BATCH';
    end if;
    if not exists(select 1 from public.fulfilment_batch_items where batch_id=p_batch_id) then
      raise exception using errcode='P0001',message='EMPTY_BATCH';
    end if;
    if exists(select 1 from public.fulfilment_batch_items bi
      join public.order_items oi on oi.id=bi.order_item_id join public.orders o on o.id=oi.order_id
      where bi.batch_id=p_batch_id and (o.school_id<>v_batch.school_id or o.ordering_period_id<>v_batch.ordering_period_id
        or o.status<>'paid' or (o.reference like 'DEMO-%')<>p_demo)) then
      raise exception using errcode='P0001',message='BATCH_RECORDS_REQUIRE_REVIEW';
    end if;
    insert into public.shipping_notification_jobs(batch_id,event,recipient,demo,payload)
    select p_batch_id,p_status,r.recipient,p_demo,r.payload
    from public.shipping_batch_recipients(p_batch_id,p_status,p_demo,v_now) r
    on conflict(batch_id,event,recipient) do nothing;
    get diagnostics v_queued=row_count;
  end if;
  update public.fulfilment_batches set status=p_status,
    dispatched_at=case when p_status='dispatched' then coalesce(dispatched_at,v_now) else dispatched_at end,
    delivered_at=case when p_status='delivered' then coalesce(delivered_at,v_now) else delivered_at end
    where id=p_batch_id;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,details)
  values(p_actor,'fulfilment_batch_status_updated','fulfilment_batch',p_batch_id,
    jsonb_build_object('previous_status',v_batch.status,'status',p_status,'notification_count',v_queued,'demo',p_demo));
  return jsonb_build_object('id',p_batch_id,'status',p_status,'changed',true,'queued',v_queued);
end;
$$;

-- Atomic claims prevent parallel workers from submitting the same message.
-- A later event for the same mailbox waits for its earlier in-flight event.
create or replace function public.claim_shipping_notifications(p_batch_id uuid,p_limit integer default 20)
returns setof public.shipping_notification_jobs language sql security invoker set search_path='' as $$
  update public.shipping_notification_jobs j set status='processing',attempts=1,started_at=now(),last_error=null
  where j.id in (
    select q.id from public.shipping_notification_jobs q where q.batch_id=p_batch_id and q.status='queued' and q.attempts=0
    and not exists(select 1 from public.shipping_notification_jobs earlier where earlier.batch_id=q.batch_id
      and earlier.recipient=q.recipient and earlier.event='dispatched' and q.event='delivered'
      and earlier.status in ('queued','processing'))
    order by q.created_at,q.id for update of q skip locked limit least(greatest(p_limit,1),20)
  ) returning j.*;
$$;

create or replace function public.shipping_notification_counts()
returns table(batch_id uuid,event text,status text,count bigint) language sql stable security invoker set search_path='' as $$
  select j.batch_id,j.event,case when j.status='processing' and j.started_at<now()-interval '5 minutes' then 'review' else j.status end,count(*)
  from public.shipping_notification_jobs j group by j.batch_id,j.event,3;
$$;
revoke all on function public.shipping_batch_recipients(uuid,text,boolean,timestamptz) from public,anon,authenticated;
revoke all on function public.transition_fulfilment_batch(uuid,text,uuid,boolean) from public,anon,authenticated;
revoke all on function public.claim_shipping_notifications(uuid,integer) from public,anon,authenticated;
revoke all on function public.shipping_notification_counts() from public,anon,authenticated;
grant execute on function public.transition_fulfilment_batch(uuid,text,uuid,boolean) to service_role;
grant execute on function public.claim_shipping_notifications(uuid,integer) to service_role;
grant execute on function public.shipping_notification_counts() to service_role;
grant execute on function public.shipping_batch_recipients(uuid,text,boolean,timestamptz) to service_role;
