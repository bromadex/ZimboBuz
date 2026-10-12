import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { CurrencyCode } from "@/lib/money";
import { currentUserId } from "./auth";
import { withUser } from "./data";
import { getPool } from "./db";
import { twoStepAvailable, twoStepEnabled } from "./two-step";

export interface Branding {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontPair: "modern" | "classic" | "friendly" | "technical";
  themeMode: "light" | "dark" | "system";
  cornerStyle: "square" | "rounded" | "pill";
}

export interface CompanyContext {
  userId: string;
  userEmail: string;
  company: {
    id: string;
    name: string;
    slug: string;
    planCode: string;
    planName: string;
    status: "active" | "grace" | "read_only" | "suspended";
    baseCurrency: CurrencyCode;
    vatRegistered: boolean;
    pricesIncludeTax: boolean;
  };
  roleName: string;
  permissions: Set<string>;
  branding: Branding;
  /** Two-step sign-in: whether the user has it on, and whether the company requires it of them. */
  twoStep: { enabled: boolean; required: boolean };
}

/** Admin permissions that make two-step sign-in required when the company asks for it. */
export function hasAdminPermission(permissions: Set<string>): boolean {
  return [...permissions].some((p) => p.startsWith("admin.") && p !== "admin.audit.view");
}

export type CompanyLookup =
  | { kind: "signed_out" }
  | { kind: "no_access"; userId: string; userEmail: string; disabled?: boolean }
  | { kind: "invited"; userId: string; userEmail: string; companyId: string; companyName: string; roleName: string; userType: "full" | "light" }
  | ({ kind: "ok" } & CompanyContext);

/** The signed-in user's view of a company, read through row-level security. Cached per request. */
export const lookupCompany = cache(async (slug: string): Promise<CompanyLookup> => {
  const userId = await currentUserId();
  if (!userId) return { kind: "signed_out" };

  // auth.users is not readable by signed-in users (as on Supabase); read it as the server.
  const email = (await getPool().query<{ email: string }>("select email from auth.users where id = $1", [userId])).rows[0]?.email ?? "";

  return withUser(userId, async (q) => {
    const { rows } = await q<{
      id: string; name: string; slug: string; plan_code: string; plan_name: string; status: CompanyContext["company"]["status"];
      base_currency: CurrencyCode; vat_registered: boolean; prices_include_tax: boolean; role_name: string;
      primary_color: string; secondary_color: string; accent_color: string; font_pair: Branding["fontPair"];
      theme_mode: Branding["themeMode"]; corner_style: Branding["cornerStyle"];
    }>(
      `select c.id, c.name, c.slug, c.plan_code, pl.name as plan_name, c.status, c.base_currency,
              c.vat_registered, c.prices_include_tax, r.name as role_name,
              b.primary_color, b.secondary_color, b.accent_color, b.font_pair, b.theme_mode, b.corner_style
       from public.companies c
       join public.plans pl on pl.code = c.plan_code
       join public.memberships m on m.company_id = c.id and m.user_id = auth.uid()
       join public.roles r on r.id = m.role_id
       left join public.company_branding b on b.company_id = c.id
       where c.slug = $1 and c.archived_at is null`,
      [slug],
    );
    const row = rows[0];
    if (!row) {
      const m = (
        await q<{ company_id: string; company_name: string; role_name: string; user_type: "full" | "light"; status: string }>(
          "select * from public.my_membership($1)",
          [slug],
        )
      ).rows[0];
      if (m?.status === "invited") {
        return { kind: "invited", userId, userEmail: email, companyId: m.company_id, companyName: m.company_name, roleName: m.role_name, userType: m.user_type };
      }
      return { kind: "no_access", userId, userEmail: email, disabled: m?.status === "disabled" };
    }

    const perms = await q<{ code: string }>("select public.my_permissions($1) as code", [row.id]);
    const permissions = new Set(perms.rows.map((p) => p.code));
    const requires = (await q<{ r: boolean }>("select app.requires_two_step($1) as r", [row.id])).rows[0]?.r ?? false;
    const enabled = await twoStepEnabled(userId);
    return {
      kind: "ok",
      userId,
      userEmail: email,
      company: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        planCode: row.plan_code,
        planName: row.plan_name,
        status: row.status,
        baseCurrency: row.base_currency.trim() as CurrencyCode,
        vatRegistered: row.vat_registered,
        pricesIncludeTax: row.prices_include_tax,
      },
      roleName: row.role_name,
      permissions,
      twoStep: { enabled, required: requires && hasAdminPermission(permissions) && twoStepAvailable() },
      branding: {
        primaryColor: row.primary_color ?? "#0b6e4f",
        secondaryColor: row.secondary_color ?? "#c98f00",
        accentColor: row.accent_color ?? "#b42318",
        fontPair: row.font_pair ?? "modern",
        themeMode: row.theme_mode ?? "system",
        cornerStyle: row.corner_style ?? "rounded",
      },
    };
  });
});

/** For pages and actions inside the ERP: the company context, or a redirect to sign in. */
export async function requireCompany(slug: string): Promise<CompanyContext> {
  const result = await lookupCompany(slug);
  if (result.kind === "signed_out" || result.kind === "invited") redirect("/sign-in");
  if (result.kind === "no_access") redirect("/sign-in?error=" + encodeURIComponent("You are not a member of this company."));
  // The company asks staff with admin permissions to use two-step sign-in.
  if (result.twoStep.required && !result.twoStep.enabled) redirect("/account/security?required=1");
  return result;
}

/** Like requireCompany, but also refuses users without a permission. */
export async function requirePermission(slug: string, permission: string): Promise<CompanyContext> {
  const ctx = await requireCompany(slug);
  if (!ctx.permissions.has(permission)) redirect("/?error=" + encodeURIComponent("You do not have permission to open that page."));
  return ctx;
}
