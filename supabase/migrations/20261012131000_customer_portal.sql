-- Customer portal (P19, master plan §3.2, §5.3, §12.4): a company's customers
-- sign in on the company's website and see only their own quotes, invoices,
-- payments and statement, and can accept a quote.
--
-- Portal users are a separate identity from staff: a row in portal_users links
-- a sign-in (auth.users) to one customer of one company. They have no
-- membership, so row-level security gives them nothing; everything they see
-- comes through the SECURITY DEFINER functions below, which first find the
-- customer linked to the signed-in user in that company.

create table public.portal_users (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  customer_id   uuid not null,
  user_id       uuid not null references auth.users(id),
  status        text not null default 'invited' check (status in ('invited','active','disabled')),
  invited_by    uuid default auth.uid(),
  invited_at    timestamptz not null default now(),
  activated_at  timestamptz,
  last_seen_at  timestamptz,
  updated_at    timestamptz not null default now(),
  unique (company_id, user_id),
  unique (company_id, id),
  foreign key (company_id, customer_id) references public.customers(company_id, id)
);

create index on public.portal_users (company_id, customer_id);

-- A customer accepting a submitted quote. The quote itself stays locked.
create table public.portal_quote_acceptances (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  quote_id        uuid not null,
  portal_user_id  uuid not null,
  note            text check (length(note) <= 1000),
  accepted_at     timestamptz not null default now(),
  unique (quote_id),
  foreign key (company_id, quote_id) references public.quotes(company_id, id),
  foreign key (company_id, portal_user_id) references public.portal_users(company_id, id)
);

create trigger portal_users_touch before update on public.portal_users
  for each row execute function app.touch_updated_at();
create trigger portal_users_audit after insert or update on public.portal_users
  for each row execute function app.audit_row();
create trigger portal_quote_acceptances_audit after insert on public.portal_quote_acceptances
  for each row execute function app.audit_row();
create trigger portal_quote_acceptances_append_only before update or delete on public.portal_quote_acceptances
  for each row execute function app.forbid_change();

insert into public.event_types (code, description) values
  ('quote.accepted', 'A customer accepted a quote in the customer portal');
insert into public.event_subscribers (subscriber, event_type) values
  ('notifications', 'quote.accepted'),
  ('webhooks',      'quote.accepted'),
  ('crm',           'quote.accepted');

-- ---------------------------------------------------------------------------
-- Row-level security (staff side)
-- ---------------------------------------------------------------------------

alter table public.portal_users             enable row level security;
alter table public.portal_quote_acceptances enable row level security;

create policy staff_read on public.portal_users for select to authenticated
  using (app.can(company_id, 'portal.manage') or app.can(company_id, 'core.customers.view'));
create policy manager on public.portal_users for insert to authenticated
  with check (app.can(company_id, 'portal.manage') and status = 'invited');
create policy manager_edit on public.portal_users for update to authenticated
  using (app.can(company_id, 'portal.manage')) with check (app.can(company_id, 'portal.manage'));

create policy viewer_read on public.portal_quote_acceptances for select to authenticated
  using (app.can(company_id, 'sales.view'));

revoke all on public.portal_users, public.portal_quote_acceptances from anon, authenticated;
grant select on public.portal_users, public.portal_quote_acceptances to authenticated;
grant insert (company_id, customer_id, user_id, status), update (status) on public.portal_users to authenticated;

-- ---------------------------------------------------------------------------
-- Portal access (signed-in customers)
-- ---------------------------------------------------------------------------

-- The signed-in user's active portal link in the company with this public
-- slug: company, customer and portal user. No row when there is none, the
-- link is disabled, the portal module is off or the company is suspended.
create function app.portal_link(p_slug text)
returns table (company_id uuid, customer_id uuid, portal_user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select c.id, pu.customer_id, pu.id
  from public.companies c
  join public.portal_users pu on pu.company_id = c.id
  join public.customers cu on cu.id = pu.customer_id and cu.company_id = c.id
  where c.slug = lower(trim(p_slug))
    and c.archived_at is null and c.status <> 'suspended'
    and pu.user_id = auth.uid() and pu.status = 'active'
    and cu.archived_at is null
    and app.module_on(c.id, 'portal');
$$;
revoke execute on function app.portal_link(text) from public;

-- Called after signing in on a company's website: an invited link becomes
-- active. Returns the customer's name, or null when this user has no access.
create function public.portal_sign_in(p_slug text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  if auth.uid() is null then
    return null;
  end if;
  update public.portal_users pu
  set status = 'active', activated_at = coalesce(pu.activated_at, now()), last_seen_at = now()
  from public.companies c
  where c.id = pu.company_id and c.slug = lower(trim(p_slug))
    and pu.user_id = auth.uid() and pu.status in ('invited','active');

  select cu.name into v_name
  from app.portal_link(p_slug) l join public.customers cu on cu.id = l.customer_id;
  return case when v_name is null then null else jsonb_build_object('customer_name', v_name) end;
end;
$$;

-- Who is signed in to the portal: company and customer names, or null.
create function public.portal_me(p_slug text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('company_name', c.name, 'customer_name', cu.name, 'customer_email', cu.email,
                            'base_currency', c.base_currency, 'can_accept', c.status in ('active','grace'))
  from app.portal_link(p_slug) l
  join public.companies c on c.id = l.company_id
  join public.customers cu on cu.id = l.customer_id;
$$;

-- The customer's submitted invoices with what is paid and still owed.
create function public.portal_invoices(p_slug text)
returns table (id uuid, number text, invoice_date date, due_date date, currency char(3),
               total_cents bigint, paid_cents bigint, balance_cents bigint)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.number, i.invoice_date, i.due_date, i.currency, i.total_cents,
         app.invoice_paid_cents(i.id), i.total_cents - app.invoice_paid_cents(i.id)
  from app.portal_link(p_slug) l
  join public.sales_invoices i on i.company_id = l.company_id and i.customer_id = l.customer_id
  where i.docstatus = 1
  order by i.invoice_date desc, i.number desc;
$$;

-- The customer's submitted quotes, with when they were accepted.
create function public.portal_quotes(p_slug text)
returns table (id uuid, number text, quote_date date, valid_until date, currency char(3),
               total_cents bigint, accepted_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select q.id, q.number, q.quote_date, q.valid_until, q.currency, q.total_cents, a.accepted_at
  from app.portal_link(p_slug) l
  join public.quotes q on q.company_id = l.company_id and q.customer_id = l.customer_id
  left join public.portal_quote_acceptances a on a.quote_id = q.id
  where q.docstatus = 1
  order by q.quote_date desc, q.number desc;
$$;

-- The customer's submitted payments.
create function public.portal_payments(p_slug text)
returns table (id uuid, number text, received_on date, currency char(3), amount_cents bigint,
               method text, reference text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.number, p.received_on, p.currency, p.amount_cents, p.method, p.reference
  from app.portal_link(p_slug) l
  join public.payments p on p.company_id = l.company_id and p.customer_id = l.customer_id
  where p.docstatus = 1
  order by p.received_on desc, p.number desc;
$$;

-- One submitted quote or invoice of the customer, with its lines; null otherwise.
create function public.portal_document(p_slug text, p_kind text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_link record;
  v_doc  jsonb;
begin
  select * into v_link from app.portal_link(p_slug);
  if v_link.company_id is null then
    return null;
  end if;
  if p_kind = 'quote' then
    select jsonb_build_object('kind', 'quote', 'id', q.id, 'number', q.number, 'date', q.quote_date,
             'valid_until', q.valid_until, 'currency', q.currency, 'subtotal_cents', q.subtotal_cents,
             'tax_cents', q.tax_cents, 'total_cents', q.total_cents, 'notes', q.notes,
             'expired', q.valid_until is not null and q.valid_until < current_date,
             'accepted_at', (select a.accepted_at from public.portal_quote_acceptances a where a.quote_id = q.id),
             'lines', coalesce((select jsonb_agg(jsonb_build_object('description', ql.description, 'quantity', ql.quantity,
                                   'unit_price_cents', ql.unit_price_cents, 'discount_cents', ql.discount_cents,
                                   'total_cents', ql.total_cents) order by ql.line_no, ql.id)
                                from public.quote_lines ql where ql.quote_id = q.id), '[]'::jsonb))
    into v_doc
    from public.quotes q
    where q.id = p_id and q.company_id = v_link.company_id and q.customer_id = v_link.customer_id and q.docstatus = 1;
  elsif p_kind = 'invoice' then
    select jsonb_build_object('kind', 'invoice', 'id', i.id, 'number', i.number, 'date', i.invoice_date,
             'due_date', i.due_date, 'currency', i.currency, 'subtotal_cents', i.subtotal_cents,
             'tax_cents', i.tax_cents, 'total_cents', i.total_cents, 'notes', i.notes,
             'paid_cents', app.invoice_paid_cents(i.id),
             'balance_cents', i.total_cents - app.invoice_paid_cents(i.id),
             'lines', coalesce((select jsonb_agg(jsonb_build_object('description', il.description, 'quantity', il.quantity,
                                   'unit_price_cents', il.unit_price_cents, 'discount_cents', il.discount_cents,
                                   'total_cents', il.total_cents) order by il.line_no, il.id)
                                from public.sales_invoice_lines il where il.invoice_id = i.id), '[]'::jsonb))
    into v_doc
    from public.sales_invoices i
    where i.id = p_id and i.company_id = v_link.company_id and i.customer_id = v_link.customer_id and i.docstatus = 1;
  end if;
  return v_doc;
end;
$$;

-- Statement: submitted invoices (owed) and payments (paid) per currency, oldest
-- first, with a running balance in each currency.
create function public.portal_statement(p_slug text)
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
    where p.docstatus = 1
  )
  select e.entry_date, e.kind, e.number, e.currency, e.debit_cents, e.credit_cents,
         (sum(e.debit_cents - e.credit_cents) over (partition by e.currency order by e.entry_date, e.at, e.number
                                                    rows between unbounded preceding and current row))::bigint
  from entries e
  order by e.currency, e.entry_date, e.at, e.number;
$$;

-- The customer accepts a submitted quote: recorded beside the (locked) quote,
-- written in the quote's timeline and announced as quote.accepted.
create function public.portal_accept_quote(p_slug text, p_quote uuid, p_note text default null)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_link     record;
  v_quote    public.quotes;
  v_customer text;
  v_at       timestamptz := now();
  v_note     text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v_link from app.portal_link(p_slug);
  if v_link.company_id is null then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if (select status from public.companies where id = v_link.company_id) not in ('active','grace') then
    raise exception 'quotes cannot be accepted online at the moment; please contact us' using errcode = 'check_violation';
  end if;
  select * into v_quote from public.quotes
  where id = p_quote and company_id = v_link.company_id and customer_id = v_link.customer_id;
  if v_quote.id is null or v_quote.docstatus <> 1 then
    raise exception 'that quote cannot be accepted' using errcode = 'check_violation';
  end if;
  if v_quote.valid_until is not null and v_quote.valid_until < current_date then
    raise exception 'this quote has expired; please ask us for a new one' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.portal_quote_acceptances where quote_id = p_quote) then
    raise exception 'this quote has already been accepted' using errcode = 'check_violation';
  end if;
  if length(coalesce(v_note, '')) > 1000 then
    raise exception 'please keep your note under 1,000 characters' using errcode = 'check_violation';
  end if;

  insert into public.portal_quote_acceptances (company_id, quote_id, portal_user_id, note, accepted_at)
  values (v_link.company_id, p_quote, v_link.portal_user_id, v_note, v_at);

  select name into v_customer from public.customers where id = v_link.customer_id;
  perform app.log_system_message(v_link.company_id, 'quote', p_quote,
    'Accepted by ' || v_customer || ' in the customer portal' || coalesce(': ' || v_note, '.'));
  perform app.emit_event(v_link.company_id, 'quote.accepted', 'quote', p_quote::text,
    jsonb_build_object('number', v_quote.number, 'customer_id', v_link.customer_id,
                       'currency', v_quote.currency, 'total_cents', v_quote.total_cents, 'note', v_note));
  return v_at;
end;
$$;

revoke execute on function public.portal_sign_in(text), public.portal_me(text), public.portal_invoices(text),
                           public.portal_quotes(text), public.portal_payments(text),
                           public.portal_document(text, text, uuid), public.portal_statement(text),
                           public.portal_accept_quote(text, uuid, text) from public, anon;
grant execute on function public.portal_sign_in(text), public.portal_me(text), public.portal_invoices(text),
                          public.portal_quotes(text), public.portal_payments(text),
                          public.portal_document(text, text, uuid), public.portal_statement(text),
                          public.portal_accept_quote(text, uuid, text) to authenticated;
