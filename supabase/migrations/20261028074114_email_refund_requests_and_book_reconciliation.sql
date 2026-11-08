-- Staff records requests received by email. No public request form, provider call or mail send.
alter table public.orders add column management_version integer not null default 0;
create table public.order_refund_requests (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),
 item_ids uuid[] not null check(cardinality(item_ids) between 1 and 20),amount_cents integer not null check(amount_cents>0),
 status text not null default 'requested' check(status in ('requested','approved','rejected','completed')),
 reason text not null check(char_length(reason) between 5 and 1000),email_received_at timestamptz not null,
 source_email_reference text not null default '' check(char_length(source_email_reference)<=200),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id),reviewed_at timestamptz,review_reason text,
 completed_at timestamptz
);
create unique index one_open_order_refund_request on public.order_refund_requests(order_id) where status in ('requested','approved');
create index order_refund_requests_recent on public.order_refund_requests(created_at desc);
create table public.order_refund_completions (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique references public.order_refund_requests(id),
 order_id uuid not null references public.orders(id),payment_attempt_id uuid not null references public.payment_attempts(id),
 provider_mode text not null check(provider_mode in ('sandbox','live')),provider_payment_id text not null,
 provider_refund_reference text not null check(char_length(provider_refund_reference) between 2 and 100),
 amount_cents integer not null check(amount_cents>0),refunded_at timestamptz not null,
 reason text not null check(char_length(reason) between 5 and 1000),recorded_by uuid not null references auth.users(id),recorded_at timestamptz not null default now(),
 unique(provider_mode,provider_refund_reference)
);
create table public.order_item_refunds (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),
 order_item_id uuid not null unique references public.order_items(id),request_id uuid not null references public.order_refund_requests(id),
 completion_id uuid not null references public.order_refund_completions(id),amount_cents integer not null check(amount_cents>0),
 provider_refund_reference text not null,refunded_at timestamptz not null,recorded_at timestamptz not null default now()
);
create index order_item_refunds_order on public.order_item_refunds(order_id);
create table public.order_original_details (
 order_id uuid primary key references public.orders(id),snapshot jsonb not null,
 captured_by uuid not null references auth.users(id),captured_at timestamptz not null default now()
);
alter table public.order_refund_requests enable row level security;
alter table public.order_refund_completions enable row level security;
alter table public.order_item_refunds enable row level security;
alter table public.order_original_details enable row level security;
revoke all on public.order_refund_requests,public.order_refund_completions,public.order_item_refunds,public.order_original_details from public,anon,authenticated,service_role;
grant select,insert,update on public.order_refund_requests to service_role;
grant select,insert on public.order_refund_completions,public.order_item_refunds,public.order_original_details to service_role;

-- A provider confirmation is shared by both refund ledgers. One unique claim
-- serializes concurrent inserts across the two tables as well as within each.
create table public.refund_reference_claims (
 provider_mode text not null,provider_refund_reference text not null,
 primary key(provider_mode,provider_refund_reference)
);
alter table public.refund_reference_claims enable row level security;
revoke all on public.refund_reference_claims from public,anon,authenticated,service_role;
grant select,insert on public.refund_reference_claims to service_role;
create function public.claim_provider_refund_reference() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.refund_reference_claims(provider_mode,provider_refund_reference)
 values(new.provider_mode,new.provider_refund_reference) on conflict do nothing;
 if not found then raise exception using errcode='23505',message='Refund confirmation already claimed';end if;
 return new;
end $$;
revoke all on function public.claim_provider_refund_reference() from public,anon,authenticated;
create trigger refund_reference_claim_legacy before insert on public.order_refunds for each row execute function public.claim_provider_refund_reference();
create trigger refund_reference_claim_book before insert on public.order_refund_completions for each row execute function public.claim_provider_refund_reference();
-- Install the trigger first, so even an insert concurrent with backfill claims
-- its reference. An already claimed row is safe to skip during backfill.
insert into public.refund_reference_claims(provider_mode,provider_refund_reference)
 select provider_mode,provider_refund_reference from public.order_refunds on conflict do nothing;

create function public.manage_order_record(p_order_id uuid,p_expected_version integer,p_actor uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders;r public.order_refund_requests;c public.order_refund_completions;a public.payment_attempts;
 period_id uuid;ids uuid[];n integer;amount integer;v_reason text;v_received timestamptz;v_date timestamptz;v_reference text;
 before_details jsonb;after_details jsonb;child jsonb;parent jsonb;v_count integer;v_mode text;v_id uuid;v_decision text;
begin
 if not exists(select 1 from public.staff_access_approvals where auth_user_id=p_actor and active and role='administrator' and password_set_at is not null) then
  raise exception using message='MANAGEMENT_ADMIN_REQUIRED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_expected_version is null or p_expected_version<0 then raise exception using message='MANAGEMENT_INVALID';end if;
 v_reason:=trim(coalesce(p_payload->>'reason',''));
 if char_length(v_reason) not between 5 and 1000 or v_reason ~ '[[:cntrl:]]' then raise exception using message='MANAGEMENT_INVALID';end if;
 select ordering_period_id into period_id from public.orders where id=p_order_id;
 if not found then raise exception using message='MANAGEMENT_NOT_FOUND';end if;
 -- Match batch creation/full-refund lock order. Payment callbacks lock attempt before order.
 perform id from public.ordering_periods where id=period_id for update;
 perform id from public.payment_attempts where order_id=p_order_id order by id for update;
 select * into strict o from public.orders where id=p_order_id for update;
 if p_action='record-refund-request' then
  if o.status<>'paid' or exists(select 1 from public.order_refunds where order_id=o.id) then raise exception using message='MANAGEMENT_NOT_PAID';end if;
  select array_agg(distinct value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_payload->'item_ids');
  if cardinality(ids) not between 1 and 20 or ids is null then raise exception using message='MANAGEMENT_INVALID';end if;
  select count(*),sum(line_total_cents) into n,amount from public.order_items i where i.order_id=o.id and i.id=any(ids)
   and not exists(select 1 from public.order_item_refunds f where f.order_item_id=i.id);
  if n<>cardinality(ids) or amount is null or amount<=0 then raise exception using message='MANAGEMENT_ITEMS_INVALID';end if;
  if not exists(select 1 from public.payment_attempts p join public.payment_events e on e.payment_attempt_id=p.id
    where p.order_id=o.id and p.status='complete' and p.amount_cents=o.amount_cents and e.verification_state='verified' and e.payment_status='COMPLETE' and e.provider_payment_id=p.provider_payment_id) then
   raise exception using message='MANAGEMENT_PAYMENT_REQUIRED';end if;
  v_received:=(p_payload->>'email_received_at')::timestamptz;v_reference:=trim(coalesce(p_payload->>'source_email_reference',''));
  if v_received is null or not isfinite(v_received) or v_received>now() or char_length(v_reference)>200 or v_reference ~ '[[:cntrl:]]' then raise exception using message='MANAGEMENT_INVALID';end if;
  select * into r from public.order_refund_requests where order_id=o.id and status in ('requested','approved');
  if found then
   if r.item_ids=ids and r.reason=v_reason and r.email_received_at=v_received and r.source_email_reference=v_reference then
    return jsonb_build_object('request_id',r.id,'status',r.status,'reused',true,'management_version',o.management_version);end if;
   raise exception using message='MANAGEMENT_OPEN_REQUEST';end if;
  if o.management_version<>p_expected_version then raise exception using message='MANAGEMENT_VERSION_CONFLICT';end if;
  insert into public.order_refund_requests(order_id,item_ids,amount_cents,reason,email_received_at,source_email_reference,created_by)
   values(o.id,ids,amount,v_reason,v_received,v_reference,p_actor) returning * into r;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'email_refund_request_recorded','order',o.id::text,
   jsonb_build_object('request_id',r.id,'item_ids',ids,'amount_cents',amount,'reason',v_reason,'source','email','money_moved',false));
 elsif p_action in ('review-refund-request','record-item-refund') then
  select * into r from public.order_refund_requests where id=(p_payload->>'request_id')::uuid and order_id=o.id for update;
  if not found then raise exception using message='MANAGEMENT_NOT_FOUND';end if;
  if p_action='review-refund-request' then
   v_decision:=p_payload->>'decision';
   if v_decision not in ('approved','rejected') or v_decision is null then raise exception using message='MANAGEMENT_INVALID';end if;
   if r.status=v_decision and r.review_reason=v_reason then return jsonb_build_object('request_id',r.id,'status',r.status,'reused',true,'management_version',o.management_version);end if;
   if o.management_version<>p_expected_version then raise exception using message='MANAGEMENT_VERSION_CONFLICT';end if;
   if r.status<>'requested' then raise exception using message='MANAGEMENT_REQUEST_FINAL';end if;
   update public.order_refund_requests set status=v_decision,reviewed_by=p_actor,reviewed_at=now(),review_reason=v_reason where id=r.id returning * into r;
   insert into public.audit_events(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'email_refund_request_reviewed','order',o.id::text,
    jsonb_build_object('request_id',r.id,'decision',v_decision,'reason',v_reason,'money_moved',false));
  else
   v_reference:=trim(coalesce(p_payload->>'provider_refund_reference',''));v_date:=(p_payload->>'refunded_at')::timestamptz;
   if p_payload->'confirm_external_refund' is distinct from 'true'::jsonb or char_length(v_reference) not between 2 and 100
     or v_reference ~ '[[:cntrl:]]' or v_date is null or not isfinite(v_date) or v_date>now() or v_date<o.paid_at then raise exception using message='MANAGEMENT_INVALID';end if;
   select * into c from public.order_refund_completions where request_id=r.id;
   if found then
    if c.provider_refund_reference=v_reference and c.provider_payment_id=p_payload->>'provider_payment_id' and c.refunded_at=v_date and c.reason=v_reason then
     return jsonb_build_object('request_id',r.id,'status','completed','reused',true,'management_version',o.management_version);end if;
    raise exception using message='MANAGEMENT_RECEIPT_CONFLICT';end if;
   if o.management_version<>p_expected_version then raise exception using message='MANAGEMENT_VERSION_CONFLICT';end if;
   if r.status<>'approved' then raise exception using message='MANAGEMENT_APPROVAL_REQUIRED';end if;
   if o.status<>'paid' or exists(select 1 from public.order_refunds where order_id=o.id) then raise exception using message='MANAGEMENT_NOT_PAID';end if;
   select count(*) into n from public.payment_attempts where order_id=o.id;
   select * into a from public.payment_attempts where order_id=o.id;
   v_mode:=a.checkout_payload->>'mode';
   if n<>1 or a.status<>'complete' or a.amount_cents<>o.amount_cents or a.provider_payment_id is distinct from p_payload->>'provider_payment_id' or v_mode not in ('sandbox','live')
    or not exists(select 1 from public.payment_events e where e.payment_attempt_id=a.id and e.verification_state='verified' and e.payment_status='COMPLETE' and e.provider_payment_id=a.provider_payment_id) then
    raise exception using message='MANAGEMENT_PAYMENT_REQUIRED';end if;
   if exists(select 1 from public.order_items i join public.fulfilment_batch_items bi on bi.order_item_id=i.id join public.fulfilment_batches b on b.id=bi.batch_id
     where i.id=any(r.item_ids) and (b.status<>'cancelled' or b.dispatched_at is not null or b.delivered_at is not null)) then raise exception using message='MANAGEMENT_BATCH_REVIEW_REQUIRED';end if;
   perform id from public.notification_jobs where order_id=o.id order by id for update;
   if exists(select 1 from public.notification_jobs where order_id=o.id and status in ('queued','processing')) then raise exception using message='MANAGEMENT_MAIL_IN_PROGRESS';end if;
   select count(*),sum(line_total_cents) into n,amount from public.order_items i where i.order_id=o.id and i.id=any(r.item_ids)
    and not exists(select 1 from public.order_item_refunds f where f.order_item_id=i.id);
   if n<>cardinality(r.item_ids) or amount<>r.amount_cents then raise exception using message='MANAGEMENT_ITEMS_INVALID';end if;
   if exists(select 1 from public.order_refunds where provider_mode=v_mode and provider_refund_reference=v_reference) then raise exception using message='MANAGEMENT_RECEIPT_CONFLICT';end if;
   begin
    insert into public.order_refund_completions(request_id,order_id,payment_attempt_id,provider_mode,provider_payment_id,provider_refund_reference,amount_cents,refunded_at,reason,recorded_by)
     values(r.id,o.id,a.id,v_mode,a.provider_payment_id,v_reference,amount,v_date,v_reason,p_actor) returning * into c;
    insert into public.order_item_refunds(order_id,order_item_id,request_id,completion_id,amount_cents,provider_refund_reference,refunded_at)
     select o.id,i.id,r.id,c.id,i.line_total_cents,v_reference,v_date from public.order_items i where i.id=any(r.item_ids) and i.order_id=o.id;
   exception when unique_violation then raise exception using message='MANAGEMENT_RECEIPT_CONFLICT';end;
   update public.order_refund_requests set status='completed',completed_at=now() where id=r.id returning * into r;
   if not exists(select 1 from public.order_items i where i.order_id=o.id and not exists(select 1 from public.order_item_refunds f where f.order_item_id=i.id)) then
    update public.orders set status='refunded' where id=o.id;
    update public.payment_attempts set status='refunded' where id=a.id;
   end if;
   insert into public.audit_events(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'order_book_refund_recorded','order',o.id::text,
    jsonb_build_object('request_id',r.id,'completion_id',c.id,'item_ids',r.item_ids,'amount_cents',amount,'provider_refund_reference',v_reference,'refunded_at',v_date,'reason',v_reason,'money_moved',false));
  end if;
 elsif p_action='correct-details' then
  if o.management_version<>p_expected_version then raise exception using message='MANAGEMENT_VERSION_CONFLICT';end if;
  if exists(select 1 from public.fulfilment_batch_items bi join public.order_items i on i.id=bi.order_item_id join public.fulfilment_batches b on b.id=bi.batch_id where i.order_id=o.id and (b.status<>'cancelled' or b.dispatched_at is not null or b.delivered_at is not null)) then raise exception using message='MANAGEMENT_BATCH_REVIEW_REQUIRED';end if;
  perform id from public.notification_jobs where order_id=o.id order by id for update;
  if exists(select 1 from public.notification_jobs where order_id=o.id and status in ('queued','processing')) or exists(select 1 from public.shipping_notification_jobs j where j.status in ('queued','processing') and exists(select 1 from public.fulfilment_batch_items bi join public.order_items i on i.id=bi.order_item_id where bi.batch_id=j.batch_id and i.order_id=o.id)) then raise exception using message='MANAGEMENT_MAIL_IN_PROGRESS';end if;
  parent:=p_payload->'parent';
  if parent is null or jsonb_typeof(parent)<>'object' or char_length(trim(coalesce(parent->>'first_name',''))) not between 1 and 80 or char_length(trim(coalesce(parent->>'last_name',''))) not between 1 and 80
    or char_length(coalesce(parent->>'email',''))>254 or coalesce(parent->>'email','') !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    or char_length(coalesce(parent->>'mobile','')) not between 8 and 25 or parent::text ~ '\\u00[01][0-9a-f]' then raise exception using message='MANAGEMENT_INVALID';end if;
  if jsonb_typeof(p_payload->'learners') is distinct from 'array' then raise exception using message='MANAGEMENT_INVALID';end if;
  select count(*) into n from public.learners where order_id=o.id;
  if jsonb_array_length(p_payload->'learners')<>n or (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'learners'))<>n then raise exception using message='MANAGEMENT_ITEMS_INVALID';end if;
  before_details:=jsonb_build_object('parent',jsonb_build_object('first_name',o.parent_first_name,'last_name',o.parent_last_name,'email',o.parent_email,'mobile',o.parent_mobile),
    'learners',(select jsonb_agg(jsonb_build_object('id',id,'first_name',first_name,'last_name',last_name,'class_name',class_name) order by id) from public.learners where order_id=o.id));
  insert into public.order_original_details(order_id,snapshot,captured_by) values(o.id,before_details,p_actor) on conflict(order_id) do nothing;
  for child in select value from jsonb_array_elements(p_payload->'learners') loop
   if not exists(select 1 from public.learners where id=(child->>'id')::uuid and order_id=o.id) or char_length(trim(coalesce(child->>'first_name',''))) not between 1 and 80 or char_length(trim(coalesce(child->>'last_name',''))) not between 1 and 80 or child ? 'class_name' or child::text ~ '\\u00[01][0-9a-f]' then raise exception using message='MANAGEMENT_ITEMS_INVALID';end if;
   -- The client removed class collection. Existing class values are historical
   -- data and must not be erased or rewritten by a name/contact correction.
   update public.learners set first_name=trim(child->>'first_name'),last_name=trim(child->>'last_name') where id=(child->>'id')::uuid and order_id=o.id;
  end loop;
  update public.orders set parent_first_name=trim(parent->>'first_name'),parent_last_name=trim(parent->>'last_name'),parent_email=lower(trim(parent->>'email')),parent_mobile=trim(parent->>'mobile') where id=o.id;
  after_details:=jsonb_build_object('parent',parent,'learners',(select jsonb_agg(jsonb_build_object('id',id,'first_name',first_name,'last_name',last_name,'class_name',class_name) order by id) from public.learners where order_id=o.id));
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,details) values(p_actor,'order_details_corrected','order',o.id::text,jsonb_build_object('before',before_details,'after',after_details,'reason',v_reason,'selected_order_only',true));
 else raise exception using message='MANAGEMENT_INVALID';end if;
 update public.orders set management_version=management_version+1 where id=o.id returning management_version into n;
 return jsonb_build_object('management_version',n,'request_id',r.id,'status',r.status,'reused',false,'money_moved',false);
end;$$;
revoke all on function public.manage_order_record(uuid,integer,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_order_record(uuid,integer,uuid,text,jsonb) to service_role;

create function public.guard_legacy_full_refund() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.order_item_refunds where order_id=new.order_id) or exists(select 1 from public.order_refund_completions where provider_mode=new.provider_mode and provider_refund_reference=new.provider_refund_reference) then raise exception using message='REFUND_PARTIAL_ALREADY_RECORDED';end if;
 return new;
end;$$;
create trigger legacy_full_refund_has_no_book_refunds before insert on public.order_refunds for each row execute function public.guard_legacy_full_refund();
create function public.sync_legacy_refund_request() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.order_refund_requests set status='completed',completed_at=now() where order_id=new.order_id and status in ('requested','approved');
 update public.orders set management_version=management_version+1 where id=new.order_id;
 return new;
end;$$;
create trigger legacy_full_refund_completes_request after insert on public.order_refunds for each row execute function public.sync_legacy_refund_request();
revoke all on function public.guard_legacy_full_refund(),public.sync_legacy_refund_request() from public,anon,authenticated;

-- Preserve the existing RPC and its period lock; add book-refund exclusion.
do $$ declare definition text; begin
 select pg_get_functiondef('public.create_fulfilment_batch(uuid,uuid,text,uuid)'::regprocedure) into definition;
 if position('o.status=''paid''' in definition)=0 then raise exception 'Batch function shape changed; review refund exclusion';end if;
 definition:=replace(definition,'o.status=''paid''','o.status=''paid'' and not exists(select 1 from public.order_item_refunds ir where ir.order_item_id=oi.id)');
 execute definition;
end;$$;
notify pgrst,'reload schema';
