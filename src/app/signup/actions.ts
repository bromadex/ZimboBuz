"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { wwwPartner } from "@/lib/tenancy/domains";
import { normaliseHostname } from "@/server/adapters/domains";
import { devSignIn } from "@/server/auth";
import { listModules, listPlans } from "@/server/industries";
import { allow, TOO_MANY } from "@/server/rate-limit";
import { friendlyError, withUser } from "@/server/data";
import { createSessionToken, sessionSecret } from "@/server/session";
import { adapters } from "@/server/web/services";
import { erpOrigin, platformDomain, requestProtocol } from "@/server/urls";

const PLANS = new Set(["starter", "business", "growth", "pro", "enterprise"]);
const CURRENCIES = new Set(["USD", "ZWG", "ZAR"]);

// P1: sign up, create the company (with its roles, head office and brand kit)
// and hand the new owner over to their own ERP address, already signed in.
export async function signUp(formData: FormData): Promise<never> {
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("company") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const plan = String(formData.get("plan") ?? "starter");
  const currency = String(formData.get("currency") ?? "USD");
  const [plans, moduleRows] = await Promise.all([listPlans(), listModules()]);
  const modules = formData.getAll("modules").map(String).filter((m) => moduleRows.some((r) => r.code === m));
  const industry = String(formData.get("industry") ?? "").trim() || null;
  const sampleItems = formData.get("sample_items") === "on";
  const ownDomainRaw = String(formData.get("own_domain") ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");

  const back = (error: string) => {
    const params = new URLSearchParams({ error, email, company: name, slug, plan, currency, industry: industry ?? "", modules: modules.join(","), own_domain: ownDomainRaw });
    redirect(`/signup?${params}`);
  };
  if (!(await allow("signUp"))) back(TOO_MANY);
  if (!name) back("Please enter your company name.");
  if (!/^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/.test(slug)) {
    back("Web addresses use lower-case letters, numbers and hyphens only (2 to 42 characters).");
  }
  if (!PLANS.has(plan) || !CURRENCIES.has(currency)) back("Please choose a plan and a currency.");
  if (modules.length === 0) back("Please choose at least one module.");
  const chosenPlan = plans.find((p) => p.code === plan);
  if (chosenPlan) {
    const missing = moduleRows.filter((m) => modules.includes(m.code) && !chosenPlan.modules.includes(m.code));
    if (missing.length) back(`The ${chosenPlan.name} plan does not include ${missing.map((m) => m.name).join(", ")}. Choose a bigger plan or untick ${missing.length === 1 ? "it" : "them"}.`);
    const counted = moduleRows.filter((m) => modules.includes(m.code) && m.countsTowardLimit).length;
    if (chosenPlan.maxModules !== null && counted > chosenPlan.maxModules) {
      back(`The ${chosenPlan.name} plan includes ${chosenPlan.maxModules} module${chosenPlan.maxModules === 1 ? "" : "s"}; you chose ${counted}. Choose a bigger plan or untick some.`);
    }
  }
  if (industry && !/^[a-z_]{1,40}$/.test(industry)) back("Please choose what kind of organisation you are.");
  let ownDomain: string | null = null;
  if (ownDomainRaw) {
    try {
      ownDomain = normaliseHostname(ownDomainRaw);
    } catch {
      back("Please enter your domain like www.mybusiness.co.zw, or leave it empty.");
    }
    const platform = platformDomain();
    if (ownDomain && (ownDomain.endsWith(`.${platform}`) || ownDomain.endsWith(".zimerp.co.zw") || ownDomain.startsWith("erp."))) {
      back("Please enter your own website domain (not a ZimERP or erp. address), or leave it empty.");
    }
  }

  let userId = "";
  try {
    userId = await devSignIn(email);
    await withUser(userId, async (q) => {
      const company = (
        await q<{ id: string }>("select public.create_company($1, $2, $3, $4::text[], $5, $6, $7) as id", [name, slug, plan, modules, currency, industry, sampleItems])
      ).rows[0].id;
      // Their own domain, waiting for DNS: Settings > Domains shows what to add.
      if (ownDomain) {
        const names = [ownDomain, wwwPartner(ownDomain)].filter((n): n is string => !!n);
        try {
          for (const n of names) await q("insert into public.company_domains (company_id, hostname, kind) values ($1, $2, 'website')", [company, n]);
        } catch (e) {
          if ((e as { code?: string }).code === "23505") throw new Error("Please use another domain: that one is already connected to a ZimERP company.");
          throw e;
        }
      }
    });
    if (ownDomain) {
      for (const n of [ownDomain, wwwPartner(ownDomain)]) if (n) await adapters().domains.addDomain(n).catch(() => null);
    }
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
