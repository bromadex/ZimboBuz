import type { CurrencyCode } from "@/lib/money";
import type { CustomerImportRow, ExistingCustomers, ExistingProducts, ProductImportRow } from "@/lib/import";
import type { Query } from "../data";

// Saving a checked CSV import (P18). Runs inside the caller's transaction as
// the signed-in user, so row-level security and app.can() decide what is
// allowed and nothing is saved unless every row is. Kept free of
// "server-only" so the database tests can call it directly.

export async function existingProducts(q: Query, companyId: string): Promise<ExistingProducts> {
  const { rows } = await q<{ sku: string; barcode: string | null; archived: boolean }>(
    "select sku, barcode, archived_at is not null as archived from public.products where company_id = $1",
    [companyId],
  );
  return {
    skus: new Set(rows.map((r) => r.sku.toLowerCase())),
    barcodes: new Set(rows.filter((r) => r.barcode && !r.archived).map((r) => r.barcode!)),
  };
}

export async function existingCustomers(q: Query, companyId: string): Promise<ExistingCustomers> {
  const { rows } = await q<{ email: string | null; phone_key: string | null }>(
    "select lower(email) as email, phone_key from public.customers where company_id = $1 and archived_at is null",
    [companyId],
  );
  return {
    emails: new Set(rows.flatMap((r) => (r.email ? [r.email] : []))),
    phoneKeys: new Set(rows.flatMap((r) => (r.phone_key ? [r.phone_key] : []))),
  };
}

export interface ProductImportResult {
  products: number;
  openingMovements: number;
}

/**
 * Adds the products with their base-currency prices, and opening stock as
 * receipts into `locationId`, submitted straight away so stock and average
 * cost update.
 */
export async function importProducts(
  q: Query,
  companyId: string,
  base: CurrencyCode,
  rows: ProductImportRow[],
  locationId: string | null,
): Promise<ProductImportResult> {
  const payload = JSON.stringify(
    rows.map((r) => ({
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      tax_code: r.taxCode,
      barcode: r.barcode,
      reorder_level: r.reorderLevel,
      price_cents: r.priceCents,
      opening_qty: r.openingQty,
      unit_cost: r.unitCostCents,
    })),
  );
  const inserted = await q<{ id: string; sku: string }>(
    `insert into public.products (company_id, sku, name, unit, tax_code, barcode, reorder_level)
     select $1, r.sku, r.name, r.unit, r.tax_code, r.barcode, r.reorder_level
     from jsonb_to_recordset($2::jsonb) as r(sku text, name text, unit text, tax_code text, barcode text, reorder_level numeric)
     returning id, sku`,
    [companyId, payload],
  );
  await q(
    `insert into public.product_prices (company_id, product_id, currency, price_cents)
     select $1, p.id, $3, r.price_cents
     from jsonb_to_recordset($2::jsonb) as r(sku text, price_cents bigint)
     join public.products p on p.company_id = $1 and p.sku = r.sku`,
    [companyId, payload, base],
  );

  let openingMovements = 0;
  if (rows.some((r) => r.openingQty !== null)) {
    if (!locationId) throw new Error("a location is needed for opening stock");
    const moved = await q<{ id: string }>(
      `insert into public.stock_movements (company_id, branch_id, movement_type, product_id, to_location_id, quantity, unit_cost, notes)
       select $1, l.branch_id, 'receipt', p.id, l.id, r.opening_qty, r.unit_cost, 'Opening stock (imported)'
       from jsonb_to_recordset($2::jsonb) as r(sku text, opening_qty numeric, unit_cost numeric)
       join public.products p on p.company_id = $1 and p.sku = r.sku
       join public.stock_locations l on l.company_id = $1 and l.id = $3 and l.archived_at is null
       where r.opening_qty is not null
       returning id`,
      [companyId, payload, locationId],
    );
    if (moved.rowCount !== rows.filter((r) => r.openingQty !== null).length) throw new Error("the location for opening stock was not found");
    await q("update public.stock_movements set docstatus = 1 where company_id = $1 and id = any($2::uuid[])", [
      companyId,
      moved.rows.map((m) => m.id),
    ]);
    openingMovements = moved.rows.length;
  }
  return { products: inserted.rowCount ?? 0, openingMovements };
}

export async function importCustomers(q: Query, companyId: string, rows: CustomerImportRow[]): Promise<number> {
  const result = await q(
    `insert into public.customers (company_id, name, company_name, phone, whatsapp, email, currency)
     select $1, r.name, r.company_name, r.phone, r.whatsapp, r.email, r.currency
     from jsonb_to_recordset($2::jsonb) as r(name text, company_name text, phone text, whatsapp text, email text, currency text)`,
    [
      companyId,
      JSON.stringify(
        rows.map((r) => ({ name: r.name, company_name: r.companyName, phone: r.phone, whatsapp: r.whatsapp, email: r.email, currency: r.currency })),
      ),
    ],
  );
  return result.rowCount ?? 0;
}
