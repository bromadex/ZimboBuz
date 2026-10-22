-- Core records shared by every module (issue #25, master plan §4.2, §6.1, §6.2):
-- company tax settings, VAT rates, company-set exchange rates, customers (with
-- de-duplication by email or phone, as in Bromadex), suppliers, products and
-- per-currency prices.
--
-- Money is stored as integer minor units (cents) with an explicit currency.
-- Exchange rates are "units of the currency per 1 unit of the company's base
-- currency"; the base currency's rate is always 1.

-- ---------------------------------------------------------------------------
-- Company tax settings
-- ---------------------------------------------------------------------------

alter table public.companies
  add column vat_registered     boolean not null default false,
  add column vat_number         text,
  add column prices_include_tax boolean not null default true;

-- ---------------------------------------------------------------------------
-- VAT rates (statutory data, effective-dated; see §6.4)
-- ---------------------------------------------------------------------------

create table public.tax_rates (
  code            text not null check (code in ('standard','zero_rated','exempt')),
  rate_bp         integer not null check (rate_bp between 0 and 10000),  -- basis points: 1500 = 15%
  effective_from  date not null,
  primary key (code, effective_from)
);

-- Rates to be confirmed by the accountant/tax adviser (issue #5) before launch.
insert into public.tax_rates (code, rate_bp, effective_from) values
  ('standard',   1500, '2000-01-01'),
  ('standard',   1550, '2025-01-01'),
  ('zero_rated', 0,    '2000-01-01'),
  ('exempt',     0,    '2000-01-01');

-- VAT rate in basis points for a tax code on a date; 0 when the company is not VAT-registered.
create function app.tax_rate_bp(p_company uuid, p_code text, p_on date)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case
    when not (select vat_registered from public.companies where id = p_company) then 0
    else coalesce((select t.rate_bp from public.tax_rates t
                   where t.code = p_code and t.effective_from <= p_on
                   order by t.effective_from desc limit 1), 0)
  end;
$$;

-- ---------------------------------------------------------------------------
-- Exchange rates (set by each company; history kept, never edited)
-- ---------------------------------------------------------------------------

create table public.exchange_rates (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references public.companies(id),
  currency      char(3) not null check (currency in ('USD','ZWG','ZAR')),
  rate          numeric(20,8) not null check (rate > 0),
  effective_at  timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

create index on public.exchange_rates (company_id, currency, effective_at desc);

create trigger exchange_rates_append_only before update or delete on public.exchange_rates
  for each row execute function app.forbid_change();

create function app.check_exchange_rate()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.currency = (select base_currency from public.companies where id = new.company_id) then
    raise exception 'the base currency always has rate 1' using errcode = 'check_violation';
  end if;
  perform app.emit_event(new.company_id, 'rate.changed', 'exchange_rate', new.id::text,
    jsonb_build_object('currency', new.currency, 'rate', new.rate, 'effective_at', new.effective_at));
  return new;
end;
$$;

create trigger exchange_rates_check after insert on public.exchange_rates
  for each row execute function app.check_exchange_rate();

-- Rate for a currency at a moment: 1 for the base currency, otherwise the
-- latest rate effective at that time. Errors if none has been set.
create function app.rate_at(p_company uuid, p_currency char(3), p_at timestamptz default now())
returns numeric
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rate numeric;
begin
  if p_currency = (select base_currency from public.companies where id = p_company) then
    return 1;
  end if;
  select r.rate into v_rate from public.exchange_rates r
  where r.company_id = p_company and r.currency = p_currency and r.effective_at <= p_at
  order by r.effective_at desc, r.id desc limit 1;
  if v_rate is null then
    raise exception 'no exchange rate set for %', p_currency using errcode = 'no_data_found';
  end if;
  return v_rate;
end;
$$;

-- Converts minor units from one currency to another at given rates (half-up).
create function app.convert_cents(p_cents bigint, p_from_rate numeric, p_to_rate numeric)
returns bigint
language sql immutable
as $$
  select round(p_cents::numeric / p_from_rate * p_to_rate)::bigint;
$$;

grant execute on function app.rate_at(uuid, char, timestamptz), app.convert_cents(bigint, numeric, numeric)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Customers and suppliers
-- ---------------------------------------------------------------------------

-- Last 9 digits of a phone number, so +263 77 123 4567 and 0771234567 match.
create function app.phone_key(p_phone text)
returns text
language sql immutable
as $$
  select nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9), '');
$$;

create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  name                text not null check (length(trim(name)) > 0),
  email               text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone               text,
  phone_key           text generated always as (app.phone_key(phone)) stored,
  whatsapp            text,
  company_name        text,
  vat_number          text,
  currency            char(3) not null default 'USD' check (currency in ('USD','ZWG','ZAR')),
  credit_limit_cents  bigint check (credit_limit_cents >= 0),
  notes               text,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,
  unique (company_id, id)
);

create unique index customers_email_unique on public.customers (company_id, lower(email))
  where email is not null and archived_at is null;
create unique index customers_phone_unique on public.customers (company_id, phone_key)
  where phone_key is not null and archived_at is null;

create table public.suppliers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  name         text not null check (length(trim(name)) > 0),
  email        text,
  phone        text,
  vat_number   text,
  tax_clearance_expires_on date,   -- ITF263, for withholding tax (Wave 2)
  currency     char(3) not null default 'USD' check (currency in ('USD','ZWG','ZAR')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  unique (company_id, id)
);

-- Finds a live customer by email or phone, or creates one. Used by website
-- enquiries and the POS so the same person is never entered twice.
create function app.match_or_create_customer(p_company uuid, p_name text, p_email text, p_phone text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select c.id into v_id from public.customers c
  where c.company_id = p_company and c.archived_at is null
    and ((p_email is not null and lower(c.email) = lower(trim(p_email)))
      or (app.phone_key(p_phone) is not null and c.phone_key = app.phone_key(p_phone)))
  order by (lower(c.email) = lower(trim(p_email))) desc nulls last, c.created_at
  limit 1;
  if v_id is null then
    insert into public.customers (company_id, name, email, phone, currency)
    values (p_company, coalesce(nullif(trim(p_name), ''), 'Customer'), nullif(lower(trim(p_email)), ''), nullif(trim(p_phone), ''),
            (select base_currency from public.companies where id = p_company))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function app.match_or_create_customer(uuid, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- Products and prices
-- ---------------------------------------------------------------------------

create table public.products (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  sku            text not null check (length(trim(sku)) > 0),
  barcode        text,
  name           text not null check (length(trim(name)) > 0),
  description    text,
  unit           text not null default 'each',
  is_stock_item  boolean not null default true,
  tax_code       text not null default 'standard' check (tax_code in ('standard','zero_rated','exempt')),
  reorder_level  numeric(14,3) check (reorder_level >= 0),
  avg_cost       numeric(18,4) not null default 0 check (avg_cost >= 0),  -- base-currency cents; maintained by stock movements
  show_online    boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz,
  unique (company_id, sku),
  unique (company_id, id)
);

create unique index products_barcode_unique on public.products (company_id, barcode)
  where barcode is not null and archived_at is null;

create table public.product_prices (
  company_id   uuid not null,
  product_id   uuid not null,
  currency     char(3) not null check (currency in ('USD','ZWG','ZAR')),
  price_cents  bigint not null check (price_cents >= 0),
  updated_at   timestamptz not null default now(),
  primary key (product_id, currency),
  foreign key (company_id, product_id) references public.products(company_id, id)
);

-- Selling price in a currency: the explicit price if set, otherwise the base
-- price converted at the current rate. Null when neither exists.
create function app.price_cents(p_company uuid, p_product uuid, p_currency char(3))
returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_base  char(3) := (select base_currency from public.companies where id = p_company);
  v_price bigint;
begin
  select price_cents into v_price from public.product_prices
  where company_id = p_company and product_id = p_product and currency = p_currency;
  if v_price is not null or p_currency = v_base then
    return v_price;
  end if;
  select price_cents into v_price from public.product_prices
  where company_id = p_company and product_id = p_product and currency = v_base;
  if v_price is null then
    return null;
  end if;
  return app.convert_cents(v_price, 1, app.rate_at(p_company, p_currency));
end;
$$;
grant execute on function app.price_cents(uuid, uuid, char) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['customers','suppliers','products','product_prices'] loop
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['customers','suppliers','products'] loop
    execute format('create trigger %I_audit after insert or update on public.%I
                    for each row execute function app.audit_row()', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions added by this migration
-- ---------------------------------------------------------------------------

insert into public.permissions (code, module_code, feature_code, action, light_ok, description) values
  ('core.suppliers.view',   'core', null, 'view',   true,  'View suppliers'),
  ('core.suppliers.create', 'core', null, 'create', false, 'Create suppliers'),
  ('core.suppliers.edit',   'core', null, 'edit',   false, 'Edit suppliers'),
  ('core.accounts.view',    'core', null, 'view',   true,  'View the ledger and financial statements'),
  ('core.accounts.post',    'core', null, 'create', false, 'Post manual journal entries'),
  ('core.settings.tax',     'core', null, 'manage', false, 'Change VAT settings');

insert into public.role_templates (role_code, role_name, permission_code) values
  ('owner', 'Owner', 'core.suppliers.view'), ('owner', 'Owner', 'core.suppliers.create'),
  ('owner', 'Owner', 'core.suppliers.edit'), ('owner', 'Owner', 'core.accounts.view'),
  ('owner', 'Owner', 'core.accounts.post'),  ('owner', 'Owner', 'core.settings.tax'),
  ('manager', 'Manager', 'core.suppliers.view'), ('manager', 'Manager', 'core.suppliers.create'),
  ('manager', 'Manager', 'core.suppliers.edit'), ('manager', 'Manager', 'core.accounts.view'),
  ('storekeeper', 'Storekeeper', 'core.suppliers.view'),
  ('accountant', 'Accountant', 'core.suppliers.view'), ('accountant', 'Accountant', 'core.suppliers.create'),
  ('accountant', 'Accountant', 'core.suppliers.edit'), ('accountant', 'Accountant', 'core.accounts.view'),
  ('accountant', 'Accountant', 'core.accounts.post'),  ('accountant', 'Accountant', 'core.settings.tax');

update public.doctypes set view_permission = 'core.suppliers.view', create_permission = 'core.suppliers.create'
where code = 'supplier';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.tax_rates      enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.customers      enable row level security;
alter table public.suppliers      enable row level security;
alter table public.products       enable row level security;
alter table public.product_prices enable row level security;

create policy catalogue_read on public.tax_rates for select to authenticated using (true);

create policy member_read on public.exchange_rates for select to authenticated using (app.is_member(company_id));
create policy rate_setter on public.exchange_rates for insert to authenticated
  with check (app.can(company_id, 'core.rates.manage') and created_by = auth.uid());

create policy viewer_read on public.customers for select to authenticated using (app.can(company_id, 'core.customers.view'));
create policy creator     on public.customers for insert to authenticated with check (app.can(company_id, 'core.customers.create'));
create policy editor      on public.customers for update to authenticated
  using (app.can(company_id, 'core.customers.edit')) with check (app.can(company_id, 'core.customers.edit'));

create policy viewer_read on public.suppliers for select to authenticated using (app.can(company_id, 'core.suppliers.view'));
create policy creator     on public.suppliers for insert to authenticated with check (app.can(company_id, 'core.suppliers.create'));
create policy editor      on public.suppliers for update to authenticated
  using (app.can(company_id, 'core.suppliers.edit')) with check (app.can(company_id, 'core.suppliers.edit'));

create policy viewer_read on public.products for select to authenticated using (app.can(company_id, 'core.products.view'));
create policy creator     on public.products for insert to authenticated with check (app.can(company_id, 'core.products.create'));
create policy editor      on public.products for update to authenticated
  using (app.can(company_id, 'core.products.edit')) with check (app.can(company_id, 'core.products.edit'));

create policy viewer_read on public.product_prices for select to authenticated using (app.can(company_id, 'core.products.view'));
create policy creator     on public.product_prices for insert to authenticated with check (app.can(company_id, 'core.products.edit'));
create policy editor      on public.product_prices for update to authenticated
  using (app.can(company_id, 'core.products.edit')) with check (app.can(company_id, 'core.products.edit'));

revoke all on public.tax_rates, public.exchange_rates, public.customers, public.suppliers,
              public.products, public.product_prices from anon, authenticated;
grant select on public.tax_rates to authenticated;
grant select, insert on public.exchange_rates to authenticated;
grant select, insert, update on public.customers, public.suppliers, public.product_prices to authenticated;
-- Products: every column except avg_cost (maintained by stock movements; hidden
-- from roles without core.products.view_cost). Read cost through products_v.
grant select (id, company_id, sku, barcode, name, description, unit, is_stock_item, tax_code,
              reorder_level, show_online, created_at, updated_at, archived_at)
  on public.products to authenticated;
grant insert (id, company_id, sku, barcode, name, description, unit, is_stock_item, tax_code,
              reorder_level, show_online, archived_at),
      update (sku, barcode, name, description, unit, is_stock_item, tax_code,
              reorder_level, show_online, archived_at)
  on public.products to authenticated;

-- Product list with cost shown only to roles that may see it (P17). The view
-- runs as its owner, so it applies the company/permission filter itself.
create view public.products_v as
select p.id, p.company_id, p.sku, p.barcode, p.name, p.description, p.unit, p.is_stock_item, p.tax_code,
       p.reorder_level, p.show_online, p.created_at, p.updated_at, p.archived_at,
       case when app.can(p.company_id, 'core.products.view_cost') then p.avg_cost end as avg_cost
from public.products p
where app.can(p.company_id, 'core.products.view');
revoke all on public.products_v from anon, authenticated;
grant select on public.products_v to authenticated;
