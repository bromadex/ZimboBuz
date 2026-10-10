"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { devSignIn } from "@/server/auth";
import { friendlyError, withUser } from "@/server/data";
import { createSessionToken, sessionSecret } from "@/server/session";
import { erpOrigin, platformDomain, requestProtocol } from "@/server/urls";

const PLANS = new Set(["starter", "business", "growth", "pro", "enterprise"]);
const MODULES = new Set(["pos", "sales", "inventory", "website"]);
const CURRENCIES = new Set(["USD", "ZWG", "ZAR"]);

// P1: sign up, create the company (with its roles, head office and brand kit)
// and hand the new owner over to their own ERP address, already signed in.
export async function signUp(formData: FormData): Promise<never> {
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("company") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const plan = String(formData.get("plan") ?? "starter");
  const currency = String(formData.get("currency") ?? "USD");
  const modules = formData.getAll("modules").map(String).filter((m) => MODULES.has(m));

  const back = (error: string) => {
    const params = new URLSearchParams({ error, email, company: name, slug, plan, currency });
    redirect(`/signup?${params}`);
  };
  if (!name) back("Please enter your company name.");
  if (!/^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/.test(slug)) {
    back("Web addresses use lower-case letters, numbers and hyphens only (2 to 42 characters).");
  }
  if (!PLANS.has(plan) || !CURRENCIES.has(currency)) back("Please choose a plan and a currency.");
  if (modules.length === 0) back("Please choose at least one module.");

  let userId = "";
  try {
    userId = await devSignIn(email);
    await withUser(userId, (q) =>
      q("select public.create_company($1, $2, $3, $4::text[], $5)", [name, slug, plan, modules, currency]),
    );
  } catch (error) {
    back(error instanceof Error && error.message.startsWith("Please") ? error.message : friendlyError(error));
  }

  const h = await headers();
  const platform = platformDomain();
  const origin = erpOrigin(slug, platform, h.get("host"), requestProtocol(h.get("x-forwarded-proto")));
  // Cookies belong to one host, so the ERP host signs the owner in from a
  // short-lived token that only it accepts.
  const token = createSessionToken(userId, sessionSecret(), 120, Date.now(), `erp.${slug}.${platform}`);
  redirect(`${origin}/api/auth/handoff?token=${encodeURIComponent(token)}`);
}
