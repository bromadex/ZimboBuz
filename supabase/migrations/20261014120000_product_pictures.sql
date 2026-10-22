-- Product pictures (P9): one picture per product, uploaded in the ERP by
-- people who may edit products, shown in the online store, on product pages
-- and at the till. Files live in the company's storage like website images.

alter table public.products add column image_key text
  check (image_key is null or (image_key like company_id::text || '/products/%' and image_key !~ '\.\.'));
grant select (image_key), insert (image_key), update (image_key) on public.products to authenticated;

-- Product pictures are registered as public assets of their own kind,
-- uploaded by people who may edit products.
alter table public.site_assets drop constraint site_assets_kind_check;
alter table public.site_assets add constraint site_assets_kind_check check (kind in ('logo','image','product'));

drop policy uploader on public.site_assets;
drop policy uploader_edit on public.site_assets;
create policy uploader on public.site_assets for insert to authenticated
  with check (app.can(company_id, case kind when 'logo' then 'admin.branding.edit' when 'product' then 'core.products.edit' else 'website.edit' end)
              and created_by = auth.uid());
create policy uploader_edit on public.site_assets for update to authenticated
  using (app.can(company_id, case kind when 'logo' then 'admin.branding.edit' when 'product' then 'core.products.edit' else 'website.edit' end))
  with check (app.can(company_id, case kind when 'logo' then 'admin.branding.edit' when 'product' then 'core.products.edit' else 'website.edit' end));

-- The product list for staff keeps its columns; the picture is added at the end.
create or replace view public.products_v as
select p.id, p.company_id, p.sku, p.barcode, p.name, p.description, p.unit, p.is_stock_item, p.tax_code,
       p.reorder_level, p.show_online, p.created_at, p.updated_at, p.archived_at,
       case when app.can(p.company_id, 'core.products.view_cost') then p.avg_cost end as avg_cost,
       p.image_key
from public.products p
where app.can(p.company_id, 'core.products.view');

-- The public product functions return the picture too.
drop function public.site_products(text, text, integer, integer, uuid[]);
drop function public.site_product(text, uuid);

create function public.site_products(p_slug text, p_search text default null, p_limit integer default 24,
                                     p_offset integer default 0, p_ids uuid[] default null)
returns table (id uuid, name text, description text, unit text, price_cents bigint, currency char(3), total bigint, image_key text)
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
    select p.id, p.name, p.description, p.unit, p.created_at, p.image_key
    from public.products p
    where p.company_id = v_company and p.show_online and p.archived_at is null
      and (v_search is null or strpos(lower(p.name), v_search) > 0 or strpos(lower(coalesce(p.description, '')), v_search) > 0)
      and (p_ids is null or p.id = any (p_ids))
  )
  select m.id, m.name, m.description, m.unit,
         app.price_cents(v_company, m.id, c.base_currency), c.base_currency,
         count(*) over (), m.image_key
  from matching m cross join public.companies c
  where c.id = v_company
  order by case when p_ids is not null then array_position(p_ids, m.id) end, m.name, m.id
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create function public.site_product(p_slug text, p_product uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'unit', p.unit,
                            'price_cents', app.price_cents(p.company_id, p.id, c.base_currency),
                            'currency', c.base_currency, 'image_key', p.image_key)
  from public.products p join public.companies c on c.id = p.company_id
  where p.company_id = app.public_company(p_slug)
    and app.site_live(p.company_id)
    and p.id = p_product and p.show_online and p.archived_at is null;
$$;

revoke execute on function public.site_products(text, text, integer, integer, uuid[]), public.site_product(text, uuid) from public;
grant execute on function public.site_products(text, text, integer, integer, uuid[]), public.site_product(text, uuid)
  to anon, authenticated, service_role;
