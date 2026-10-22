-- Two safety fixes:
--   * Suspension by ZimERP support (abuse, fraud, a legal request) is kept
--     apart from billing: the nightly billing run never lifts it. Only ZimERP
--     staff tooling (service role) can set or lift it.
--   * Price changes are recorded in the audit log, like other product changes.

alter table public.companies
  add column support_suspended_at timestamptz,
  add column support_suspension_reason text check (length(support_suspension_reason) <= 500);

create function app.suspend_company_by_support(p_company uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required' using errcode = 'check_violation';
  end if;
  update public.companies
  set support_suspended_at = now(), support_suspension_reason = trim(p_reason), status = 'suspended'
  where id = p_company;
end;
$$;

create function app.lift_support_suspension(p_company uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
begin
  update public.companies set support_suspended_at = null, support_suspension_reason = null where id = p_company;
  return app.refresh_billing_status(p_company);
end;
$$;

revoke execute on function app.suspend_company_by_support(uuid, text), app.lift_support_suspension(uuid) from public;
grant execute on function app.suspend_company_by_support(uuid, text), app.lift_support_suspension(uuid) to service_role;

-- Billing decides the status, unless support has suspended the company.
create or replace function app.refresh_billing_status(p_company uuid, p_on date default current_date)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_due    date;
  v_status text;
begin
  if (select support_suspended_at from public.companies where id = p_company) is not null then
    update public.companies set status = 'suspended' where id = p_company and status <> 'suspended';
    return 'suspended';
  end if;
  select min(due_on) into v_due from public.subscription_invoices where company_id = p_company and status = 'due';
  v_status := app.billing_status_for(coalesce(p_on - v_due, 0));
  update public.companies set status = v_status where id = p_company and status <> v_status;
  return v_status;
end;
$$;

-- product_prices has no id column; the audit row records the product id.
create function app.audit_product_price()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_events (company_id, table_name, record_id, action, actor_id, before, after)
  values (new.company_id, 'product_prices', new.product_id::text, lower(tg_op), auth.uid(),
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end;
$$;

create trigger product_prices_audit after insert or update on public.product_prices
  for each row execute function app.audit_product_price();
