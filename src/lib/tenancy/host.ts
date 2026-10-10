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

export interface SiteRecord {
  companySlug: string;
  kind: "website" | "store" | "erp";
  companyName: string;
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
    const rows = (await res.json()) as Array<{ company_slug: string; kind: SiteRecord["kind"]; company_name: string }>;
    const row = rows[0];
    return row ? { companySlug: row.company_slug, kind: row.kind, companyName: row.company_name } : null;
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
