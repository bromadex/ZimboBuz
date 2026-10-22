-- ZimERP core platform: companies, plans, modules, feature switches, branches,
-- roles and permissions, memberships, the can() access rule, plan limits and
-- the audit trail. See docs/ZimERP-master-plan.md §12.2–§12.4 and §14.
--
-- Rules every later migration follows:
--   * every business table has company_id and row-level security;
--   * nothing is hard-deleted (no DELETE grants or policies; archive instead);
--   * writes are checked with app.can(company_id, permission_code).

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Global catalogue (same for every company, maintained by ZimERP migrations)
-- ---------------------------------------------------------------------------

create table public.plans (
  code             text primary key,
  name             text not null,
  price_usd_cents  integer not null check (price_usd_cents >= 0),
  max_full_users   integer check (max_full_users > 0),   -- null = unlimited
  max_modules      integer check (max_modules >= 0),     -- non-core modules that count; null = unlimited
  max_branches     integer check (max_branches > 0),     -- null = unlimited
  sort_order       integer not null
);

create table public.modules (
  code                 text primary key,
  name                 text not null,
  is_core              boolean not null default false,  -- always on, never counted
  counts_toward_limit  boolean not null default true,
  sort_order           integer not null
);

create table public.plan_modules (
  plan_code    text not null references public.plans(code),
  module_code  text not null references public.modules(code),
  primary key (plan_code, module_code)
);

create table public.features (
  code         text primary key,
  module_code  text not null references public.modules(code),
  name         text not null,
  default_on   boolean not null
);

create table public.permissions (
  code          text primary key,
  module_code   text not null references public.modules(code),
  feature_code  text references public.features(code),
  action        text not null check (action in ('view','create','edit','submit','approve','void','refund','manage','export')),
  light_ok      boolean not null default false,  -- allowed for light (low-cost) users
  description   text not null
);

create table public.role_templates (
  role_code        text not null,
  role_name        text not null,
  permission_code  text not null references public.permissions(code),
  primary key (role_code, permission_code)
);

-- ---------------------------------------------------------------------------
-- Company-scoped platform tables
-- ---------------------------------------------------------------------------

create table public.companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  slug           text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$'),
  plan_code      text not null references public.plans(code),
  status         text not null default 'active' check (status in ('active','grace','read_only','suspended')),
  base_currency  char(3) not null default 'USD' check (base_currency in ('USD','ZWG','ZAR')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz
);

create table public.company_domains (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  hostname     text not null unique check (hostname = lower(hostname) and hostname ~ '^[a-z0-9.-]+$'),
  kind         text not null check (kind in ('website','store','erp')),
  is_primary   boolean not null default false,
  verified_at  timestamptz,
  ssl_status   text not null default 'pending' check (ssl_status in ('pending','issued','failed')),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz
);

create table public.company_branding (
  company_id       uuid primary key references public.companies(id),
  primary_color    text not null default '#0b6e4f' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color  text not null default '#c98f00' check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color     text not null default '#b42318' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  font_pair        text not null default 'modern' check (font_pair in ('modern','classic','friendly','technical')),
  theme_mode       text not null default 'system' check (theme_mode in ('light','dark','system')),
  motion_level     text not null default 'subtle' check (motion_level in ('off','subtle','rich')),
  corner_style     text not null default 'rounded' check (corner_style in ('square','rounded','pill')),
  logo_path        text,
  logo_mono_path   text,
  icon_path        text,
  updated_at       timestamptz not null default now()
);

create table public.company_modules (
  company_id   uuid not null references public.companies(id),
  module_code  text not null references public.modules(code),
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now(),
  primary key (company_id, module_code)
);

create table public.company_features (
  company_id    uuid not null references public.companies(id),
  feature_code  text not null references public.features(code),
  enabled       boolean not null,
  updated_at    timestamptz not null default now(),
  primary key (company_id, feature_code)
);

create table public.branches (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  code            text not null check (code ~ '^[A-Z0-9]{2,6}$'),
  name            text not null,
  is_head_office  boolean not null default false,
  created_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (company_id, code),
  unique (company_id, id)
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  code        text not null check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name        text not null,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (company_id, code),
  unique (company_id, id)
);

create table public.role_permissions (
  company_id       uuid not null,
  role_id          uuid not null,
  permission_code  text not null references public.permissions(code),
  primary key (role_id, permission_code),
  foreign key (company_id, role_id) references public.roles(company_id, id)
);

create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  user_id     uuid not null references auth.users(id),
  role_id     uuid not null,
  user_type   text not null default 'full' check (user_type in ('full','light')),
  status      text not null default 'active' check (status in ('invited','active','disabled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, user_id),
  foreign key (company_id, role_id) references public.roles(company_id, id)
);

create table public.audit_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id),
  table_name  text not null,
  record_id   text not null,
  action      text not null check (action in ('insert','update')),
  actor_id    uuid,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);

create index on public.company_domains (company_id);
create index on public.branches (company_id);
create index on public.roles (company_id);
create index on public.role_permissions (company_id);
create index on public.memberships (user_id);
create index on public.audit_events (company_id, at desc);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

-- True when the signed-in user has an active membership of the company.
create function app.is_member(p_company uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.companies c on c.id = m.company_id
    where m.company_id = p_company
      and m.user_id = auth.uid()
      and m.status = 'active'
      and c.archived_at is null
  );
$$;

-- The one access rule (§12.3): the company's plan includes the module, the
-- company has the module and feature switched on, and the user's role grants
-- the permission. Read-only companies may only view; suspended companies get
-- nothing; light users only get permissions marked light_ok.
create function app.can(p_company uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.companies c        on c.id = m.company_id
    join public.permissions p      on p.code = p_permission
    join public.modules mo         on mo.code = p.module_code
    join public.role_permissions rp on rp.role_id = m.role_id and rp.permission_code = p.code
    where m.company_id = p_company
      and m.user_id = auth.uid()
      and m.status = 'active'
      and c.archived_at is null
      and c.status <> 'suspended'
      and (c.status <> 'read_only' or p.action in ('view','export'))
      and (m.user_type = 'full' or p.light_ok)
      and (
        mo.is_core
        or (
          exists (select 1 from public.plan_modules pm
                  where pm.plan_code = c.plan_code and pm.module_code = mo.code)
          and exists (select 1 from public.company_modules cm
                      where cm.company_id = c.id and cm.module_code = mo.code and cm.enabled)
        )
      )
      and (
        p.feature_code is null
        or coalesce(
             (select cf.enabled from public.company_features cf
              where cf.company_id = c.id and cf.feature_code = p.feature_code),
             (select f.default_on from public.features f where f.code = p.feature_code)
           )
      )
  );
$$;

grant execute on function app.is_member(uuid), app.can(uuid, text) to authenticated, service_role;

-- Permissions the signed-in user has in a company (for hiding unavailable UI).
create function public.my_permissions(p_company uuid)
returns setof text
language sql stable security definer set search_path = ''
as $$
  select p.code from public.permissions p where app.can(p_company, p.code) order by p.code;
$$;
grant execute on function public.my_permissions(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Plan limits
-- ---------------------------------------------------------------------------

-- Runs AFTER the row is written, i.e. after row-level security has accepted
-- it, so a refused cross-company write never reveals another company's plan.
create function app.enforce_plan_limits()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan  public.plans;
  v_count integer;
begin
  select pl.* into v_plan
  from public.companies c join public.plans pl on pl.code = c.plan_code
  where c.id = new.company_id;

  if tg_table_name = 'memberships' then
    if new.user_type = 'full' and new.status = 'active' and v_plan.max_full_users is not null then
      select count(*) into v_count from public.memberships
      where company_id = new.company_id and user_type = 'full' and status = 'active';
      if v_count > v_plan.max_full_users then
        raise exception 'plan % allows % full users', v_plan.code, v_plan.max_full_users
          using errcode = 'check_violation';
      end if;
    end if;

  elsif tg_table_name = 'company_modules' then
    if new.enabled then
      if not exists (select 1 from public.modules where code = new.module_code and is_core)
         and not exists (select 1 from public.plan_modules
                         where plan_code = v_plan.code and module_code = new.module_code) then
        raise exception 'module % is not available on plan %', new.module_code, v_plan.code
          using errcode = 'check_violation';
      end if;
      if v_plan.max_modules is not null then
        select count(*) into v_count
        from public.company_modules cm join public.modules mo on mo.code = cm.module_code
        where cm.company_id = new.company_id and cm.enabled and mo.counts_toward_limit and not mo.is_core;
        if v_count > v_plan.max_modules then
          raise exception 'plan % allows % modules', v_plan.code, v_plan.max_modules
            using errcode = 'check_violation';
        end if;
      end if;
    end if;

  elsif tg_table_name = 'branches' then
    if new.archived_at is null and v_plan.max_branches is not null then
      select count(*) into v_count from public.branches
      where company_id = new.company_id and archived_at is null;
      if v_count > v_plan.max_branches then
        raise exception 'plan % allows % branches', v_plan.code, v_plan.max_branches
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return null;
end;
$$;

create trigger memberships_plan_limits after insert or update on public.memberships
  for each row execute function app.enforce_plan_limits();
create trigger company_modules_plan_limits after insert or update on public.company_modules
  for each row execute function app.enforce_plan_limits();
create trigger branches_plan_limits after insert or update on public.branches
  for each row execute function app.enforce_plan_limits();

-- ---------------------------------------------------------------------------
-- Audit trail (append-only, written by triggers)
-- ---------------------------------------------------------------------------

create function app.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row     jsonb := to_jsonb(new);
  v_company uuid;
  v_record  text;
begin
  v_company := case when tg_table_name = 'companies' then (v_row->>'id')::uuid
                    else (v_row->>'company_id')::uuid end;
  v_record  := coalesce(v_row->>'id', v_row->>'company_id');
  insert into public.audit_events (company_id, table_name, record_id, action, actor_id, before, after)
  values (v_company, tg_table_name, v_record, lower(tg_op), auth.uid(),
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end;
$$;

create function app.forbid_change()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows cannot be changed or deleted', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function app.forbid_change();

create function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['companies','company_domains','company_branding','company_modules',
                           'company_features','branches','roles','memberships'] loop
    execute format('create trigger %I_audit after insert or update on public.%I
                    for each row execute function app.audit_row()', t, t);
  end loop;
  foreach t in array array['companies','company_branding','company_modules','company_features','memberships'] loop
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function app.touch_updated_at()', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.plans            enable row level security;
alter table public.modules          enable row level security;
alter table public.plan_modules     enable row level security;
alter table public.features         enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_templates   enable row level security;
alter table public.companies        enable row level security;
alter table public.company_domains  enable row level security;
alter table public.company_branding enable row level security;
alter table public.company_modules  enable row level security;
alter table public.company_features enable row level security;
alter table public.branches         enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.memberships      enable row level security;
alter table public.audit_events     enable row level security;

-- Catalogue: readable by any signed-in user, written only by migrations.
create policy catalogue_read on public.plans          for select to authenticated using (true);
create policy catalogue_read on public.modules        for select to authenticated using (true);
create policy catalogue_read on public.plan_modules   for select to authenticated using (true);
create policy catalogue_read on public.features       for select to authenticated using (true);
create policy catalogue_read on public.permissions    for select to authenticated using (true);
create policy catalogue_read on public.role_templates for select to authenticated using (true);

-- Companies: members read; admins edit. New companies come from create_company().
create policy member_read  on public.companies for select to authenticated using (app.is_member(id));
create policy admin_update on public.companies for update to authenticated
  using (app.can(id, 'admin.company.edit')) with check (app.can(id, 'admin.company.edit'));

-- Company configuration: members read; the matching admin permission writes.
create policy member_read on public.company_domains  for select to authenticated using (app.is_member(company_id));
create policy admin_write on public.company_domains  for insert to authenticated with check (app.can(company_id, 'admin.domains.manage'));
create policy admin_edit  on public.company_domains  for update to authenticated using (app.can(company_id, 'admin.domains.manage')) with check (app.can(company_id, 'admin.domains.manage'));

create policy member_read on public.company_branding for select to authenticated using (app.is_member(company_id));
create policy admin_write on public.company_branding for insert to authenticated with check (app.can(company_id, 'admin.branding.edit'));
create policy admin_edit  on public.company_branding for update to authenticated using (app.can(company_id, 'admin.branding.edit')) with check (app.can(company_id, 'admin.branding.edit'));

create policy member_read on public.company_modules  for select to authenticated using (app.is_member(company_id));
create policy admin_write on public.company_modules  for insert to authenticated with check (app.can(company_id, 'admin.modules.manage'));
create policy admin_edit  on public.company_modules  for update to authenticated using (app.can(company_id, 'admin.modules.manage')) with check (app.can(company_id, 'admin.modules.manage'));

create policy member_read on public.company_features for select to authenticated using (app.is_member(company_id));
create policy admin_write on public.company_features for insert to authenticated with check (app.can(company_id, 'admin.modules.manage'));
create policy admin_edit  on public.company_features for update to authenticated using (app.can(company_id, 'admin.modules.manage')) with check (app.can(company_id, 'admin.modules.manage'));

create policy member_read on public.branches for select to authenticated using (app.is_member(company_id));
create policy admin_write on public.branches for insert to authenticated with check (app.can(company_id, 'admin.branches.manage'));
create policy admin_edit  on public.branches for update to authenticated using (app.can(company_id, 'admin.branches.manage')) with check (app.can(company_id, 'admin.branches.manage'));

create policy member_read on public.roles for select to authenticated using (app.is_member(company_id));
create policy admin_write on public.roles for insert to authenticated with check (app.can(company_id, 'admin.roles.manage'));
create policy admin_edit  on public.roles for update to authenticated using (app.can(company_id, 'admin.roles.manage')) with check (app.can(company_id, 'admin.roles.manage'));

create policy member_read on public.role_permissions for select to authenticated using (app.is_member(company_id));
create policy admin_write on public.role_permissions for insert to authenticated with check (app.can(company_id, 'admin.roles.manage'));

create policy member_read on public.memberships for select to authenticated using (app.is_member(company_id));
create policy admin_write on public.memberships for insert to authenticated with check (app.can(company_id, 'admin.users.manage'));
create policy admin_edit  on public.memberships for update to authenticated using (app.can(company_id, 'admin.users.manage')) with check (app.can(company_id, 'admin.users.manage'));

create policy auditor_read on public.audit_events for select to authenticated using (app.can(company_id, 'admin.audit.view'));

-- Privileges: no DELETE anywhere (archive instead); catalogue is read-only.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.plans, public.modules, public.plan_modules, public.features,
                public.permissions, public.role_templates to authenticated;
grant select, insert, update on public.companies, public.company_domains, public.company_branding,
                public.company_modules, public.company_features, public.branches, public.roles,
                public.memberships to authenticated;
grant select, insert on public.role_permissions to authenticated;
grant select on public.audit_events to authenticated;
revoke insert on public.companies from authenticated;  -- only through create_company()

-- ---------------------------------------------------------------------------
-- Company creation (sign-up)
-- ---------------------------------------------------------------------------

create function public.create_company(
  p_name text,
  p_slug text,
  p_plan text default 'starter',
  p_modules text[] default array['pos'],
  p_base_currency char(3) default 'USD'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_company uuid;
  v_role    record;
  v_owner   uuid;
  v_module  text;
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;

  insert into public.companies (name, slug, plan_code, base_currency)
  values (p_name, lower(p_slug), p_plan, p_base_currency)
  returning id into v_company;

  insert into public.company_branding (company_id) values (v_company);
  insert into public.branches (company_id, code, name, is_head_office)
  values (v_company, 'HQ', 'Head office', true);

  for v_role in select distinct role_code, role_name from public.role_templates loop
    with r as (
      insert into public.roles (company_id, code, name, is_system)
      values (v_company, v_role.role_code, v_role.role_name, true)
      returning id
    )
    insert into public.role_permissions (company_id, role_id, permission_code)
    select v_company, r.id, t.permission_code
    from r, public.role_templates t
    where t.role_code = v_role.role_code;
  end loop;

  select id into v_owner from public.roles where company_id = v_company and code = 'owner';
  insert into public.memberships (company_id, user_id, role_id, user_type, status)
  values (v_company, v_user, v_owner, 'full', 'active');

  foreach v_module in array coalesce(p_modules, array[]::text[]) loop
    insert into public.company_modules (company_id, module_code, enabled)
    values (v_company, v_module, true);
  end loop;

  insert into public.company_domains (company_id, hostname, kind, is_primary, verified_at, ssl_status)
  values (v_company, lower(p_slug) || '.zimerp.co.zw', 'website', true, now(), 'issued');

  return v_company;
end;
$$;

revoke execute on function public.create_company(text, text, text, text[], char) from public, anon;
grant execute on function public.create_company(text, text, text, text[], char) to authenticated;

-- ---------------------------------------------------------------------------
-- Catalogue data (Release 1)
-- ---------------------------------------------------------------------------

insert into public.plans (code, name, price_usd_cents, max_full_users, max_modules, max_branches, sort_order) values
  ('starter',    'Starter',    0,     1,    1,    1,    1),
  ('business',   'Business',   2900,  5,    3,    1,    2),
  ('growth',     'Growth',     7900,  15,   6,    2,    3),
  ('pro',        'Pro',        19900, 50,   null, 5,    4),
  ('enterprise', 'Enterprise', 49900, null, null, null, 5);

insert into public.modules (code, name, is_core, counts_toward_limit, sort_order) values
  ('core',      'Core',                  true,  false, 0),
  ('pos',       'Point of sale',         false, true,  1),
  ('sales',     'Quotes and invoicing',  false, true,  2),
  ('inventory', 'Inventory',             false, true,  3),
  ('website',   'Website and store',     false, false, 4),
  ('portal',    'Customer portal',       false, true,  5);

insert into public.plan_modules (plan_code, module_code)
select p.code, m.code
from public.plans p cross join public.modules m
where not m.is_core
  and not (p.code = 'starter' and m.code in ('inventory','portal'));

insert into public.features (code, module_code, name, default_on) values
  ('pos.split_tender',      'pos',       'Split payments across currencies and methods', true),
  ('pos.change_as_credit',  'pos',       'Give change as store credit or voucher',       true),
  ('pos.ecocash_express',   'pos',       'EcoCash express checkout',                     true),
  ('pos.discounts',         'pos',       'Discounts at the till',                        true),
  ('pos.offline',           'pos',       'Offline selling',                              true),
  ('sales.quotes',          'sales',     'Quotations',                                   true),
  ('sales.credit_book',     'sales',     'Credit book (customer accounts)',              true),
  ('inventory.stock_takes', 'inventory', 'Stock takes',                                  true),
  ('inventory.negative',    'inventory', 'Allow negative stock',                         false),
  ('website.buy',           'website',   'Online checkout (Buy)',                        true),
  ('website.add_to_quote',  'website',   'Add to quote',                                 true);

insert into public.permissions (code, module_code, feature_code, action, light_ok, description) values
  -- administration (core)
  ('admin.company.edit',     'core', null, 'manage', false, 'Edit company details'),
  ('admin.branding.edit',    'core', null, 'manage', false, 'Edit the brand kit'),
  ('admin.modules.manage',   'core', null, 'manage', false, 'Switch modules and features'),
  ('admin.branches.manage',  'core', null, 'manage', false, 'Manage branches'),
  ('admin.roles.manage',     'core', null, 'manage', false, 'Manage roles and permissions'),
  ('admin.users.manage',     'core', null, 'manage', false, 'Invite and manage users'),
  ('admin.domains.manage',   'core', null, 'manage', false, 'Manage domains'),
  ('admin.billing.manage',   'core', null, 'manage', false, 'Manage the ZimERP subscription'),
  ('admin.audit.view',       'core', null, 'view',   true,  'View the audit log'),
  -- core records
  ('core.customers.view',    'core', null, 'view',   true,  'View customers'),
  ('core.customers.create',  'core', null, 'create', false, 'Create customers'),
  ('core.customers.edit',    'core', null, 'edit',   false, 'Edit customers'),
  ('core.products.view',     'core', null, 'view',   true,  'View products'),
  ('core.products.view_cost','core', null, 'view',   false, 'See cost prices and margins'),
  ('core.products.create',   'core', null, 'create', false, 'Create products'),
  ('core.products.edit',     'core', null, 'edit',   false, 'Edit products and prices'),
  ('core.rates.manage',      'core', null, 'manage', false, 'Set exchange rates'),
  ('reports.view',           'core', null, 'view',   true,  'View reports and dashboards'),
  ('reports.export',         'core', null, 'export', true,  'Export reports'),
  -- point of sale
  ('pos.view',               'pos', null,               'view',   true,  'View sales and tills'),
  ('pos.sell',               'pos', null,               'create', false, 'Make sales'),
  ('pos.till.open',          'pos', null,               'create', false, 'Open a till session'),
  ('pos.till.close',         'pos', null,               'submit', false, 'Close and cash up a till'),
  ('pos.discount',           'pos', 'pos.discounts',    'edit',   false, 'Give discounts'),
  ('pos.void',               'pos', null,               'void',   false, 'Void sales'),
  ('pos.refund',             'pos', null,               'refund', false, 'Refund sales'),
  -- quotes and invoicing
  ('sales.view',             'sales', null,                'view',   true,  'View quotes and invoices'),
  ('sales.quote.create',     'sales', 'sales.quotes',      'create', false, 'Create quotes'),
  ('sales.invoice.create',   'sales', null,                'create', false, 'Create invoices'),
  ('sales.invoice.submit',   'sales', null,                'submit', false, 'Submit (lock) invoices'),
  ('sales.invoice.cancel',   'sales', null,                'void',   false, 'Cancel invoices'),
  ('sales.payment.record',   'sales', null,                'create', false, 'Record payments'),
  ('sales.credit.manage',    'sales', 'sales.credit_book', 'manage', false, 'Manage customer credit'),
  -- inventory
  ('inventory.view',             'inventory', null,                    'view',    true,  'View stock'),
  ('inventory.move',             'inventory', null,                    'create',  false, 'Receive, issue and transfer stock'),
  ('inventory.stocktake',        'inventory', 'inventory.stock_takes', 'create',  false, 'Count stock'),
  ('inventory.stocktake.approve','inventory', 'inventory.stock_takes', 'approve', true,  'Approve stock-take variances'),
  -- website and store
  ('website.view',           'website', null, 'view',   true,  'View website and store'),
  ('website.edit',           'website', null, 'edit',   false, 'Edit pages and products online'),
  ('website.publish',        'website', null, 'submit', false, 'Publish website changes'),
  -- customer portal
  ('portal.manage',          'portal', null, 'manage', false, 'Manage customer portal access');

-- Role templates copied into every new company.
insert into public.role_templates (role_code, role_name, permission_code)
select 'owner', 'Owner', code from public.permissions;

insert into public.role_templates (role_code, role_name, permission_code)
select 'manager', 'Manager', code from public.permissions
where code not like 'admin.%' or code = 'admin.audit.view';

insert into public.role_templates (role_code, role_name, permission_code)
select 'cashier', 'Cashier', code from public.permissions
where code in ('pos.view','pos.sell','pos.till.open','pos.till.close',
               'core.customers.view','core.customers.create','core.products.view','sales.view');

insert into public.role_templates (role_code, role_name, permission_code)
select 'storekeeper', 'Storekeeper', code from public.permissions
where code in ('inventory.view','inventory.move','inventory.stocktake','core.products.view');

insert into public.role_templates (role_code, role_name, permission_code)
select 'accountant', 'Accountant', code from public.permissions
where code like 'sales.%' or code like 'reports.%' or code like 'core.customers.%'
   or code in ('core.products.view','core.products.view_cost','inventory.view','pos.view',
               'core.rates.manage','admin.audit.view');
