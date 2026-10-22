-- Website enquiries → leads → quotes (issue #25, master plan §4.4 flow A,
-- ported from Bromadex where "every website quote request opens a lead").

create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  customer_id  uuid not null,
  source       text not null check (source in ('website_form','store_quote','whatsapp','manual')),
  name         text not null,
  email        text,
  phone        text,
  message      text,
  status       text not null default 'new' check (status in ('new','contacted','quoted','won','lost')),
  quote_id     uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, customer_id) references public.customers(company_id, id),
  foreign key (company_id, quote_id) references public.quotes(company_id, id)
);

create index on public.leads (company_id, status, created_at desc);

create trigger leads_touch before update on public.leads
  for each row execute function app.touch_updated_at();
create trigger leads_audit after insert or update on public.leads
  for each row execute function app.audit_row();

alter table public.quotes add foreign key (company_id, lead_id) references public.leads(company_id, id);

-- Called by public websites and stores (no sign-in). Resolves the company from
-- the site's hostname, matches or creates the customer, records the lead and,
-- when items are given, a draft quote priced in the company's base currency.
-- p_items: [{"product_id": uuid, "quantity": number}]
create function public.submit_website_enquiry(
  p_hostname text,
  p_name     text,
  p_email    text,
  p_phone    text,
  p_message  text default null,
  p_items    jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_company  uuid;
  v_branch   uuid;
  v_currency char(3);
  v_customer uuid;
  v_lead     uuid;
  v_quote    uuid;
  v_item     jsonb;
  v_line     integer := 0;
  v_price    bigint;
begin
  select d.company_id, c.base_currency into v_company, v_currency
  from public.company_domains d join public.companies c on c.id = d.company_id
  where d.hostname = lower(trim(p_hostname)) and d.archived_at is null
    and c.archived_at is null and c.status in ('active','grace');
  if v_company is null then
    raise exception 'unknown site' using errcode = 'no_data_found';
  end if;
  if length(coalesce(trim(p_name), '')) not between 1 and 200
     or (nullif(trim(p_email), '') is null and nullif(trim(p_phone), '') is null)
     or length(coalesce(p_message, '')) > 5000
     or length(coalesce(p_email, '')) > 320 or length(coalesce(p_phone, '')) > 40
     or (p_items is not null and (jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100)) then
    raise exception 'please give your name and an email address or phone number' using errcode = 'check_violation';
  end if;
  if nullif(trim(p_email), '') is not null and trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'that email address does not look right' using errcode = 'check_violation';
  end if;

  v_customer := app.match_or_create_customer(v_company, p_name, nullif(trim(p_email), ''), nullif(trim(p_phone), ''));

  insert into public.leads (company_id, customer_id, source, name, email, phone, message)
  values (v_company, v_customer, case when p_items is null then 'website_form' else 'store_quote' end,
          trim(p_name), nullif(lower(trim(p_email)), ''), nullif(trim(p_phone), ''), p_message)
  returning id into v_lead;

  if p_items is not null and jsonb_array_length(p_items) > 0 then
    select id into v_branch from public.branches
    where company_id = v_company and archived_at is null
    order by is_head_office desc, created_at limit 1;
    insert into public.quotes (company_id, branch_id, customer_id, currency, lead_id, notes)
    values (v_company, v_branch, v_customer, v_currency, v_lead, p_message)
    returning id into v_quote;
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_line := v_line + 1;
      if not exists (select 1 from public.products
                     where id = (v_item->>'product_id')::uuid and company_id = v_company
                       and show_online and archived_at is null) then
        raise exception 'one of the items is no longer available' using errcode = 'check_violation';
      end if;
      v_price := coalesce(app.price_cents(v_company, (v_item->>'product_id')::uuid, v_currency), 0);
      insert into public.quote_lines (company_id, quote_id, line_no, product_id, quantity, unit_price_cents)
      values (v_company, v_quote, v_line, (v_item->>'product_id')::uuid,
              greatest(coalesce((v_item->>'quantity')::numeric, 1), 0.001), v_price);
    end loop;
    update public.leads set quote_id = v_quote, status = 'quoted' where id = v_lead;
  end if;

  perform app.emit_event(v_company, 'lead.created', 'lead', v_lead::text,
    jsonb_build_object('customer_id', v_customer, 'quote_id', v_quote, 'name', trim(p_name)));

  return jsonb_build_object('reference', upper(left(replace(v_lead::text, '-', ''), 8)));
end;
$$;

revoke execute on function public.submit_website_enquiry(text, text, text, text, text, jsonb) from public;
grant execute on function public.submit_website_enquiry(text, text, text, text, text, jsonb) to anon, authenticated;

-- Invoicing a quote marks its lead as won.
create function app.mark_lead_won()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.docstatus = 0 and new.docstatus = 1 and new.quote_id is not null then
    update public.leads l set status = 'won'
    from public.quotes q
    where q.id = new.quote_id and l.id = q.lead_id and l.status <> 'won';
  end if;
  return null;
end;
$$;

create trigger sales_invoices_lead_won after update on public.sales_invoices
  for each row execute function app.mark_lead_won();

insert into public.doctypes (code, name, module_code, table_name, view_permission, create_permission, prefix, is_submittable)
values ('lead', 'Lead', 'sales', 'leads', 'sales.view', 'sales.quote.create', null, false);
insert into public.doctype_links (from_doctype, to_doctype, link_column, label) values
  ('customer', 'lead',  'customer_id', 'Leads'),
  ('lead',     'quote', 'lead_id',     'Quotes');

alter table public.leads enable row level security;
create policy viewer_read on public.leads for select to authenticated using (app.can(company_id, 'sales.view'));
create policy author      on public.leads for insert to authenticated with check (app.can(company_id, 'sales.quote.create'));
create policy author_edit on public.leads for update to authenticated
  using (app.can(company_id, 'sales.quote.create')) with check (app.can(company_id, 'sales.quote.create'));

revoke all on public.leads from anon, authenticated;
grant select, insert, update on public.leads to authenticated;
