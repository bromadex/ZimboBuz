-- General ledger (issue #25, master plan §4.1 "one ledger", ported from Bravura
-- finance). Every module posts automatically through app.post_entry(); entries
-- are append-only, must balance (checked at commit) and are corrected by
-- reversal entries. Amounts are in the company's base currency, with the
-- original currency, amount and rate kept on each line.

create table public.accounts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  code         text not null check (code ~ '^[0-9]{3,6}$'),
  name         text not null,
  type         text not null check (type in ('asset','liability','equity','income','expense')),
  system_key   text check (system_key ~ '^[a-z_]+$'),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz,
  unique (company_id, code),
  unique (company_id, system_key),
  unique (company_id, id)
);

-- Chart of accounts template copied into every new company.
create table public.account_templates (
  code        text primary key,
  name        text not null,
  type        text not null check (type in ('asset','liability','equity','income','expense')),
  system_key  text unique
);

insert into public.account_templates (code, name, type, system_key) values
  ('1000', 'Cash on hand (USD)',              'asset',     'cash_usd'),
  ('1001', 'Cash on hand (ZiG)',              'asset',     'cash_zwg'),
  ('1002', 'Cash on hand (ZAR)',              'asset',     'cash_zar'),
  ('1010', 'Mobile money (EcoCash, OneMoney, InnBucks)', 'asset', 'mobile_money'),
  ('1020', 'Card and gateway clearing',       'asset',     'card_clearing'),
  ('1030', 'Bank',                            'asset',     'bank'),
  ('1100', 'Accounts receivable',             'asset',     'accounts_receivable'),
  ('1200', 'Inventory',                       'asset',     'inventory'),
  ('1300', 'VAT input',                       'asset',     'vat_input'),
  ('2000', 'Accounts payable',                'liability', 'accounts_payable'),
  ('2100', 'VAT output',                      'liability', 'vat_output'),
  ('2200', 'Customer deposits and credit',    'liability', 'customer_credit'),
  ('2300', 'Stock received not invoiced',     'liability', 'stock_received_clearing'),
  ('3000', 'Owner''s equity',                 'equity',    'equity'),
  ('3100', 'Opening balances',                'equity',    'opening_balances'),
  ('4000', 'Sales',                           'income',    'sales'),
  ('5000', 'Cost of sales',                   'expense',   'cost_of_sales'),
  ('5100', 'Stock adjustments',               'expense',   'stock_adjustments'),
  ('6000', 'Payment gateway fees and IMTT',   'expense',   'gateway_fees'),
  ('7000', 'Exchange gains and losses',       'expense',   'fx_gain_loss');

create function app.seed_company_accounts()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.accounts (company_id, code, name, type, system_key)
  select new.id, t.code, t.name, t.type, t.system_key from public.account_templates t;
  return null;
end;
$$;

create trigger companies_seed_accounts after insert on public.companies
  for each row execute function app.seed_company_accounts();

create table public.journal_entries (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  entry_date         date not null default current_date,
  memo               text not null,
  source_doctype     text references public.doctypes(code),
  source_id          uuid,
  reverses_entry_id  uuid references public.journal_entries(id),
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  unique (company_id, id)
);

create table public.journal_lines (
  id             bigint generated always as identity primary key,
  company_id     uuid not null,
  entry_id       uuid not null,
  account_id     uuid not null,
  debit_cents    bigint not null default 0 check (debit_cents >= 0),
  credit_cents   bigint not null default 0 check (credit_cents >= 0),
  currency       char(3) not null check (currency in ('USD','ZWG','ZAR')),
  amount_cents   bigint not null,          -- original currency, signed (+ debit, - credit)
  exchange_rate  numeric(20,8) not null check (exchange_rate > 0),
  check ((debit_cents > 0) <> (credit_cents > 0)),
  foreign key (company_id, entry_id) references public.journal_entries(company_id, id),
  foreign key (company_id, account_id) references public.accounts(company_id, id)
);

create index on public.journal_entries (company_id, source_doctype, source_id);
create index on public.journal_lines (company_id, account_id);
create index on public.journal_lines (entry_id);

create trigger journal_entries_append_only before update or delete on public.journal_entries
  for each row execute function app.forbid_change();
create trigger journal_lines_append_only before update or delete on public.journal_lines
  for each row execute function app.forbid_change();

-- Every entry must balance and have at least two lines, checked at commit.
create function app.check_entry_balanced()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_debit  bigint;
  v_credit bigint;
  v_lines  integer;
begin
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0), count(*)
  into v_debit, v_credit, v_lines
  from public.journal_lines where entry_id = new.entry_id;
  if v_lines < 2 or v_debit <> v_credit then
    raise exception 'journal entry % does not balance (debits %, credits %, lines %)',
      new.entry_id, v_debit, v_credit, v_lines using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger journal_lines_balanced after insert on public.journal_lines
  deferrable initially deferred
  for each row execute function app.check_entry_balanced();

-- Posts a journal entry. p_lines is a JSON array of
--   {"account": "<system_key>", "debit": cents, "credit": cents,
--    "currency": "USD", "amount": cents, "rate": 1}
-- where debit/credit are base-currency cents; currency/amount/rate describe
-- the original transaction (they default to the base currency). Zero lines
-- are skipped. Returns the entry id, or null when every line is zero.
create function app.post_entry(p_company uuid, p_date date, p_memo text,
                               p_source_doctype text, p_source_id uuid, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry uuid;
  v_base  char(3) := (select base_currency from public.companies where id = p_company);
  v_line  jsonb;
  v_acct  uuid;
  v_dr    bigint;
  v_cr    bigint;
begin
  if not exists (select 1 from jsonb_array_elements(p_lines) l
                 where coalesce((l->>'debit')::bigint, 0) <> 0 or coalesce((l->>'credit')::bigint, 0) <> 0) then
    return null;
  end if;
  insert into public.journal_entries (company_id, entry_date, memo, source_doctype, source_id)
  values (p_company, coalesce(p_date, current_date), p_memo, p_source_doctype, p_source_id)
  returning id into v_entry;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_dr := coalesce((v_line->>'debit')::bigint, 0);
    v_cr := coalesce((v_line->>'credit')::bigint, 0);
    -- normalise negative amounts onto the other side
    if v_dr < 0 then v_cr := v_cr - v_dr; v_dr := 0; end if;
    if v_cr < 0 then v_dr := v_dr - v_cr; v_cr := 0; end if;
    if v_dr = v_cr then continue; end if;
    if v_dr > 0 and v_cr > 0 then
      if v_dr > v_cr then v_dr := v_dr - v_cr; v_cr := 0; else v_cr := v_cr - v_dr; v_dr := 0; end if;
    end if;
    select id into v_acct from public.accounts
    where company_id = p_company and system_key = v_line->>'account';
    if v_acct is null then
      raise exception 'unknown account %', v_line->>'account' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.journal_lines (company_id, entry_id, account_id, debit_cents, credit_cents,
                                      currency, amount_cents, exchange_rate)
    values (p_company, v_entry, v_acct, v_dr, v_cr,
            coalesce(v_line->>'currency', v_base),
            coalesce((v_line->>'amount')::bigint, v_dr - v_cr),
            coalesce((v_line->>'rate')::numeric, 1));
  end loop;
  return v_entry;
end;
$$;

-- Reverses every not-yet-reversed entry of a source document (used on cancel).
create function app.reverse_source_entries(p_company uuid, p_source_doctype text, p_source_id uuid, p_memo text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry record;
  v_new   uuid;
  v_count integer := 0;
begin
  for v_entry in
    select e.* from public.journal_entries e
    where e.company_id = p_company and e.source_doctype = p_source_doctype and e.source_id = p_source_id
      and e.reverses_entry_id is null
      and not exists (select 1 from public.journal_entries r where r.reverses_entry_id = e.id)
    order by e.created_at
  loop
    insert into public.journal_entries (company_id, entry_date, memo, source_doctype, source_id, reverses_entry_id)
    values (p_company, current_date, p_memo, p_source_doctype, p_source_id, v_entry.id)
    returning id into v_new;
    insert into public.journal_lines (company_id, entry_id, account_id, debit_cents, credit_cents,
                                      currency, amount_cents, exchange_rate)
    select company_id, v_new, account_id, credit_cents, debit_cents, currency, -amount_cents, exchange_rate
    from public.journal_lines where entry_id = v_entry.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function app.post_entry(uuid, date, text, text, uuid, jsonb),
                           app.reverse_source_entries(uuid, text, uuid, text) from public;

-- Manual journal entries for accountants; lines are
--   {"account_id": uuid, "debit": cents, "credit": cents}
create function public.post_manual_entry(p_company uuid, p_date date, p_memo text, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry uuid;
  v_line  jsonb;
  v_base  char(3);
begin
  if not app.can(p_company, 'core.accounts.post') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_memo), '') = '' then
    raise exception 'a description is required' using errcode = 'check_violation';
  end if;
  select base_currency into v_base from public.companies where id = p_company;
  insert into public.journal_entries (company_id, entry_date, memo)
  values (p_company, coalesce(p_date, current_date), p_memo) returning id into v_entry;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.journal_lines (company_id, entry_id, account_id, debit_cents, credit_cents,
                                      currency, amount_cents, exchange_rate)
    values (p_company, v_entry, (v_line->>'account_id')::uuid,
            coalesce((v_line->>'debit')::bigint, 0), coalesce((v_line->>'credit')::bigint, 0), v_base,
            coalesce((v_line->>'debit')::bigint, 0) - coalesce((v_line->>'credit')::bigint, 0), 1);
  end loop;
  return v_entry;
end;
$$;
revoke execute on function public.post_manual_entry(uuid, date, text, jsonb) from public, anon;
grant execute on function public.post_manual_entry(uuid, date, text, jsonb) to authenticated;

-- Trial balance per account (base currency), for users who may view accounts.
create view public.trial_balance as
select a.company_id, a.id as account_id, a.code, a.name, a.type,
       coalesce(sum(l.debit_cents), 0)::bigint  as debit_cents,
       coalesce(sum(l.credit_cents), 0)::bigint as credit_cents,
       (coalesce(sum(l.debit_cents), 0) - coalesce(sum(l.credit_cents), 0))::bigint as balance_cents
from public.accounts a
left join public.journal_lines l on l.account_id = a.id
where app.can(a.company_id, 'core.accounts.view')
group by a.company_id, a.id, a.code, a.name, a.type;
revoke all on public.trial_balance from anon, authenticated;
grant select on public.trial_balance to authenticated;

insert into public.doctypes (code, name, module_code, table_name, view_permission, create_permission, prefix, is_submittable)
values ('journal_entry', 'Journal entry', 'core', 'journal_entries', 'core.accounts.view', 'core.accounts.post', null, false);

alter table public.accounts          enable row level security;
alter table public.account_templates enable row level security;
alter table public.journal_entries   enable row level security;
alter table public.journal_lines     enable row level security;

create policy catalogue_read on public.account_templates for select to authenticated using (true);
create policy member_read    on public.accounts          for select to authenticated using (app.is_member(company_id));
create policy viewer_read    on public.journal_entries   for select to authenticated using (app.can(company_id, 'core.accounts.view'));
create policy viewer_read    on public.journal_lines     for select to authenticated using (app.can(company_id, 'core.accounts.view'));

revoke all on public.accounts, public.account_templates, public.journal_entries, public.journal_lines
  from anon, authenticated;
grant select on public.accounts, public.account_templates, public.journal_entries, public.journal_lines
  to authenticated;
