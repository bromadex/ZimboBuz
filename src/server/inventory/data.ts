import "server-only";
import { act, UserError, type ActOptions } from "../act";
import type { CompanyContext } from "../company";
import type { Query } from "../data";
import { inventoryMessage } from "./errors";

// Shared reads and the action wrapper for the inventory screens.

export interface LocationOption {
  id: string;
  code: string;
  name: string;
  branch_id: string;
  branch_name: string;
  is_default: boolean;
  archived: boolean;
}

/** Stock locations with their branch, live ones first. */
export async function stockLocations(q: Query, companyId: string, { includeArchived = false } = {}): Promise<LocationOption[]> {
  return (
    await q<LocationOption>(
      `select l.id, l.code, l.name, l.branch_id, b.name as branch_name, l.is_default, l.archived_at is not null as archived
       from public.stock_locations l join public.branches b on b.id = l.branch_id
       where l.company_id = $1 and ($2 or l.archived_at is null)
       order by l.archived_at is not null, b.is_head_office desc, b.name, l.is_default desc, l.name`,
      [companyId, includeArchived],
    )
  ).rows;
}

/** "Main store" or "Harare: Main store" when the company has several branches. */
export function locationLabel(l: { name: string; branch_name: string }, manyBranches: boolean): string {
  return manyBranches ? `${l.branch_name}: ${l.name}` : l.name;
}

export interface ProductOption {
  id: string;
  sku: string;
  name: string;
  unit: string;
}

/** Live stock items, for choosing in forms. */
export async function stockProducts(q: Query, companyId: string): Promise<ProductOption[]> {
  return (
    await q<ProductOption>(
      `select id, sku, name, unit from public.products
       where company_id = $1 and archived_at is null and is_stock_item order by name, sku`,
      [companyId],
    )
  ).rows;
}

/** Like act(), with plain-English messages for the stock rules. */
export function actStock<T>(
  slug: string,
  path: string,
  success: string,
  work: (q: Query, ctx: CompanyContext) => Promise<T>,
  options?: ActOptions,
): Promise<never> {
  return act(
    slug,
    path,
    success,
    async (q, ctx) => {
      try {
        return await work(q, ctx);
      } catch (e) {
        if (e instanceof UserError) throw e;
        const message = inventoryMessage(e);
        throw message ? new UserError(message) : e;
      }
    },
    options,
  );
}

export const MOVEMENT_TYPES: Record<string, { label: string; inbound: boolean; outbound: boolean }> = {
  receipt: { label: "Received", inbound: true, outbound: false },
  return_in: { label: "Returned", inbound: true, outbound: false },
  adjustment_in: { label: "Adjusted in", inbound: true, outbound: false },
  issue: { label: "Issued", inbound: false, outbound: true },
  sale: { label: "Sold", inbound: false, outbound: true },
  adjustment_out: { label: "Adjusted out", inbound: false, outbound: true },
  transfer: { label: "Transfer", inbound: true, outbound: true },
};

export const TAX_LABELS: Record<string, string> = { standard: "Standard VAT", zero_rated: "Zero-rated", exempt: "Exempt" };
