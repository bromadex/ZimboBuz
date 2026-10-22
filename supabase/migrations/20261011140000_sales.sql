-- Quotes, invoices and payments (issue #25 / P8, ported from Bromadex):
--   * line amounts and document totals are always computed by the database
--     (VAT-inclusive or exclusive prices, per company setting);
--   * submitting an invoice posts it to the ledger, takes stock out of the
--     branch's default location and emits sale.submitted;
--   * payments are allocated to submitted invoices (across currencies);
--     paid and balance amounts are derived live from submitted payments;
--   * realised exchange gains and losses are posted automatically (§6.1).

-- ---------------------------------------------------------------------------
-- Shared line maths
-- ---------------------------------------------------------------------------

-- Computes net, tax and total for a line. VAT-inclusive prices are split back
-- into net and tax; exclusive prices have tax added. Half-up rounding.
create function app.line_amounts(p_quantity numeric, p_unit_price_cents bigint, p_discount_cents bigint,
                                 p_rate_bp integer, p_inclusive boolean,
                                 out net_cents bigint, out tax_cents bigint, out total_cents bigint)
language plpgsql immutable
as $$
declare
  v_gross bigint := round(p_quantity * p_unit_price_cents)::bigint - coalesce(p_discount_cents, 0);
begin
  if v_gross < 0 then
    raise exception 'the discount is larger than the line amount' using errcode = 'check_violation';
  end if;
  if p_inclusive then
    total_cents := v_gross;
    net_cents   := round(v_gross * 10000.0 / (10000 + p_rate_bp))::bigint;
    tax_cents   := total_cents - net_cents;
  else
    net_cents   := v_gross;
    tax_cents   := round(v_gross * p_rate_bp / 10000.0)::bigint;
    total_cents := net_cents + tax_cents;
  end if;
end;
$$;

-- Fills a line's tax rate and amounts from its parent document's company and date.
create function app.compute_line()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_parent_table text := tg_argv[0];
  v_parent_col   text := tg_argv[1];
  v_date_col     text := tg_argv[2];
  v_on           date;
  v_amounts      record;
begin
  execute format('select %I from public.%I where id = $1', v_date_col, v_parent_table)
    into v_on using (to_jsonb(new)->>v_parent_col)::uuid;
  if new.product_id is not null then
    select coalesce(new.description, p.name), coalesce(new.tax_code, p.tax_code)
    into new.description, new.tax_code
    from public.products p where p.id = new.product_id and p.company_id = new.company_id;
  end if;
  if coalesce(trim(new.description), '') = '' then
    raise exception 'each line needs a product or a description' using errcode = 'check_violation';
  end if;
  new.tax_code    := coalesce(new.tax_code, 'standard');
  new.tax_rate_bp := app.tax_rate_bp(new.company_id, new.tax_code, coalesce(v_on, current_date));
  select * into v_amounts from app.line_amounts(new.quantity, new.unit_price_cents, new.discount_cents,
    new.tax_rate_bp, (select prices_include_tax from public.companies where id = new.company_id));
  new.net_cents   := v_amounts.net_cents;
  new.tax_cents   := v_amounts.tax_cents;
  new.total_cents := v_amounts.total_cents;
  return new;
end;
$$;

-- Recomputes a document's totals from its lines (BEFORE UPDATE on the document).
create function app.compute_totals()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_lines_table text := tg_argv[0];
  v_parent_col  text := tg_argv[1];
begin
  execute format('select coalesce(sum(net_cents), 0), coalesce(sum(tax_cents), 0), coalesce(sum(total_cents), 0)
                  from public.%I where %I = $1', v_lines_table, v_parent_col)
    into new.subtotal_cents, new.tax_cents, new.total_cents using new.id;
  return new;
end;
$$;

-- After a line changes, touch the parent so its totals are recomputed.
create function app.touch_parent_totals()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_parent_table text := tg_argv[0];
  v_parent_col   text := tg_argv[1];
begin
  execute format('update public.%I set subtotal_cents = subtotal_cents where id = $1 and docstatus = 0', v_parent_table)
    using (to_jsonb(coalesce(new, old))->>v_parent_col)::uuid;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------

create table public.quotes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  branch_id       uuid not null,
  number          text,
  customer_id     uuid not null,
  currency        char(3) not null check (currency in ('USD','ZWG','ZAR')),
  quote_date      date not null default current_date,
  valid_until     date,
  lead_id         uuid,
  notes           text,
  subtotal_cents  bigint not null default 0,
  tax_cents       bigint not null default 0,
  total_cents     bigint not null default 0,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, number),
  unique (company_id, id),
  foreign key (company_id, branch_id) references public.branches(company_id, id),
  foreign key (company_id, customer_id) references public.customers(company_id, id)
);

create table public.quote_lines (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  quote_id          uuid not null,
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
  foreign key (company_id, quote_id) references public.quotes(company_id, id),
  foreign key (company_id, product_id) references public.products(company_id, id)
);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

create table public.sales_invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  branch_id       uuid not null,
  number          text,
  customer_id     uuid not null,
  currency        char(3) not null check (currency in ('USD','ZWG','ZAR')),
  exchange_rate   numeric(20,8) check (exchange_rate > 0),   -- set on submission
  invoice_date    date not null default current_date,
  due_date        date,
  quote_id        uuid,
  notes           text,
  subtotal_cents  bigint not null default 0,
  tax_cents       bigint not null default 0,
  total_cents     bigint not null default 0,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, number),
  unique (company_id, id),
  foreign key (company_id, branch_id) references public.branches(company_id, id),
  foreign key (company_id, customer_id) references public.customers(company_id, id),
  foreign key (company_id, quote_id) references public.quotes(company_id, id)
);

create table public.sales_invoice_lines (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  invoice_id        uuid not null,
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
  foreign key (company_id, invoice_id) references public.sales_invoices(company_id, id),
  foreign key (company_id, product_id) references public.products(company_id, id)
);

create index on public.quotes (company_id, customer_id);
create index on public.sales_invoices (company_id, customer_id);
create index on public.quote_lines (quote_id);
create index on public.sales_invoice_lines (invoice_id);

select app.enable_document_lifecycle('public.quotes', 'quote');
select app.enable_document_lifecycle('public.sales_invoices', 'sales_invoice');

create trigger quote_lines_draft before insert or update or delete on public.quote_lines
  for each row execute function app.draft_lines_only('quotes', 'quote_id');
create trigger quote_lines_compute before insert or update on public.quote_lines
  for each row execute function app.compute_line('quotes', 'quote_id', 'quote_date');
create trigger quote_lines_totals after insert or update or delete on public.quote_lines
  for each row execute function app.touch_parent_totals('quotes', 'quote_id');
create trigger quotes_totals before update on public.quotes
  for each row execute function app.compute_totals('quote_lines', 'quote_id');
create trigger quotes_touch before update on public.quotes
  for each row execute function app.touch_updated_at();

create trigger sales_invoice_lines_draft before insert or update or delete on public.sales_invoice_lines
  for each row execute function app.draft_lines_only('sales_invoices', 'invoice_id');
create trigger sales_invoice_lines_compute before insert or update on public.sales_invoice_lines
  for each row execute function app.compute_line('sales_invoices', 'invoice_id', 'invoice_date');
create trigger sales_invoice_lines_totals after insert or update or delete on public.sales_invoice_lines
  for each row execute function app.touch_parent_totals('sales_invoices', 'invoice_id');
create trigger sales_invoices_totals before update on public.sales_invoices
  for each row execute function app.compute_totals('sales_invoice_lines', 'invoice_id');
create trigger sales_invoices_touch before update on public.sales_invoices
  for each row execute function app.touch_updated_at();

-- Submitting needs at least one line; the exchange rate is fixed at submission.
create function app.before_invoice_submit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.docstatus = 0 and new.docstatus = 1 then
    if not exists (select 1 from public.sales_invoice_lines where invoice_id = new.id) then
      raise exception 'an invoice needs at least one line' using errcode = 'check_violation';
    end if;
    new.exchange_rate := coalesce(new.exchange_rate, app.rate_at(new.company_id, new.currency));
  end if;
  return new;
end;
$$;

-- Trigger names run in alphabetical order: lifecycle, then this, then totals.
create trigger sales_invoices_prepare before update on public.sales_invoices
  for each row execute function app.before_invoice_submit();

-- Base-currency cents for an amount in a document currency at the document's rate.
create function app.to_base(p_cents bigint, p_rate numeric)
returns bigint
language sql immutable
as $$
  select round(p_cents::numeric / p_rate)::bigint;
$$;

create function app.after_invoice_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_total bigint;
  v_net   bigint;
  v_line  record;
  v_loc   uuid;
  v_mov   uuid;
begin
  if old.docstatus = 0 and new.docstatus = 1 then
    v_total := app.to_base(new.total_cents, new.exchange_rate);
    v_net   := app.to_base(new.subtotal_cents, new.exchange_rate);
    perform app.post_entry(new.company_id, new.invoice_date, 'Invoice ' || new.number,
      'sales_invoice', new.id, jsonb_build_array(
        jsonb_build_object('account', 'accounts_receivable', 'debit', v_total,
                           'currency', new.currency, 'amount', new.total_cents, 'rate', new.exchange_rate),
        jsonb_build_object('account', 'sales', 'credit', v_net,
                           'currency', new.currency, 'amount', -new.subtotal_cents, 'rate', new.exchange_rate),
        jsonb_build_object('account', 'vat_output', 'credit', v_total - v_net,
                           'currency', new.currency, 'amount', -new.tax_cents, 'rate', new.exchange_rate)));

    -- Take stock items out of the branch's default location.
    select id into v_loc from public.stock_locations where branch_id = new.branch_id and is_default;
    for v_line in
      select l.product_id, sum(l.quantity) as quantity
      from public.sales_invoice_lines l join public.products p on p.id = l.product_id
      where l.invoice_id = new.id and p.is_stock_item
      group by l.product_id
    loop
      insert into public.stock_movements (company_id, branch_id, movement_type, product_id, from_location_id,
                                          quantity, source_doctype, source_id, notes)
      values (new.company_id, new.branch_id, 'sale', v_line.product_id, v_loc, v_line.quantity,
              'sales_invoice', new.id, 'Invoice ' || new.number)
      returning id into v_mov;
      update public.stock_movements set docstatus = 1 where id = v_mov;
    end loop;

    perform app.emit_event(new.company_id, 'sale.submitted', 'sales_invoice', new.id::text,
      jsonb_build_object('number', new.number, 'customer_id', new.customer_id,
                         'currency', new.currency, 'total_cents', new.total_cents));

  elsif old.docstatus = 1 and new.docstatus = 2 then
    if exists (select 1 from public.payment_allocations a join public.payments p on p.id = a.payment_id
               where a.invoice_id = new.id and p.docstatus = 1) then
      raise exception 'cancel the payments on this invoice first' using errcode = 'check_violation';
    end if;
    perform app.reverse_source_entries(new.company_id, 'sales_invoice', new.id, 'Cancelled invoice ' || new.number);
    update public.stock_movements set docstatus = 2, cancel_reason = 'Invoice ' || new.number || ' cancelled'
    where source_doctype = 'sales_invoice' and source_id = new.id and docstatus = 1;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  branch_id          uuid not null,
  number             text,
  customer_id        uuid not null,
  currency           char(3) not null check (currency in ('USD','ZWG','ZAR')),
  amount_cents       bigint not null check (amount_cents > 0),
  exchange_rate      numeric(20,8) check (exchange_rate > 0),   -- set on submission
  method             text not null check (method in
                     ('cash','ecocash','onemoney','innbucks','card','bank_transfer','zipit','store_credit','other')),
  reference          text,
  received_on        date not null default current_date,
  gateway            text,
  gateway_reference  text,
  notes              text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, number),
  unique (company_id, id),
  foreign key (company_id, branch_id) references public.branches(company_id, id),
  foreign key (company_id, customer_id) references public.customers(company_id, id)
);

create unique index payments_gateway_reference on public.payments (company_id, gateway, gateway_reference)
  where gateway_reference is not null;

create table public.payment_allocations (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  payment_id     uuid not null,
  invoice_id     uuid not null,
  amount_cents   bigint not null check (amount_cents > 0),   -- in the payment's currency
  applied_cents  bigint,                                    -- in the invoice's currency, set on submission
  unique (payment_id, invoice_id),
  foreign key (company_id, payment_id) references public.payments(company_id, id),
  foreign key (company_id, invoice_id) references public.sales_invoices(company_id, id)
);

create index on public.payment_allocations (invoice_id);

select app.enable_document_lifecycle('public.payments', 'payment');

create trigger payments_touch before update on public.payments
  for each row execute function app.touch_updated_at();
create trigger payment_allocations_draft before insert or update or delete on public.payment_allocations
  for each row execute function app.draft_lines_only('payments', 'payment_id');

create function app.before_payment_submit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.docstatus = 0 and new.docstatus = 1 then
    new.exchange_rate := coalesce(new.exchange_rate, app.rate_at(new.company_id, new.currency));
  end if;
  return new;
end;
$$;

create trigger payments_prepare before update on public.payments
  for each row execute function app.before_payment_submit();

-- Applied (submitted) payment amount per invoice, in the invoice's currency.
create function app.invoice_paid_cents(p_invoice uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(a.applied_cents), 0)::bigint
  from public.payment_allocations a join public.payments p on p.id = a.payment_id
  where a.invoice_id = p_invoice and p.docstatus = 1;
$$;

create function app.after_payment_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_alloc      record;
  v_allocated  bigint := 0;
  v_ar_base    bigint := 0;
  v_cash_base  bigint;
  v_unalloc    bigint;
  v_applied    bigint;
  v_balance    bigint;
  v_account    text;
  v_lines      jsonb;
begin
  if old.docstatus = 0 and new.docstatus = 1 then
    for v_alloc in
      select a.id, a.amount_cents, i.id as invoice_id, i.currency, i.exchange_rate, i.total_cents,
             i.docstatus, i.customer_id, i.number
      from public.payment_allocations a join public.sales_invoices i on i.id = a.invoice_id
      where a.payment_id = new.id
      order by i.invoice_date, i.number
    loop
      if v_alloc.docstatus <> 1 then
        raise exception 'invoice % is not submitted', coalesce(v_alloc.number, 'draft') using errcode = 'check_violation';
      end if;
      if v_alloc.customer_id <> new.customer_id then
        raise exception 'invoice % belongs to another customer', v_alloc.number using errcode = 'check_violation';
      end if;
      v_applied := app.convert_cents(v_alloc.amount_cents, new.exchange_rate,
                                     app.rate_at(new.company_id, v_alloc.currency));
      v_balance := v_alloc.total_cents - app.invoice_paid_cents(v_alloc.invoice_id);
      if v_applied > v_balance then
        raise exception 'payment exceeds the balance of invoice %', v_alloc.number using errcode = 'check_violation';
      end if;
      update public.payment_allocations set applied_cents = v_applied where id = v_alloc.id;
      v_allocated := v_allocated + v_alloc.amount_cents;
      v_ar_base   := v_ar_base + app.to_base(v_applied, v_alloc.exchange_rate);
    end loop;

    if v_allocated > new.amount_cents then
      raise exception 'allocations exceed the payment amount' using errcode = 'check_violation';
    end if;

    v_cash_base := app.to_base(new.amount_cents, new.exchange_rate);
    v_unalloc   := app.to_base(new.amount_cents - v_allocated, new.exchange_rate);
    v_account := case
      when new.method = 'cash' then 'cash_' || lower(new.currency)
      when new.method in ('ecocash','onemoney','innbucks') then 'mobile_money'
      when new.method = 'card' then 'card_clearing'
      when new.method in ('bank_transfer','zipit') then 'bank'
      when new.method = 'store_credit' then 'customer_credit'
      else 'bank'
    end;
    v_lines := jsonb_build_array(
      jsonb_build_object('account', v_account, 'debit', v_cash_base,
                         'currency', new.currency, 'amount', new.amount_cents, 'rate', new.exchange_rate),
      jsonb_build_object('account', 'accounts_receivable', 'credit', v_ar_base),
      jsonb_build_object('account', 'customer_credit', 'credit', v_unalloc,
                         'currency', new.currency, 'amount', -(new.amount_cents - v_allocated), 'rate', new.exchange_rate),
      -- Realised exchange difference: positive = loss (debit), negative = gain (credit).
      jsonb_build_object('account', 'fx_gain_loss', 'debit', v_ar_base + v_unalloc - v_cash_base));
    perform app.post_entry(new.company_id, new.received_on, 'Payment ' || new.number,
                           'payment', new.id, v_lines);

    perform app.emit_event(new.company_id, 'payment.received', 'payment', new.id::text,
      jsonb_build_object('number', new.number, 'customer_id', new.customer_id, 'method', new.method,
                         'currency', new.currency, 'amount_cents', new.amount_cents));

  elsif old.docstatus = 1 and new.docstatus = 2 then
    perform app.reverse_source_entries(new.company_id, 'payment', new.id, 'Cancelled payment ' || new.number);
  end if;
  return null;
end;
$$;

-- Created after payments exist because the invoice trigger checks payments.
create trigger sales_invoices_after after update on public.sales_invoices
  for each row execute function app.after_invoice_change();
create trigger payments_after after update on public.payments
  for each row execute function app.after_payment_change();

-- Invoices with live paid amount, balance and payment status.
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

-- ---------------------------------------------------------------------------
-- Quote → invoice
-- ---------------------------------------------------------------------------

create function public.convert_quote_to_invoice(p_quote uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_quote   public.quotes;
  v_invoice uuid;
begin
  select * into v_quote from public.quotes where id = p_quote;
  if v_quote.id is null or not app.can(v_quote.company_id, 'sales.invoice.create') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_quote.docstatus <> 1 then
    raise exception 'only submitted quotes can be invoiced' using errcode = 'check_violation';
  end if;
  insert into public.sales_invoices (company_id, branch_id, customer_id, currency, quote_id, notes)
  values (v_quote.company_id, v_quote.branch_id, v_quote.customer_id, v_quote.currency, v_quote.id, v_quote.notes)
  returning id into v_invoice;
  insert into public.sales_invoice_lines (company_id, invoice_id, line_no, product_id, description, quantity,
                                          unit_price_cents, discount_cents, tax_code)
  select company_id, v_invoice, line_no, product_id, description, quantity, unit_price_cents, discount_cents, tax_code
  from public.quote_lines where quote_id = p_quote order by line_no;
  return v_invoice;
end;
$$;
revoke execute on function public.convert_quote_to_invoice(uuid) from public, anon;
grant execute on function public.convert_quote_to_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Catalogue updates and row-level security
-- ---------------------------------------------------------------------------

insert into public.doctype_links (from_doctype, to_doctype, link_column, label) values
  ('sales_invoice', 'stock_movement', 'source_id', 'Stock movements');

alter table public.quotes              enable row level security;
alter table public.quote_lines         enable row level security;
alter table public.sales_invoices      enable row level security;
alter table public.sales_invoice_lines enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;

create policy viewer_read on public.quotes for select to authenticated using (app.can(company_id, 'sales.view'));
create policy author      on public.quotes for insert to authenticated with check (app.can(company_id, 'sales.quote.create'));
create policy author_edit on public.quotes for update to authenticated
  using (app.can(company_id, 'sales.quote.create')) with check (app.can(company_id, 'sales.quote.create'));
create policy viewer_read on public.quote_lines for select to authenticated using (app.can(company_id, 'sales.view'));
create policy author      on public.quote_lines for insert to authenticated with check (app.can(company_id, 'sales.quote.create'));
create policy author_edit on public.quote_lines for update to authenticated
  using (app.can(company_id, 'sales.quote.create')) with check (app.can(company_id, 'sales.quote.create'));

create policy viewer_read on public.sales_invoices for select to authenticated using (app.can(company_id, 'sales.view'));
create policy author      on public.sales_invoices for insert to authenticated with check (app.can(company_id, 'sales.invoice.create'));
-- Drafts: invoice creators. Submitting: sales.invoice.submit. Cancelling: sales.invoice.cancel.
create policy author_edit on public.sales_invoices for update to authenticated
  using (app.can(company_id, 'sales.invoice.create'))
  with check (case docstatus when 0 then app.can(company_id, 'sales.invoice.create')
                             when 1 then app.can(company_id, 'sales.invoice.submit')
                             else app.can(company_id, 'sales.invoice.cancel') end);
create policy viewer_read on public.sales_invoice_lines for select to authenticated using (app.can(company_id, 'sales.view'));
create policy author      on public.sales_invoice_lines for insert to authenticated with check (app.can(company_id, 'sales.invoice.create'));
create policy author_edit on public.sales_invoice_lines for update to authenticated
  using (app.can(company_id, 'sales.invoice.create')) with check (app.can(company_id, 'sales.invoice.create'));

create policy viewer_read on public.payments for select to authenticated using (app.can(company_id, 'sales.view'));
create policy recorder    on public.payments for insert to authenticated with check (app.can(company_id, 'sales.payment.record'));
create policy recorder_edit on public.payments for update to authenticated
  using (app.can(company_id, 'sales.payment.record'))
  with check (docstatus < 2 and app.can(company_id, 'sales.payment.record')
              or docstatus = 2 and app.can(company_id, 'sales.invoice.cancel'));
create policy viewer_read on public.payment_allocations for select to authenticated using (app.can(company_id, 'sales.view'));
create policy recorder    on public.payment_allocations for insert to authenticated with check (app.can(company_id, 'sales.payment.record'));
create policy recorder_edit on public.payment_allocations for update to authenticated
  using (app.can(company_id, 'sales.payment.record')) with check (app.can(company_id, 'sales.payment.record'));

revoke all on public.quotes, public.quote_lines, public.sales_invoices, public.sales_invoice_lines,
              public.payments, public.payment_allocations from anon, authenticated;
grant select, insert, update on public.quotes, public.quote_lines, public.sales_invoices,
              public.sales_invoice_lines, public.payments to authenticated;
grant select, insert, update (amount_cents) on public.payment_allocations to authenticated;
