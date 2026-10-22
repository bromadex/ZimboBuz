-- ZimERP subscription billing (P11, master plan §7.4 and §17): monthly
-- invoices in USD, plan changes with limit checks, payment through ZimERP's own
-- Paynow account, and the overdue path:
--   due date + 7 days  → grace     (everything works; a banner asks to pay)
--   due date + 14 days → read_only (view and export only; app.can() enforces it)
--   due date + 60 days → suspended
-- Paying every overdue invoice returns the company to active. Companies can
-- never change their own plan or status except through these functions.

create sequence public.subscription_invoice_number_seq;
revoke all on sequence public.subscription_invoice_number_seq from public, anon, authenticated;

create table public.subscription_invoices (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  number             text not null unique,
  kind               text not null default 'monthly' check (kind in ('monthly', 'upgrade')),
  period_start       date not null,
  period_end         date not null check (period_end >= period_start),
  plan_code          text not null references public.plans(code),
  description        text not null,
  amount_cents       integer not null check (amount_cents > 0),
  currency           char(3) not null default 'USD' check (currency = 'USD'),
  status             text not null default 'due' check (status in ('due', 'paid', 'void')),
  due_on             date not null,
  paid_at            timestamptz,
  gateway            text,
  gateway_reference  text,
  poll_url           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null))
);

create index on public.subscription_invoices (company_id, period_start desc);
create unique index subscription_invoices_one_monthly on public.subscription_invoices (company_id, period_start)
  where kind = 'monthly';

create trigger subscription_invoices_touch before update on public.subscription_invoices
  for each row execute function app.touch_updated_at();
create trigger subscription_invoices_audit after insert or update on public.subscription_invoices
  for each row execute function app.audit_row();

-- True when the signed-in user may manage the company's subscription. Unlike
-- app.can() this ignores the billing status, so a company that is read-only or
-- suspended can still see what it owes and pay.
create function app.billing_admin(p_company uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.companies c on c.id = m.company_id
    join public.role_permissions rp on rp.role_id = m.role_id and rp.permission_code = 'admin.billing.manage'
    where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active'
      and m.user_type = 'full' and c.archived_at is null);
$$;
revoke execute on function app.billing_admin(uuid) from public;
grant execute on function app.billing_admin(uuid) to authenticated, service_role;

alter table public.subscription_invoices enable row level security;
create policy billing_read on public.subscription_invoices for select to authenticated using (app.billing_admin(company_id));
revoke all on public.subscription_invoices from anon, authenticated;
grant select on public.subscription_invoices to authenticated;

-- ---------------------------------------------------------------------------
-- Issuing invoices
-- ---------------------------------------------------------------------------

create function app.new_subscription_invoice(p_company uuid, p_kind text, p_start date, p_end date, p_plan text,
                                             p_description text, p_amount integer, p_due date)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.subscription_invoices (company_id, number, kind, period_start, period_end, plan_code,
                                            description, amount_cents, due_on)
  values (p_company,
          'ZIM-' || to_char(p_start, 'YYYY') || '-' || lpad(nextval('public.subscription_invoice_number_seq')::text, 5, '0'),
          p_kind, p_start, p_end, p_plan, p_description, p_amount, p_due)
  on conflict (company_id, period_start) where kind = 'monthly' do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Issues this month's invoice to every paying company that does not have one
-- yet. Safe to run repeatedly. Returns the number of invoices issued.
create function app.issue_subscription_invoices(p_on date default current_date)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_on)::date;
  v_end   date := (date_trunc('month', p_on) + interval '1 month - 1 day')::date;
  v_row   record;
  v_count integer := 0;
begin
  for v_row in
    select c.id, pl.code, pl.name, pl.price_usd_cents
    from public.companies c join public.plans pl on pl.code = c.plan_code
    where c.archived_at is null and pl.price_usd_cents > 0
      and c.created_at::date <= v_end
      and not exists (select 1 from public.subscription_invoices s
                      where s.company_id = c.id and s.kind = 'monthly' and s.period_start = v_start)
  loop
    if app.new_subscription_invoice(v_row.id, 'monthly', v_start, v_end, v_row.code,
         v_row.name || ' plan, ' || to_char(v_start, 'FMMonth YYYY'), v_row.price_usd_cents, v_start + 7) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Status from what is owed
-- ---------------------------------------------------------------------------

create function app.billing_status_for(p_days_overdue integer)
returns text
language sql immutable
as $$
  select case when p_days_overdue >= 60 then 'suspended'
              when p_days_overdue >= 14 then 'read_only'
              when p_days_overdue >= 7  then 'grace'
              else 'active' end;
$$;

-- Moves one company to the status its oldest unpaid invoice calls for.
create function app.refresh_billing_status(p_company uuid, p_on date default current_date)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_due    date;
  v_status text;
begin
  select min(due_on) into v_due from public.subscription_invoices where company_id = p_company and status = 'due';
  v_status := app.billing_status_for(coalesce(p_on - v_due, 0));
  update public.companies set status = v_status where id = p_company and status <> v_status;
  return v_status;
end;
$$;

-- Runs the status check for every company. Returns how many changed.
create function app.update_billing_statuses(p_on date default current_date)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  for v_row in select id, status from public.companies where archived_at is null loop
    if app.refresh_billing_status(v_row.id, p_on) <> v_row.status then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Records a verified payment (called by the server after the gateway confirms
-- it). Idempotent: a second notification for a paid invoice changes nothing.
create function app.mark_subscription_paid(p_invoice uuid, p_gateway text, p_reference text, p_amount_cents bigint)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.subscription_invoices;
begin
  select * into v_inv from public.subscription_invoices where id = p_invoice for update;
  if v_inv.id is null then
    raise exception 'unknown invoice' using errcode = 'no_data_found';
  end if;
  if v_inv.status = 'paid' then
    return false;
  end if;
  if v_inv.status <> 'due' then
    raise exception 'invoice % is void', v_inv.number using errcode = 'check_violation';
  end if;
  if p_amount_cents is null or p_amount_cents < v_inv.amount_cents then
    raise exception 'the amount paid does not match invoice %', v_inv.number using errcode = 'check_violation';
  end if;
  update public.subscription_invoices
  set status = 'paid', paid_at = now(), gateway = p_gateway, gateway_reference = p_reference
  where id = p_invoice;
  perform app.refresh_billing_status(v_inv.company_id);
  return true;
end;
$$;

revoke execute on function app.new_subscription_invoice(uuid, text, date, date, text, text, integer, date),
                           app.issue_subscription_invoices(date), app.refresh_billing_status(uuid, date),
                           app.update_billing_statuses(date), app.mark_subscription_paid(uuid, text, text, bigint)
  from public;
grant execute on function app.issue_subscription_invoices(date), app.refresh_billing_status(uuid, date),
                          app.update_billing_statuses(date), app.mark_subscription_paid(uuid, text, text, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- Changing plan
-- ---------------------------------------------------------------------------

-- Upgrades take effect straight away, with an invoice for the difference for
-- the rest of this month. Downgrades take effect straight away (no refund) but
-- only when the company already fits the smaller plan. Starter is free.
create function public.change_plan(p_company uuid, p_plan text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_old     public.plans;
  v_new     public.plans;
  v_count   integer;
  v_missing text;
  v_start   date := date_trunc('month', current_date)::date;
  v_end     date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_amount  integer;
begin
  if not app.billing_admin(p_company) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select pl.* into v_old from public.companies c join public.plans pl on pl.code = c.plan_code where c.id = p_company;
  select * into v_new from public.plans where code = p_plan;
  if v_new.code is null then
    raise exception 'Please choose a plan.' using errcode = 'invalid_parameter_value';
  end if;
  if v_new.code = v_old.code then
    raise exception 'You are already on the % plan.', v_new.name using errcode = 'check_violation';
  end if;

  if v_new.max_full_users is not null then
    select count(*) into v_count from public.memberships
    where company_id = p_company and user_type = 'full' and status in ('active', 'invited');
    if v_count > v_new.max_full_users then
      raise exception 'The % plan allows % full user%, and you have %. Disable some users or make them light users first.',
        v_new.name, v_new.max_full_users, case when v_new.max_full_users = 1 then '' else 's' end, v_count
        using errcode = 'check_violation';
    end if;
  end if;

  select string_agg(mo.name, ', ' order by mo.sort_order) into v_missing
  from public.company_modules cm join public.modules mo on mo.code = cm.module_code
  where cm.company_id = p_company and cm.enabled and not mo.is_core
    and not exists (select 1 from public.plan_modules pm where pm.plan_code = v_new.code and pm.module_code = mo.code);
  if v_missing is not null then
    raise exception 'The % plan does not include %. Switch it off in Modules and features first.', v_new.name, v_missing
      using errcode = 'check_violation';
  end if;

  if v_new.max_modules is not null then
    select count(*) into v_count
    from public.company_modules cm join public.modules mo on mo.code = cm.module_code
    where cm.company_id = p_company and cm.enabled and mo.counts_toward_limit and not mo.is_core;
    if v_count > v_new.max_modules then
      raise exception 'The % plan allows % module%, and you have % switched on. Switch some off first.',
        v_new.name, v_new.max_modules, case when v_new.max_modules = 1 then '' else 's' end, v_count
        using errcode = 'check_violation';
    end if;
  end if;

  if v_new.max_branches is not null then
    select count(*) into v_count from public.branches where company_id = p_company and archived_at is null;
    if v_count > v_new.max_branches then
      raise exception 'The % plan allows % branch%, and you have %. Archive some branches first.',
        v_new.name, v_new.max_branches, case when v_new.max_branches = 1 then '' else 'es' end, v_count
        using errcode = 'check_violation';
    end if;
  end if;

  update public.companies set plan_code = v_new.code where id = p_company;

  if v_new.price_usd_cents > v_old.price_usd_cents then
    v_amount := round((v_new.price_usd_cents - v_old.price_usd_cents)::numeric
                      * (v_end - current_date + 1) / (v_end - v_start + 1))::integer;
    if v_amount > 0 then
      perform app.new_subscription_invoice(p_company, 'upgrade', current_date, v_end, v_new.code,
        'Upgrade from ' || v_old.name || ' to ' || v_new.name || ' for the rest of ' || to_char(current_date, 'FMMonth YYYY'),
        v_amount, current_date + 7);
    end if;
  end if;
  return v_new.code;
end;
$$;
revoke execute on function public.change_plan(uuid, text) from public, anon;
grant execute on function public.change_plan(uuid, text) to authenticated;
