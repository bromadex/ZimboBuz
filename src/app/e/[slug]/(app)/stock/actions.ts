"use server";

import { amount, changed, optional, quantity, text, UserError, uuid } from "@/server/act";
import type { Query } from "@/server/data";
import { actStock } from "@/server/inventory/data";

// Stock actions (P7): movements, locations and stock takes. Each runs as the
// signed-in user, so row-level security and app.can() decide; checks here only
// give clearer messages.

const NEW_TYPES = ["receipt", "issue", "adjustment_in", "adjustment_out", "transfer"] as const;

async function location(q: Query, companyId: string, id: string): Promise<{ id: string; branch_id: string }> {
  const { rows } = await q<{ id: string; branch_id: string }>(
    "select id, branch_id from public.stock_locations where company_id = $1 and id = $2 and archived_at is null",
    [companyId, id],
  );
  if (!rows[0]) throw new UserError("Please choose a location.");
  return rows[0];
}

// --- Movements --------------------------------------------------------------

export async function createMovement(slug: string, formData: FormData): Promise<never> {
  const type = text(formData, "movement_type") as (typeof NEW_TYPES)[number];
  const product = text(formData, "product_id");
  const back = `/stock/movements/new?type=${encodeURIComponent(type)}${/^[0-9a-f-]{36}$/i.test(product) ? `&product=${product}` : ""}`;
  return actStock(
    slug,
    back,
    "Stock updated.",
    async (q, { company: { id: companyId } }) => {
      if (!NEW_TYPES.includes(type)) throw new UserError("Please choose what kind of movement this is.");
      const productId = uuid(formData, "product_id", "a product");
      const qty = quantity(formData, "quantity");
      const inbound = type === "receipt" || type === "adjustment_in" || type === "transfer";
      const outbound = type !== "receipt" && type !== "adjustment_in";
      const from = outbound ? await location(q, companyId, uuid(formData, "from_location_id", "where the stock comes from")) : null;
      const to = inbound ? await location(q, companyId, uuid(formData, "to_location_id", "where the stock goes")) : null;
      if (from && to && from.id === to.id) throw new UserError("Choose two different locations to transfer between.");
      let unitCost: number | null = null;
      if (type === "receipt") unitCost = amount(formData, "unit_cost", "the cost of one unit");
      if (type === "adjustment_in" && text(formData, "unit_cost")) unitCost = amount(formData, "unit_cost", "the cost of one unit");

      const { rows } = await q<{ id: string }>(
        `insert into public.stock_movements (company_id, branch_id, movement_type, product_id, from_location_id, to_location_id, quantity, unit_cost, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [companyId, (from ?? to)!.branch_id, type, productId, from?.id ?? null, to?.id ?? null, qty, unitCost, optional(formData, "notes")],
      );
      // Created and submitted together, so stock changes straight away.
      await q("update public.stock_movements set docstatus = 1 where id = $1", [rows[0].id]);
      return rows[0].id;
    },
    { then: (id) => `/stock/movements/${id}` },
  );
}

export async function submitMovement(slug: string, id: string): Promise<never> {
  return actStock(slug, `/stock/movements/${id}`, "Movement submitted. Stock is updated.", (q, { company: { id: companyId } }) =>
    changed(q("update public.stock_movements set docstatus = 1 where company_id = $1 and id = $2 and docstatus = 0", [companyId, id])),
  );
}

export async function cancelMovement(slug: string, id: string, formData: FormData): Promise<never> {
  return actStock(slug, `/stock/movements/${id}`, "Movement cancelled. Stock is back as it was.", async (q, { company: { id: companyId } }) => {
    const reason = text(formData, "reason");
    if (!reason) throw new UserError("Please give a reason for cancelling.");
    const { rows } = await q<{ source_doctype: string | null }>(
      "select source_doctype from public.stock_movements where company_id = $1 and id = $2",
      [companyId, id],
    );
    if (rows[0]?.source_doctype) throw new UserError("This movement was made by another document. Cancel that document instead.");
    await changed(
      q("update public.stock_movements set docstatus = 2, cancel_reason = $3 where company_id = $1 and id = $2 and docstatus = 1", [
        companyId,
        id,
        reason.slice(0, 500),
      ]),
    );
  });
}

// --- Locations --------------------------------------------------------------

export async function addLocation(slug: string, formData: FormData): Promise<never> {
  return actStock(slug, "/stock/locations", "Location added.", async (q, { company: { id: companyId } }) => {
    const code = text(formData, "code").toUpperCase().replace(/\s+/g, "-");
    const name = text(formData, "name");
    if (!name) throw new UserError("Please give the location a name.");
    if (!/^[A-Z0-9-]{2,12}$/.test(code)) throw new UserError("Codes are 2 to 12 letters, numbers or hyphens, like YARD or SHOP-2.");
    await q("insert into public.stock_locations (company_id, branch_id, code, name) values ($1, $2, $3, $4)", [
      companyId,
      uuid(formData, "branch_id", "a branch"),
      code,
      name,
    ]);
  });
}

export async function renameLocation(slug: string, id: string, formData: FormData): Promise<never> {
  return actStock(slug, "/stock/locations", "Location saved.", async (q, { company: { id: companyId } }) => {
    const name = text(formData, "name");
    if (!name) throw new UserError("Please give the location a name.");
    await changed(q("update public.stock_locations set name = $3 where company_id = $1 and id = $2", [companyId, id, name]));
  });
}

export async function makeMainLocation(slug: string, id: string): Promise<never> {
  return actStock(slug, "/stock/locations", "Main location changed. New sales take stock from it.", async (q, { company: { id: companyId } }) => {
    const loc = await location(q, companyId, id);
    await q("update public.stock_locations set is_default = false where company_id = $1 and branch_id = $2 and is_default", [companyId, loc.branch_id]);
    await changed(q("update public.stock_locations set is_default = true where company_id = $1 and id = $2", [companyId, id]));
  });
}

export async function setLocationArchived(slug: string, id: string, formData: FormData): Promise<never> {
  const archive = text(formData, "archive") === "true";
  return actStock(slug, "/stock/locations", archive ? "Location archived." : "Location restored.", (q, { company: { id: companyId } }) =>
    changed(
      q("update public.stock_locations set archived_at = case when $3 then now() end where company_id = $1 and id = $2 and (archived_at is null) = $3", [
        companyId,
        id,
        archive,
      ]),
    ),
  );
}

// --- Stock takes ------------------------------------------------------------

export async function createStockTake(slug: string, formData: FormData): Promise<never> {
  return actStock(
    slug,
    "/stock/takes",
    "Stock take started. Add what you count.",
    async (q, { company: { id: companyId } }) => {
      const loc = await location(q, companyId, uuid(formData, "location_id", "a location"));
      const { rows } = await q<{ id: string }>(
        "insert into public.stock_takes (company_id, branch_id, location_id, notes) values ($1, $2, $3, $4) returning id",
        [companyId, loc.branch_id, loc.id, optional(formData, "notes")],
      );
      return rows[0].id;
    },
    { then: (id) => `/stock/takes/${id}` },
  );
}

function countedQuantity(formData: FormData): string {
  const raw = text(formData, "counted_qty").replace(/,/g, "");
  if (!/^\d+(\.\d{1,3})?$/.test(raw)) throw new UserError("Please enter the quantity you counted, like 12 or 0.");
  return raw;
}

/** Adds a counted product, or changes the count if it is already on the stock take. */
export async function countProduct(slug: string, id: string, formData: FormData): Promise<never> {
  return actStock(slug, `/stock/takes/${id}`, "Count saved.", async (q, { company: { id: companyId } }) => {
    const productId = uuid(formData, "product_id", "a product");
    const counted = countedQuantity(formData);
    const { rows } = await q<{ is_stock_item: boolean }>("select is_stock_item from public.products where company_id = $1 and id = $2", [companyId, productId]);
    if (!rows[0]) throw new UserError("Please choose a product.");
    if (!rows[0].is_stock_item) throw new UserError("That product is a service, so it has no stock to count.");
    await q(
      `insert into public.stock_take_lines (company_id, stock_take_id, product_id, counted_qty) values ($1, $2, $3, $4)
       on conflict (stock_take_id, product_id) do update set counted_qty = excluded.counted_qty`,
      [companyId, id, productId, counted],
    );
  });
}

export async function addAllTakeProducts(slug: string, id: string): Promise<never> {
  return actStock(
    slug,
    `/stock/takes/${id}`,
    "Products added at the quantities the system expects. Change any that differ from what you count.",
    async (q, { company: { id: companyId } }) => {
      const { rowCount } = await q(
        `insert into public.stock_take_lines (company_id, stock_take_id, product_id, counted_qty)
         select t.company_id, t.id, s.product_id, greatest(s.quantity, 0)
         from public.stock_takes t
         join public.stock_levels s on s.location_id = t.location_id
         join public.products p on p.id = s.product_id and p.archived_at is null and p.is_stock_item
         where t.company_id = $1 and t.id = $2 and t.docstatus = 0
         on conflict (stock_take_id, product_id) do nothing`,
        [companyId, id],
      );
      if (!rowCount) throw new UserError("There are no more products recorded at this location. Add products one at a time instead.");
    },
  );
}

export async function removeTakeLine(slug: string, id: string, formData: FormData): Promise<never> {
  return actStock(slug, `/stock/takes/${id}`, "Line removed.", async (q) => {
    await q("select public.remove_draft_line('stock_take_lines', $1)", [uuid(formData, "line_id", "a line")]);
  });
}

export async function sendTakeForApproval(slug: string, id: string): Promise<never> {
  return actStock(slug, `/stock/takes/${id}`, "Sent for approval. A manager can now check and submit it.", async (q) => {
    await q("select public.send_stock_take_for_approval($1)", [id]);
  });
}

export async function submitStockTake(slug: string, id: string): Promise<never> {
  return actStock(slug, `/stock/takes/${id}`, "Stock take submitted. Differences have been adjusted.", async (q, ctx) => {
    if (!ctx.permissions.has("inventory.stocktake.approve")) {
      throw new UserError("Only someone who approves stock takes can submit this. Send it for approval instead.");
    }
    const lines = await q<{ n: string }>("select count(*) as n from public.stock_take_lines where stock_take_id = $1", [id]);
    if (Number(lines.rows[0].n) === 0) throw new UserError("Add at least one counted product first.");
    await changed(q("update public.stock_takes set docstatus = 1 where company_id = $1 and id = $2 and docstatus = 0 and archived_at is null", [ctx.company.id, id]));
  });
}

export async function setStockTakeArchived(slug: string, id: string, formData: FormData): Promise<never> {
  const archive = text(formData, "archive") === "true";
  return actStock(slug, `/stock/takes/${id}`, archive ? "Draft stock take put away." : "Draft stock take restored.", (q, { company: { id: companyId } }) =>
    changed(
      q(
        `update public.stock_takes set archived_at = case when $3 then now() end
         where company_id = $1 and id = $2 and docstatus = 0 and (archived_at is null) = $3`,
        [companyId, id, archive],
      ),
    ),
  );
}

export async function cancelStockTake(slug: string, id: string, formData: FormData): Promise<never> {
  return actStock(slug, `/stock/takes/${id}`, "Stock take cancelled. Its adjustments have been reversed.", async (q, ctx) => {
    const reason = text(formData, "reason");
    if (!reason) throw new UserError("Please give a reason for cancelling.");
    if (!ctx.permissions.has("inventory.stocktake.approve")) throw new UserError("Only someone who approves stock takes can cancel one.");
    await changed(
      q("update public.stock_takes set docstatus = 2, cancel_reason = $3 where company_id = $1 and id = $2 and docstatus = 1", [
        ctx.company.id,
        id,
        reason.slice(0, 500),
      ]),
    );
  });
}
