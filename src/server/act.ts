import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseMoney } from "@/lib/money";
import { requireCompany, type CompanyContext } from "./company";
import { friendlyError, withUser, type Query } from "./data";

// Building blocks for ERP form actions. Each action runs as the signed-in
// user, so row-level security and app.can() decide what is allowed; checks in
// actions only give clearer messages. Paths are host-relative: the proxy maps
// them to the company.

/** A message for the user (shown as is), as opposed to an unexpected error. */
export class UserError extends Error {}

export interface ActOptions {
  /** Where to go on success, if not back to `path`. May depend on the work's result. */
  then?: (result: unknown) => string;
}

/**
 * Runs `work` as the user in one transaction, then redirects to `path` with a
 * success or error message (or to `options.then(result)` on success).
 */
export async function act<T>(
  slug: string,
  path: string,
  success: string,
  work: (q: Query, ctx: CompanyContext) => Promise<T>,
  options: ActOptions = {},
): Promise<never> {
  const ctx = await requireCompany(slug);
  let error: string | null = null;
  let result: T | undefined;
  try {
    result = await withUser(ctx.userId, (q) => work(q, ctx));
  } catch (e) {
    error = e instanceof UserError ? e.message : friendlyError(e);
  }
  // Settings such as the brand kit and modules change the shell, not just the page.
  if (!error) revalidatePath("/e/[slug]", "layout");
  const target = !error && options.then ? options.then(result) : path;
  const sep = target.includes("?") ? "&" : "?";
  redirect(`${target}${sep}${new URLSearchParams(error ? { error } : { success })}`);
}

/** Row-level security hides rows a user may not change, so an update that touched nothing was refused. */
export async function changed(result: Promise<{ rowCount: number | null }>): Promise<void> {
  if (!(await result).rowCount) throw new UserError("You do not have permission to do that, or it no longer exists.");
}

export function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

export function amount(form: FormData, key: string, label: string, { allowZero = true } = {}): number {
  try {
    const cents = parseMoney(text(form, key));
    if (cents < 0 || (!allowZero && cents === 0)) throw new Error();
    return cents;
  } catch {
    throw new UserError(`Please enter ${label} like 12.50.`);
  }
}

export function quantity(form: FormData, key: string, label = "a quantity"): string {
  const raw = text(form, key).replace(/,/g, "");
  if (!/^\d+(\.\d{1,3})?$/.test(raw) || Number(raw) <= 0) throw new UserError(`Please enter ${label} greater than zero.`);
  return raw;
}

export const CURRENCIES = ["USD", "ZWG", "ZAR"] as const;

export function currency(form: FormData, key = "currency"): (typeof CURRENCIES)[number] {
  const value = text(form, key);
  if (!CURRENCIES.includes(value as (typeof CURRENCIES)[number])) throw new UserError("Please choose a currency.");
  return value as (typeof CURRENCIES)[number];
}

export function uuid(form: FormData, key: string, label = "an item"): string {
  const value = text(form, key);
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new UserError(`Please choose ${label}.`);
  return value;
}
