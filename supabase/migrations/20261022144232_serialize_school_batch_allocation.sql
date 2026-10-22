-- Serialise creation for the same school/period so two staff clicks cannot
-- allocate the same paid items to two active batches.
create or replace function public.create_fulfilment_batch(
  p_school_id uuid, p_ordering_period_id uuid, p_label text, p_created_by uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.fulfilment_batches;
  v_item_count integer;
begin
  perform 1 from public.ordering_periods
  where id=p_ordering_period_id and school_id=p_school_id for update;
  if not found then
    raise exception using errcode='P0001',message='INVALID_SCHOOL_PERIOD';
  end if;
  insert into public.fulfilment_batches(school_id,ordering_period_id,label,created_by)
  values(p_school_id,p_ordering_period_id,trim(p_label),p_created_by) returning * into v_batch;
  insert into public.fulfilment_batch_items(batch_id,order_item_id,grade_id,book_title,learner_first_name,learner_last_name,order_reference,quantity)
  select v_batch.id,oi.id,l.grade_id,oi.description_snapshot,l.first_name,l.last_name,o.reference,oi.quantity
  from public.order_items oi join public.orders o on o.id=oi.order_id
  join public.learners l on l.id=oi.learner_id
  where o.school_id=p_school_id and o.ordering_period_id=p_ordering_period_id and o.status='paid'
  and not exists(select 1 from public.fulfilment_batch_items fbi
    join public.fulfilment_batches fb on fb.id=fbi.batch_id
    where fbi.order_item_id=oi.id and fb.status<>'cancelled');
  get diagnostics v_item_count=row_count;
  if v_item_count=0 then
    raise exception using errcode='P0001',message='NO_PAID_ITEMS_AVAILABLE';
  end if;
  return jsonb_build_object('id',v_batch.id,'item_count',v_item_count,'status',v_batch.status);
end;
$$;
revoke all on function public.create_fulfilment_batch(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.create_fulfilment_batch(uuid,uuid,text,uuid) to service_role;
