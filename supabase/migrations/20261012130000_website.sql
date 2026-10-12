-- Company website and online store (P9), uploaded public files such as logos
-- and website images (P20), and custom domain safeguards (master plan §8,
-- §10.2, §12.6, §12.7).
--
--   * site_settings: one row per company (template, live or not, contact
--     details, social links);
--   * site_pages: pages made of ordered JSON blocks; editors change the draft
--     (blocks), publishers copy it to the live version (published_blocks);
--   * site_assets: public files (logos, website images) kept in file storage;
--   * anonymous visitors read only through SECURITY DEFINER functions that
--     return published content of a live site of an active company.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- True when the company's plan includes the module and the company switched it on.
create function app.module_on(p_company uuid, p_module text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.companies c
    join public.modules mo on mo.code = p_module
    where c.id = p_company
      and (mo.is_core
           or (exists (select 1 from public.plan_modules pm where pm.plan_code = c.plan_code and pm.module_code = mo.code)
               and exists (select 1 from public.company_modules cm
                           where cm.company_id = c.id and cm.module_code = mo.code and cm.enabled)))
  );
$$;

-- True when a feature is switched on for the company (its default otherwise).
create function app.feature_on(p_company uuid, p_feature text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select cf.enabled from public.company_features cf where cf.company_id = p_company and cf.feature_code = p_feature),
    (select f.default_on from public.features f where f.code = p_feature),
    false);
$$;

revoke execute on function app.module_on(uuid, text), app.feature_on(uuid, text) from public;
grant execute on function app.module_on(uuid, text), app.feature_on(uuid, text) to authenticated, service_role;

-- Page blocks: an array of at most 40 objects, each with an id and a known type.
-- The application checks each block's fields; this keeps the shape honest.
create function app.valid_site_blocks(p_blocks jsonb)
returns boolean
language sql immutable
as $$
  select p_blocks is null or (
    jsonb_typeof(p_blocks) = 'array'
    and jsonb_array_length(p_blocks) <= 40
    and octet_length(p_blocks::text) <= 200000
    and not exists (
      select 1 from jsonb_array_elements(p_blocks) e
      where jsonb_typeof(e) <> 'object'
         or coalesce(e->>'type', '') not in ('hero','text','featured_products','products','image_text',
                                             'contact','cta','testimonials','gallery')
         or coalesce(length(e->>'id'), 0) not between 1 and 40));
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.site_settings (
  company_id        uuid primary key references public.companies(id),
  template          text not null default 'classic' check (template in ('classic','bold')),
  published         boolean not null default false,
  published_at      timestamptz,
  tagline           text check (length(tagline) <= 200),
  about             text check (length(about) <= 5000),
  contact_phone     text check (length(contact_phone) <= 40),
  contact_whatsapp  text check (length(contact_whatsapp) <= 40),
  contact_email     text check (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(contact_email) <= 320),
  address           text check (length(address) <= 500),
  opening_hours     text check (length(opening_hours) <= 1000),
  social_links      jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(social_links) = 'object' and octet_length(social_links::text) <= 4000),
  seo_description   text check (length(seo_description) <= 300),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.site_pages (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  slug              text not null
                    check (slug ~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$'
                           and slug not in ('shop','quote','account','api','site-preview','preview','sitemap','robots')),
  title             text not null check (length(trim(title)) between 1 and 120),
  description       text check (length(description) <= 300),
  nav_order         integer not null default 0,
  show_in_menu      boolean not null default true,
  blocks            jsonb not null default '[]'::jsonb check (app.valid_site_blocks(blocks)),
  published_title   text,
  published_blocks  jsonb check (app.valid_site_blocks(published_blocks)),
  published_at      timestamptz,
  published_by      uuid,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived_at       timestamptz,
  unique (company_id, id)
);

create unique index site_pages_slug_unique on public.site_pages (company_id, slug) where archived_at is null;
create index on public.site_pages (company_id, nav_order);

create table public.site_assets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  storage_key   text not null unique check (storage_key like company_id::text || '/%' and storage_key !~ '\.\.'),
  kind          text not null check (kind in ('logo','image')),
  content_type  text not null check (content_type in ('image/png','image/jpeg','image/webp','image/svg+xml')),
  size_bytes    integer not null check (size_bytes between 1 and 2097152),
  file_name     text check (length(file_name) <= 200),
  alt_text      text check (length(alt_text) <= 200),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create index on public.site_assets (company_id, kind, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['site_settings','site_pages'] loop
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['site_settings','site_pages','site_assets'] loop
    execute format('create trigger %I_audit after insert or update on public.%I
                    for each row execute function app.audit_row()', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------

alter table public.site_settings enable row level security;
alter table public.site_pages    enable row level security;
alter table public.site_assets   enable row level security;

create policy viewer_read on public.site_settings for select to authenticated using (app.can(company_id, 'website.view'));
create policy editor      on public.site_settings for insert to authenticated with check (app.can(company_id, 'website.edit'));
create policy editor_edit on public.site_settings for update to authenticated
  using (app.can(company_id, 'website.edit')) with check (app.can(company_id, 'website.edit'));

create policy viewer_read on public.site_pages for select to authenticated using (app.can(company_id, 'website.view'));
create policy editor      on public.site_pages for insert to authenticated with check (app.can(company_id, 'website.edit'));
create policy editor_edit on public.site_pages for update to authenticated
  using (app.can(company_id, 'website.edit')) with check (app.can(company_id, 'website.edit'));

-- Logos belong to the brand kit, website images to the website.
create policy member_read on public.site_assets for select to authenticated using (app.is_member(company_id));
create policy uploader    on public.site_assets for insert to authenticated
  with check (app.can(company_id, case kind when 'logo' then 'admin.branding.edit' else 'website.edit' end)
              and created_by = auth.uid());
create policy uploader_edit on public.site_assets for update to authenticated
  using (app.can(company_id, case kind when 'logo' then 'admin.branding.edit' else 'website.edit' end))
  with check (app.can(company_id, case kind when 'logo' then 'admin.branding.edit' else 'website.edit' end));

revoke all on public.site_settings, public.site_pages, public.site_assets from anon, authenticated;
-- Going live and publishing pages happen only through the publish functions.
grant select on public.site_settings, public.site_pages, public.site_assets to authenticated;
grant insert (company_id, template, tagline, about, contact_phone, contact_whatsapp, contact_email, address,
              opening_hours, social_links, seo_description),
      update (template, tagline, about, contact_phone, contact_whatsapp, contact_email, address,
              opening_hours, social_links, seo_description)
  on public.site_settings to authenticated;
grant insert (id, company_id, slug, title, description, nav_order, show_in_menu, blocks),
      update (slug, title, description, nav_order, show_in_menu, blocks, archived_at)
  on public.site_pages to authenticated;
grant insert (company_id, storage_key, kind, content_type, size_bytes, file_name, alt_text, created_by),
      update (alt_text, archived_at)
  on public.site_assets to authenticated;

-- ---------------------------------------------------------------------------
-- Setting up and publishing (signed-in staff)
-- ---------------------------------------------------------------------------

-- Creates the company's site settings and default pages (a home page and a
-- contact page, already published) the first time the website is opened.
-- Safe to call repeatedly.
create function public.ensure_site(p_company uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  v_home jsonb;
  v_contact jsonb;
begin
  if not app.can(p_company, 'website.edit') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into public.site_settings (company_id) values (p_company) on conflict (company_id) do nothing;
  if exists (select 1 from public.site_pages where company_id = p_company) then
    return;
  end if;

  select name into v_name from public.companies where id = p_company;
  v_home := jsonb_build_array(
    jsonb_build_object('id', 'b' || substr(md5(random()::text), 1, 10), 'type', 'hero', 'reveal', 'fade-up',
      'eyebrow', 'Welcome',
      'heading', v_name,
      'text', 'Quality products, fair prices and friendly service. Browse what we have in stock or ask us for a quote.',
      'button_label', 'Browse the shop', 'button_link', '/shop',
      'secondary_label', 'Contact us', 'secondary_link', '/contact'),
    jsonb_build_object('id', 'b' || substr(md5(random()::text), 1, 10), 'type', 'featured_products', 'reveal', 'fade-up',
      'heading', 'Popular products', 'text', 'A few of the things our customers buy most.', 'count', 8),
    jsonb_build_object('id', 'b' || substr(md5(random()::text), 1, 10), 'type', 'text', 'reveal', 'fade-up',
      'heading', 'About us',
      'body', 'Welcome to ' || v_name || '. We are proud to serve our customers with quality products, honest prices and friendly service.'),
    jsonb_build_object('id', 'b' || substr(md5(random()::text), 1, 10), 'type', 'cta', 'reveal', 'zoom',
      'heading', 'Need a price for a bigger order?',
      'text', 'Add products to your quote and we will get back to you quickly.',
      'button_label', 'Contact us', 'button_link', '/contact'));
  v_contact := jsonb_build_array(
    jsonb_build_object('id', 'b' || substr(md5(random()::text), 1, 10), 'type', 'contact', 'reveal', 'fade-up',
      'heading', 'Get in touch',
      'text', 'Send us a message and we will reply as soon as we can.', 'show_form', true));

  insert into public.site_pages (company_id, slug, title, nav_order, show_in_menu, blocks,
                                 published_title, published_blocks, published_at, published_by)
  values (p_company, 'home', 'Home', 0, true, v_home, 'Home', v_home, now(), auth.uid()),
         (p_company, 'contact', 'Contact us', 90, true, v_contact, 'Contact us', v_contact, now(), auth.uid());
end;
$$;

-- Copies a page's draft to its live version.
create function public.publish_site_page(p_page uuid)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_at      timestamptz := now();
begin
  select company_id into v_company from public.site_pages where id = p_page and archived_at is null;
  if v_company is null or not app.can(v_company, 'website.publish') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.site_pages
  set published_blocks = blocks, published_title = title, published_at = v_at, published_by = auth.uid()
  where id = p_page;
  return v_at;
end;
$$;

-- Puts the whole site live, or takes it offline (visitors then see "coming soon").
create function public.set_site_published(p_company uuid, p_published boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.can(p_company, 'website.publish') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_published and not exists (select 1 from public.site_pages
                                 where company_id = p_company and slug = 'home'
                                   and archived_at is null and published_at is not null) then
    raise exception 'publish a home page (address "home") before putting the site live' using errcode = 'check_violation';
  end if;
  update public.site_settings
  set published = p_published, published_at = case when p_published then now() else published_at end
  where company_id = p_company;
  if not found then
    raise exception 'open the website screen once to set up the site' using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function public.ensure_site(uuid), public.publish_site_page(uuid),
                           public.set_site_published(uuid, boolean) from public, anon;
grant execute on function public.ensure_site(uuid), public.publish_site_page(uuid),
                          public.set_site_published(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Public reading (anonymous visitors)
-- ---------------------------------------------------------------------------

-- The company behind a public slug, when it may be shown at all.
create function app.public_company(p_slug text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.id from public.companies c
  where c.slug = lower(trim(p_slug)) and c.archived_at is null and c.status in ('active','grace');
$$;

-- True when the company's website is live: website module on and site published.
create function app.site_live(p_company uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_company is not null
     and app.module_on(p_company, 'website')
     and coalesce((select s.published from public.site_settings s where s.company_id = p_company), false);
$$;

revoke execute on function app.public_company(text), app.site_live(uuid) from public;

-- Everything a site needs on every page: company name, brand kit, settings and
-- menu. For a company whose site is not live, only the name and brand kit
-- (for a "coming soon" page). Null for unknown or inactive companies.
create function public.site_bundle(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid := app.public_company(p_slug);
  v_live    boolean;
  v_c       public.companies;
  v_s       public.site_settings;
  v_b       public.company_branding;
begin
  if v_company is null then
    return null;
  end if;
  v_live := app.site_live(v_company);
  select * into v_c from public.companies where id = v_company;
  select * into v_s from public.site_settings where company_id = v_company;
  select * into v_b from public.company_branding where company_id = v_company;

  return jsonb_build_object(
    'company', jsonb_build_object('name', v_c.name, 'slug', v_c.slug, 'base_currency', v_c.base_currency,
                                  'prices_include_tax', v_c.prices_include_tax, 'vat_registered', v_c.vat_registered),
    'live', v_live,
    'branding', jsonb_build_object(
      'primary_color', coalesce(v_b.primary_color, '#0b6e4f'), 'secondary_color', coalesce(v_b.secondary_color, '#c98f00'),
      'accent_color', coalesce(v_b.accent_color, '#b42318'), 'font_pair', coalesce(v_b.font_pair, 'modern'),
      'theme_mode', coalesce(v_b.theme_mode, 'system'), 'motion_level', coalesce(v_b.motion_level, 'subtle'),
      'corner_style', coalesce(v_b.corner_style, 'rounded'), 'logo_path', v_b.logo_path),
    'settings', case when v_live then jsonb_build_object(
      'template', v_s.template, 'tagline', v_s.tagline, 'about', v_s.about,
      'contact_phone', v_s.contact_phone, 'contact_whatsapp', v_s.contact_whatsapp, 'contact_email', v_s.contact_email,
      'address', v_s.address, 'opening_hours', v_s.opening_hours, 'social_links', v_s.social_links,
      'seo_description', v_s.seo_description)
      else jsonb_build_object('template', coalesce(v_s.template, 'classic')) end,
    'menu', case when v_live then coalesce((
      select jsonb_agg(jsonb_build_object('slug', p.slug, 'title', p.published_title) order by p.nav_order, p.created_at)
      from public.site_pages p
      where p.company_id = v_company and p.archived_at is null and p.published_at is not null and p.show_in_menu), '[]'::jsonb)
      else '[]'::jsonb end,
    'features', jsonb_build_object(
      'add_to_quote', v_live and app.feature_on(v_company, 'website.add_to_quote'),
      'buy', v_live and app.feature_on(v_company, 'website.buy'),
      'portal', app.module_on(v_company, 'portal')));
end;
$$;

-- A published page of a live site, or null.
create function public.site_page(p_slug text, p_page text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('slug', p.slug, 'title', p.published_title, 'description', p.description,
                            'blocks', p.published_blocks, 'published_at', p.published_at)
  from public.site_pages p
  where p.company_id = app.public_company(p_slug)
    and app.site_live(p.company_id)
    and p.slug = lower(trim(p_page))
    and p.archived_at is null
    and p.published_at is not null;
$$;

-- Products shown online by a live site, priced in the company's base currency
-- (null when no price is set). Search matches name and description; p_ids
-- picks particular products (e.g. a "featured products" block). total is the
-- number of matching products, for paging. Never returns cost.
create function public.site_products(p_slug text, p_search text default null, p_limit integer default 24,
                                     p_offset integer default 0, p_ids uuid[] default null)
returns table (id uuid, name text, description text, unit text, price_cents bigint, currency char(3), total bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid := app.public_company(p_slug);
  v_search  text := lower(nullif(trim(coalesce(p_search, '')), ''));
begin
  if v_company is null or not app.site_live(v_company) then
    return;
  end if;
  return query
  with matching as (
    select p.id, p.name, p.description, p.unit, p.created_at
    from public.products p
    where p.company_id = v_company and p.show_online and p.archived_at is null
      and (v_search is null or strpos(lower(p.name), v_search) > 0 or strpos(lower(coalesce(p.description, '')), v_search) > 0)
      and (p_ids is null or p.id = any (p_ids))
  )
  select m.id, m.name, m.description, m.unit,
         app.price_cents(v_company, m.id, c.base_currency), c.base_currency,
         count(*) over ()
  from matching m cross join public.companies c
  where c.id = v_company
  order by case when p_ids is not null then array_position(p_ids, m.id) end, m.name, m.id
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- One product shown online by a live site, or null.
create function public.site_product(p_slug text, p_product uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'unit', p.unit,
                            'price_cents', app.price_cents(p.company_id, p.id, c.base_currency),
                            'currency', c.base_currency)
  from public.products p join public.companies c on c.id = p.company_id
  where p.company_id = app.public_company(p_slug)
    and app.site_live(p.company_id)
    and p.id = p_product and p.show_online and p.archived_at is null;
$$;

-- A public file (logo or website image) by storage key, for the file server.
create function public.public_asset(p_key text)
returns table (content_type text, size_bytes integer)
language sql stable security definer set search_path = ''
as $$
  select a.content_type, a.size_bytes
  from public.site_assets a join public.companies c on c.id = a.company_id
  where a.storage_key = p_key and a.archived_at is null and c.archived_at is null and c.status <> 'suspended';
$$;

revoke execute on function public.site_bundle(text), public.site_page(text, text),
                           public.site_products(text, text, integer, integer, uuid[]),
                           public.site_product(text, uuid), public.public_asset(text) from public;
grant execute on function public.site_bundle(text), public.site_page(text, text),
                          public.site_products(text, text, integer, integer, uuid[]),
                          public.site_product(text, uuid), public.public_asset(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Custom domains: verification comes from the hosting provider, not users
-- ---------------------------------------------------------------------------

-- Users add and archive domains and choose the primary one; whether a domain
-- is verified (and so routed) is recorded by the server after asking the
-- domain provider. ZimERP's own addresses cannot be added or removed.
revoke insert, update on public.company_domains from authenticated;
grant insert (company_id, hostname, kind, is_primary), update (is_primary, archived_at)
  on public.company_domains to authenticated;

create function app.guard_company_domain()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and (new.hostname = 'zimerp.co.zw' or new.hostname like '%.zimerp.co.zw') then
      raise exception 'ZimERP addresses cannot be added as your own domain' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' and old.hostname like '%.zimerp.co.zw' and new.archived_at is not null then
      raise exception 'your ZimERP address cannot be removed' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger company_domains_guard before insert or update on public.company_domains
  for each row execute function app.guard_company_domain();
