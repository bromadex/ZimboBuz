-- Point of sale (P5) and EcoCash express checkout (P6).
--   * till sessions: a cashier opens a till with a float per currency and
--     closes it by counting the cash; the difference is posted to the ledger;
--   * pos_checkout(): one call records a till sale as a submitted invoice and
--     its payments (split across methods and currencies), works out the change,
--     and is idempotent on the till's own reference so an offline till can
--     safely retry;
--   * payment requests: EcoCash (and other gateway) payments started at the
--     till, confirmed by the gateway before the sale can use them.

-- ---------------------------------------------------------------------------
-- Ledger account for cash differences at cash-up
-- ---------------------------------------------------------------------------

insert into public.account_templates (code, name, type, system_key)
values ('5200', 'Cash over and short', 'expense', 'cash_over_short');

insert into public.accounts (company_id, code, name, type, system_key)
select c.id, '5200', 'Cash over and short', 'expense', 'cash_over_short' from public.companies c
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Walk-in customer: till sales without a named customer go to one record per company.
-- ---------------------------------------------------------------------------

alter table public.customers add column is_walk_in boolean not null default false;
create unique index customers_one_walk_in on public.customers (company_id) where is_walk_in;

create function app.walk_in_customer(p_company uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.customers where company_id = p_company and is_walk_in;
  if v_id is null then
    insert into public.customers (company_id, name, is_walk_in, currency)
    values (p_company, 'Walk-in customer', true, (select base_currency from public.companies where id = p_company))
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.customers where company_id = p_company and is_walk_in;
    end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function app.walk_in_customer(uuid) from public;

-- ---------------------------------------------------------------------------
-- Till sessions (draft = open, submitted = closed and counted)
-- ---------------------------------------------------------------------------

create table public.till_sessions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  branch_id      uuid not null,
  number         text,
  opened_by      uuid not null default auth.uid(),
  opened_at      timestamptz not null default now(),
  opening_float  jsonb not null default '{}'::jsonb,   -- {"USD": 2000, "ZWG": 50000} in cents
  expected_cash  jsonb,                                -- set at close
  counted_cash   jsonb,                                -- set at close
  closing_notes  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, number),
  unique (company_id, id),
  foreign key (company_id, branch_id) references public.branches(company_id, id),
  check (jsonb_typeof(opening_float) = 'object')
);

select app.enable_document_lifecycle('public.till_sessions', 'till_session');

create unique index till_sessions_one_open on public.till_sessions (company_id, opened_by) where docstatus = 0;
create trigger till_sessions_touch before update on public.till_sessions
  for each row execute function app.touch_updated_at();

alter table public.sales_invoices add column till_session_id uuid, add column client_ref uuid;
alter table public.sales_invoices
  add foreign key (company_id, till_session_id) references public.till_sessions(company_id, id),
  add constraint sales_invoices_client_ref unique (company_id, client_ref);
alter table public.payments add column till_session_id uuid;
alter table public.payments add foreign key (company_id, till_session_id) references public.till_sessions(company_id, id);
create index on public.sales_invoices (till_session_id) where till_session_id is not null;
create index on public.payments (till_session_id) where till_session_id is not null;

-- The invoice view lists columns as they were when it was made; rebuild it so
-- it includes the new ones.
drop view public.sales_invoices_v;
create view public.sales_invoices_v as
select i.*,
       app.invoice_paid_cents(i.id) as paid_cents,
       i.total_cents - app.invoice_paid_cents(i.id) as balance_cents,
       case when i.docstatus <> 1 then null
            when app.invoice_paid_cents(i.id) = 0 then 'unpaid'
            when app.invoice_paid_cents(i.id) >= i.total_cents then 'paid'
            else 'partly_paid' end as payment_status
from public.sales_invoices i
where app.can(i.company_id, 'sales.view');
revoke all on public.sales_invoices_v from anon, authenticated;
grant select on public.sales_invoices_v to authenticated;

-- Cash in the till for each currency: the float plus cash taken (cash
-- payments are recorded net of change given).
create function app.till_expected_cash(p_session uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with currencies as (
    select key as currency from public.till_sessions s, jsonb_object_keys(s.opening_float) key where s.id = p_session
    union
    select currency from public.payments where till_session_id = p_session and method = 'cash' and docstatus = 1
  )
  select coalesce(jsonb_object_agg(c.currency,
           coalesce((select (s.opening_float->>c.currency)::bigint from public.till_sessions s where s.id = p_session), 0)
           + coalesce((select sum(p.amount_cents) from public.payments p
                       where p.till_session_id = p_session and p.method = 'cash' and p.docstatus = 1 and p.currency = c.currency), 0)),
         '{}'::jsonb)
  from currencies c;
$$;
grant execute on function app.till_expected_cash(uuid) to authenticated;

-- Closes the caller's till: records counted cash, the expected amounts and
-- posts any difference to "Cash over and short".
create function public.close_till(p_session uuid, p_counted jsonb, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s        public.till_sessions;
  v_expected jsonb;
  v_cur      text;
  v_diff     bigint;
  v_rate     numeric;
  v_lines    jsonb := '[]'::jsonb;
begin
  select * into v_s from public.till_sessions where id = p_session for update;
  if v_s.id is null or not app.can(v_s.company_id, 'pos.till.close') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_s.opened_by <> auth.uid() and not app.can(v_s.company_id, 'pos.void') then
    raise exception 'only the cashier who opened this till, or a manager, can close it' using errcode = 'insufficient_privilege';
  end if;
  if v_s.docstatus <> 0 then
    raise exception 'this till is already closed' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_counted) <> 'object' then
    raise exception 'please count the cash in each currency' using errcode = 'check_violation';
  end if;

  v_expected := app.till_expected_cash(p_session);
  for v_cur in select key from jsonb_object_keys(v_expected || p_counted) key loop
    if v_cur not in ('USD','ZWG','ZAR') then
      raise exception 'unknown currency %', v_cur using errcode = 'check_violation';
    end if;
    if (p_counted->>v_cur) is not null and (p_counted->>v_cur)::bigint < 0 then
      raise exception 'counted cash cannot be negative' using errcode = 'check_violation';
    end if;
    v_diff := coalesce((p_counted->>v_cur)::bigint, 0) - coalesce((v_expected->>v_cur)::bigint, 0);
    if v_diff <> 0 then
      v_rate := app.rate_at(v_s.company_id, v_cur);
      v_lines := v_lines
        || jsonb_build_object('account', 'cash_' || lower(v_cur), 'debit', app.to_base(v_diff, v_rate),
                              'currency', v_cur, 'amount', v_diff, 'rate', v_rate)
        || jsonb_build_object('account', 'cash_over_short', 'credit', app.to_base(v_diff, v_rate));
    end if;
  end loop;

  update public.till_sessions
  set expected_cash = v_expected, counted_cash = p_counted, closing_notes = p_notes, docstatus = 1
  where id = p_session;

  if jsonb_array_length(v_lines) > 0 then
    perform app.post_entry(v_s.company_id, current_date,
      'Cash-up difference, till ' || (select number from public.till_sessions where id = p_session),
      'till_session', p_session, v_lines);
  end if;
  return jsonb_build_object('expected', v_expected, 'counted', p_counted);
end;
$$;
revoke execute on function public.close_till(uuid, jsonb, text) from public, anon;
grant execute on function public.close_till(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Payment gateway accounts (per company and currency; Paynow integrations are
-- per currency). Keys are encrypted by the application before storage and
-- are never readable by signed-in users.
-- ---------------------------------------------------------------------------

create table public.payment_gateway_accounts (
  company_id          uuid not null references public.companies(id),
  gateway             text not null check (gateway in ('paynow')),
  currency            char(3) not null check (currency in ('USD','ZWG','ZAR')),
  integration_id      text not null check (length(integration_id) between 1 and 64),
  integration_key_enc text not null,
  enabled             boolean not null default true,
  updated_by          uuid default auth.uid(),
  updated_at          timestamptz not null default now(),
  primary key (company_id, gateway, currency)
);

create trigger payment_gateway_accounts_touch before update on public.payment_gateway_accounts
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Payment requests started at the till (EcoCash express, etc.)
-- ---------------------------------------------------------------------------

create table public.payment_requests (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  till_session_id    uuid,
  gateway            text not null check (gateway in ('paynow')),
  method             text not null check (method in ('ecocash','onemoney','innbucks')),
  currency           char(3) not null check (currency in ('USD','ZWG','ZAR')),
  amount_cents       bigint not null check (amount_cents > 0),
  phone              text not null,
  reference          text not null,
  poll_url           text,
  status             text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  gateway_reference  text,
  raw_status         text,
  created_by         uuid not null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  paid_at            timestamptz,
  used_by_payment    uuid,
  unique (company_id, reference),
  unique (company_id, id),
  foreign key (company_id, till_session_id) references public.till_sessions(company_id, id)
);

create trigger payment_requests_touch before update on public.payment_requests
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Till checkout
-- ---------------------------------------------------------------------------
-- p_lines:   [{"product_id": uuid, "quantity": number, "discount_cents": int?}]
-- p_tenders: [{"method": "cash"|"card"|"ecocash"|..., "currency": "USD", "amount_cents": int,
--              "reference": text?, "payment_request_id": uuid?}]
-- Returns {"invoice_id", "number", "currency", "total_cents", "change": [{"currency","cents"}],
--          "on_account_cents", "duplicate"}.
create function public.pos_checkout(
  p_session            uuid,
  p_client_ref         uuid,
  p_customer           uuid,
  p_currency           char(3),
  p_lines              jsonb,
  p_tenders            jsonb,
  p_change_as_credit   boolean default false,
  p_on_account         boolean default false
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s          public.till_sessions;
  v_company    uuid;
  v_customer   uuid;
  v_walk_in    boolean;
  v_invoice    public.sales_invoices;
  v_line       jsonb;
  v_no         integer := 0;
  v_product    public.products;
  v_price      bigint;
  v_discount   bigint;
  v_tender     jsonb;
  v_remaining  bigint;
  v_rt         numeric;
  v_ri         numeric;
  v_amount     bigint;
  v_need       bigint;
  v_alloc      bigint;
  v_left       bigint;
  v_keep       bigint;
  v_payment    uuid;
  v_request    public.payment_requests;
  v_change     jsonb := '[]'::jsonb;
  v_method     text;
  v_cur        char(3);
begin
  select * into v_s from public.till_sessions where id = p_session;
  v_company := v_s.company_id;
  if v_s.id is null or not app.can(v_company, 'pos.sell') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_s.opened_by <> auth.uid() then
    raise exception 'this till belongs to another cashier' using errcode = 'insufficient_privilege';
  end if;
  if v_s.docstatus <> 0 then
    raise exception 'this till is closed; open a new one' using errcode = 'check_violation';
  end if;

  -- Retried (e.g. offline) sales come back with the same reference: answer
  -- with the original result instead of selling twice.
  if p_client_ref is not null then
    select * into v_invoice from public.sales_invoices where company_id = v_company and client_ref = p_client_ref;
    if v_invoice.id is not null then
      return jsonb_build_object('invoice_id', v_invoice.id, 'number', v_invoice.number, 'currency', v_invoice.currency,
                                'total_cents', v_invoice.total_cents, 'change', '[]'::jsonb, 'duplicate', true);
    end if;
  end if;

  if p_currency not in ('USD','ZWG','ZAR') then
    raise exception 'unknown currency' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 500 then
    raise exception 'the sale has no items' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_tenders) <> 'array' or jsonb_array_length(p_tenders) > 10 then
    raise exception 'too many payments' using errcode = 'check_violation';
  end if;

  if p_customer is null then
    v_customer := app.walk_in_customer(v_company);
  else
    select id into v_customer from public.customers where id = p_customer and company_id = v_company and archived_at is null;
    if v_customer is null then
      raise exception 'that customer no longer exists' using errcode = 'check_violation';
    end if;
  end if;
  v_walk_in := (select is_walk_in from public.customers where id = v_customer);

  insert into public.sales_invoices (company_id, branch_id, customer_id, currency, till_session_id, client_ref, notes)
  values (v_company, v_s.branch_id, v_customer, p_currency, p_session, p_client_ref, 'Till sale')
  returning * into v_invoice;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_no := v_no + 1;
    select * into v_product from public.products
    where id = (v_line->>'product_id')::uuid and company_id = v_company and archived_at is null;
    if v_product.id is null then
      raise exception 'one of the items is no longer for sale' using errcode = 'check_violation';
    end if;
    v_price := app.price_cents(v_company, v_product.id, p_currency);
    if v_price is null then
      raise exception '% has no price', v_product.name using errcode = 'check_violation';
    end if;
    v_discount := coalesce((v_line->>'discount_cents')::bigint, 0);
    if v_discount < 0 then
      raise exception 'discounts cannot be negative' using errcode = 'check_violation';
    end if;
    if v_discount > 0 and not app.can(v_company, 'pos.discount') then
      raise exception 'you are not allowed to give discounts' using errcode = 'insufficient_privilege';
    end if;
    if coalesce((v_line->>'quantity')::numeric, 0) <= 0 then
      raise exception 'quantities must be more than zero' using errcode = 'check_violation';
    end if;
    insert into public.sales_invoice_lines (company_id, invoice_id, line_no, product_id, quantity, unit_price_cents, discount_cents)
    values (v_company, v_invoice.id, v_no, v_product.id, (v_line->>'quantity')::numeric, v_price, v_discount);
  end loop;

  update public.sales_invoices set docstatus = 1 where id = v_invoice.id returning * into v_invoice;
  v_remaining := v_invoice.total_cents;
  v_ri := app.rate_at(v_company, p_currency);

  -- Non-cash payments first, so any change comes out of cash.
  for v_tender in
    select t from jsonb_array_elements(p_tenders) t order by (t->>'method' = 'cash')
  loop
    v_method := v_tender->>'method';
    v_cur    := v_tender->>'currency';
    v_amount := (v_tender->>'amount_cents')::bigint;
    if v_method not in ('cash','ecocash','onemoney','innbucks','card','bank_transfer','zipit','other') then
      raise exception 'that payment method cannot be used at the till' using errcode = 'check_violation';
    end if;
    if v_cur not in ('USD','ZWG','ZAR') or v_amount is null or v_amount <= 0 then
      raise exception 'each payment needs a currency and an amount' using errcode = 'check_violation';
    end if;

    v_request := null;
    if v_tender ? 'payment_request_id' then
      select * into v_request from public.payment_requests
      where id = (v_tender->>'payment_request_id')::uuid and company_id = v_company for update;
      if v_request.id is null or v_request.status <> 'paid' or v_request.used_by_payment is not null
         or v_request.currency <> v_cur or v_request.amount_cents <> v_amount then
        raise exception 'that mobile money payment has not been confirmed' using errcode = 'check_violation';
      end if;
    elsif v_method in ('ecocash','onemoney','innbucks') and exists (
      select 1 from public.payment_gateway_accounts
      where company_id = v_company and gateway = 'paynow' and currency = v_cur and enabled) then
      raise exception 'mobile money must be confirmed through Paynow before the sale' using errcode = 'check_violation';
    end if;

    v_rt   := app.rate_at(v_company, v_cur);
    v_need := case when v_remaining <= 0 then 0
                   when v_cur = p_currency then v_remaining
                   else ceil(v_remaining * v_rt / v_ri)::bigint end;
    v_alloc := least(v_amount, v_need);
    v_left  := v_amount - v_alloc;

    if v_left > 0 and v_method <> 'cash' then
      raise exception 'card and mobile money payments cannot be more than the amount due' using errcode = 'check_violation';
    end if;
    if v_left > 0 and p_change_as_credit then
      if v_walk_in then
        raise exception 'choose the customer to keep change as their credit' using errcode = 'check_violation';
      end if;
      if not app.feature_enabled(v_company, 'pos.change_as_credit') then
        raise exception 'keeping change as credit is switched off' using errcode = 'check_violation';
      end if;
      v_keep := v_amount;
    else
      v_keep := v_alloc;
      if v_left > 0 then
        v_change := v_change || jsonb_build_object('currency', v_cur, 'cents', v_left);
      end if;
    end if;
    if v_keep = 0 then
      continue;
    end if;

    insert into public.payments (company_id, branch_id, customer_id, currency, amount_cents, method, reference,
                                 till_session_id, gateway, gateway_reference)
    values (v_company, v_s.branch_id, v_customer, v_cur, v_keep, v_method, nullif(v_tender->>'reference', ''),
            p_session, case when v_request.id is not null then v_request.gateway end, v_request.gateway_reference)
    returning id into v_payment;
    if v_alloc > 0 then
      insert into public.payment_allocations (company_id, payment_id, invoice_id, amount_cents)
      values (v_company, v_payment, v_invoice.id, v_alloc);
    end if;
    update public.payments set docstatus = 1 where id = v_payment;
    if v_request.id is not null then
      update public.payment_requests set used_by_payment = v_payment where id = v_request.id;
    end if;
    v_remaining := v_invoice.total_cents - app.invoice_paid_cents(v_invoice.id);
  end loop;

  v_remaining := v_invoice.total_cents - app.invoice_paid_cents(v_invoice.id);
  if v_remaining > 0 then
    if not p_on_account then
      raise exception 'the payment is less than the total' using errcode = 'check_violation';
    end if;
    if v_walk_in then
      raise exception 'choose the customer to put the sale on their account' using errcode = 'check_violation';
    end if;
    if not app.can(v_company, 'sales.credit.manage') then
      raise exception 'you are not allowed to sell on account' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return jsonb_build_object('invoice_id', v_invoice.id, 'number', v_invoice.number, 'currency', v_invoice.currency,
                            'total_cents', v_invoice.total_cents, 'change', v_change,
                            'on_account_cents', greatest(v_remaining, 0), 'duplicate', false);
end;
$$;
revoke execute on function public.pos_checkout(uuid, uuid, uuid, char, jsonb, jsonb, boolean, boolean) from public, anon;
grant execute on function public.pos_checkout(uuid, uuid, uuid, char, jsonb, jsonb, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Catalogue and row-level security
-- ---------------------------------------------------------------------------

insert into public.doctype_links (from_doctype, to_doctype, link_column, label) values
  ('till_session', 'sales_invoice', 'till_session_id', 'Sales'),
  ('till_session', 'payment',       'till_session_id', 'Payments');

alter table public.till_sessions            enable row level security;
alter table public.payment_gateway_accounts enable row level security;
alter table public.payment_requests         enable row level security;

create policy viewer_read on public.till_sessions for select to authenticated using (app.can(company_id, 'pos.view'));
create policy opener      on public.till_sessions for insert to authenticated
  with check (app.can(company_id, 'pos.till.open') and opened_by = auth.uid());

create policy admin_read  on public.payment_gateway_accounts for select to authenticated using (app.can(company_id, 'admin.company.edit'));
create policy admin_write on public.payment_gateway_accounts for insert to authenticated with check (app.can(company_id, 'admin.company.edit'));
create policy admin_edit  on public.payment_gateway_accounts for update to authenticated
  using (app.can(company_id, 'admin.company.edit')) with check (app.can(company_id, 'admin.company.edit'));

create policy viewer_read on public.payment_requests for select to authenticated using (app.can(company_id, 'pos.view'));
create policy seller      on public.payment_requests for insert to authenticated
  with check (app.can(company_id, 'pos.sell') and created_by = auth.uid() and status = 'pending');

revoke all on public.till_sessions, public.payment_gateway_accounts, public.payment_requests from anon, authenticated;
grant select on public.till_sessions to authenticated;
grant insert (company_id, branch_id, opening_float) on public.till_sessions to authenticated;
-- The encrypted key is never readable by users; the server reads it.
grant select (company_id, gateway, currency, integration_id, enabled, updated_by, updated_at) on public.payment_gateway_accounts to authenticated;
grant insert (company_id, gateway, currency, integration_id, integration_key_enc, enabled),
      update (integration_id, integration_key_enc, enabled) on public.payment_gateway_accounts to authenticated;
grant select on public.payment_requests to authenticated;
grant insert (company_id, till_session_id, gateway, method, currency, amount_cents, phone, reference) on public.payment_requests to authenticated;
