
-- Industries (P1): a company says what kind of organisation it is when it
-- signs up. ZimERP then suggests the modules, features, website template,
-- starter items and the words it uses (members, learners, donors...). The
-- owner can change every suggestion before or after signing up.

create table public.industries (
  code                text primary key check (code ~ '^[a-z_]+$'),
  name                text not null,
  description         text not null,
  sort_order          integer not null,
  suggested_modules   text[] not null,
  suggested_features  jsonb not null default '{}'::jsonb,   -- {"feature_code": true|false}
  website_template    text not null,
  terms               jsonb not null default '{}'::jsonb,   -- {"customer": "Member", "customers": "Members", ...}
  starter_items       jsonb not null default '[]'::jsonb    -- [{"sku","name","price" (USD cents),"unit","stock","tax","online"}]
);

alter table public.industries enable row level security;
create policy catalogue_read on public.industries for select to anon, authenticated using (true);
revoke all on public.industries from anon, authenticated;
grant select on public.industries to anon, authenticated;

insert into public.industries (code, name, description, sort_order, suggested_modules, suggested_features, website_template, terms, starter_items) values
  ('retail', 'Shop or supermarket', 'Sell over the counter, keep stock, take EcoCash and cash in any currency.', 1,
   array['pos','inventory','website'], '{}', 'bold', '{}',
   '[{"sku":"BREAD","name":"Bread loaf","price":120,"stock":true},{"sku":"SUGAR-2","name":"Sugar 2kg","price":350,"stock":true},{"sku":"OIL-2","name":"Cooking oil 2L","price":480,"stock":true}]'),
  ('hardware', 'Hardware and building supplies', 'Counter sales, quotes for builders, stock in several stores and accounts for regular customers.', 2,
   array['pos','sales','inventory','website'], '{"sales.credit_book": true}', 'showcase', '{}',
   '[{"sku":"CEM-50","name":"Cement 50kg","price":1250,"stock":true,"unit":"bag"},{"sku":"BRK-1000","name":"Common bricks (1000)","price":9000,"stock":true},{"sku":"IBR-3","name":"IBR roofing sheet 3m","price":1800,"stock":true}]'),
  ('wholesale', 'Wholesale and distribution', 'Quotes and invoices on account, stock across warehouses and a portal for your trade customers.', 3,
   array['sales','inventory','portal','website'], '{"sales.credit_book": true}', 'showcase', '{"customer":"Trade customer","customers":"Trade customers"}', '[]'),
  ('restaurant', 'Restaurant, café or takeaway', 'Fast till sales, a menu online and stock of ingredients.', 4,
   array['pos','inventory','website'], '{"pos.change_as_credit": false}', 'menu', '{}',
   '[{"sku":"SADZA-BEEF","name":"Sadza and beef stew","price":500},{"sku":"CHIPS","name":"Chips (large)","price":250},{"sku":"COKE","name":"Coca-Cola 500ml","price":100,"stock":true}]'),
  ('hospitality', 'Hotel, lodge or guest house', 'Room and restaurant sales, invoices for companies and a website that takes enquiries.', 5,
   array['pos','sales','website'], '{}', 'menu', '{"customer":"Guest","customers":"Guests"}',
   '[{"sku":"ROOM-STD","name":"Standard room (per night)","price":6000,"unit":"night"},{"sku":"BRKFST","name":"Breakfast","price":800}]'),
  ('salon', 'Salon, barber or beauty', 'Quick till sales for services and products, and a website with your price list.', 6,
   array['pos','inventory','website'], '{}', 'menu', '{"customer":"Client","customers":"Clients"}',
   '[{"sku":"CUT","name":"Haircut","price":300},{"sku":"BRAIDS","name":"Braids","price":2500},{"sku":"MANI","name":"Manicure","price":800}]'),
  ('pharmacy', 'Pharmacy or health shop', 'Till sales, careful stock control and invoices for medical aid.', 7,
   array['pos','sales','inventory','website'], '{"inventory.negative": false}', 'classic', '{"customer":"Patient","customers":"Patients"}', '[]'),
  ('agriculture', 'Farming and agro supplies', 'Sell inputs and produce, keep stock, invoice buyers.', 8,
   array['pos','sales','inventory','website'], '{}', 'showcase', '{}',
   '[{"sku":"SEED-MAIZE","name":"Maize seed 10kg","price":3500,"stock":true},{"sku":"AN-50","name":"Ammonium nitrate 50kg","price":3800,"stock":true}]'),
  ('mining_construction', 'Mining or construction', 'Quotes and invoices for contracts, stock on sites and a portal for clients.', 9,
   array['sales','inventory','portal','website'], '{"sales.credit_book": true}', 'showcase', '{"customer":"Client","customers":"Clients"}', '[]'),
  ('professional', 'Professional services or consultancy', 'Quotes, invoices, statements and a portal where clients see and pay their invoices.', 10,
   array['sales','portal','website'], '{"sales.credit_book": true, "website.add_to_quote": false}', 'consult', '{"customer":"Client","customers":"Clients","product":"Service","products":"Services"}',
   '[{"online":false,"sku":"CONSULT-HR","name":"Consulting (per hour)","price":5000,"unit":"hour"},{"online":false,"sku":"RETAINER","name":"Monthly retainer","price":50000,"unit":"month"}]'),
  ('school', 'School or college', 'Fees invoiced per term, payments in any currency, statements and a parent portal.', 11,
   array['sales','portal','website'], '{"sales.credit_book": true, "sales.quotes": false, "website.add_to_quote": false}', 'academy', '{"customer":"Parent or learner","customers":"Parents and learners","product":"Fee","products":"Fees"}',
   '[{"online":false,"sku":"TUITION-T1","name":"Tuition fees (term)","price":30000,"unit":"term"},{"online":false,"sku":"LEVY","name":"Development levy","price":5000,"unit":"term"},{"sku":"UNIFORM","name":"School uniform","price":4500,"stock":true}]'),
  ('church', 'Church or ministry', 'Record tithes, offerings and pledges in any currency, give members statements and run a welcoming website.', 12,
   array['sales','website'], '{"sales.quotes": false, "website.add_to_quote": false}', 'ministry', '{"customer":"Member","customers":"Members","product":"Giving type","products":"Giving types","invoice":"Pledge","invoices":"Pledges"}',
   '[{"online":false,"sku":"TITHE","name":"Tithe","tax":"exempt"},{"online":false,"sku":"OFFERING","name":"Offering","tax":"exempt"},{"online":false,"sku":"BUILDING","name":"Building fund","tax":"exempt"}]'),
  ('ngo', 'NGO or non-profit', 'Record donations and grants, thank donors with receipts and tell your story on your website.', 13,
   array['sales','website'], '{"sales.quotes": false, "website.add_to_quote": false}', 'cause', '{"customer":"Donor","customers":"Donors","product":"Fund","products":"Funds"}',
   '[{"online":false,"sku":"GENERAL","name":"General donation","tax":"exempt"},{"online":false,"sku":"PROGRAMME","name":"Programme support","tax":"exempt"}]'),
  ('auto', 'Garage or auto parts', 'Job cards as quotes and invoices, parts stock and till sales.', 14,
   array['pos','sales','inventory','website'], '{}', 'bold', '{}',
   '[{"sku":"SERVICE","name":"Minor service (labour)","price":4000},{"sku":"OIL-5W30","name":"Engine oil 5W-30 (5L)","price":3500,"stock":true}]'),
  ('online_store', 'Online shop', 'A good-looking online store that takes EcoCash and card payments, with stock and orders in one place.', 15,
   array['website','sales','inventory'], '{"website.buy": true}', 'boutique', '{}', '[]'),
  ('other', 'Something else', 'Start with the basics and switch on what you need.', 99,
   array['pos','sales'], '{}', 'classic', '{}', '[]');

alter table public.companies add column industry_code text references public.industries(code);
-- Company admins may change it later (the admin_update policy applies).
grant update (industry_code) on public.companies to authenticated;

-- The words a company's industry uses (e.g. Members instead of Customers).
create function public.company_terms(p_company uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(i.terms, '{}'::jsonb)
  from public.companies c left join public.industries i on i.code = c.industry_code
  where c.id = p_company and app.is_member(p_company);
$$;
grant execute on function public.company_terms(uuid) to authenticated;

drop function public.create_company(text, text, text, text[], char);

create function public.create_company(
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
                coalesce((v_item->>'stock')::boolean, false), coalesce(v_item->>'tax', 'standard'),
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

revoke execute on function public.create_company(text, text, text, text[], char, text, boolean) from public, anon;
grant execute on function public.create_company(text, text, text, text[], char, text, boolean) to authenticated;
