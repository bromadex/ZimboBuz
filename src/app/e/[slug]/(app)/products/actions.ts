"use server";

import { amount, changed, CURRENCIES, optional, text, UserError } from "@/server/act";
import { actStock } from "@/server/inventory/data";
import { saveImage } from "@/server/web/uploads";

// Product record actions (P7): details, prices per currency, archive and restore.

const TAX_CODES = ["standard", "zero_rated", "exempt"];

function optionalQuantity(form: FormData, key: string, label: string): string | null {
  const raw = text(form, key).replace(/,/g, "");
  if (!raw) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(raw)) throw new UserError(`Please enter ${label} as a number, like 10, or leave it empty.`);
  return raw;
}

export async function updateProduct(slug: string, id: string, formData: FormData): Promise<never> {
  return actStock(slug, `/products/${id}`, "Product saved.", async (q, { company: { id: companyId } }) => {
    const name = text(formData, "name");
    const sku = text(formData, "sku");
    if (!name || !sku) throw new UserError("Please enter a name and a product code.");
    const taxCode = text(formData, "tax_code");
    if (!TAX_CODES.includes(taxCode)) throw new UserError("Please choose a VAT type.");
    const isStockItem = formData.get("is_stock_item") === "on";
    if (!isStockItem) {
      const held = await q<{ n: string }>("select coalesce(sum(quantity), 0) as n from public.stock_levels where product_id = $1", [id]);
      if (Number(held.rows[0]?.n ?? 0) !== 0) {
        throw new UserError("This product still has stock. Issue or adjust it to zero before making it a service.");
      }
    }
    await changed(
      q(
        `update public.products set name = $3, sku = $4, barcode = $5, unit = $6, tax_code = $7, is_stock_item = $8,
                reorder_level = $9, show_online = $10, description = $11
         where company_id = $1 and id = $2 and archived_at is null`,
        [
          companyId,
          id,
          name,
          sku,
          optional(formData, "barcode"),
          text(formData, "unit") || "each",
          taxCode,
          isStockItem,
          isStockItem ? optionalQuantity(formData, "reorder_level", "a reorder level") : null,
          formData.get("show_online") === "on",
          optional(formData, "description"),
        ],
      ),
    );
  });
}

export async function saveProductPrices(slug: string, id: string, formData: FormData): Promise<never> {
  return actStock(slug, `/products/${id}`, "Prices saved.", async (q, { company: { id: companyId, baseCurrency } }) => {
    const exists = await q("select 1 from public.products where company_id = $1 and id = $2 and archived_at is null", [companyId, id]);
    if (!exists.rowCount) throw new UserError("You do not have permission to do that, or it no longer exists.");
    for (const cur of CURRENCIES) {
      const key = `price_${cur}`;
      if (!formData.has(key)) continue;
      if (cur !== baseCurrency && !text(formData, key)) {
        await q("select public.remove_product_price($1, $2)", [id, cur]);
        continue;
      }
      const cents = amount(formData, key, cur === baseCurrency ? "the selling price" : `a price in ${cur === "ZWG" ? "ZiG" : cur}`);
      await q(
        `insert into public.product_prices (company_id, product_id, currency, price_cents) values ($1, $2, $3, $4)
         on conflict (product_id, currency) do update set price_cents = excluded.price_cents
         where product_prices.price_cents is distinct from excluded.price_cents`,
        [companyId, id, cur, cents],
      );
    }
  });
}

export async function setProductArchived(slug: string, id: string, formData: FormData): Promise<never> {
  const archive = text(formData, "archive") === "true";
  return actStock(slug, `/products/${id}`, archive ? "Product archived. It no longer shows for sale." : "Product restored.", (q, { company: { id: companyId } }) =>
    changed(
      q(
        `update public.products set archived_at = case when $3 then now() end
         where company_id = $1 and id = $2 and (archived_at is null) = $3`,
        [companyId, id, archive],
      ),
    ),
  );
}

// Product picture (P9): shown in the online store and at the till.
export async function setProductPicture(slug: string, id: string, formData: FormData): Promise<never> {
  const remove = text(formData, "remove") === "yes";
  return actStock(slug, `/products/${id}`, remove ? "Picture removed." : "Picture saved.", async (q, ctx) => {
    const key = remove ? null : await saveImage(q, ctx, formData.get("picture"), "product");
    await changed(q("update public.products set image_key = $3 where company_id = $1 and id = $2", [ctx.company.id, id, key]));
  });
}
