-- Change in another currency at the till (P5): a customer pays with a US
-- dollar note and takes change in ZiG, say. The extra note stays in the till
-- and the change goes out in the other currency at the company rate; both are
-- recorded so the cash-up expects the right amount of each currency.

create table public.till_change (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  till_session_id  uuid not null,
  invoice_id       uuid not null,
  kept_currency    char(3) not null check (kept_currency in ('USD','ZWG','ZAR')),
  kept_cents       bigint not null check (kept_cents > 0),
  change_currency  char(3) not null check (change_currency in ('USD','ZWG','ZAR')),
  change_cents     bigint not null check (change_cents >= 0),
  created_at       timestamptz not null default now(),
  foreign key (company_id, till_session_id) references public.till_sessions(company_id, id),
  foreign key (company_id, invoice_id) references public.sales_invoices(company_id, id)
);
create index on public.till_change (till_session_id);

alter table public.till_change enable row level security;
create policy viewer_read on public.till_change for select to authenticated using (app.can(company_id, 'pos.view'));
revoke all on public.till_change from anon, authenticated;
grant select on public.till_change to authenticated;

create trigger till_change_append_only before update or delete on public.till_change
  for each row execute function app.forbid_change();

create or replace function app.till_expected_cash(p_session uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with currencies as (
    select key as currency from public.till_sessions s, jsonb_object_keys(s.opening_float) key where s.id = p_session
    union
    select currency from public.payments where till_session_id = p_session and method = 'cash' and docstatus = 1
    union
    select kept_currency from public.till_change where till_session_id = p_session
    union
    select change_currency from public.till_change where till_session_id = p_session
  )
  select coalesce(jsonb_object_agg(c.currency,
           coalesce((select (s.opening_float->>c.currency)::bigint from public.till_sessions s where s.id = p_session), 0)
           + coalesce((select sum(p.amount_cents) from public.payments p
                       where p.till_session_id = p_session and p.method = 'cash' and p.docstatus = 1 and p.currency = c.currency), 0)
           + coalesce((select sum(t.kept_cents) from public.till_change t where t.till_session_id = p_session and t.kept_currency = c.currency), 0)
           - coalesce((select sum(t.change_cents) from public.till_change t where t.till_session_id = p_session and t.change_currency = c.currency), 0)),
         '{}'::jsonb)
  from currencies c;
$$;

drop function public.pos_checkout(uuid, uuid, uuid, char, jsonb, jsonb, boolean, boolean);

create function public.pos_checkout(
  p_session            uuid,
  p_client_ref         uuid,
  p_customer           uuid,
  p_currency           char(3),
  p_lines              jsonb,
  p_tenders            jsonb,
  p_change_as_credit   boolean default false,
  p_on_account         boolean default false,
  p_change_currency    char(3) default null
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
  v_change_cents bigint;
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

  if p_change_currency is not null and p_change_currency not in ('USD','ZWG','ZAR') then
    raise exception 'unknown change currency' using errcode = 'check_violation';
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
      if v_left > 0 and p_change_currency is not null and p_change_currency <> v_cur then
        -- The note stays in the till; change goes out in another currency at
        -- the company rate. Recorded as an exchange in the till, posted to the
        -- books, so the sale's payment holds only what was due.
        v_change_cents := app.convert_cents(v_left, v_rt, app.rate_at(v_company, p_change_currency));
        insert into public.till_change (company_id, till_session_id, invoice_id, kept_currency, kept_cents,
                                        change_currency, change_cents)
        values (v_company, p_session, v_invoice.id, v_cur, v_left, p_change_currency, v_change_cents);
        perform app.post_entry(v_company, current_date, 'Change in ' || p_change_currency || ' for ' || v_invoice.number,
          'till_session', p_session, jsonb_build_array(
            jsonb_build_object('account', 'cash_' || lower(v_cur), 'debit', app.to_base(v_left, v_rt),
                               'currency', v_cur, 'amount', v_left, 'rate', v_rt),
            jsonb_build_object('account', 'cash_' || lower(p_change_currency),
                               'credit', app.to_base(v_change_cents, app.rate_at(v_company, p_change_currency)),
                               'currency', p_change_currency, 'amount', -v_change_cents,
                               'rate', app.rate_at(v_company, p_change_currency)),
            jsonb_build_object('account', 'fx_gain_loss',
                               'debit', app.to_base(v_change_cents, app.rate_at(v_company, p_change_currency)) - app.to_base(v_left, v_rt))));
        v_change := v_change || jsonb_build_object('currency', p_change_currency, 'cents', v_change_cents);
      elsif v_left > 0 then
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
revoke execute on function public.pos_checkout(uuid, uuid, uuid, char, jsonb, jsonb, boolean, boolean, char) from public, anon;
grant execute on function public.pos_checkout(uuid, uuid, uuid, char, jsonb, jsonb, boolean, boolean, char) to authenticated;
