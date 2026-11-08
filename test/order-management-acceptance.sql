-- Synthetic clones only, no provider/SMTP calls; entire exercise rolls back.
begin;
create function pg_temp.management_fixture() returns uuid language plpgsql as $$
declare o public.orders;i public.order_items;l public.learners;template uuid;oid uuid:=gen_random_uuid();attempt uuid:=gen_random_uuid();total integer;
begin
 select * into strict o from public.orders where status='paid' and reference like 'DEMO-%' order by created_at limit 1;
 template:=o.id;o.id:=oid;o.reference:='DEMO-BB-MANAGE-'||left(oid::text,8);o.idempotency_key:=oid::text;o.management_version:=0;o.paid_at:=now()-interval '2 hours';
 insert into public.orders select o.*;
 for i in select * from public.order_items where order_id=template order by id limit 2 loop
  select * into strict l from public.learners where id=i.learner_id;l.id:=gen_random_uuid();l.order_id:=oid;insert into public.learners select l.*;
  i.id:=gen_random_uuid();i.order_id:=oid;i.learner_id:=l.id;insert into public.order_items select i.*;
 end loop;
 select sum(line_total_cents) into total from public.order_items where order_id=oid;update public.orders set amount_cents=total where id=oid;
 insert into public.payment_attempts(id,order_id,merchant_payment_id,provider_payment_id,amount_cents,status,checkout_payload) values(attempt,oid,o.reference,oid::text,total,'complete','{"mode":"sandbox"}');
 insert into public.payment_events(payment_attempt_id,event_key,provider_payment_id,payment_status,verification_state,raw_payload) values(attempt,'manage-'||oid,oid::text,'COMPLETE','verified','{"synthetic":true}');
 return oid;
end;$$;
do $$
declare oid uuid;other uuid;actor uuid;item uuid;otheritem uuid;result jsonb;rid uuid;payload jsonb;amount integer;batch jsonb;
begin
 select auth_user_id into strict actor from public.staff_access_approvals where email='technical@awaldstudio.com' and active;
 oid:=pg_temp.management_fixture();select id,line_total_cents into item,amount from public.order_items where order_id=oid order by id limit 1;
 select id into otheritem from public.order_items where order_id=oid and id<>item limit 1;
 if otheritem is null then raise exception 'Fixture requires two books';end if;
 payload:=jsonb_build_object('reason','Parent email requests this book','item_ids',jsonb_build_array(item),'email_received_at',now()-interval '1 hour');
 result:=public.manage_order_record(oid,0,actor,'record-refund-request',payload);rid:=(result->>'request_id')::uuid;
 if (select amount_cents from public.order_refund_requests where id=rid)<>amount then raise exception 'Amount not authoritative';end if;
 result:=public.manage_order_record(oid,0,actor,'record-refund-request',payload);if not (result->>'reused')::boolean then raise exception 'Request duplicate not reused';end if;
 perform public.manage_order_record(oid,1,actor,'review-refund-request',jsonb_build_object('request_id',rid,'decision','approved','reason','Approved selected book only'));
 if (select status from public.orders where id=oid)<>'paid' or exists(select 1 from public.order_item_refunds where order_id=oid) then raise exception 'Approval moved financial state';end if;
 payload:=jsonb_build_object('request_id',rid,'provider_payment_id',oid::text,'provider_refund_reference','QA-FIRST-'||oid,'refunded_at',now()-interval '30 minutes','reason','Completed external selected book refund','confirm_external_refund',true);
 result:=public.manage_order_record(oid,2,actor,'record-item-refund',payload);
 if (select status from public.orders where id=oid)<>'paid' or (select count(*) from public.order_item_refunds where order_id=oid)<>1 then raise exception 'Partial refund state invalid';end if;
 result:=public.manage_order_record(oid,2,actor,'record-item-refund',payload);if not (result->>'reused')::boolean then raise exception 'Duplicate completion not reused';end if;
 begin
  perform public.record_completed_full_refund(oid,oid::text,'QA-FULL-'||oid,(select amount_cents from public.orders where id=oid),now()-interval '20 minutes','Incorrect duplicate full refund',actor);
  raise exception 'Full refund accepted after partial';
 exception when sqlstate 'P0001' then if sqlerrm<>'REFUND_PARTIAL_ALREADY_RECORDED' then raise;end if;end;
 select public.create_fulfilment_batch(school_id,ordering_period_id,'Management exclusion QA',actor) into batch from public.orders where id=oid;
 if exists(select 1 from public.fulfilment_batch_items where batch_id=(batch->>'id')::uuid and order_item_id=item) or not exists(select 1 from public.fulfilment_batch_items where batch_id=(batch->>'id')::uuid and order_item_id=otheritem) then raise exception 'Batch included refunded book or excluded paid book';end if;
 perform public.transition_fulfilment_batch((batch->>'id')::uuid,'cancelled',actor,true);
 result:=public.manage_order_record(oid,3,actor,'record-refund-request',jsonb_build_object('reason','Second emailed book request','item_ids',jsonb_build_array(otheritem),'email_received_at',now()-interval '1 hour'));rid:=(result->>'request_id')::uuid;
 perform public.manage_order_record(oid,4,actor,'review-refund-request',jsonb_build_object('request_id',rid,'decision','approved','reason','Approved second selected book'));
 payload:=jsonb_build_object('request_id',rid,'provider_payment_id',oid::text,'provider_refund_reference','QA-SECOND-'||oid,'refunded_at',now()-interval '10 minutes','reason','Completed second external book refund','confirm_external_refund',true);
 perform public.manage_order_record(oid,5,actor,'record-item-refund',payload);
 if (select status from public.orders where id=oid)<>'refunded' or (select status from public.payment_attempts where order_id=oid)<>'refunded' or (select sum(amount_cents) from public.order_item_refunds where order_id=oid)<>(select amount_cents from public.orders where id=oid) then raise exception 'All-book refund did not become terminal';end if;
 other:=pg_temp.management_fixture();
 update public.learners set class_name='Historical class' where order_id=other;
 select jsonb_build_object('reason','Correct details from received parent email','parent',jsonb_build_object('first_name','Corrected','last_name',parent_last_name,'email',parent_email,'mobile',parent_mobile),'learners',(select jsonb_agg(jsonb_build_object('id',id,'first_name',first_name,'last_name',last_name)) from public.learners where order_id=other)) into payload from public.orders where id=other;
 perform public.manage_order_record(other,0,actor,'correct-details',payload);
 if not exists(select 1 from public.order_original_details where order_id=other) or not exists(select 1 from public.audit_events where entity_id=other::text and action='order_details_corrected') or (select parent_first_name from public.orders where id=other)<>'Corrected' then raise exception 'Correction snapshot/audit missing';end if;
 if exists(select 1 from public.learners where order_id=other and class_name is distinct from 'Historical class') then raise exception 'Correction changed historical class data';end if;
 begin perform public.manage_order_record(other,1,actor,'correct-details',jsonb_set(payload,'{learners,0,class_name}','"Attempted class change"'::jsonb));raise exception 'Class change accepted';exception when sqlstate 'P0001' then if sqlerrm<>'MANAGEMENT_ITEMS_INVALID' then raise;end if;end;
 if (select management_version from public.orders where id=other)<>1 or exists(select 1 from public.learners where order_id=other and class_name is distinct from 'Historical class') then raise exception 'Rejected class change mutated history';end if;
 begin perform public.manage_order_record(other,0,actor,'correct-details',payload);raise exception 'Stale version accepted';exception when sqlstate 'P0001' then if sqlerrm<>'MANAGEMENT_VERSION_CONFLICT' then raise;end if;end;
 if has_table_privilege('anon','public.order_item_refunds','select') or has_table_privilege('authenticated','public.order_refund_requests','select') or has_table_privilege('service_role','public.order_item_refunds','update') or has_function_privilege('authenticated','public.manage_order_record(uuid,integer,uuid,text,jsonb)','execute') then raise exception 'Management grants too broad';end if;
end;$$;
do $$
declare oid uuid;other uuid;actor uuid;item uuid;foreign_item uuid;rid uuid;payload jsonb;
begin
 select auth_user_id into strict actor from public.staff_access_approvals where email='technical@awaldstudio.com' and active;
 oid:=pg_temp.management_fixture();other:=pg_temp.management_fixture();
 select id into item from public.order_items where order_id=oid order by id limit 1;
 select id into foreign_item from public.order_items where order_id=other order by id limit 1;
 payload:=jsonb_build_object('reason','Request for selected book','item_ids',jsonb_build_array(item),'email_received_at',now()-interval '1 hour');
 begin
  perform public.manage_order_record(oid,0,gen_random_uuid(),'record-refund-request',payload);
  raise exception 'Unauthorized actor accepted';
 exception when sqlstate 'P0001' then if sqlerrm<>'MANAGEMENT_ADMIN_REQUIRED' then raise;end if;end;
 begin
  perform public.manage_order_record(oid,0,actor,'record-refund-request',jsonb_set(payload,'{item_ids}',jsonb_build_array(foreign_item)));
  raise exception 'Foreign order item accepted';
 exception when sqlstate 'P0001' then if sqlerrm<>'MANAGEMENT_ITEMS_INVALID' then raise;end if;end;
 if exists(select 1 from public.order_refund_requests where order_id=oid) or (select management_version from public.orders where id=oid)<>0 then raise exception 'Rejected request changed records';end if;
 rid:=(public.manage_order_record(oid,0,actor,'record-refund-request',payload)->>'request_id')::uuid;
 perform public.manage_order_record(oid,1,actor,'review-refund-request',jsonb_build_object('request_id',rid,'decision','approved','reason','Approved selected book only'));
 payload:=jsonb_build_object('request_id',rid,'provider_payment_id','wrong-payment','provider_refund_reference','QA-WRONG-'||oid,'refunded_at',now()-interval '30 minutes','reason','Completed external refund evidence','confirm_external_refund',true);
 begin
  perform public.manage_order_record(oid,2,actor,'record-item-refund',payload);
  raise exception 'Incorrect payment accepted';
 exception when sqlstate 'P0001' then if sqlerrm<>'MANAGEMENT_PAYMENT_REQUIRED' then raise;end if;end;
 if exists(select 1 from public.order_item_refunds where order_id=oid) or (select management_version from public.orders where id=oid)<>2 or (select status from public.order_refund_requests where id=rid)<>'approved' then raise exception 'Rejected receipt poisoned approved request';end if;
 payload:=jsonb_set(payload,'{provider_payment_id}',to_jsonb(oid::text));
 perform public.manage_order_record(oid,2,actor,'record-item-refund',payload);
 begin
  perform public.manage_order_record(oid,3,actor,'record-refund-request',jsonb_build_object('reason','Repeat refunded book request','item_ids',jsonb_build_array(item),'email_received_at',now()-interval '1 hour'));
  raise exception 'Already refunded book accepted';
 exception when sqlstate 'P0001' then if sqlerrm<>'MANAGEMENT_ITEMS_INVALID' then raise;end if;end;
end;$$;
select 'PASS: email request, approval without money, per-book refund, repeated completion, full-refund guard, batch exclusion, all-book terminal state, original details/audit/version, private grants, denied actors, foreign items and receipts' as result;
rollback;
