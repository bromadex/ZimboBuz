-- Shared document model (issue #26, master plan §5.3 and §12.4). Built once and
-- used by every module:
--   * doctypes catalogue: every kind of record, its module and view permission;
--   * document lifecycle: Draft (0) → Submitted (1, locked) → Cancelled (2),
--     with Amended copies linked to the cancelled original; enforced by triggers;
--   * naming series: INV-HQ-2026-0001 per company, document type, branch and year,
--     with number blocks reserved for offline devices;
--   * activity panel: messages, notes, followers and scheduled activities on any record;
--   * connections registry: which document types link to which (for counts);
--   * restricted fields: columns hidden from roles without a permission.

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table public.doctypes (
  code             text primary key check (code ~ '^[a-z_]+$'),
  name             text not null,
  module_code      text not null references public.modules(code),
  table_name       text not null,                 -- public table holding the records
  view_permission  text not null references public.permissions(code),
  create_permission text not null references public.permissions(code),
  prefix           text check (prefix ~ '^[A-Z]{2,5}$'),  -- null: not numbered
  is_submittable   boolean not null default false
);

insert into public.doctypes (code, name, module_code, table_name, view_permission, create_permission, prefix, is_submittable) values
  ('customer',       'Customer',       'core',      'customers',       'core.customers.view', 'core.customers.create', null,  false),
  ('supplier',       'Supplier',       'core',      'suppliers',       'core.customers.view', 'core.customers.create', null,  false),
  ('product',        'Product',        'core',      'products',        'core.products.view',  'core.products.create',  null,  false),
  ('quote',          'Quote',          'sales',     'quotes',          'sales.view',          'sales.quote.create',    'QUO', true),
  ('sales_invoice',  'Invoice',        'sales',     'sales_invoices',  'sales.view',          'sales.invoice.create',  'INV', true),
  ('credit_note',    'Credit note',    'sales',     'credit_notes',    'sales.view',          'sales.invoice.create',  'CRN', true),
  ('payment',        'Payment',        'sales',     'payments',        'sales.view',          'sales.payment.record',  'PAY', true),
  ('pos_sale',       'Till sale',      'pos',       'pos_sales',       'pos.view',            'pos.sell',              'POS', true),
  ('till_session',   'Till session',   'pos',       'till_sessions',   'pos.view',            'pos.till.open',         'TIL', true),
  ('stock_movement', 'Stock movement', 'inventory', 'stock_movements', 'inventory.view',      'inventory.move',        'STM', true),
  ('stock_take',     'Stock take',     'inventory', 'stock_takes',     'inventory.view',      'inventory.stocktake',   'STK', true);

create table public.doctype_links (
  from_doctype  text not null references public.doctypes(code),
  to_doctype    text not null references public.doctypes(code),
  link_column   text not null check (link_column ~ '^[a-z_]+$'),  -- column on to_doctype's table
  label         text not null,
  primary key (from_doctype, to_doctype, link_column)
);

insert into public.doctype_links (from_doctype, to_doctype, link_column, label) values
  ('customer',      'quote',          'customer_id', 'Quotes'),
  ('customer',      'sales_invoice',  'customer_id', 'Invoices'),
  ('customer',      'payment',        'customer_id', 'Payments'),
  ('customer',      'pos_sale',       'customer_id', 'Till sales'),
  ('quote',         'sales_invoice',  'quote_id',    'Invoices'),
  ('sales_invoice', 'payment',        'invoice_id',  'Payments'),
  ('sales_invoice', 'credit_note',    'invoice_id',  'Credit notes'),
  ('product',       'stock_movement', 'product_id',  'Stock movements'),
  ('till_session',  'pos_sale',       'till_session_id', 'Sales');

create table public.restricted_fields (
  doctype          text not null references public.doctypes(code),
  column_name      text not null check (column_name ~ '^[a-z_]+$'),
  permission_code  text not null references public.permissions(code),
  primary key (doctype, column_name)
);

insert into public.restricted_fields (doctype, column_name, permission_code) values
  ('product',  'cost_price',      'core.products.view_cost'),
  ('product',  'margin',          'core.products.view_cost'),
  ('product',  'supplier_price',  'core.products.view_cost'),
  ('customer', 'credit_limit',    'sales.credit.manage');

-- True when the signed-in user may see field p_column of p_doctype.
create function app.can_see_field(p_company uuid, p_doctype text, p_column text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select app.can(p_company, rf.permission_code)
     from public.restricted_fields rf
     where rf.doctype = p_doctype and rf.column_name = p_column),
    app.is_member(p_company));
$$;

-- True when the signed-in user may view records of p_doctype.
create function app.can_view_doctype(p_company uuid, p_doctype text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select app.can(p_company, d.view_permission) from public.doctypes d where d.code = p_doctype),
    false);
$$;

grant execute on function app.can_see_field(uuid, text, text), app.can_view_doctype(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Naming series
-- ---------------------------------------------------------------------------

create table public.naming_counters (
  company_id  uuid not null references public.companies(id),
  doctype     text not null references public.doctypes(code),
  branch_id   uuid not null,
  year        integer not null check (year between 2000 and 2999),
  last_value  bigint not null default 0 check (last_value >= 0),
  primary key (company_id, doctype, branch_id, year),
  foreign key (company_id, branch_id) references public.branches(company_id, id)
);

-- Number ranges handed to offline devices so documents numbered offline never clash.
create table public.device_number_blocks (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies(id),
  device_id    text not null,
  doctype      text not null references public.doctypes(code),
  branch_id    uuid not null,
  year         integer not null,
  first_value  bigint not null,
  last_value   bigint not null check (last_value >= first_value),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  foreign key (company_id, branch_id) references public.branches(company_id, id)
);

create function app.format_document_number(p_prefix text, p_branch_code text, p_year integer, p_value bigint)
returns text
language sql immutable
as $$
  select p_prefix || '-' || p_branch_code || '-' || p_year || '-' || lpad(p_value::text, 4, '0');
$$;

-- Reserves p_count consecutive numbers and returns the first and last values.
create function app.reserve_numbers(p_company uuid, p_doctype text, p_branch uuid, p_year integer, p_count integer)
returns table (first_value bigint, last_value bigint)
language sql security definer set search_path = ''
as $$
  insert into public.naming_counters as nc (company_id, doctype, branch_id, year, last_value)
  values (p_company, p_doctype, p_branch, p_year, p_count)
  on conflict (company_id, doctype, branch_id, year)
  do update set last_value = nc.last_value + excluded.last_value
  returning last_value - p_count + 1, last_value;
$$;

-- Next document number, e.g. INV-HQ-2026-0001. Atomic under concurrency.
create function app.next_document_number(p_company uuid, p_doctype text, p_branch uuid,
                                          p_on date default current_date)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_prefix text;
  v_branch text;
  v_year   integer := extract(year from p_on)::integer;
  v_value  bigint;
begin
  select d.prefix into v_prefix from public.doctypes d where d.code = p_doctype;
  if v_prefix is null then
    raise exception 'document type % is not numbered', p_doctype using errcode = 'invalid_parameter_value';
  end if;
  select b.code into strict v_branch from public.branches b where b.id = p_branch and b.company_id = p_company;
  select r.last_value into v_value from app.reserve_numbers(p_company, p_doctype, p_branch, v_year, 1) r;
  return app.format_document_number(v_prefix, v_branch, v_year, v_value);
end;
$$;

-- Gives an offline device a block of numbers; the caller needs the doctype's create permission.
create function public.allocate_number_block(p_company uuid, p_doctype text, p_branch uuid,
                                             p_device text, p_size integer default 100)
returns table (prefix text, branch_code text, year integer, first_value bigint, last_value bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_doc    public.doctypes;
  v_branch text;
  v_year   integer := extract(year from current_date)::integer;
  v_first  bigint;
  v_last   bigint;
begin
  if p_size not between 1 and 1000 then
    raise exception 'block size must be between 1 and 1000' using errcode = 'invalid_parameter_value';
  end if;
  select * into strict v_doc from public.doctypes where code = p_doctype;
  if v_doc.prefix is null or not app.can(p_company, v_doc.create_permission) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select b.code into strict v_branch from public.branches b where b.id = p_branch and b.company_id = p_company;
  select r.first_value, r.last_value into v_first, v_last
  from app.reserve_numbers(p_company, p_doctype, p_branch, v_year, p_size) r;
  insert into public.device_number_blocks (company_id, device_id, doctype, branch_id, year, first_value, last_value, created_by)
  values (p_company, p_device, p_doctype, p_branch, v_year, v_first, v_last, auth.uid());
  return query select v_doc.prefix, v_branch, v_year, v_first, v_last;
end;
$$;

revoke execute on function app.reserve_numbers(uuid, text, uuid, integer, integer),
                           app.next_document_number(uuid, text, uuid, date) from public;
grant execute on function app.next_document_number(uuid, text, uuid, date) to service_role;
revoke execute on function public.allocate_number_block(uuid, text, uuid, text, integer) from public, anon;
grant execute on function public.allocate_number_block(uuid, text, uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Activity panel
-- ---------------------------------------------------------------------------

create table public.record_messages (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  doctype     text not null references public.doctypes(code),
  record_id   uuid not null,
  kind        text not null check (kind in ('message','note','system')),
  body        text not null check (length(body) between 1 and 10000),
  author_id   uuid,
  created_at  timestamptz not null default now()
);

create table public.record_followers (
  company_id  uuid not null references public.companies(id),
  doctype     text not null references public.doctypes(code),
  record_id   uuid not null,
  user_id     uuid not null references auth.users(id),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (company_id, doctype, record_id, user_id)
);

create table public.record_activities (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  doctype        text not null references public.doctypes(code),
  record_id      uuid not null,
  activity_type  text not null check (activity_type in ('call','meeting','todo','email','visit')),
  summary        text not null check (length(summary) between 1 and 500),
  due_on         date not null,
  assigned_to    uuid not null references auth.users(id),
  status         text not null default 'open' check (status in ('open','done','cancelled')),
  notified_at    timestamptz,
  created_by     uuid not null default auth.uid(),
  created_at     timestamptz not null default now(),
  done_at        timestamptz
);

create index on public.record_messages   (company_id, doctype, record_id, created_at);
create index on public.record_activities (company_id, doctype, record_id);
create index record_activities_due on public.record_activities (due_on) where status = 'open';

create trigger record_messages_append_only before update or delete on public.record_messages
  for each row execute function app.forbid_change();

-- Writes a system line in a record's timeline (used by the lifecycle trigger).
create function app.log_system_message(p_company uuid, p_doctype text, p_record uuid, p_body text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.record_messages (company_id, doctype, record_id, kind, body, author_id)
  values (p_company, p_doctype, p_record, 'system', p_body, auth.uid());
$$;
revoke execute on function app.log_system_message(uuid, text, uuid, text) from public;

-- Raises activity.due events for open activities that are due and not yet
-- notified. Run by the scheduler (service_role); returns the number raised.
create function app.emit_due_activities(p_on date default current_date)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  for v_row in
    update public.record_activities
    set notified_at = now()
    where status = 'open' and notified_at is null and due_on <= p_on
    returning id, company_id, doctype, record_id, assigned_to, summary, due_on
  loop
    perform app.emit_event(v_row.company_id, 'activity.due', v_row.doctype, v_row.record_id::text,
      jsonb_build_object('activity_id', v_row.id, 'assigned_to', v_row.assigned_to,
                         'summary', v_row.summary, 'due_on', v_row.due_on));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function app.emit_due_activities(date) from public;
grant execute on function app.emit_due_activities(date) to service_role;

-- ---------------------------------------------------------------------------
-- Document lifecycle
-- ---------------------------------------------------------------------------

-- Guards every submittable document table:
--   * a submitted document can only move to cancelled (with a reason);
--   * a cancelled document can never change;
--   * drafts cannot jump straight to cancelled (archive them instead);
--   * submitting and cancelling stamp who and when, write a timeline line and
--     emit document.submitted / document.cancelled.
create function app.document_lifecycle()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_doctype text := tg_argv[0];
  v_locked  constant text[] := array['docstatus','submitted_at','submitted_by','cancelled_at',
                                     'cancelled_by','cancel_reason','updated_at'];
begin
  if tg_op = 'INSERT' then
    if new.docstatus <> 0 then
      raise exception 'documents must be created as drafts' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.docstatus = 2 then
    raise exception 'cancelled documents cannot be changed' using errcode = 'check_violation';
  end if;

  if old.docstatus = 1 then
    if new.docstatus <> 2 then
      raise exception 'submitted documents are locked; cancel and amend instead' using errcode = 'check_violation';
    end if;
    if (to_jsonb(new) - v_locked) is distinct from (to_jsonb(old) - v_locked) then
      raise exception 'submitted documents are locked; only cancellation is allowed' using errcode = 'check_violation';
    end if;
    if coalesce(trim(new.cancel_reason), '') = '' then
      raise exception 'a reason is required to cancel' using errcode = 'check_violation';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := auth.uid();
    perform app.log_system_message(new.company_id, v_doctype, new.id, 'Cancelled: ' || new.cancel_reason);
    perform app.emit_event(new.company_id, 'document.cancelled', v_doctype, new.id::text,
                           jsonb_build_object('reason', new.cancel_reason));
    return new;
  end if;

  -- draft
  if new.docstatus = 2 then
    raise exception 'drafts cannot be cancelled; archive them instead' using errcode = 'check_violation';
  end if;
  if new.docstatus = 1 then
    new.submitted_at := now();
    new.submitted_by := auth.uid();
    perform app.log_system_message(new.company_id, v_doctype, new.id, 'Submitted');
    perform app.emit_event(new.company_id, 'document.submitted', v_doctype, new.id::text, '{}'::jsonb);
  end if;
  return new;
end;
$$;

-- Adds lifecycle columns and the guard trigger to a document table. Used by
-- later migrations when they create a submittable table.
create function app.enable_document_lifecycle(p_table regclass, p_doctype text)
returns void
language plpgsql
as $$
begin
  execute format($f$
    alter table %1$s
      add column if not exists docstatus smallint not null default 0 check (docstatus in (0, 1, 2)),
      add column if not exists amended_from uuid,
      add column if not exists submitted_at timestamptz,
      add column if not exists submitted_by uuid,
      add column if not exists cancelled_at timestamptz,
      add column if not exists cancelled_by uuid,
      add column if not exists cancel_reason text
  $f$, p_table);
  execute format('create trigger document_lifecycle before insert or update on %s
                  for each row execute function app.document_lifecycle(%L)', p_table, p_doctype);
end;
$$;
revoke execute on function app.enable_document_lifecycle(regclass, text) from public;

-- ---------------------------------------------------------------------------
-- Connections: linked-record counts for the panel and smart buttons
-- ---------------------------------------------------------------------------

-- Runs as the caller, so row-level security applies to every count. Link
-- targets whose tables do not exist yet are skipped.
create function public.record_connections(p_company uuid, p_doctype text, p_record uuid)
returns table (doctype text, link_column text, label text, record_count bigint)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_link record;
  v_n    bigint;
begin
  for v_link in
    select l.to_doctype, l.link_column, l.label, d.table_name
    from public.doctype_links l join public.doctypes d on d.code = l.to_doctype
    where l.from_doctype = p_doctype
    order by l.label
  loop
    if to_regclass('public.' || v_link.table_name) is null then
      continue;
    end if;
    execute format('select count(*) from public.%I where company_id = $1 and %I = $2',
                   v_link.table_name, v_link.link_column)
      into v_n using p_company, p_record;
    doctype := v_link.to_doctype; link_column := v_link.link_column;
    label := v_link.label; record_count := v_n;
    return next;
  end loop;
end;
$$;
grant execute on function public.record_connections(uuid, text, uuid) to authenticated;

-- True when p_user is an active member of the company (activities can only be
-- assigned to colleagues).
create function app.is_member_user(p_company uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.memberships m
                 where m.company_id = p_company and m.user_id = p_user and m.status = 'active');
$$;
grant execute on function app.is_member_user(uuid, uuid) to authenticated, service_role;

-- Activities keep their record and creator; completing one stamps done_at.
create function app.activity_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.company_id, new.doctype, new.record_id, new.created_by, new.created_at)
     is distinct from (old.company_id, old.doctype, old.record_id, old.created_by, old.created_at) then
    raise exception 'an activity cannot be moved to another record or creator' using errcode = 'check_violation';
  end if;
  if new.status = 'done' and old.status <> 'done' then
    new.done_at := now();
  end if;
  if new.due_on is distinct from old.due_on then
    new.notified_at := null;
  end if;
  return new;
end;
$$;

create trigger record_activities_guard before update on public.record_activities
  for each row execute function app.activity_guard();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.doctypes             enable row level security;
alter table public.doctype_links        enable row level security;
alter table public.restricted_fields    enable row level security;
alter table public.naming_counters      enable row level security;
alter table public.device_number_blocks enable row level security;
alter table public.record_messages      enable row level security;
alter table public.record_followers     enable row level security;
alter table public.record_activities    enable row level security;

create policy catalogue_read on public.doctypes          for select to authenticated using (true);
create policy catalogue_read on public.doctype_links     for select to authenticated using (true);
create policy catalogue_read on public.restricted_fields for select to authenticated using (true);

create policy member_read on public.naming_counters      for select to authenticated using (app.is_member(company_id));
create policy member_read on public.device_number_blocks for select to authenticated using (app.is_member(company_id));

-- Timeline: visible to anyone who can view the record type.
create policy viewer_read on public.record_messages for select to authenticated
  using (app.can_view_doctype(company_id, doctype));
create policy viewer_post on public.record_messages for insert to authenticated
  with check (app.can_view_doctype(company_id, doctype) and kind in ('message','note') and author_id = auth.uid());

create policy viewer_read on public.record_followers for select to authenticated
  using (app.can_view_doctype(company_id, doctype));
create policy self_follow on public.record_followers for insert to authenticated
  with check (app.can_view_doctype(company_id, doctype) and user_id = auth.uid());
create policy self_unfollow on public.record_followers for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and app.can_view_doctype(company_id, doctype));

create policy viewer_read on public.record_activities for select to authenticated
  using (app.can_view_doctype(company_id, doctype));
create policy viewer_plan on public.record_activities for insert to authenticated
  with check (app.can_view_doctype(company_id, doctype) and created_by = auth.uid()
              and app.is_member_user(company_id, assigned_to));
create policy owner_update on public.record_activities for update to authenticated
  using (app.can_view_doctype(company_id, doctype) and auth.uid() in (assigned_to, created_by))
  with check (app.can_view_doctype(company_id, doctype) and app.is_member_user(company_id, assigned_to));

revoke all on public.doctypes, public.doctype_links, public.restricted_fields, public.naming_counters,
              public.device_number_blocks, public.record_messages, public.record_followers,
              public.record_activities from anon, authenticated;
grant select on public.doctypes, public.doctype_links, public.restricted_fields,
                public.naming_counters, public.device_number_blocks to authenticated;
grant select, insert on public.record_messages to authenticated;
grant select, insert, update on public.record_followers, public.record_activities to authenticated;
