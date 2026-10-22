"use server";

import { CsvError, parseCsv } from "@/lib/csv";
import { checkCustomers, checkProducts, type ImportCheck, type ImportKind, type ImportPreview } from "@/lib/import";
import { act, text, UserError } from "@/server/act";
import { requireCompany, type CompanyContext } from "@/server/company";
import { withUser, type Query } from "@/server/data";
import { inventoryMessage } from "@/server/inventory/errors";
import { existingCustomers, existingProducts, importCustomers, importProducts } from "@/server/inventory/import-run";

// Data import (P18): step 1 checks a CSV file and shows every problem; step 2
// imports every row in one transaction as the signed-in user, or nothing.

/** Keeps a server action's request under Next's 1 MB body limit. */
const MAX_BYTES = 900_000;

const PERMISSION: Record<ImportKind, string> = { products: "core.products.create", customers: "core.customers.create" };

function kindOf(formData: FormData): ImportKind {
  const kind = text(formData, "kind");
  if (kind !== "products" && kind !== "customers") throw new UserError("Please choose what you are importing.");
  return kind;
}

async function check(q: Query, ctx: CompanyContext, kind: ImportKind, csv: string): Promise<ImportCheck<unknown>> {
  let table: string[][];
  try {
    table = parseCsv(csv);
  } catch (e) {
    if (e instanceof CsvError) throw new UserError(`The file could not be read. ${e.message}`);
    throw e;
  }
  const base = ctx.company.baseCurrency;
  if (kind === "customers") return checkCustomers(table, await existingCustomers(q, ctx.company.id), base);
  const result = checkProducts(table, await existingProducts(q, ctx.company.id), base);
  if (result.rows.some((r) => r.value?.openingQty) && !ctx.permissions.has("inventory.move")) {
    result.fileErrors.push("You do not have permission to receive stock. Remove the opening quantities, or ask a manager to import this file.");
  }
  return result;
}

export async function previewImport(slug: string, _previous: ImportPreview | null, formData: FormData): Promise<ImportPreview> {
  const ctx = await requireCompany(slug);
  const location = text(formData, "location_id");
  let kind: ImportKind = "products";
  let csv = "";
  try {
    kind = kindOf(formData);
    if (!ctx.permissions.has(PERMISSION[kind])) throw new UserError(`You do not have permission to add ${kind}.`);
    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) throw new UserError("That file is too big. Files can be up to 900 KB; split it into smaller files.");
      csv = await file.text();
    } else {
      csv = String(formData.get("pasted") ?? "");
      if (csv.length > MAX_BYTES) throw new UserError("That is too much text. Import up to 900 KB at a time.");
    }
    if (!csv.trim()) throw new UserError("Choose a CSV file or paste the rows first.");
    const result = await withUser(ctx.userId, (q) => check(q, ctx, kind, csv));
    return { kind, csv, location, check: result as ImportPreview["check"], error: null };
  } catch (e) {
    return { kind, csv, location, check: null, error: e instanceof UserError ? e.message : "Something went wrong. Please try again." };
  }
}

export async function runImport(slug: string, formData: FormData): Promise<never> {
  const kind = text(formData, "kind") === "customers" ? "customers" : "products";
  const csv = String(formData.get("csv") ?? "");
  const location = text(formData, "location_id");
  return act(
    slug,
    "/settings/import",
    kind === "products" ? "Import finished: every product was added." : "Import finished: every customer was added.",
    async (q, ctx) => {
      if (!ctx.permissions.has(PERMISSION[kind])) throw new UserError(`You do not have permission to add ${kind}.`);
      if (csv.length > MAX_BYTES) throw new UserError("That file is too big. Import up to 900 KB at a time.");
      const result = await check(q, ctx, kind, csv);
      if (result.fileErrors.length || result.errorRows) {
        throw new UserError("Some rows have problems now (someone may have added the same records meanwhile). Check the file again.");
      }
      const rows = result.rows.map((r) => r.value!);
      try {
        if (kind === "customers") {
          await importCustomers(q, ctx.company.id, rows as Parameters<typeof importCustomers>[2]);
        } else {
          const productRows = rows as Parameters<typeof importProducts>[3];
          const needsLocation = productRows.some((r) => r.openingQty !== null);
          if (needsLocation && !/^[0-9a-f-]{36}$/i.test(location)) throw new UserError("Choose where the opening stock is kept.");
          await importProducts(q, ctx.company.id, ctx.company.baseCurrency, productRows, needsLocation ? location : null);
        }
      } catch (e) {
        if (e instanceof UserError) throw e;
        const message = inventoryMessage(e);
        if (message) throw new UserError(`Nothing was imported. ${message}`);
        if (e instanceof Error && e.message.startsWith("the location for opening stock")) throw new UserError("Choose where the opening stock is kept.");
        throw e;
      }
    },
    { then: () => (kind === "products" ? "/products" : "/customers") },
  );
}
