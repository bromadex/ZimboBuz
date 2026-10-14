// Request routing by hostname (issue #23, master plan §12.6).
//
//   zimerp.co.zw, www.zimerp.co.zw, localhost      → ZimERP's own site
//   <slug>.zimerp.co.zw                            → the company's website and store
//   erp.<slug>.zimerp.co.zw                        → the company's ERP
//   www.mhofu.co.zw / mhofu.co.zw (verified)       → website and store
//   erp.mhofu.co.zw (registered as kind "erp")     → ERP

export const RESERVED_SLUGS = new Set([
  "www", "app", "api", "admin", "status", "help", "support", "docs", "erp", "mail", "email",
  "cdn", "static", "assets", "auth", "login", "billing", "zimerp", "portal", "dashboard",
]);

export type Area = "site" | "erp";

export type HostTarget =
  | { kind: "platform" }
  | { kind: "tenant"; area: Area; lookupHost: string; custom: boolean }
  | { kind: "invalid" };

export function normaliseHost(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

export function classifyHost(rawHost: string | null | undefined, platformDomain: string): HostTarget {
  const host = normaliseHost(rawHost);
  const platform = platformDomain.toLowerCase();
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return { kind: "invalid" };
  if (host === platform || host === `www.${platform}` || host === "localhost" || host === "127.0.0.1") {
    return { kind: "platform" };
  }

  if (host.endsWith(`.${platform}`)) {
    const parts = host.slice(0, -(platform.length + 1)).split(".");
    if (parts.length === 1) {
      return RESERVED_SLUGS.has(parts[0])
        ? { kind: "platform" }
        : { kind: "tenant", area: "site", lookupHost: host, custom: false };
    }
    if (parts.length === 2 && parts[0] === "erp" && !RESERVED_SLUGS.has(parts[1])) {
      return { kind: "tenant", area: "erp", lookupHost: `${parts[1]}.${platform}`, custom: false };
    }
    return { kind: "invalid" };
  }

  return { kind: "tenant", area: host.startsWith("erp.") ? "erp" : "site", lookupHost: host, custom: true };
}

/** The platform domain ZimERP addresses are recorded under (public.create_company). */
export const STORED_PLATFORM = "zimerp.co.zw";

/** The hostname to look up for a request: free addresses use their stored form. */
export function storedLookupHost(target: Extract<HostTarget, { kind: "tenant" }>, platformDomain: string): string {
  if (target.custom) return target.lookupHost;
  return `${target.lookupHost.slice(0, -(platformDomain.length + 1))}.${STORED_PLATFORM}`;
}

export interface SiteRecord {
  companySlug: string;
  kind: "website" | "store" | "erp";
  companyName: string;
  /** The company's main website address (its own domain once made main). */
  siteHost?: string | null;
  /** The company's main ERP address on its own domain, if it has one. */
  erpHost?: string | null;
}

/**
 * Where to send a visitor who reached a company on an address that is not its
 * main one (the free ZimERP address after the company made its own domain
 * main, the bare domain when www is main, and so on). Null: stay.
 */
export function canonicalHost(
  record: SiteRecord,
  target: Extract<HostTarget, { kind: "tenant" }>,
  requestHost: string,
  platformDomain: string,
): string | null {
  const host = normaliseHost(requestHost);
  const platform = platformDomain.toLowerCase();
  if (target.area === "site") {
    // Free addresses are stored as <slug>.zimerp.co.zw; on a staging domain
    // they live under that domain instead.
    const stored = record.siteHost ?? null;
    const main = stored?.endsWith(`.${STORED_PLATFORM}`) ? `${stored.slice(0, -STORED_PLATFORM.length)}${platform}` : stored;
    return main && main !== host ? main : null;
  }
  const main = record.erpHost ?? (target.custom ? `erp.${record.companySlug}.${platform}` : null);
  return main && main !== host ? main : null;
}

export type SiteLookup = (hostname: string) => Promise<SiteRecord | null>;

/** Whether a resolved domain may serve the requested area. */
export function allowsArea(record: SiteRecord, target: Extract<HostTarget, { kind: "tenant" }>): boolean {
  if (!target.custom) return true; // platform subdomains: the slug decides, both areas allowed
  return target.area === "erp" ? record.kind === "erp" : record.kind !== "erp";
}

/** Caches lookups (including misses) for a short time; routing runs on every request. */
export function cachedLookup(lookup: SiteLookup, ttlMs = 60_000, now: () => number = Date.now): SiteLookup {
  const cache = new Map<string, { value: SiteRecord | null; expires: number }>();
  return async (hostname) => {
    const hit = cache.get(hostname);
    if (hit && hit.expires > now()) return hit.value;
    const value = await lookup(hostname);
    cache.set(hostname, { value, expires: now() + ttlMs });
    if (cache.size > 5000) cache.delete(cache.keys().next().value!);
    return value;
  };
}

/** Looks hostnames up through Supabase's REST API (public.resolve_site). */
export function supabaseLookup(supabaseUrl: string, anonKey: string, fetchImpl: typeof fetch = fetch): SiteLookup {
  return async (hostname) => {
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/resolve_site`, {
      method: "POST",
      headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, "content-type": "application/json" },
      body: JSON.stringify({ p_hostname: hostname }),
    });
    if (!res.ok) throw new Error(`site lookup failed with HTTP ${res.status}`);
    const rows = (await res.json()) as ResolvedRow[];
    return rows[0] ? fromRow(rows[0]) : null;
  };
}

type ResolvedRow = { company_slug: string; kind: SiteRecord["kind"]; company_name: string; site_host: string | null; erp_host: string | null };

function fromRow(row: ResolvedRow): SiteRecord {
  return { companySlug: row.company_slug, kind: row.kind, companyName: row.company_name, siteHost: row.site_host, erpHost: row.erp_host };
}

/** Looks hostnames up directly in PostgreSQL (public.resolve_site), before Supabase is connected. */
export function databaseLookup(query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>): SiteLookup {
  return async (hostname) => {
    const { rows } = await query("select * from public.resolve_site($1)", [hostname]);
    return rows[0] ? fromRow(rows[0] as ResolvedRow) : null;
  };
}

/** Development fallback: platform subdomains resolve to their slug; custom domains do not resolve. */
export function devLookup(platformDomain: string): SiteLookup {
  return async (hostname) => {
    if (!hostname.endsWith(`.${platformDomain}`)) return null;
    const slug = hostname.slice(0, -(platformDomain.length + 1));
    return { companySlug: slug, kind: "website", companyName: slug };
  };
}
