-- Online store checkout ("Buy", feature website.buy): a visitor's basket
-- becomes a draft invoice; the visitor pays through the company's own Paynow
-- account; when Paynow confirms, the invoice is submitted (stock and ledger)
-- and the payment recorded against it.

create table public.web_orders (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  customer_id        uuid not null,
  invoice_id         uuid not null,
  currency           char(3) not null check (currency in ('USD','ZWG','ZAR')),
  total_cents        bigint not null check (total_cents > 0),
  reference          text not null,
  status             text not null default 'pending'
                     check (status in ('pending','paid','failed','cancelled','needs_attention')),
  poll_url           text,
  gateway_reference  text,
  payment_id         uuid,
  problem            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  paid_at            timestamptz,
  unique (company_id, reference),
  unique (company_id, id),
  foreign key (company_id, customer_id) references public.customers(company_id, id),
  foreign key (company_id, invoice_id) references public.sales_invoices(company_id, id)
);

create trigger web_orders_touch before update on public.web_orders
  for each row execute function app.touch_updated_at();

-- Called by the public store (no sign-in) for an active company with online
-- checkout switched on. p_items: [{"product_id": uuid, "quantity": number}].
-- Returns {"order_id", "reference", "currency", "total_cents"}.
create function public.create_web_order(
  p_slug     text,
  p_name     text,
  p_email    text,
  p_phone    text,
  p_currency char(3),
  p_items    jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_company  uuid;
  v_branch   uuid;
  v_customer uuid;
  v_invoice  public.sales_invoices;
  v_item     jsonb;
  v_line     integer := 0;
  v_price    bigint;
  v_ref      text := 'WEB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_order    uuid;
begin
  select c.id into v_company from public.companies c
  where c.slug = lower(trim(p_slug)) and c.archived_at is null and c.status in ('active','grace');
  if v_company is null then
    raise exception 'unknown site' using errcode = 'no_data_found';
  end if;
  if not app.feature_enabled(v_company, 'website.buy')
     or not exists (select 1 from public.company_modules where company_id = v_company and module_code = 'website' and enabled) then
    raise exception 'this shop does not take online payments' using errcode = 'check_violation';
  end if;
  if p_currency not in ('USD','ZWG','ZAR') then
    raise exception 'unknown currency' using errcode = 'check_violation';
  end if;
  if length(coalesce(trim(p_name), '')) not between 1 and 200
     or nullif(trim(p_email), '') is null or trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 320
     or length(coalesce(p_phone, '')) > 40 then
    raise exception 'please give your name and a valid email address' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'your basket is empty' using errcode = 'check_violation';
  end if;

  v_customer := app.match_or_create_customer(v_company, p_name, nullif(trim(p_email), ''), nullif(trim(p_phone), ''));
  select id into v_branch from public.branches
  where company_id = v_company and archived_at is null order by is_head_office desc, created_at limit 1;

  insert into public.sales_invoices (company_id, branch_id, customer_id, currency, notes)
  values (v_company, v_branch, v_customer, p_currency, 'Online order ' || v_ref)
  returning * into v_invoice;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    if not exists (select 1 from public.products
                   where id = (v_item->>'product_id')::uuid and company_id = v_company and show_online and archived_at is null) then
      raise exception 'one of the items is no longer available' using errcode = 'check_violation';
    end if;
    if coalesce((v_item->>'quantity')::numeric, 0) <= 0 or (v_item->>'quantity')::numeric > 10000 then
      raise exception 'please check the quantities' using errcode = 'check_violation';
    end if;
    v_price := app.price_cents(v_company, (v_item->>'product_id')::uuid, p_currency);
    if v_price is null or v_price = 0 then
      raise exception 'one of the items has no price; please ask the shop for a quote' using errcode = 'check_violation';
    end if;
    insert into public.sales_invoice_lines (company_id, invoice_id, line_no, product_id, quantity, unit_price_cents)
    values (v_company, v_invoice.id, v_line, (v_item->>'product_id')::uuid, (v_item->>'quantity')::numeric, v_price);
  end loop;

  select * into v_invoice from public.sales_invoices where id = v_invoice.id;
  insert into public.web_orders (company_id, customer_id, invoice_id, currency, total_cents, reference)
  values (v_company, v_customer, v_invoice.id, p_currency, v_invoice.total_cents, v_ref)
  returning id into v_order;

  return jsonb_build_object('order_id', v_order, 'reference', v_ref, 'currency', p_currency,
                            'total_cents', v_invoice.total_cents, 'company_id', v_company);
end;
$$;

revoke execute on function public.create_web_order(text, text, text, text, char, jsonb) from public;
grant execute on function public.create_web_order(text, text, text, text, char, jsonb) to anon, authenticated;

-- Completes a paid order: submits the invoice and records the payment
-- against it. Called by the server once Paynow has confirmed the payment.
-- If the invoice cannot be submitted (e.g. stock ran out), the money is kept
-- as the customer's credit and the order is flagged for staff.
create function app.complete_web_order(p_order uuid, p_gateway_reference text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_o       public.web_orders;
  v_payment uuid;
  v_branch  uuid;
  v_ok      boolean := true;
  v_problem text;
begin
  select * into v_o from public.web_orders where id = p_order for update;
  if v_o.id is null then
    raise exception 'unknown order' using errcode = 'no_data_found';
  end if;
  if v_o.status <> 'pending' then
    return v_o.status;
  end if;
  select branch_id into v_branch from public.sales_invoices where id = v_o.invoice_id;

  begin
    update public.sales_invoices set docstatus = 1 where id = v_o.invoice_id;
  exception when others then
    v_ok := false;
    v_problem := sqlerrm;
  end;

  insert into public.payments (company_id, branch_id, customer_id, currency, amount_cents, method, reference,
                               gateway, gateway_reference, notes)
  values (v_o.company_id, v_branch, v_o.customer_id, v_o.currency, v_o.total_cents, 'card', v_o.reference,
          'paynow', p_gateway_reference, 'Online order ' || v_o.reference)
  returning id into v_payment;
  if v_ok then
    insert into public.payment_allocations (company_id, payment_id, invoice_id, amount_cents)
    values (v_o.company_id, v_payment, v_o.invoice_id, v_o.total_cents);
  end if;
  update public.payments set docstatus = 1 where id = v_payment;

  update public.web_orders
  set status = case when v_ok then 'paid' else 'needs_attention' end,
      gateway_reference = p_gateway_reference, payment_id = v_payment, paid_at = now(), problem = v_problem
  where id = p_order;
  return case when v_ok then 'paid' else 'needs_attention' end;
end;
$$;
revoke execute on function app.complete_web_order(uuid, text) from public;
grant execute on function app.complete_web_order(uuid, text) to service_role;

alter table public.web_orders enable row level security;
create policy viewer_read on public.web_orders for select to authenticated using (app.can(company_id, 'sales.view'));
revoke all on public.web_orders from anon, authenticated;
grant select on public.web_orders to authenticated;

