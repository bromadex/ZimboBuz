-- Own domains, done properly (master plan §10.2, §12.6):
--
--   * routing knows each company's main (primary) address, so the free
--     <slug>.zimerp.co.zw address and any other connected domain forward
--     visitors to the main one;
--   * companies can ask ZimERP to register a domain for them (domain_orders),
--     at prices kept in a catalogue (domain_prices), never chosen by users;
--   * higher plans may hide "Website by ZimERP" in their website footer.

-- ---------------------------------------------------------------------------
-- Routing: the main address for each area
-- ---------------------------------------------------------------------------

drop function public.resolve_site(text);

-- site_host: the verified main website address (the free ZimERP address
-- until the company makes its own domain the main one).
-- erp_host: the verified main ERP address on the company's own domain, or
-- null when the ERP uses its ZimERP address.
create function public.resolve_site(p_hostname text)
returns table (company_slug text, kind text, company_name text, site_host text, erp_host text)
language sql stable security definer set search_path = ''
as $$
  select c.slug, d.kind, c.name,
         (select p.hostname from public.company_domains p
          where p.company_id = c.id and p.kind in ('website','store') and p.is_primary
            and p.verified_at is not null and p.archived_at is null
          order by p.created_at limit 1),
         (select p.hostname from public.company_domains p
          where p.company_id = c.id and p.kind = 'erp' and p.is_primary
            and p.verified_at is not null and p.archived_at is null
          order by p.created_at limit 1)
  from public.company_domains d
  join public.companies c on c.id = d.company_id
  where d.hostname = lower(trim(trailing '.' from trim(p_hostname)))
    and d.archived_at is null
    and d.verified_at is not null
    and c.archived_at is null
    and c.status <> 'suspended';
$$;

revoke execute on function public.resolve_site(text) from public;
grant execute on function public.resolve_site(text) to anon, authenticated, service_role;

-- One main address per area: making a domain main clears the others (the
-- screen does this already; this keeps direct writes honest too).
create function app.one_primary_domain()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_primary and new.archived_at is null then
    update public.company_domains
    set is_primary = false
    where company_id = new.company_id and id <> new.id and is_primary
      and (case when kind = 'erp' then 'erp' else 'site' end) = (case when new.kind = 'erp' then 'erp' else 'site' end);
  end if;
  return new;
end;
$$;

create trigger company_domains_one_primary after insert or update of is_primary on public.company_domains
  for each row when (new.is_primary) execute function app.one_primary_domain();

-- Archiving the main website domain hands "main" back to the ZimERP address.
create function app.primary_fallback()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.archived_at is null and new.archived_at is not null and old.kind in ('website','store')
     and not exists (select 1 from public.company_domains
                     where company_id = new.company_id and kind in ('website','store') and is_primary
                       and archived_at is null and id <> new.id) then
    update public.company_domains
    set is_primary = true
    where id = (select id from public.company_domains
                where company_id = new.company_id and kind = 'website' and archived_at is null
                  and verified_at is not null and id <> new.id
                order by (hostname like '%.zimerp.co.zw') desc, created_at
                limit 1);
  end if;
  return new;
end;
$$;

create trigger company_domains_primary_fallback after update of archived_at on public.company_domains
  for each row execute function app.primary_fallback();

-- ---------------------------------------------------------------------------
-- Registering domains through ZimERP
-- ---------------------------------------------------------------------------

-- Yearly prices ZimERP charges per domain ending (USD cents).
create table public.domain_prices (
  tld                   text primary key check (tld ~ '^[a-z]+(\.[a-z]+)?$'),
  price_usd_cents_year  integer not null check (price_usd_cents_year > 0),
  note                  text,
  sort_order            integer not null
);

alter table public.domain_prices enable row level security;
create policy catalogue_read on public.domain_prices for select to anon, authenticated using (true);
revoke all on public.domain_prices from anon, authenticated;
grant select on public.domain_prices to anon, authenticated;

insert into public.domain_prices (tld, price_usd_cents_year, note, sort_order) values
  ('co.zw',  2500, 'For businesses registered in Zimbabwe.', 1),
  ('org.zw', 2500, 'For churches, NGOs and other organisations.', 2),
  ('ac.zw',  2500, 'For schools, colleges and universities (proof of registration needed).', 3),
  ('com',    1800, null, 4),
  ('org',    1800, null, 5),
  ('africa', 2500, null, 6);

create table public.domain_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  hostname      text not null check (hostname = lower(hostname) and hostname ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  years         integer not null default 1 check (years between 1 and 5),
  price_cents   bigint not null check (price_cents > 0),
  currency      char(3) not null default 'USD' check (currency = 'USD'),
  status        text not null default 'requested' check (status in ('requested','registered','failed','cancelled')),
  registrar_reference text,
  problem       text,
  requested_by  uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index on public.domain_orders (company_id, created_at desc);
create unique index domain_orders_open_unique on public.domain_orders (hostname) where status in ('requested','registered');

create trigger domain_orders_touch before update on public.domain_orders
  for each row execute function app.touch_updated_at();

alter table public.domain_orders enable row level security;
create policy admin_read on public.domain_orders for select to authenticated using (app.can(company_id, 'admin.domains.manage'));
revoke all on public.domain_orders from anon, authenticated;
grant select on public.domain_orders to authenticated;

-- Asks ZimERP to register a domain for the company. The price comes from
-- domain_prices; ZimERP adds it to the next subscription invoice.
create function public.request_domain(p_company uuid, p_hostname text, p_years integer default 1)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_host  text := lower(trim(trailing '.' from trim(p_hostname)));
  v_label text;
  v_tld   text;
  v_price integer;
  v_id    uuid;
begin
  if not app.can(p_company, 'admin.domains.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z]{2,10}){1,2}$' then
    raise exception 'please enter a domain like mybusiness.co.zw' using errcode = 'check_violation';
  end if;
  v_label := split_part(v_host, '.', 1);
  v_tld := substr(v_host, length(v_label) + 2);
  select price_usd_cents_year into v_price from public.domain_prices where tld = v_tld;
  if v_price is null then
    raise exception 'ZimERP cannot register domains ending in .% yet', v_tld using errcode = 'check_violation';
  end if;
  if v_host like '%zimerp%' then
    raise exception 'that name is not available' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.company_domains where hostname in (v_host, 'www.' || v_host) and archived_at is null) then
    raise exception 'that domain is already connected to a ZimERP company' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.domain_orders where hostname = v_host and status in ('requested','registered')) then
    raise exception 'that domain has already been ordered' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.domain_orders where company_id = p_company and status = 'requested') >= 3 then
    raise exception 'you already have three domain orders waiting; please wait for them first' using errcode = 'check_violation';
  end if;

  insert into public.domain_orders (company_id, hostname, years, price_cents)
  values (p_company, v_host, greatest(1, least(coalesce(p_years, 1), 5)), v_price::bigint * greatest(1, least(coalesce(p_years, 1), 5)))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.request_domain(uuid, text, integer) from public, anon;
grant execute on function public.request_domain(uuid, text, integer) to authenticated;

-- The company cancels an order ZimERP has not acted on yet.
create function public.cancel_domain_order(p_order uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.domain_orders where id = p_order and status = 'requested';
  if v_company is null or not app.can(v_company, 'admin.domains.manage') then
    raise exception 'that order cannot be cancelled' using errcode = 'insufficient_privilege';
  end if;
  update public.domain_orders set status = 'cancelled', completed_at = now() where id = p_order;
end;
$$;
revoke execute on function public.cancel_domain_order(uuid) from public, anon;
grant execute on function public.cancel_domain_order(uuid) to authenticated;

-- Records the registrar's answer (server only). A registered domain is
-- connected to the website straight away (both mybusiness.co.zw and
-- www.mybusiness.co.zw); the hosting check then verifies it.
create function app.complete_domain_order(p_order uuid, p_registered boolean, p_reference text default null, p_problem text default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.domain_orders;
begin
  select * into v_o from public.domain_orders where id = p_order for update;
  if v_o.id is null then
    raise exception 'unknown domain order' using errcode = 'no_data_found';
  end if;
  if v_o.status <> 'requested' then
    return v_o.status;
  end if;
  update public.domain_orders
  set status = case when p_registered then 'registered' else 'failed' end,
      registrar_reference = p_reference, problem = p_problem, completed_at = now()
  where id = p_order;
  if p_registered then
    insert into public.company_domains (company_id, hostname, kind)
    values (v_o.company_id, 'www.' || v_o.hostname, 'website'), (v_o.company_id, v_o.hostname, 'website')
    on conflict (hostname) do nothing;
  end if;
  return case when p_registered then 'registered' else 'failed' end;
end;
$$;
revoke execute on function app.complete_domain_order(uuid, boolean, text, text) from public;
grant execute on function app.complete_domain_order(uuid, boolean, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- "Website by ZimERP" in the footer
-- ---------------------------------------------------------------------------

alter table public.plans add column can_hide_platform_badge boolean not null default false;
update public.plans set can_hide_platform_badge = true where code in ('growth', 'pro', 'enterprise');

alter table public.site_settings add column show_platform_badge boolean not null default true;
grant update (show_platform_badge) on public.site_settings to authenticated;

create function app.guard_platform_badge()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not new.show_platform_badge
     and (tg_op = 'INSERT' or old.show_platform_badge)
     and not exists (select 1 from public.companies c join public.plans p on p.code = c.plan_code
                     where c.id = new.company_id and p.can_hide_platform_badge) then
    raise exception 'hiding "Website by ZimERP" needs the Growth plan or higher' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger site_settings_platform_badge before insert or update of show_platform_badge on public.site_settings
  for each row execute function app.guard_platform_badge();

-- Whether a company's public website shows "Website by ZimERP". Shown again
-- automatically if the company moves to a plan that does not allow hiding it.
create function public.site_platform_badge(p_slug text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select s.show_platform_badge or not p.can_hide_platform_badge
    from public.companies c
    join public.plans p on p.code = c.plan_code
    left join public.site_settings s on s.company_id = c.id
    where c.slug = lower(p_slug) and c.archived_at is null), true);
$$;
revoke execute on function public.site_platform_badge(text) from public;
grant execute on function public.site_platform_badge(text) to anon, authenticated, service_role;
