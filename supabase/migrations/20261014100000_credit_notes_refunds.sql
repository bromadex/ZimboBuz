-- Credit notes and refunds (P8).
--   * A credit note is made from a submitted invoice, for some or all of its
--     lines and quantities (never more than was invoiced and not yet
--     credited). It is submitted at once: it reduces what the customer owes
--     on that invoice, can put the goods back into stock, and is posted to
--     the books at the invoice's own exchange rate. Anything more than the
--     invoice still owed (e.g. the invoice was already paid) becomes the
--     customer's credit.
--   * A refund pays a customer's credit back (cash, EcoCash, bank...). Cash
--     refunds from a till reduce the cash expected at cash-up.
--   * Customer credit = money paid in advance + credit-note excess
--     - credit used to pay invoices - refunds, per currency.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.credit_notes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  branch_id       uuid not null,
  number          text,
  customer_id     uuid not null,
  invoice_id      uuid not null,
  currency        char(3) not null check (currency in ('USD','ZWG','ZAR')),
  exchange_rate   numeric(20,8) not null check (exchange_rate > 0),   -- the invoice's rate
  credit_date     date not null default current_date,
  tax_date        date not null,                                      -- the invoice's date: VAT as charged
  reason          text not null check (length(trim(reason)) between 1 and 500),
  return_stock    boolean not null default false,
  subtotal_cents  bigint not null default 0,
  tax_cents       bigint not null default 0,
  total_cents     bigint not null default 0,
  applied_cents   bigint,                                             -- part that reduced the invoice
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, number),
  unique (company_id, id),
  foreign key (company_id, branch_id) references public.branches(company_id, id),
  foreign key (company_id, customer_id) references public.customers(company_id, id),
  foreign key (company_id, invoice_id) references public.sales_invoices(company_id, id)
);

create table public.credit_note_lines (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  credit_note_id    uuid not null,
  invoice_line_id   uuid not null references public.sales_invoice_lines(id),
  line_no           integer not null default 1,
  product_id        uuid,
  description       text,
  quantity          numeric(14,3) not null check (quantity > 0),
  unit_price_cents  bigint not null check (unit_price_cents >= 0),
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  tax_code          text check (tax_code in ('standard','zero_rated','exempt')),
  tax_rate_bp       integer not null default 0,
  net_cents         bigint not null default 0,
  tax_cents         bigint not null default 0,
  total_cents       bigint not null default 0,
  foreign key (company_id, credit_note_id) references public.credit_notes(company_id, id),
  foreign key (company_id, product_id) references public.products(company_id, id)
);
create index on public.credit_notes (company_id, invoice_id);
create index on public.credit_note_lines (credit_note_id);
create index on public.credit_note_lines (invoice_line_id);

select app.enable_document_lifecycle('public.credit_notes', 'credit_note');

create trigger credit_note_lines_draft before insert or update or delete on public.credit_note_lines
  for each row execute function app.draft_lines_only('credit_notes', 'credit_note_id');
create trigger credit_note_lines_compute before insert or update on public.credit_note_lines
  for each row execute function app.compute_line('credit_notes', 'credit_note_id', 'tax_date');
create trigger credit_note_lines_totals after insert or update or delete on public.credit_note_lines
  for each row execute function app.touch_parent_totals('credit_notes', 'credit_note_id');
create trigger credit_notes_totals before update on public.credit_notes
  for each row execute function app.compute_totals('credit_note_lines', 'credit_note_id');
create trigger credit_notes_touch before update on public.credit_notes
  for each row execute function app.touch_updated_at();

insert into public.doctypes (code, name, module_code, table_name, view_permission, create_permission, prefix, is_submittable)
values ('refund', 'Refund', 'sales', 'refunds', 'sales.view', 'sales.payment.record', 'RFD', true);

create table public.refunds (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  branch_id        uuid not null,
  number           text,
  customer_id      uuid not null,
  currency         char(3) not null check (currency in ('USD','ZWG','ZAR')),
  amount_cents     bigint not null check (amount_cents > 0),
  exchange_rate    numeric(20,8) check (exchange_rate > 0),
  method           text not null check (method in ('cash','ecocash','onemoney','innbucks','card','bank_transfer','zipit','other')),
  reference        text,
  refunded_on      date not null default current_date,
  credit_note_id   uuid,
  till_session_id  uuid,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, number),
  unique (company_id, id),
  foreign key (company_id, branch_id) references public.branches(company_id, id),
  foreign key (company_id, customer_id) references public.customers(company_id, id),
  foreign key (company_id, credit_note_id) references public.credit_notes(company_id, id),
  foreign key (company_id, till_session_id) references public.till_sessions(company_id, id)
);
create index on public.refunds (company_id, customer_id);
create index on public.refunds (till_session_id) where till_session_id is not null;

select app.enable_document_lifecycle('public.refunds', 'refund');
create trigger refunds_touch before update on public.refunds
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Amounts
-- ---------------------------------------------------------------------------

-- Settled amount of an invoice: payments applied to it plus credit notes
-- applied to it (both in the invoice's currency). Replaces the payments-only
-- version, so balances everywhere (lists, credit book, portal) include credits.
create or replace function app.invoice_paid_cents(p_invoice uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select (coalesce((select sum(a.applied_cents)
                    from public.payment_allocations a join public.payments p on p.id = a.payment_id
                    where a.invoice_id = p_invoice and p.docstatus = 1), 0)
        + coalesce((select sum(c.applied_cents) from public.credit_notes c
                    where c.invoice_id = p_invoice and c.docstatus = 1), 0))::bigint;
$$;

-- What the customer can still use or have refunded, in one currency.
create function app.customer_credit_cents(p_company uuid, p_customer uuid, p_currency char(3))
returns bigint
language sql stable security definer set search_path = ''
as $$
  select (
      coalesce((select sum(p.amount_cents - coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.payment_id = p.id), 0))
                from public.payments p
                where p.company_id = p_company and p.customer_id = p_customer and p.currency = p_currency
                  and p.docstatus = 1 and p.method <> 'store_credit'), 0)
    + coalesce((select sum(c.total_cents - c.applied_cents) from public.credit_notes c
                where c.company_id = p_company and c.customer_id = p_customer and c.currency = p_currency and c.docstatus = 1), 0)
    - coalesce((select sum(p.amount_cents) from public.payments p
                where p.company_id = p_company and p.customer_id = p_customer and p.currency = p_currency
                  and p.docstatus = 1 and p.method = 'store_credit'), 0)
    - coalesce((select sum(r.amount_cents) from public.refunds r
                where r.company_id = p_company and r.customer_id = p_customer and r.currency = p_currency and r.docstatus = 1), 0)
  )::bigint;
$$;
grant execute on function app.customer_credit_cents(uuid, uuid, char) to authenticated;

-- ---------------------------------------------------------------------------
-- Creating credit notes
-- ---------------------------------------------------------------------------

-- p_lines: [{"invoice_line_id": uuid, "quantity": number}]
create function public.create_credit_note(p_invoice uuid, p_lines jsonb, p_reason text, p_return_stock boolean default false)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv    public.sales_invoices;
  v_note   uuid;
  v_line   jsonb;
  v_il     public.sales_invoice_lines;
  v_qty    numeric;
  v_left   numeric;
  v_no     integer := 0;
  v_cn     public.credit_notes;
  v_bal    bigint;
  v_loc    uuid;
  v_mov    uuid;
  v_item   record;
begin
  select * into v_inv from public.sales_invoices where id = p_invoice;
  if v_inv.id is null or not (app.can(v_inv.company_id, 'sales.invoice.cancel') or app.can(v_inv.company_id, 'pos.refund')) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_inv.docstatus <> 1 then
    raise exception 'only submitted invoices can be credited' using errcode = 'check_violation';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'please give a reason for the credit note' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'choose at least one line to credit' using errcode = 'check_violation';
  end if;

  insert into public.credit_notes (company_id, branch_id, customer_id, invoice_id, currency, exchange_rate,
                                   tax_date, reason, return_stock)
  values (v_inv.company_id, v_inv.branch_id, v_inv.customer_id, v_inv.id, v_inv.currency, v_inv.exchange_rate,
          v_inv.invoice_date, trim(p_reason), coalesce(p_return_stock, false))
  returning id into v_note;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line->>'quantity')::numeric, 0);
    if v_qty <= 0 then continue; end if;
    select * into v_il from public.sales_invoice_lines
    where id = (v_line->>'invoice_line_id')::uuid and invoice_id = v_inv.id;
    if v_il.id is null then
      raise exception 'that line is not on this invoice' using errcode = 'check_violation';
    end if;
    v_left := v_il.quantity - coalesce((select sum(l.quantity) from public.credit_note_lines l
                                        join public.credit_notes c on c.id = l.credit_note_id
                                        where l.invoice_line_id = v_il.id and c.docstatus = 1), 0);
    if v_qty > v_left then
      raise exception 'you can credit at most % of %', v_left, v_il.description using errcode = 'check_violation';
    end if;
    v_no := v_no + 1;
    insert into public.credit_note_lines (company_id, credit_note_id, invoice_line_id, line_no, product_id, description,
                                          quantity, unit_price_cents, discount_cents, tax_code)
    values (v_inv.company_id, v_note, v_il.id, v_no, v_il.product_id, v_il.description, v_qty, v_il.unit_price_cents,
            round(v_il.discount_cents * v_qty / v_il.quantity)::bigint, v_il.tax_code);
  end loop;
  if v_no = 0 then
    raise exception 'choose at least one line to credit' using errcode = 'check_violation';
  end if;

  -- Submit: number it, apply it to the invoice, post it and return stock.
  v_bal := v_inv.total_cents - app.invoice_paid_cents(v_inv.id);
  update public.credit_notes set docstatus = 1, applied_cents = least(total_cents, greatest(v_bal, 0))
  where id = v_note returning * into v_cn;

  perform app.post_entry(v_cn.company_id, v_cn.credit_date, 'Credit note ' || v_cn.number, 'credit_note', v_cn.id,
    jsonb_build_array(
      jsonb_build_object('account', 'sales', 'debit', app.to_base(v_cn.subtotal_cents, v_cn.exchange_rate),
                         'currency', v_cn.currency, 'amount', v_cn.subtotal_cents, 'rate', v_cn.exchange_rate),
      jsonb_build_object('account', 'vat_output',
                         'debit', app.to_base(v_cn.total_cents, v_cn.exchange_rate) - app.to_base(v_cn.subtotal_cents, v_cn.exchange_rate),
                         'currency', v_cn.currency, 'amount', v_cn.tax_cents, 'rate', v_cn.exchange_rate),
      jsonb_build_object('account', 'accounts_receivable', 'credit', app.to_base(v_cn.applied_cents, v_cn.exchange_rate),
                         'currency', v_cn.currency, 'amount', -v_cn.applied_cents, 'rate', v_cn.exchange_rate),
      jsonb_build_object('account', 'customer_credit',
                         'credit', app.to_base(v_cn.total_cents, v_cn.exchange_rate) - app.to_base(v_cn.applied_cents, v_cn.exchange_rate),
                         'currency', v_cn.currency, 'amount', -(v_cn.total_cents - v_cn.applied_cents), 'rate', v_cn.exchange_rate)));

  if v_cn.return_stock then
    select id into v_loc from public.stock_locations where branch_id = v_cn.branch_id and is_default;
    for v_item in
      select l.product_id, sum(l.quantity) as quantity
      from public.credit_note_lines l join public.products p on p.id = l.product_id
      where l.credit_note_id = v_cn.id and p.is_stock_item
      group by l.product_id
    loop
      insert into public.stock_movements (company_id, branch_id, movement_type, product_id, to_location_id, quantity,
                                          source_doctype, source_id, notes)
      values (v_cn.company_id, v_cn.branch_id, 'return_in', v_item.product_id, v_loc, v_item.quantity,
              'credit_note', v_cn.id, 'Credit note ' || v_cn.number)
      returning id into v_mov;
      update public.stock_movements set docstatus = 1 where id = v_mov;
    end loop;
  end if;

  perform app.log_system_message(v_cn.company_id, 'sales_invoice', v_inv.id, 'Credit note ' || v_cn.number || ': ' || v_cn.reason);
  return v_cn.id;
end;
$$;
revoke execute on function public.create_credit_note(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.create_credit_note(uuid, jsonb, text, boolean) to authenticated;

-- Cancelling a credit note puts the amount back on the invoice; refused if
-- the credit it created has already been refunded or used.
create function public.cancel_credit_note(p_note uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_cn public.credit_notes;
begin
  select * into v_cn from public.credit_notes where id = p_note;
  if v_cn.id is null or not app.can(v_cn.company_id, 'sales.invoice.cancel') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_cn.docstatus <> 1 then
    raise exception 'only submitted credit notes can be cancelled' using errcode = 'check_violation';
  end if;
  if app.customer_credit_cents(v_cn.company_id, v_cn.customer_id, v_cn.currency) < v_cn.total_cents - v_cn.applied_cents then
    raise exception 'this credit has already been refunded or used; cancel the refund first' using errcode = 'check_violation';
  end if;
  update public.credit_notes set docstatus = 2, cancel_reason = p_reason where id = p_note;
  perform app.reverse_source_entries(v_cn.company_id, 'credit_note', v_cn.id, 'Cancelled credit note ' || v_cn.number);
  update public.stock_movements set docstatus = 2, cancel_reason = 'Credit note ' || v_cn.number || ' cancelled'
  where source_doctype = 'credit_note' and source_id = v_cn.id and docstatus = 1;
end;
$$;
revoke execute on function public.cancel_credit_note(uuid, text) from public, anon;
grant execute on function public.cancel_credit_note(uuid, text) to authenticated;

-- An invoice with credit notes cannot be cancelled until they are.
create function app.guard_invoice_cancel()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.docstatus = 1 and new.docstatus = 2
     and exists (select 1 from public.credit_notes where invoice_id = new.id and docstatus = 1) then
    raise exception 'cancel the credit notes on this invoice first' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger sales_invoices_credit_guard before update on public.sales_invoices
  for each row execute function app.guard_invoice_cancel();

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

create function public.record_refund(
  p_customer      uuid,
  p_currency      char(3),
  p_amount_cents  bigint,
  p_method        text,
  p_reference     text default null,
  p_credit_note   uuid default null,
  p_till_session  uuid default null,
  p_notes         text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_branch  uuid;
  v_id      uuid;
  v_r       public.refunds;
  v_s       public.till_sessions;
  v_account text;
begin
  select company_id into v_company from public.customers where id = p_customer;
  if v_company is null or not (app.can(v_company, 'sales.payment.record') or app.can(v_company, 'pos.refund')) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'please enter the amount to refund' using errcode = 'check_violation';
  end if;
  if p_amount_cents > app.customer_credit_cents(v_company, p_customer, p_currency) then
    raise exception 'the refund is more than the customer''s credit in %', p_currency using errcode = 'check_violation';
  end if;
  if p_credit_note is not null and not exists (
    select 1 from public.credit_notes where id = p_credit_note and customer_id = p_customer and docstatus = 1) then
    raise exception 'that credit note is not for this customer' using errcode = 'check_violation';
  end if;
  if p_method not in ('cash','ecocash','onemoney','innbucks','card','bank_transfer','zipit','other') then
    raise exception 'please choose how the money is paid back' using errcode = 'check_violation';
  end if;
  if p_till_session is not null then
    select * into v_s from public.till_sessions where id = p_till_session and company_id = v_company;
    if v_s.id is null or v_s.docstatus <> 0 or v_s.opened_by <> auth.uid() then
      raise exception 'refund from your own open till' using errcode = 'check_violation';
    end if;
    v_branch := v_s.branch_id;
  else
    select id into v_branch from public.branches where company_id = v_company and archived_at is null
    order by is_head_office desc, created_at limit 1;
  end if;

  insert into public.refunds (company_id, branch_id, customer_id, currency, amount_cents, method, reference,
                              credit_note_id, till_session_id, notes)
  values (v_company, v_branch, p_customer, p_currency, p_amount_cents, p_method, nullif(trim(p_reference), ''),
          p_credit_note, p_till_session, p_notes)
  returning id into v_id;
  update public.refunds set docstatus = 1, exchange_rate = app.rate_at(v_company, p_currency) where id = v_id
  returning * into v_r;

  v_account := case
    when p_method = 'cash' then 'cash_' || lower(p_currency)
    when p_method in ('ecocash','onemoney','innbucks') then 'mobile_money'
    when p_method = 'card' then 'card_clearing'
    else 'bank' end;
  perform app.post_entry(v_company, v_r.refunded_on, 'Refund ' || v_r.number, 'refund', v_r.id, jsonb_build_array(
    jsonb_build_object('account', 'customer_credit', 'debit', app.to_base(v_r.amount_cents, v_r.exchange_rate),
                       'currency', v_r.currency, 'amount', v_r.amount_cents, 'rate', v_r.exchange_rate),
    jsonb_build_object('account', v_account, 'credit', app.to_base(v_r.amount_cents, v_r.exchange_rate),
                       'currency', v_r.currency, 'amount', -v_r.amount_cents, 'rate', v_r.exchange_rate)));
  return v_id;
end;
$$;
revoke execute on function public.record_refund(uuid, char, bigint, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.record_refund(uuid, char, bigint, text, text, uuid, uuid, text) to authenticated;

-- Cash refunds from a till leave the drawer.
create or replace function app.till_expected_cash(p_session uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with currencies as (
    select key as currency from public.till_sessions s, jsonb_object_keys(s.opening_float) key where s.id = p_session
    union select currency from public.payments where till_session_id = p_session and method = 'cash' and docstatus = 1
    union select kept_currency from public.till_change where till_session_id = p_session
    union select change_currency from public.till_change where till_session_id = p_session
    union select currency from public.refunds where till_session_id = p_session and method = 'cash' and docstatus = 1
  )
  select coalesce(jsonb_object_agg(c.currency,
           coalesce((select (s.opening_float->>c.currency)::bigint from public.till_sessions s where s.id = p_session), 0)
           + coalesce((select sum(p.amount_cents) from public.payments p
                       where p.till_session_id = p_session and p.method = 'cash' and p.docstatus = 1 and p.currency = c.currency), 0)
           + coalesce((select sum(t.kept_cents) from public.till_change t where t.till_session_id = p_session and t.kept_currency = c.currency), 0)
           - coalesce((select sum(t.change_cents) from public.till_change t where t.till_session_id = p_session and t.change_currency = c.currency), 0)
           - coalesce((select sum(r.amount_cents) from public.refunds r
                       where r.till_session_id = p_session and r.method = 'cash' and r.docstatus = 1 and r.currency = c.currency), 0)),
         '{}'::jsonb)
  from currencies c;
$$;

-- ---------------------------------------------------------------------------
-- Statements include credit notes, credit used and refunds
-- ---------------------------------------------------------------------------

create or replace function public.customer_statement(p_company uuid, p_customer uuid, p_currency char(3), p_from date, p_to date)
returns table (entry_date date, kind text, reference text, document_id uuid, debit_cents bigint, credit_cents bigint,
               balance_cents bigint, recorded_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  with entries as (
    select i.invoice_date as entry_date, 'invoice'::text as kind, i.number as reference, i.id as document_id,
           i.total_cents as debit_cents, 0::bigint as credit_cents, i.submitted_at as at
    from public.sales_invoices i
    where i.company_id = p_company and i.customer_id = p_customer and i.currency = p_currency and i.docstatus = 1
    union all
    select p.received_on, case when p.method = 'store_credit' then 'credit_used' else 'payment' end, p.number, p.id, 0, a.applied_cents, p.submitted_at
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
    join public.sales_invoices i on i.id = a.invoice_id
    where p.company_id = p_company and p.customer_id = p_customer and i.currency = p_currency and p.docstatus = 1
    union all
    select p.received_on, 'advance', p.number, p.id, 0,
           p.amount_cents - coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.payment_id = p.id), 0),
           p.submitted_at
    from public.payments p
    where p.company_id = p_company and p.customer_id = p_customer and p.currency = p_currency and p.docstatus = 1
      and p.method <> 'store_credit'
      and p.amount_cents > coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.payment_id = p.id), 0)
    union all
    -- paying with credit takes it out of the credit balance
    select p.received_on, 'credit_used', p.number, p.id, p.amount_cents, 0, p.submitted_at
    from public.payments p
    where p.company_id = p_company and p.customer_id = p_customer and p.currency = p_currency and p.docstatus = 1
      and p.method = 'store_credit'
    union all
    select c.credit_date, 'credit_note', c.number, c.id, 0, c.total_cents, c.submitted_at
    from public.credit_notes c
    where c.company_id = p_company and c.customer_id = p_customer and c.currency = p_currency and c.docstatus = 1
    union all
    select r.refunded_on, 'refund', r.number, r.id, r.amount_cents, 0, r.submitted_at
    from public.refunds r
    where r.company_id = p_company and r.customer_id = p_customer and r.currency = p_currency and r.docstatus = 1
  ),
  running as (
    select e.*, sum(e.debit_cents - e.credit_cents) over (order by e.entry_date, e.at, e.kind rows unbounded preceding) as balance_cents
    from entries e
  )
  select * from (
    select null::date, 'opening', null, null::uuid, 0::bigint, 0::bigint,
           coalesce((select r.balance_cents from running r where r.entry_date < p_from
                     order by r.entry_date desc, r.at desc, r.kind desc limit 1), 0),
           null::timestamptz
    union all
    select r.entry_date, r.kind, r.reference, r.document_id, r.debit_cents, r.credit_cents, r.balance_cents, r.at
    from running r where r.entry_date between p_from and p_to
  ) s
  order by 1 nulls first, 8, 2;
$$;

create or replace function public.portal_statement(p_slug text)
returns table (entry_date date, kind text, number text, currency char(3),
               debit_cents bigint, credit_cents bigint, balance_cents bigint)
language sql stable security definer set search_path = ''
as $$
  with link as (select * from app.portal_link(p_slug)),
  entries as (
    select i.invoice_date as entry_date, 'invoice'::text as kind, i.number, i.currency,
           i.total_cents as debit_cents, 0::bigint as credit_cents, i.submitted_at as at
    from link l join public.sales_invoices i on i.company_id = l.company_id and i.customer_id = l.customer_id
    where i.docstatus = 1
    union all
    select p.received_on, 'payment', p.number, p.currency, 0, p.amount_cents, p.submitted_at
    from link l join public.payments p on p.company_id = l.company_id and p.customer_id = l.customer_id
    where p.docstatus = 1 and p.method <> 'store_credit'
    union all
    select c.credit_date, 'credit_note', c.number, c.currency, 0, c.total_cents, c.submitted_at
    from link l join public.credit_notes c on c.company_id = l.company_id and c.customer_id = l.customer_id
    where c.docstatus = 1
    union all
    select r.refunded_on, 'refund', r.number, r.currency, r.amount_cents, 0, r.submitted_at
    from link l join public.refunds r on r.company_id = l.company_id and r.customer_id = l.customer_id
    where r.docstatus = 1
  )
  select e.entry_date, e.kind, e.number, e.currency, e.debit_cents, e.credit_cents,
         (sum(e.debit_cents - e.credit_cents) over (partition by e.currency order by e.entry_date, e.at, e.number
                                                    rows between unbounded preceding and current row))::bigint
  from entries e
  order by e.currency, e.entry_date, e.at, e.number;
$$;

-- ---------------------------------------------------------------------------
-- Catalogue and row-level security
-- ---------------------------------------------------------------------------

insert into public.doctype_links (from_doctype, to_doctype, link_column, label) values
  ('sales_invoice', 'credit_note', 'invoice_id', 'Credit notes'),
  ('customer', 'credit_note', 'customer_id', 'Credit notes'),
  ('customer', 'refund', 'customer_id', 'Refunds'),
  ('credit_note', 'stock_movement', 'source_id', 'Stock returned'),
  ('till_session', 'refund', 'till_session_id', 'Refunds')
on conflict do nothing;

alter table public.credit_notes      enable row level security;
alter table public.credit_note_lines enable row level security;
alter table public.refunds           enable row level security;

create policy viewer_read on public.credit_notes      for select to authenticated using (app.can(company_id, 'sales.view') or app.can(company_id, 'pos.view'));
create policy viewer_read on public.credit_note_lines for select to authenticated using (app.can(company_id, 'sales.view') or app.can(company_id, 'pos.view'));
create policy viewer_read on public.refunds           for select to authenticated using (app.can(company_id, 'sales.view') or app.can(company_id, 'pos.view'));

-- Written only through create_credit_note, cancel_credit_note and record_refund.
revoke all on public.credit_notes, public.credit_note_lines, public.refunds from anon, authenticated;
grant select on public.credit_notes, public.credit_note_lines, public.refunds to authenticated;

do $$
declare t text;
begin
  foreach t in array array['credit_notes','refunds'] loop
    execute format('create trigger %I_audit after insert or update on public.%I
                    for each row execute function app.audit_row()', t, t);
  end loop;
end;
$$;
