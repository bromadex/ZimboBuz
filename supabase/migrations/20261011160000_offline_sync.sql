-- Offline sync, server side (issue #24, master plan §12.8):
--   * devices: every phone, tablet or till is registered to a company and
--     branch; admins can revoke a device or order a remote wipe;
--   * offline operations: actions queued on a device while offline are applied
--     exactly once when it reconnects (idempotent on device + client op id),
--     with the user's own permissions and all database rules; refused
--     operations are recorded with the reason so the device can show it.
-- The PowerSync sync rules (download side) live in powersync/sync-rules.yaml.

create table public.devices (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  branch_id      uuid not null,
  device_id      text not null check (device_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  name           text not null,
  platform       text not null check (platform in ('web','android','ios')),
  registered_by  uuid not null,
  last_seen_at   timestamptz,
  wipe_requested_at timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (company_id, device_id),
  foreign key (company_id, branch_id) references public.branches(company_id, id)
);

create table public.offline_operations (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references public.companies(id),
  device_id     text not null,
  client_op_id  text not null check (length(client_op_id) between 8 and 64),
  op_type       text not null check (op_type in ('insert','submit')),
  target        text not null,
  payload       jsonb not null,
  status        text not null check (status in ('applied','rejected')),
  error         text,
  result        jsonb,
  user_id       uuid not null,
  created_at    timestamptz not null default now(),
  unique (company_id, device_id, client_op_id),
  foreign key (company_id, device_id) references public.devices(company_id, device_id)
);

create trigger offline_operations_append_only before update or delete on public.offline_operations
  for each row execute function app.forbid_change();

-- Tables a device may insert into, and document types it may submit.
create table public.offline_targets (
  target     text primary key,
  can_submit boolean not null default false
);

insert into public.offline_targets (target, can_submit) values
  ('customers',           false),
  ('record_messages',     false),
  ('record_activities',   false),
  ('stock_movements',     true),
  ('stock_takes',         false),
  ('stock_take_lines',    false),
  ('quotes',              true),
  ('quote_lines',         false),
  ('sales_invoices',      true),
  ('sales_invoice_lines', false),
  ('payments',            true),
  ('payment_allocations', false);

-- Registers (or re-registers) the calling user's device.
create function public.register_device(p_company uuid, p_branch uuid, p_device_id text, p_name text, p_platform text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_member(p_company) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into public.devices (company_id, branch_id, device_id, name, platform, registered_by)
  values (p_company, p_branch, p_device_id, p_name, p_platform, auth.uid())
  on conflict (company_id, device_id) do update
    set name = excluded.name, branch_id = excluded.branch_id, last_seen_at = now()
    where public.devices.revoked_at is null
  returning id into v_id;
  if v_id is null then
    raise exception 'this device has been revoked' using errcode = 'insufficient_privilege';
  end if;
  return v_id;
end;
$$;

-- What a device should do when it connects: carry on, or wipe its local data.
create function public.device_status(p_company uuid, p_device_id text)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when not app.is_member(p_company) then 'denied'
    when d.id is null then 'unregistered'
    when d.wipe_requested_at is not null then 'wipe'
    when d.revoked_at is not null then 'revoked'
    else 'ok' end
  from (select 1) x
  left join public.devices d on d.company_id = p_company and d.device_id = p_device_id;
$$;

-- Admin actions: revoke a lost device and order its local data to be wiped.
create function public.revoke_device(p_device uuid, p_wipe boolean default true)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := (select company_id from public.devices where id = p_device);
begin
  if v_company is null or not app.can(v_company, 'admin.users.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.devices
  set revoked_at = coalesce(revoked_at, now()),
      wipe_requested_at = case when p_wipe then coalesce(wipe_requested_at, now()) else wipe_requested_at end
  where id = p_device;
end;
$$;

-- Applies one queued operation exactly once and returns its outcome:
--   {"status": "applied", "result": {...}} or {"status": "rejected", "error": "..."}
-- Runs as the caller, so row-level security and every trigger apply.
--   op_type 'insert': payload is the new row; company_id is forced to p_company.
--   op_type 'submit': payload is {"id": uuid}; sets docstatus to 1.
create function public.apply_offline_operation(p_company uuid, p_device_id text, p_client_op_id text,
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

  begin
    if p_op_type = 'insert' then
      if not exists (select 1 from public.offline_targets where target = p_target) then
        raise exception 'offline changes to % are not supported', p_target;
      end if;
      v_payload := v_payload || jsonb_build_object('company_id', p_company);
      select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = p_target and v_payload ? c.column_name;
      execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) returning to_jsonb(%1$I.*)',
                     p_target, v_cols)
        into v_result using v_payload;
      v_result := jsonb_build_object('id', v_result->'id', 'number', v_result->'number');
    elsif p_op_type = 'submit' then
      if not exists (select 1 from public.offline_targets where target = p_target and can_submit) then
        raise exception 'offline submission of % is not supported', p_target;
      end if;
      execute format('update public.%I set docstatus = 1 where id = $1 and company_id = $2 and docstatus = 0 returning to_jsonb(%I.*)',
                     p_target, p_target)
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

-- Records the outcome as the system. Only reachable from apply_offline_operation
-- (which sets app.offline_apply for the transaction); clients cannot set that
-- setting through the API, so they cannot write log entries themselves.
create function public.log_offline_operation(p_company uuid, p_device_id text, p_client_op_id text,
                                             p_op_type text, p_target text, p_payload jsonb,
                                             p_status text, p_error text, p_result jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if current_setting('app.offline_apply', true) is distinct from 'on' then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.offline_apply', 'off', true);
  insert into public.offline_operations (company_id, device_id, client_op_id, op_type, target, payload,
                                         status, error, result, user_id)
  values (p_company, p_device_id, p_client_op_id, p_op_type, p_target, coalesce(p_payload, '{}'::jsonb),
          p_status, p_error, p_result, auth.uid());
  update public.devices set last_seen_at = now() where company_id = p_company and device_id = p_device_id;
end;
$$;

revoke execute on function public.register_device(uuid, uuid, text, text, text),
                           public.device_status(uuid, text),
                           public.revoke_device(uuid, boolean),
                           public.apply_offline_operation(uuid, text, text, text, text, jsonb),
                           public.log_offline_operation(uuid, text, text, text, text, jsonb, text, text, jsonb)
  from public, anon;
grant execute on function public.register_device(uuid, uuid, text, text, text),
                          public.device_status(uuid, text),
                          public.revoke_device(uuid, boolean),
                          public.apply_offline_operation(uuid, text, text, text, text, jsonb)
  to authenticated;
-- log_offline_operation is only reachable through apply_offline_operation.
grant execute on function public.log_offline_operation(uuid, text, text, text, text, jsonb, text, text, jsonb)
  to authenticated;

alter table public.devices            enable row level security;
alter table public.offline_operations enable row level security;
alter table public.offline_targets    enable row level security;

create policy catalogue_read on public.offline_targets for select to authenticated using (true);
create policy member_read on public.devices for select to authenticated
  using (registered_by = auth.uid() or app.can(company_id, 'admin.users.manage'));
create policy own_read on public.offline_operations for select to authenticated
  using (user_id = auth.uid() or app.can(company_id, 'admin.audit.view'));

revoke all on public.devices, public.offline_operations, public.offline_targets from anon, authenticated;
grant select on public.devices, public.offline_operations, public.offline_targets to authenticated;
