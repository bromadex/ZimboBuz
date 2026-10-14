-- Paying an invoice from the customer portal (P19) through the company's own
-- Paynow account. The portal starts a payment for the invoice's balance; when
-- Paynow confirms it, the payment is recorded against the invoice, once.

create table public.invoice_payment_links (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  invoice_id         uuid not null,
  customer_id        uuid not null,
  currency           char(3) not null check (currency in ('USD','ZWG','ZAR')),
  amount_cents       bigint not null check (amount_cents > 0),
  reference          text not null,
  status             text not null default 'pending' check (status in ('pending','paid','failed','cancelled','needs_attention')),
  poll_url           text,
  gateway_reference  text,
  payment_id         uuid,
  problem            text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  paid_at            timestamptz,
  unique (company_id, reference),
  foreign key (company_id, invoice_id) references public.sales_invoices(company_id, id),
  foreign key (company_id, customer_id) references public.customers(company_id, id)
);
create index on public.invoice_payment_links (company_id, invoice_id);

create trigger invoice_payment_links_touch before update on public.invoice_payment_links
  for each row execute function app.touch_updated_at();

-- Starts a payment for what is still owed on one of the signed-in customer's
-- invoices. Returns {"link_id", "reference", "currency", "amount_cents", "company_id"}.
create function public.portal_start_invoice_payment(p_slug text, p_invoice uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_link    record;
  v_inv     public.sales_invoices;
  v_balance bigint;
  v_id      uuid;
  v_ref     text := 'INV-PAY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
begin
  select * into v_link from app.portal_link(p_slug);
  if v_link.company_id is null then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_inv from public.sales_invoices
  where id = p_invoice and company_id = v_link.company_id and customer_id = v_link.customer_id and docstatus = 1;
  if v_inv.id is null then
    raise exception 'that invoice is not yours' using errcode = 'insufficient_privilege';
  end if;
  v_balance := v_inv.total_cents - app.invoice_paid_cents(v_inv.id);
  if v_balance <= 0 then
    raise exception 'this invoice is already paid' using errcode = 'check_violation';
  end if;
  insert into public.invoice_payment_links (company_id, invoice_id, customer_id, currency, amount_cents, reference)
  values (v_link.company_id, v_inv.id, v_inv.customer_id, v_inv.currency, v_balance, v_ref)
  returning id into v_id;
  return jsonb_build_object('link_id', v_id, 'reference', v_ref, 'currency', v_inv.currency,
                            'amount_cents', v_balance, 'company_id', v_link.company_id);
end;
$$;
revoke execute on function public.portal_start_invoice_payment(text, uuid) from public, anon;
grant execute on function public.portal_start_invoice_payment(text, uuid) to authenticated;

-- Records a confirmed payment exactly once (server, after Paynow confirms).
-- If the invoice was settled some other way meanwhile, the money is kept as
-- the customer's credit and the link flagged for staff.
create function app.complete_invoice_payment(p_link uuid, p_gateway_reference text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_l       public.invoice_payment_links;
  v_branch  uuid;
  v_balance bigint;
  v_payment uuid;
  v_alloc   bigint;
begin
  select * into v_l from public.invoice_payment_links where id = p_link for update;
  if v_l.id is null then
    raise exception 'unknown payment' using errcode = 'no_data_found';
  end if;
  if v_l.status <> 'pending' then
    return v_l.status;
  end if;
  select branch_id, total_cents - app.invoice_paid_cents(id) into v_branch, v_balance
  from public.sales_invoices where id = v_l.invoice_id;
  v_alloc := least(v_l.amount_cents, greatest(v_balance, 0));

  insert into public.payments (company_id, branch_id, customer_id, currency, amount_cents, method, reference,
                               gateway, gateway_reference, notes)
  values (v_l.company_id, v_branch, v_l.customer_id, v_l.currency, v_l.amount_cents, 'card', v_l.reference,
          'paynow', p_gateway_reference, 'Paid online from the customer portal')
  returning id into v_payment;
  if v_alloc > 0 then
    insert into public.payment_allocations (company_id, payment_id, invoice_id, amount_cents)
    values (v_l.company_id, v_payment, v_l.invoice_id, v_alloc);
  end if;
  update public.payments set docstatus = 1 where id = v_payment;

  update public.invoice_payment_links
  set status = case when v_alloc = v_l.amount_cents then 'paid' else 'needs_attention' end,
      problem = case when v_alloc = v_l.amount_cents then null else 'invoice was already partly settled; the rest is kept as credit' end,
      gateway_reference = p_gateway_reference, payment_id = v_payment, paid_at = now()
  where id = p_link;
  return case when v_alloc = v_l.amount_cents then 'paid' else 'needs_attention' end;
end;
$$;
revoke execute on function app.complete_invoice_payment(uuid, text) from public;
grant execute on function app.complete_invoice_payment(uuid, text) to service_role;

alter table public.invoice_payment_links enable row level security;
create policy viewer_read on public.invoice_payment_links for select to authenticated using (app.can(company_id, 'sales.view'));
revoke all on public.invoice_payment_links from anon, authenticated;
grant select on public.invoice_payment_links to authenticated;
