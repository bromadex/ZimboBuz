-- Database support for the inventory screens (P7): removing a per-currency
-- price override, sending a stock take for approval and archiving abandoned
-- drafts, keeping stock locations that still hold stock from being archived,
-- and valuing positive adjustments at the average cost.

-- ---------------------------------------------------------------------------
-- Price overrides. A product's price in another currency is either set
-- explicitly or converted from the base price at the current rate
-- (app.price_cents). Removing an override goes back to the converted price.
-- Prices are settings, not documents, so this is the one way to remove one;
-- there is still no DELETE grant. The base-currency price cannot be removed.
-- ---------------------------------------------------------------------------

create function public.remove_product_price(p_product uuid, p_currency char(3))
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select p.company_id into v_company from public.products p where p.id = p_product;
  if v_company is null or not app.can(v_company, 'core.products.edit') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_currency = (select c.base_currency from public.companies c where c.id = v_company) then
    raise exception 'the price in your base currency cannot be removed' using errcode = 'check_violation';
  end if;
  delete from public.product_prices where product_id = p_product and currency = p_currency;
  if found then
    perform app.log_system_message(v_company, 'product', p_product,
      'Price in ' || case p_currency when 'ZWG' then 'ZiG' else p_currency end
      || ' removed; it is now converted from the base price');
  end if;
end;
$$;

revoke execute on function public.remove_product_price(uuid, char) from public, anon;
grant execute on function public.remove_product_price(uuid, char) to authenticated;

-- ---------------------------------------------------------------------------
-- Stock takes: the person counting sends the count for approval; someone with
-- inventory.stocktake.approve then submits it (the existing RLS already stops
-- counters from submitting or cancelling).
-- ---------------------------------------------------------------------------

alter table public.stock_takes
  add column sent_for_approval_at timestamptz,
  add column sent_for_approval_by uuid,
  add column archived_at timestamptz;   -- abandoned drafts (drafts cannot be cancelled)

-- Only this function records who sent a count for approval.
revoke update on public.stock_takes from authenticated;
grant update (notes, docstatus, cancel_reason, archived_at) on public.stock_takes to authenticated;

create function public.send_stock_take_for_approval(p_take uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_take public.stock_takes;
begin
  select * into v_take from public.stock_takes where id = p_take for update;
  if v_take.id is null or not app.can(v_take.company_id, 'inventory.stocktake') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_take.docstatus <> 0 then
    raise exception 'this stock take has already been submitted' using errcode = 'check_violation';
  end if;
  if v_take.archived_at is not null then
    raise exception 'this stock take has been put away; take it out again first' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.stock_take_lines l where l.stock_take_id = p_take) then
    raise exception 'add at least one counted product first' using errcode = 'check_violation';
  end if;
  update public.stock_takes
  set sent_for_approval_at = now(), sent_for_approval_by = auth.uid()
  where id = p_take;
  perform app.log_system_message(v_take.company_id, 'stock_take', p_take, 'Count finished and sent for approval');
end;
$$;

revoke execute on function public.send_stock_take_for_approval(uuid) from public, anon;
grant execute on function public.send_stock_take_for_approval(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Stock locations: the default location of a branch, and any location still
-- holding stock, cannot be archived (move or count the stock out first).
-- ---------------------------------------------------------------------------

create function app.guard_stock_location()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    if new.is_default then
      raise exception 'the main location of a branch cannot be archived; make another location the main one first'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.stock_levels s where s.location_id = new.id and s.quantity <> 0) then
      raise exception 'this location still holds stock; move it to another location first'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.is_default and new.archived_at is not null then
    raise exception 'an archived location cannot be the main location' using errcode = 'check_violation';
  end if;
  if new.branch_id is distinct from old.branch_id then
    raise exception 'a location cannot move to another branch' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger stock_locations_guard before update on public.stock_locations
  for each row execute function app.guard_stock_location();

create trigger stock_locations_audit after insert or update on public.stock_locations
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Positive adjustments without a cost (found stock, a miscount) are valued at
-- the product's current average cost. People who may not see cost prices
-- (storekeepers) cannot read it to fill it in themselves.
-- ---------------------------------------------------------------------------

create function app.default_adjustment_cost()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.movement_type = 'adjustment_in' and new.unit_cost is null then
    new.unit_cost := coalesce((select p.avg_cost from public.products p
                               where p.id = new.product_id and p.company_id = new.company_id), 0);
  end if;
  return new;
end;
$$;

create trigger stock_movements_default_cost before insert on public.stock_movements
  for each row execute function app.default_adjustment_cost();
