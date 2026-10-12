-- Cost prices are restricted (P17): only roles with core.products.view_cost
-- may see them. Stock movements carry a unit cost, so the column is no longer
-- readable directly; stock_movements_v shows it to permitted roles only.
-- (Writing a cost on a receipt is still allowed: that needs no read access.)

revoke select on public.stock_movements from authenticated;
grant select (id, company_id, branch_id, number, movement_type, product_id, from_location_id, to_location_id,
              quantity, source_doctype, source_id, notes, created_by, created_at, updated_at, docstatus,
              amended_from, submitted_at, submitted_by, cancelled_at, cancelled_by, cancel_reason)
  on public.stock_movements to authenticated;

create view public.stock_movements_v as
select m.id, m.company_id, m.branch_id, m.number, m.movement_type, m.product_id, m.from_location_id, m.to_location_id,
       m.quantity, m.source_doctype, m.source_id, m.notes, m.created_by, m.created_at, m.updated_at, m.docstatus,
       m.amended_from, m.submitted_at, m.submitted_by, m.cancelled_at, m.cancelled_by, m.cancel_reason,
       case when app.can(m.company_id, 'core.products.view_cost') then m.unit_cost end as unit_cost
from public.stock_movements m
where app.can(m.company_id, 'inventory.view');
revoke all on public.stock_movements_v from anon, authenticated;
grant select on public.stock_movements_v to authenticated;

insert into public.restricted_fields (doctype, column_name, permission_code)
values ('stock_movement', 'unit_cost', 'core.products.view_cost');

create or replace function public.apply_offline_operation(p_company uuid, p_device_id text, p_client_op_id text,
                                               p_op_type text, p_target text, p_payload jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_existing public.offline_operations;
  v_cols     text;
  v_result   jsonb;
  v_error    text;
  v_status   text := 'applied';
  v_payload  jsonb := coalesce(p_payload, '{}'::jsonb);
  v_ret      text;
begin
  select * into v_existing from public.offline_operations
  where company_id = p_company and device_id = p_device_id and client_op_id = p_client_op_id;
  if found then
    return jsonb_build_object('status', v_existing.status, 'result', v_existing.result,
                              'error', v_existing.error, 'duplicate', true);
  end if;

  if public.device_status(p_company, p_device_id) <> 'ok' then
    raise exception 'this device cannot sync' using errcode = 'insufficient_privilege';
  end if;

  -- Only the id and number go back to the device (not whole rows, which may
  -- hold columns the user is not allowed to read).
  v_ret := case when exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = p_target and column_name = 'number')
                then 'jsonb_build_object(''id'', id, ''number'', number)' else 'jsonb_build_object(''id'', id)' end;

  begin
    if p_op_type = 'insert' then
      if not exists (select 1 from public.offline_targets where target = p_target) then
        raise exception 'offline changes to % are not supported', p_target;
      end if;
      v_payload := v_payload || jsonb_build_object('company_id', p_company);
      select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = p_target and v_payload ? c.column_name;
      execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) returning %3$s',
                     p_target, v_cols, v_ret)
        into v_result using v_payload;
      v_result := jsonb_build_object('id', v_result->'id', 'number', v_result->'number');
    elsif p_op_type = 'submit' then
      if not exists (select 1 from public.offline_targets where target = p_target and can_submit) then
        raise exception 'offline submission of % is not supported', p_target;
      end if;
      execute format('update public.%I set docstatus = 1 where id = $1 and company_id = $2 and docstatus = 0 returning %s',
                     p_target, v_ret)
        into v_result using (v_payload->>'id')::uuid, p_company;
      if v_result is null then
        raise exception 'document not found or already submitted';
      end if;
      v_result := jsonb_build_object('id', v_result->'id', 'number', v_result->'number');
    else
      raise exception 'unknown operation %', p_op_type;
    end if;
  exception when others then
    v_status := 'rejected';
    v_error  := sqlerrm;
    v_result := null;
  end;

  perform set_config('app.offline_apply', 'on', true);
  perform public.log_offline_operation(p_company, p_device_id, p_client_op_id, p_op_type, p_target,
                                       p_payload, v_status, v_error, v_result);
  return jsonb_build_object('status', v_status, 'result', v_result, 'error', v_error, 'duplicate', false);
end;
$$;
