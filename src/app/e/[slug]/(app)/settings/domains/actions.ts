"use server";

import { act, changed, text, UserError } from "@/server/act";
import { normaliseHostname } from "@/server/adapters/domains";
import { getPool } from "@/server/db";
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
    // Ask the hosting provider to attach the domain (SSL follows verification).
    try {
      await adapters().domains.addDomain(host);
    } catch {
      // Not fatal: "Check now" tries again.
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
        await q<{ hostname: string }>(
          "select hostname from public.company_domains where company_id = $1 and id = $2 and archived_at is null",
          [ctx.company.id, id],
        )
      ).rows[0];
      if (!row) throw new UserError("That domain no longer exists.");
      if (!ctx.permissions.has("admin.domains.manage")) throw new UserError("You do not have permission to do that.");
      const provider = adapters().domains;
      let status;
      try {
        status = await provider.getDomain(row.hostname).catch(() => provider.addDomain(row.hostname));
      } catch {
        throw new UserError("We could not reach the domain service. Please try again in a few minutes.");
      }
      // Verification is recorded by the server, not by users (see the website migration).
      await getPool().query(
        `update public.company_domains
         set verified_at = case when $3 then coalesce(verified_at, now()) else null end,
             ssl_status = case when $3 then 'issued' else 'pending' end
         where company_id = $1 and id = $2 and archived_at is null`,
        [ctx.company.id, id, status.verified],
      );
      message = status.verified
        ? `${row.hostname} is connected. It can take a few minutes for the secure certificate to reach everyone.`
        : `${row.hostname} is not pointing to ZimERP yet. DNS changes can take up to a day; check again later.`;
    },
    { then: () => `${BACK}?${new URLSearchParams({ success: message })}` },
  );
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
