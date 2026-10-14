"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { act, changed, text, UserError } from "@/server/act";
import { requireCompany } from "@/server/company";
import { friendlyError, withUser } from "@/server/data";
import { normaliseHostname } from "@/server/adapters/domains";
import { getPool } from "@/server/db";
import { preferredOfPair, wwwPartner } from "@/lib/tenancy/domains";
import { platformDomain } from "@/server/urls";
import { adapters } from "@/server/web/services";

// Custom domains (§10.2, §12.6): admins add their own domain for the website
// or the ERP; the hosting provider (domain adapter) attaches it with SSL and
// says when it is verified. Only then does routing (public.resolve_site) use it.

const BACK = "/settings/domains";

function hostname(form: FormData): string {
  try {
    return normaliseHostname(text(form, "hostname").replace(/^https?:\/\//i, "").replace(/\/.*$/, ""));
  } catch {
    throw new UserError("Please enter a domain name like www.mybusiness.co.zw (without https://).");
  }
}

export async function addDomain(slug: string, form: FormData): Promise<never> {
  return act(slug, BACK, "Domain added. Now add the DNS record below, then press “Check now”.", async (q, ctx) => {
    const host = hostname(form);
    const kind = text(form, "kind");
    if (kind !== "website" && kind !== "erp") throw new UserError("Please choose what the domain is for.");
    const platform = platformDomain();
    if (host === platform || host.endsWith(`.${platform}`) || host === "zimerp.co.zw" || host.endsWith(".zimerp.co.zw")) {
      throw new UserError("ZimERP addresses are already yours. Please enter your own domain.");
    }
    if (kind === "erp" && !host.startsWith("erp.")) throw new UserError("An ERP address must start with erp., for example erp.mybusiness.co.zw.");
    if (kind === "website" && host.startsWith("erp.")) throw new UserError("Addresses starting with erp. are for the ERP. Choose “ERP” or use another name.");
    try {
      await q("insert into public.company_domains (company_id, hostname, kind) values ($1, $2, $3)", [ctx.company.id, host, kind]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new UserError("That domain is already connected to a ZimERP company.");
      throw e;
    }
    // mybusiness.co.zw and www.mybusiness.co.zw go together: visitors typing
    // either reach the site (the other forwards to the main one).
    const partner = kind === "website" ? wwwPartner(host) : null;
    if (partner) {
      await q(
        `insert into public.company_domains (company_id, hostname, kind)
         select $1, $2, 'website' where not exists (select 1 from public.company_domains where hostname = $2)`,
        [ctx.company.id, partner],
      );
    }
    // Ask the hosting provider to attach the domains (SSL follows verification).
    for (const name of partner ? [host, partner] : [host]) {
      try {
        await adapters().domains.addDomain(name);
      } catch {
        // Not fatal: "Check now" tries again.
      }
    }
  });
}

export async function checkDomain(slug: string, form: FormData): Promise<never> {
  let message = "";
  return act(
    slug,
    BACK,
    "",
    async (q, ctx) => {
      const id = text(form, "id");
      const row = (
        await q<{ hostname: string; kind: string }>(
          "select hostname, kind from public.company_domains where company_id = $1 and id = $2 and archived_at is null",
          [ctx.company.id, id],
        )
      ).rows[0];
      if (!row) throw new UserError("That domain no longer exists.");
      if (!ctx.permissions.has("admin.domains.manage")) throw new UserError("You do not have permission to do that.");
      const provider = adapters().domains;
      const verify = async (hostname: string) => {
        const status = await provider.getDomain(hostname).catch(() => provider.addDomain(hostname));
        // Verification is recorded by the server, not by users (see the website migration).
        await getPool().query(
          `update public.company_domains
           set verified_at = case when $3 then coalesce(verified_at, now()) else null end,
               ssl_status = case when $3 then 'issued' else 'pending' end
           where company_id = $1 and hostname = $2 and archived_at is null`,
          [ctx.company.id, hostname, status.verified],
        );
        return status;
      };
      let status;
      try {
        status = await verify(row.hostname);
      } catch {
        throw new UserError("We could not reach the domain service. Please try again in a few minutes.");
      }
      // Its www/bare twin is checked at the same time.
      const partner = row.kind === "erp" ? null : wwwPartner(row.hostname);
      if (partner) {
        const twin = await q("select 1 from public.company_domains where company_id = $1 and hostname = $2 and archived_at is null", [ctx.company.id, partner]);
        if (twin.rowCount) await verify(partner).catch(() => null);
      }
      const madeMain = status.verified ? await makeMainIfFirst(ctx.company.id, id) : null;
      message = status.verified
        ? `${row.hostname} is connected.${madeMain ? ` ${madeMain} is now your main address; your ZimERP address forwards visitors to it.` : ""} It can take a few minutes for the secure certificate to reach everyone.`
        : `${row.hostname} is not pointing to ZimERP yet. DNS changes can take up to a day; check again later.`;
    },
    { then: () => `${BACK}?${new URLSearchParams({ success: message })}` },
  );
}

/**
 * The first own website domain to be connected becomes the main address
 * (the company wants its own domain rather than the free one). Of a bare/www
 * pair, the www name is main. Returns the new main hostname, if any.
 */
async function makeMainIfFirst(companyId: string, domainId: string): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; hostname: string; kind: string; is_primary: boolean; verified: boolean }>(
    `select id, hostname, kind, is_primary, verified_at is not null as verified
     from public.company_domains where company_id = $1 and archived_at is null`,
    [companyId],
  );
  const me = rows.find((r) => r.id === domainId);
  if (!me || me.kind === "erp" || me.is_primary) return null;
  const platform = platformDomain();
  const own = (h: string) => !h.endsWith(".zimerp.co.zw") && !h.endsWith(`.${platform}`);
  const main = rows.find((r) => r.kind !== "erp" && r.is_primary);
  if (main && own(main.hostname)) return null;
  const partner = wwwPartner(me.hostname);
  const twin = partner ? rows.find((r) => r.hostname === partner && r.verified) : undefined;
  const chosen = twin ? preferredOfPair(me.hostname, twin.hostname) : me.hostname;
  const target = rows.find((r) => r.hostname === chosen)!;
  await pool.query("update public.company_domains set is_primary = true where id = $1", [target.id]);
  return chosen;
}

export async function makePrimary(slug: string, form: FormData): Promise<never> {
  return act(slug, BACK, "Main address changed.", async (q, ctx) => {
    const id = text(form, "id");
    const row = (
      await q<{ kind: string; verified: boolean }>(
        "select kind, verified_at is not null as verified from public.company_domains where company_id = $1 and id = $2 and archived_at is null",
        [ctx.company.id, id],
      )
    ).rows[0];
    if (!row) throw new UserError("That domain no longer exists.");
    if (!row.verified) throw new UserError("Connect the domain first (press “Check now”), then make it your main address.");
    const kinds = row.kind === "erp" ? ["erp"] : ["website", "store"];
    await q("update public.company_domains set is_primary = false where company_id = $1 and kind = any($2) and id <> $3 and is_primary", [ctx.company.id, kinds, id]);
    await changed(q("update public.company_domains set is_primary = true where company_id = $1 and id = $2", [ctx.company.id, id]));
  });
}

export async function archiveDomain(slug: string, form: FormData): Promise<never> {
  return act(slug, BACK, "Domain removed. Visitors to it no longer reach your site.", async (q, ctx) => {
    const platform = (
      await q<{ hostname: string }>("select hostname from public.company_domains where company_id = $1 and id = $2", [ctx.company.id, text(form, "id")])
    ).rows[0];
    if (platform?.hostname.endsWith(".zimerp.co.zw")) throw new UserError("Your ZimERP address cannot be removed.");
    await changed(
      q("update public.company_domains set archived_at = now(), is_primary = false where company_id = $1 and id = $2 and archived_at is null", [
        ctx.company.id,
        text(form, "id"),
      ]),
    );
  });
}

// --- Registering a new domain through ZimERP ---------------------------------

export async function orderDomain(slug: string, form: FormData): Promise<never> {
  const ctx = await requireCompany(slug);
  let error: string | null = null;
  let message = "";
  try {
    const host = hostname(form);
    const years = Math.min(5, Math.max(1, Number.parseInt(text(form, "years") || "1", 10) || 1));
    const registrar = adapters().registrar;
    if ((await registrar.checkAvailability(host).catch(() => "unknown")) === "taken") {
      throw new UserError(`${host} is already registered by someone else. Try another name.`);
    }
    // The order is saved (as the user, so permissions apply) before the registrar is asked.
    const order = await withUser(ctx.userId, async (q) => (await q<{ id: string }>("select public.request_domain($1, $2, $3) as id", [ctx.company.id, host, years])).rows[0].id);
    const result = await registrar.register(host, years).catch(() => ({ status: "pending" as const }));
    if (result.status === "pending") {
      message = `We have your order for ${host}. ZimERP registers it in your company's name within one working day and connects it to your website.`;
    } else {
      // The registrar answered straight away: recorded by the server.
      await getPool().query("select app.complete_domain_order($1, $2, $3, $4)", [
        order,
        result.status === "registered",
        result.status === "registered" ? result.reference : null,
        result.status === "failed" ? result.problem : null,
      ]);
      if (result.status === "failed") {
        error = `We could not register ${host}: ${result.problem}`;
      } else {
        for (const name of [host, `www.${host}`]) await adapters().domains.addDomain(name).catch(() => null);
        message = `${host} is registered in your company's name and is being connected. Press “Check now” in a few minutes.`;
      }
    }
  } catch (e) {
    error = e instanceof UserError ? e.message : friendlyError(e);
  }
  revalidatePath("/e/[slug]", "layout");
  redirect(`${BACK}?${new URLSearchParams(error ? { error } : { success: message })}`);
}

export async function cancelDomainOrder(slug: string, form: FormData): Promise<never> {
  return act(slug, BACK, "Domain order cancelled.", (q) => q("select public.cancel_domain_order($1)", [text(form, "id")]));
}
