-- Inventory (issue #25 / P7, ported from Bromadex): stock only changes through
-- submitted stock movements; stock never goes negative unless the company
-- switches on inventory.negative; weighted-average cost; stock.low events;
-- automatic ledger postings; stock takes that turn variances into adjustments.

-- ---------------------------------------------------------------------------
-- Locations (every branch gets a default MAIN location)
-- ---------------------------------------------------------------------------

create table public.stock_locations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  branch_id    uuid not null,
  code         text not null check (code ~ '^[A-Z0-9-]{2,12}$'),
  name         text not null,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  archived_at  timestamptz,
  unique (company_id, branch_id, code),
  unique (company_id, id),
  foreign key (company_id, branch_id) references public.branches(company_id, id)
);

create unique index stock_locations_one_default on public.stock_locations (branch_id) where is_default;

create function app.create_default_location()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.stock_locations (company_id, branch_id, code, name, is_default)
  values (new.company_id, new.id, 'MAIN', 'Main store', true);
  return null;
end;
$$;

create trigger branches_default_location after insert on public.branches
  for each row execute function app.create_default_location();

-- ---------------------------------------------------------------------------
-- Stock levels (maintained only by movements)
-- ---------------------------------------------------------------------------

create table public.stock_levels (
  company_id   uuid not null,
  product_id   uuid not null,
  location_id  uuid not null,
  quantity     numeric(14,3) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (location_id, product_id),
  foreign key (company_id, product_id) references public.products(company_id, id),
  foreign key (company_id, location_id) references public.stock_locations(company_id, id)
);

create index on public.stock_levels (company_id, product_id);

-- ---------------------------------------------------------------------------
-- Stock movements
-- ---------------------------------------------------------------------------

create table public.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  branch_id         uuid not null,
  number            text,
  movement_type     text not null check (movement_type in
                    ('receipt','return_in','adjustment_in','issue','sale','adjustment_out','transfer')),
  product_id        uuid not null,
  from_location_id  uuid,
  to_location_id    uuid,
  quantity          numeric(14,3) not null check (quantity > 0),
  unit_cost         numeric(18,4) check (unit_cost >= 0),   -- base-currency cents per unit
  source_doctype    text references public.doctypes(code),
  source_id         uuid,
  notes             text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, number),
  foreign key (company_id, branch_id) references public.branches(company_id, id),
  foreign key (company_id, product_id) references public.products(company_id, id),
  foreign key (company_id, from_location_id) references public.stock_locations(company_id, id),
  foreign key (company_id, to_location_id) references public.stock_locations(company_id, id),
  check (case
    when movement_type in ('receipt','return_in','adjustment_in') then to_location_id is not null and from_location_id is null
    when movement_type in ('issue','sale','adjustment_out')      then from_location_id is not null and to_location_id is null
    else from_location_id is not null and to_location_id is not null and from_location_id <> to_location_id
  end),
  check (movement_type not in ('receipt','adjustment_in') or unit_cost is not null)
);

create index on public.stock_movements (company_id, product_id);
create index on public.stock_movements (company_id, source_doctype, source_id);

select app.enable_document_lifecycle('public.stock_movements', 'stock_movement');

create trigger stock_movements_touch before update on public.stock_movements
  for each row execute function app.touch_updated_at();

-- True when a company has a feature switched on (falls back to the default).
create function app.feature_enabled(p_company uuid, p_feature text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select enabled from public.company_features where company_id = p_company and feature_code = p_feature),
    (select default_on from public.features where code = p_feature),
    false);
$$;

-- On submission, outbound and return movements take the product's current average cost.
create function app.stock_movement_cost()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.docstatus = 0 and new.docstatus = 1 then
    if not (select is_stock_item from public.products where id = new.product_id) then
      raise exception 'this product is not a stock item' using errcode = 'check_violation';
    end if;
    if new.movement_type in ('issue','sale','adjustment_out','return_in','transfer') then
      new.unit_cost := (select avg_cost from public.products where id = new.product_id);
    end if;
  end if;
  return new;
end;
$$;

create trigger stock_movements_set_cost before update on public.stock_movements
  for each row execute function app.stock_movement_cost();

create function app.change_stock_level(p_company uuid, p_product uuid, p_location uuid, p_delta numeric)
returns numeric
language plpgsql security definer set search_path = ''
as $$
declare
  v_qty numeric;
begin
  insert into public.stock_levels as l (company_id, product_id, location_id, quantity)
  values (p_company, p_product, p_location, p_delta)
  on conflict (location_id, product_id)
  do update set quantity = l.quantity + excluded.quantity, updated_at = now()
  returning quantity into v_qty;
  if v_qty < 0 and not app.feature_enabled(p_company, 'inventory.negative') then
    raise exception 'not enough stock: this would leave % at the location', v_qty
      using errcode = 'check_violation';
  end if;
  return v_qty;
end;
$$;

-- Applies (submit) or reverses (cancel) a movement: levels, average cost,
-- ledger and low-stock alerts.
create function app.apply_stock_movement()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_sign      integer;
  v_before    numeric;
  v_after     numeric;
  v_avg       numeric;
  v_reorder   numeric;
  v_value     bigint;
  v_debit     text;
  v_credit    text;
begin
  if old.docstatus = 0 and new.docstatus = 1 then
    v_sign := 1;
  elsif old.docstatus = 1 and new.docstatus = 2 then
    v_sign := -1;
  else
    return null;
  end if;

  select coalesce(sum(quantity), 0) into v_before
  from public.stock_levels where product_id = new.product_id;
  select avg_cost, reorder_level into v_avg, v_reorder
  from public.products where id = new.product_id for update;

  if new.from_location_id is not null then
    perform app.change_stock_level(new.company_id, new.product_id, new.from_location_id, -v_sign * new.quantity);
  end if;
  if new.to_location_id is not null then
    perform app.change_stock_level(new.company_id, new.product_id, new.to_location_id, v_sign * new.quantity);
  end if;

  select coalesce(sum(quantity), 0) into v_after
  from public.stock_levels where product_id = new.product_id;

  -- Weighted average cost moves only with receipts and positive adjustments.
  if new.movement_type in ('receipt','adjustment_in') then
    if v_after > 0 then
      v_avg := greatest(0, (greatest(v_before, 0) * v_avg + v_sign * new.quantity * new.unit_cost) / v_after);
      update public.products set avg_cost = round(v_avg, 4) where id = new.product_id;
    end if;
  end if;

  -- Ledger: value at the movement's unit cost.
  v_value := round(new.quantity * coalesce(new.unit_cost, 0))::bigint;
  if v_value > 0 then
    if v_sign = -1 then
      perform app.reverse_source_entries(new.company_id, 'stock_movement', new.id,
                                         'Cancelled stock movement ' || coalesce(new.number, ''));
    else
      select d, c into v_debit, v_credit from (values
        ('receipt',        'inventory',         'stock_received_clearing'),
        ('adjustment_in',  'inventory',         'stock_adjustments'),
        ('return_in',      'inventory',         'cost_of_sales'),
        ('sale',           'cost_of_sales',     'inventory'),
        ('issue',          'stock_adjustments', 'inventory'),
        ('adjustment_out', 'stock_adjustments', 'inventory')
      ) as m(t, d, c) where m.t = new.movement_type;
      if v_debit is not null then
        perform app.post_entry(new.company_id, current_date,
          initcap(replace(new.movement_type, '_', ' ')) || ' ' || coalesce(new.number, ''),
          'stock_movement', new.id,
          jsonb_build_array(jsonb_build_object('account', v_debit, 'debit', v_value),
                            jsonb_build_object('account', v_credit, 'credit', v_value)));
      end if;
    end if;
  end if;

  if v_reorder is not null and v_after <= v_reorder and v_before > v_reorder then
    perform app.emit_event(new.company_id, 'stock.low', 'product', new.product_id::text,
      jsonb_build_object('quantity', v_after, 'reorder_level', v_reorder));
  end if;
  return null;
end;
$$;

create trigger stock_movements_apply after update on public.stock_movements
  for each row execute function app.apply_stock_movement();

-- ---------------------------------------------------------------------------
-- Stock takes
-- ---------------------------------------------------------------------------

create table public.stock_takes (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  branch_id    uuid not null,
  number       text,
  location_id  uuid not null,
  notes        text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, number),
  unique (company_id, id),
  foreign key (company_id, branch_id) references public.branches(company_id, id),
  foreign key (company_id, location_id) references public.stock_locations(company_id, id)
);

create table public.stock_take_lines (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  stock_take_id  uuid not null,
  product_id     uuid not null,
  counted_qty    numeric(14,3) not null check (counted_qty >= 0),
  system_qty     numeric(14,3),   -- captured when the stock take is submitted
  variance_qty   numeric(14,3),
  unique (stock_take_id, product_id),
  foreign key (company_id, stock_take_id) references public.stock_takes(company_id, id),
  foreign key (company_id, product_id) references public.products(company_id, id)
);

select app.enable_document_lifecycle('public.stock_takes', 'stock_take');

create trigger stock_takes_touch before update on public.stock_takes
  for each row execute function app.touch_updated_at();

-- Lines can only change while their parent document is a draft. Runs as the
-- caller: clients (anon/authenticated) are blocked, while the system's own
-- security definer functions (running as the owner) may record results.
create function app.draft_lines_only()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_parent_table text := tg_argv[0];
  v_parent_col   text := tg_argv[1];
  v_parent_id    uuid := (to_jsonb(coalesce(new, old))->>v_parent_col)::uuid;
  v_status       smallint;
begin
  execute format('select docstatus from public.%I where id = $1', v_parent_table) into v_status using v_parent_id;
  if v_status is distinct from 0 and current_user in ('anon', 'authenticated') then
    raise exception 'lines can only be changed while the document is a draft' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger stock_take_lines_draft before insert or update or delete on public.stock_take_lines
  for each row execute function app.draft_lines_only('stock_takes', 'stock_take_id');

-- On submission, capture system quantities and post adjustments for variances.
create function app.apply_stock_take()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_line record;
  v_mov  uuid;
begin
  if not (old.docstatus = 0 and new.docstatus = 1) then
    if old.docstatus = 1 and new.docstatus = 2 then
      -- cancelling a stock take cancels the adjustments it created
      update public.stock_movements set docstatus = 2, cancel_reason = 'Stock take ' || new.number || ' cancelled'
      where source_doctype = 'stock_take' and source_id = new.id and docstatus = 1;
    end if;
    return null;
  end if;

  for v_line in
    select l.id, l.product_id, l.counted_qty, coalesce(s.quantity, 0) as system_qty
    from public.stock_take_lines l
    left join public.stock_levels s on s.product_id = l.product_id and s.location_id = new.location_id
    where l.stock_take_id = new.id
  loop
    update public.stock_take_lines
    set system_qty = v_line.system_qty, variance_qty = v_line.counted_qty - v_line.system_qty
    where id = v_line.id;
    if v_line.counted_qty <> v_line.system_qty then
      insert into public.stock_movements (company_id, branch_id, movement_type, product_id,
                                          from_location_id, to_location_id, quantity, unit_cost,
                                          source_doctype, source_id, notes)
      values (new.company_id, new.branch_id,
              case when v_line.counted_qty > v_line.system_qty then 'adjustment_in' else 'adjustment_out' end,
              v_line.product_id,
              case when v_line.counted_qty < v_line.system_qty then new.location_id end,
              case when v_line.counted_qty > v_line.system_qty then new.location_id end,
              abs(v_line.counted_qty - v_line.system_qty),
              (select avg_cost from public.products where id = v_line.product_id),
              'stock_take', new.id, 'Stock take ' || new.number)
      returning id into v_mov;
      update public.stock_movements set docstatus = 1 where id = v_mov;
    end if;
  end loop;
  return null;
end;
$$;

create trigger stock_takes_apply after update on public.stock_takes
  for each row execute function app.apply_stock_take();

insert into public.doctype_links (from_doctype, to_doctype, link_column, label) values
  ('stock_take', 'stock_movement', 'source_id', 'Adjustments');

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.stock_locations  enable row level security;
alter table public.stock_levels     enable row level security;
alter table public.stock_movements  enable row level security;
alter table public.stock_takes      enable row level security;
alter table public.stock_take_lines enable row level security;

create policy member_read on public.stock_locations for select to authenticated using (app.is_member(company_id));
create policy admin_write on public.stock_locations for insert to authenticated with check (app.can(company_id, 'admin.branches.manage'));
create policy admin_edit  on public.stock_locations for update to authenticated
  using (app.can(company_id, 'admin.branches.manage')) with check (app.can(company_id, 'admin.branches.manage'));

create policy viewer_read on public.stock_levels for select to authenticated using (app.can(company_id, 'inventory.view'));

create policy viewer_read on public.stock_movements for select to authenticated using (app.can(company_id, 'inventory.view'));
create policy mover       on public.stock_movements for insert to authenticated with check (app.can(company_id, 'inventory.move'));
create policy mover_edit  on public.stock_movements for update to authenticated
  using (app.can(company_id, 'inventory.move')) with check (app.can(company_id, 'inventory.move'));

create policy viewer_read on public.stock_takes for select to authenticated using (app.can(company_id, 'inventory.view'));
create policy counter     on public.stock_takes for insert to authenticated with check (app.can(company_id, 'inventory.stocktake'));
-- Anyone counting may edit drafts; only approvers may submit or cancel.
create policy counter_edit on public.stock_takes for update to authenticated
  using (app.can(company_id, 'inventory.stocktake'))
  with check (app.can(company_id, 'inventory.stocktake')
              and (docstatus = 0 or app.can(company_id, 'inventory.stocktake.approve')));

create policy viewer_read on public.stock_take_lines for select to authenticated using (app.can(company_id, 'inventory.view'));
create policy counter     on public.stock_take_lines for insert to authenticated with check (app.can(company_id, 'inventory.stocktake'));
create policy counter_edit on public.stock_take_lines for update to authenticated
  using (app.can(company_id, 'inventory.stocktake')) with check (app.can(company_id, 'inventory.stocktake'));

revoke all on public.stock_locations, public.stock_levels, public.stock_movements,
              public.stock_takes, public.stock_take_lines from anon, authenticated;
grant select, insert, update on public.stock_locations to authenticated;
grant select on public.stock_levels to authenticated;
grant select, insert, update on public.stock_movements, public.stock_takes to authenticated;
grant select, insert, update (counted_qty) on public.stock_take_lines to authenticated;

-- Stock-take approval stays with owners and managers (segregation of duties):
-- storekeepers count, someone else approves.
