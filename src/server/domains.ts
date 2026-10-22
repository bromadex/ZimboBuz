import "server-only";
import { headers } from "next/headers";
import { getPool } from "./db";
import { erpOrigin, platformDomain, requestProtocol, siteOrigin } from "./urls";

// A company's main addresses, for links people will follow (portal invites,
// "view your site", emails): its own domain once it is the main address,
// otherwise the free ZimERP address.

export async function companyOrigins(slug: string): Promise<{ site: string; erp: string }> {
  const h = await headers();
  const protocol = requestProtocol(h.get("x-forwarded-proto"));
  const platform = platformDomain();
  const { rows } = await getPool().query<{ kind: string; hostname: string }>(
    `select case when d.kind = 'erp' then 'erp' else 'site' end as kind, d.hostname
     from public.company_domains d join public.companies c on c.id = d.company_id
     where c.slug = $1 and d.is_primary and d.verified_at is not null and d.archived_at is null`,
    [slug],
  );
  const own = (kind: string) => rows.find((r) => r.kind === kind && !r.hostname.endsWith(`.${platform}`))?.hostname;
  const site = own("site");
  const erp = own("erp");
  // Own domains are always served over HTTPS.
  return {
    site: site ? `https://${site}` : siteOrigin(slug, platform, h.get("host"), protocol),
    erp: erp ? `https://${erp}` : erpOrigin(slug, platform, h.get("host"), protocol),
  };
}

/**
 * The company's free ZimERP addresses, for links in sign-in emails: Supabase
 * only sends people back to allowed addresses, and one wildcard covers these
 * (an own main domain still works: the router forwards there, and the
 * browser keeps the link details).
 */
export async function platformOrigins(slug: string): Promise<{ site: string; erp: string }> {
  const h = await headers();
  const protocol = requestProtocol(h.get("x-forwarded-proto"));
  const platform = platformDomain();
  return { site: siteOrigin(slug, platform, h.get("host"), protocol), erp: erpOrigin(slug, platform, h.get("host"), protocol) };
}
