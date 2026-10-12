-- Database support shared by the Release 1 screens (epic #9).

-- ---------------------------------------------------------------------------
-- Company details: only some columns are editable by the company itself.
-- Plan and status belong to ZimERP billing (P11); the slug to routing; the base
-- currency is fixed once the books exist. Before this, a company admin could
-- have changed their own plan or lifted a suspension.
-- ---------------------------------------------------------------------------

revoke update on public.companies from authenticated;
grant update (name, vat_registered, vat_number, prices_include_tax) on public.companies to authenticated;

-- VAT settings need their own permission, not just "edit company details".
-- Runs as the caller (like draft_lines_only) so it can tell users from the
-- system's own functions.
create function app.guard_company_update()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and (new.vat_registered, new.vat_number, new.prices_include_tax)
         is distinct from (old.vat_registered, old.vat_number, old.prices_include_tax)
     and not app.can(new.id, 'core.settings.tax') then
    raise exception 'you do not have permission to change VAT settings' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger companies_guard before update on public.companies
  for each row execute function app.guard_company_update();

-- ---------------------------------------------------------------------------
-- Removing a line from a draft document. Lines of drafts are working copies,
-- not records, so they may be removed; submitted documents stay locked
-- (draft_lines_only). There is still no DELETE grant: this is the only way.
-- ---------------------------------------------------------------------------

create function public.remove_draft_line(p_table text, p_line uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_spec    record;
  v_company uuid;
  v_parent  uuid;
  v_status  smallint;
begin
  select * into v_spec from (values
      ('quote_lines',         'quotes',         'quote_id',      'sales.quote.create'),
      ('sales_invoice_lines', 'sales_invoices', 'invoice_id',    'sales.invoice.create'),
      ('payment_allocations', 'payments',       'payment_id',    'sales.payment.record'),
      ('stock_take_lines',    'stock_takes',    'stock_take_id', 'inventory.stocktake')
    ) as s(line_table, parent_table, parent_col, permission)
  where s.line_table = p_table;
  if v_spec is null then
    raise exception 'lines of % cannot be removed', p_table using errcode = 'invalid_parameter_value';
  end if;

  execute format('select l.company_id, l.%I from public.%I l where l.id = $1', v_spec.parent_col, v_spec.line_table)
    into v_company, v_parent using p_line;
  if v_company is null or not app.can(v_company, v_spec.permission) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  execute format('select docstatus from public.%I where id = $1', v_spec.parent_table) into v_status using v_parent;
  if v_status is distinct from 0 then
    raise exception 'lines can only be changed while the document is a draft' using errcode = 'check_violation';
  end if;
  execute format('delete from public.%I where id = $1', v_spec.line_table) using p_line;
end;
$$;

revoke execute on function public.remove_draft_line(text, uuid) from public, anon;
grant execute on function public.remove_draft_line(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Connections registry fix: payments link to invoices through allocations,
-- not a column on payments, so that link cannot be counted generically.
-- (Invoice screens list their payments directly.)
-- ---------------------------------------------------------------------------

delete from public.doctype_links
where from_doctype = 'sales_invoice' and to_doctype = 'payment' and link_column = 'invoice_id';
