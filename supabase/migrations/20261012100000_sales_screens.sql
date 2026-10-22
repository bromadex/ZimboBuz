-- Support for the quotes, invoices and payments screens (P8, P13).

-- ---------------------------------------------------------------------------
-- Amending: a cancelled quote or invoice is copied into a new draft that
-- points back to it (amended_from). The cancelled original stays as it was.
-- ---------------------------------------------------------------------------

create function public.amend_document(p_doctype text, p_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_status  smallint;
  v_new     uuid;
begin
  if p_doctype = 'quote' then
    select company_id, docstatus into v_company, v_status from public.quotes where id = p_id;
    if v_company is null or not app.can(v_company, 'sales.quote.create') then
      raise exception 'not allowed' using errcode = 'insufficient_privilege';
    end if;
    if v_status <> 2 then
      raise exception 'only cancelled documents can be amended' using errcode = 'check_violation';
    end if;
    insert into public.quotes (company_id, branch_id, customer_id, currency, quote_date, valid_until, lead_id, notes, amended_from)
    select company_id, branch_id, customer_id, currency, current_date, valid_until, lead_id, notes, id
    from public.quotes where id = p_id
    returning id into v_new;
    insert into public.quote_lines (company_id, quote_id, line_no, product_id, description, quantity, unit_price_cents, discount_cents, tax_code)
    select company_id, v_new, line_no, product_id, description, quantity, unit_price_cents, discount_cents, tax_code
    from public.quote_lines where quote_id = p_id order by line_no;
  elsif p_doctype = 'sales_invoice' then
    select company_id, docstatus into v_company, v_status from public.sales_invoices where id = p_id;
    if v_company is null or not app.can(v_company, 'sales.invoice.create') then
      raise exception 'not allowed' using errcode = 'insufficient_privilege';
    end if;
    if v_status <> 2 then
      raise exception 'only cancelled documents can be amended' using errcode = 'check_violation';
    end if;
    insert into public.sales_invoices (company_id, branch_id, customer_id, currency, invoice_date, due_date, quote_id, notes, amended_from)
    select company_id, branch_id, customer_id, currency, current_date, due_date, quote_id, notes, id
    from public.sales_invoices where id = p_id
    returning id into v_new;
    insert into public.sales_invoice_lines (company_id, invoice_id, line_no, product_id, description, quantity, unit_price_cents, discount_cents, tax_code)
    select company_id, v_new, line_no, product_id, description, quantity, unit_price_cents, discount_cents, tax_code
    from public.sales_invoice_lines where invoice_id = p_id order by line_no;
  else
    raise exception '% cannot be amended here', p_doctype using errcode = 'invalid_parameter_value';
  end if;
  perform app.log_system_message(v_company, p_doctype, v_new, 'Amended from a cancelled document');
  return v_new;
end;
$$;

revoke execute on function public.amend_document(text, uuid) from public, anon;
grant execute on function public.amend_document(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Payments in another currency: an amount in whole cents of the payment
-- currency can rarely convert exactly to an invoice's balance (one US cent is
-- about 27 ZiG cents). When a payment settles an invoice and overshoots its
-- balance by less than one cent of the payment currency, the invoice is
-- treated as settled; the difference goes to exchange gains and losses.
-- Otherwise unchanged from 20261011140000_sales.sql.
-- ---------------------------------------------------------------------------

create or replace function app.after_payment_change()
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
  v_one_unit   bigint;
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
        -- value of one minor unit of the payment currency, in the invoice currency
        v_one_unit := greatest(1, ceil(app.rate_at(new.company_id, v_alloc.currency) / new.exchange_rate)::bigint);
        if new.currency <> v_alloc.currency and v_applied - v_balance <= v_one_unit then
          v_applied := v_balance;
        else
          raise exception 'payment exceeds the balance of invoice %', v_alloc.number using errcode = 'check_violation';
        end if;
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

-- ---------------------------------------------------------------------------
-- Customer statement (credit book): invoices, the payments applied to them,
-- and money paid in advance, for one currency, with a running balance.
-- Runs as the caller, so row-level security applies.
-- ---------------------------------------------------------------------------

create function public.customer_statement(p_company uuid, p_customer uuid, p_currency char(3), p_from date, p_to date)
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
    select p.received_on, 'payment', p.number, p.id, 0, a.applied_cents, p.submitted_at
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
      and p.amount_cents > coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.payment_id = p.id), 0)
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

grant execute on function public.customer_statement(uuid, uuid, char, date, date) to authenticated;
