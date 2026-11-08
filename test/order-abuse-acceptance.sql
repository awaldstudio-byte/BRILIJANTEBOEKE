begin;
do $$
declare k text:=repeat('a',64);r text:=repeat('b',64);other text:=repeat('c',64);n integer;
begin
  if not public.consume_order_traffic_limit(repeat('e',64),1,60) then raise exception 'First traffic request denied';end if;
  if public.consume_order_traffic_limit(repeat('e',64),1,60) then raise exception 'Traffic quota exceeded';end if;
  if not public.consume_order_submission_limit(k,r,1,3600) then raise exception 'First request denied';end if;
  if not public.consume_order_submission_limit(k,r,1,3600) then raise exception 'Retry consumed creation quota';end if;
  if public.consume_order_submission_limit(k,other,1,3600) then raise exception 'Additional request exceeded quota';end if;
  if not public.consume_order_submission_limit(k,r,1,3600) then raise exception 'Existing retry blocked after quota exhausted';end if;
  select count(*) into n from public.order_submission_limit_receipts where key_hash=k;
  if n<>1 then raise exception 'Receipt duplicated or denied request retained';end if;
  if not public.consume_order_submission_limit(repeat('d',64),other,1,3600) then raise exception 'Unrelated client was blocked';end if;
  begin
    perform public.consume_order_submission_limit(null,r,1,3600);raise exception 'Null key allowed';
  exception when raise_exception then if sqlerrm='Null key allowed' then raise;end if;end;
  if has_function_privilege('anon','public.consume_order_traffic_limit(text,integer,integer)','execute')
     or has_function_privilege('authenticated','public.consume_order_traffic_limit(text,integer,integer)','execute')
     or not has_function_privilege('service_role','public.consume_order_traffic_limit(text,integer,integer)','execute')
     or has_function_privilege('anon','public.consume_order_submission_limit(text,text,integer,integer)','execute')
     or has_function_privilege('authenticated','public.consume_order_submission_limit(text,text,integer,integer)','execute')
     or has_table_privilege('anon','public.order_submission_limit_receipts','select')
     or has_table_privilege('authenticated','public.order_submission_limit_receipts','insert') then raise exception 'Quota exposed publicly';end if;
  if not (select relrowsecurity from pg_class where oid='public.order_submission_limit_receipts'::regclass) then raise exception 'RLS missing';end if;
end $$;
rollback;
