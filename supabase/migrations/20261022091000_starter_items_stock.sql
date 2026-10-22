-- Starter items are stock items only when the company signs up with the
-- inventory module. Without it, selling a "stock" starter item (cement for a
-- hardware shop) was refused for want of stock nobody could record.

create or replace function public.create_company(
  p_name text,
  p_slug text,
  p_plan text default 'starter',
  p_modules text[] default array['pos'],
  p_base_currency char(3) default 'USD',
  p_industry text default null,
  p_sample_items boolean default false
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
  v_ind     public.industries;
  v_item    jsonb;
  v_prod    uuid;
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;

  if p_industry is not null then
    select * into v_ind from public.industries where code = p_industry;
    if v_ind.code is null then
      raise exception 'unknown industry' using errcode = 'check_violation';
    end if;
  end if;

  insert into public.companies (name, slug, plan_code, base_currency, industry_code)
  values (p_name, lower(p_slug), p_plan, p_base_currency, v_ind.code)
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

  -- Industry presets: features switched on or off, and starter items.
  if v_ind.code is not null then
    insert into public.company_features (company_id, feature_code, enabled)
    select v_company, f.key, f.value::boolean
    from jsonb_each_text(v_ind.suggested_features) f
    where exists (select 1 from public.features where code = f.key);
    if p_sample_items then
      for v_item in select * from jsonb_array_elements(v_ind.starter_items) loop
        insert into public.products (company_id, sku, name, unit, is_stock_item, tax_code, show_online)
        values (v_company, v_item->>'sku', v_item->>'name', coalesce(v_item->>'unit', 'each'),
                coalesce((v_item->>'stock')::boolean, false) and 'inventory' = any(coalesce(p_modules, array[]::text[])), coalesce(v_item->>'tax', 'standard'),
                coalesce((v_item->>'online')::boolean, true))
        returning id into v_prod;
        if p_base_currency = 'USD' and (v_item->>'price') is not null then
          insert into public.product_prices (company_id, product_id, currency, price_cents)
          values (v_company, v_prod, 'USD', (v_item->>'price')::bigint);
        end if;
      end loop;
    end if;
  end if;

  return v_company;
end;
$$;

-- Companies that already signed up without inventory: their untouched starter
-- items (no stock movements yet) stop being stock items.
update public.products p
set is_stock_item = false
from public.companies c
join public.industries i on i.code = c.industry_code
where p.company_id = c.id
  and p.is_stock_item
  and p.sku in (select x->>'sku' from jsonb_array_elements(i.starter_items) x)
  and not exists (select 1 from public.company_modules cm where cm.company_id = c.id and cm.module_code = 'inventory' and cm.enabled)
  and not exists (select 1 from public.stock_movements m where m.product_id = p.id);
