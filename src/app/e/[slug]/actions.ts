"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseMoney } from "@/lib/money";
import { devSignIn, endSession, startSession } from "@/server/auth";
import { requireCompany } from "@/server/company";
import { friendlyError, withUser, type Query } from "@/server/data";
import { safeNextPath } from "@/server/urls";

// ERP form actions. Each one runs as the signed-in user, so row-level
// security and app.can() decide what is allowed; the checks here only give
// clearer messages. Paths are host-relative: the proxy maps them to this company.

const CURRENCIES = ["USD", "ZWG", "ZAR"] as const;

async function act(slug: string, path: string, success: string, work: (q: Query, companyId: string) => Promise<unknown>): Promise<never> {
  const ctx = await requireCompany(slug);
  let error: string | null = null;
  try {
    await withUser(ctx.userId, (q) => work(q, ctx.company.id));
  } catch (e) {
    error = e instanceof UserError ? e.message : friendlyError(e);
  }
  // Settings such as the brand kit and modules change the shell, not just the page.
  if (!error) revalidatePath("/e/[slug]", "layout");
  redirect(`${path}?${new URLSearchParams(error ? { error } : { success })}`);
}

class UserError extends Error {}

/** Row-level security hides rows a user may not change, so an update that touched nothing was refused. */
async function changed(result: Promise<{ rowCount: number | null }>): Promise<void> {
  if (!(await result).rowCount) throw new UserError("You do not have permission to do that, or it no longer exists.");
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

function amount(form: FormData, key: string, label: string): number {
  try {
    const cents = parseMoney(text(form, key));
    if (cents < 0) throw new Error();
    return cents;
  } catch {
    throw new UserError(`Please enter ${label} like 12.50.`);
  }
}

// --- Sign in and out --------------------------------------------------------

export async function signIn(formData: FormData): Promise<never> {
  const next = safeNextPath(text(formData, "next"));
  let error: string | null = null;
  try {
    await startSession(await devSignIn(text(formData, "email")));
  } catch (e) {
    error = e instanceof Error && e.message.startsWith("Please") ? e.message : friendlyError(e);
  }
  if (error) redirect(`/sign-in?${new URLSearchParams({ error })}`);
  redirect(next);
}

export async function signOut(): Promise<never> {
  await endSession();
  redirect("/sign-in");
}

// --- Products ---------------------------------------------------------------

export async function addProduct(slug: string, formData: FormData): Promise<never> {
  return act(slug, "/products", "Product added.", async (q, companyId) => {
    const name = text(formData, "name");
    const sku = text(formData, "sku");
    if (!name || !sku) throw new UserError("Please enter a name and a product code.");
    const price = amount(formData, "price", "a selling price");
    const taxCode = text(formData, "tax_code");
    if (!["standard", "zero_rated", "exempt"].includes(taxCode)) throw new UserError("Please choose a VAT type.");
    const { rows } = await q<{ id: string }>(
      `insert into public.products (company_id, sku, barcode, name, unit, tax_code, is_stock_item)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [companyId, sku, optional(formData, "barcode"), name, text(formData, "unit") || "each", taxCode, formData.get("is_stock_item") === "on"],
    );
    await q(
      `insert into public.product_prices (company_id, product_id, currency, price_cents)
       select $1, $2, base_currency, $3 from public.companies where id = $1`,
      [companyId, rows[0].id, price],
    );
  });
}

export async function archiveProduct(slug: string, formData: FormData): Promise<never> {
  return act(slug, "/products", "Product archived.", (q, companyId) =>
    changed(q("update public.products set archived_at = now() where company_id = $1 and id = $2 and archived_at is null", [companyId, text(formData, "id")])),
  );
}

// --- Customers --------------------------------------------------------------

export async function addCustomer(slug: string, formData: FormData): Promise<never> {
  return act(slug, "/customers", "Customer added.", async (q, companyId) => {
    const name = text(formData, "name");
    if (!name) throw new UserError("Please enter the customer's name.");
    const currency = text(formData, "currency");
    if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) throw new UserError("Please choose a currency.");
    const email = optional(formData, "email")?.toLowerCase() ?? null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("Please check the email address.");
    await q(
      `insert into public.customers (company_id, name, email, phone, whatsapp, company_name, currency)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [companyId, name, email, optional(formData, "phone"), optional(formData, "whatsapp"), optional(formData, "company_name"), currency],
    );
  });
}

export async function archiveCustomer(slug: string, formData: FormData): Promise<never> {
  return act(slug, "/customers", "Customer archived.", (q, companyId) =>
    changed(q("update public.customers set archived_at = now() where company_id = $1 and id = $2 and archived_at is null", [companyId, text(formData, "id")])),
  );
}

// --- Exchange rates (P4) ----------------------------------------------------

export async function setRate(slug: string, formData: FormData): Promise<never> {
  return act(slug, "/settings/rates", "Exchange rate saved. New sales use it straight away.", async (q, companyId) => {
    const currency = text(formData, "currency");
    if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) throw new UserError("Please choose a currency.");
    const raw = text(formData, "rate").replace(/,/g, "");
    if (!/^\d+(\.\d{1,8})?$/.test(raw) || Number(raw) <= 0) throw new UserError("Please enter a rate greater than zero, like 26.75.");
    await q("insert into public.exchange_rates (company_id, currency, rate) values ($1, $2, $3)", [companyId, currency, raw]);
  });
}

// --- Modules and features (P2) ----------------------------------------------

export async function setModule(slug: string, formData: FormData): Promise<never> {
  const enabled = text(formData, "enabled") === "true";
  return act(slug, "/settings/modules", enabled ? "Module switched on." : "Module switched off.", (q, companyId) =>
    q(
      `insert into public.company_modules (company_id, module_code, enabled) values ($1, $2, $3)
       on conflict (company_id, module_code) do update set enabled = excluded.enabled`,
      [companyId, text(formData, "module"), enabled],
    ),
  );
}

export async function setFeature(slug: string, formData: FormData): Promise<never> {
  const enabled = text(formData, "enabled") === "true";
  return act(slug, "/settings/modules", enabled ? "Feature switched on." : "Feature switched off.", (q, companyId) =>
    q(
      `insert into public.company_features (company_id, feature_code, enabled) values ($1, $2, $3)
       on conflict (company_id, feature_code) do update set enabled = excluded.enabled`,
      [companyId, text(formData, "feature"), enabled],
    ),
  );
}

// --- Branding (P20) ---------------------------------------------------------

export async function saveBranding(slug: string, formData: FormData): Promise<never> {
  return act(slug, "/settings/branding", "Brand kit saved.", (q, companyId) =>
    changed(q(
      `update public.company_branding
       set primary_color = $2, secondary_color = $3, accent_color = $4, font_pair = $5, corner_style = $6, theme_mode = $7
       where company_id = $1`,
      [
        companyId,
        text(formData, "primary_color"),
        text(formData, "secondary_color"),
        text(formData, "accent_color"),
        text(formData, "font_pair"),
        text(formData, "corner_style"),
        text(formData, "theme_mode"),
      ],
    )),
  );
}
