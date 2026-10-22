import { defaultFetch, requestJson, type FetchLike } from "./http";

// Custom domains with automatic SSL through the hosting provider (§10.3, §12.6).
// Vercel while building; Azure Front Door after the move.

export interface DomainStatus {
  hostname: string;
  verified: boolean;
  /** DNS records the customer (or ZimERP DNS) must add before verification. */
  verification: Array<{ type: string; domain: string; value: string }>;
}

export interface DomainProvider {
  readonly name: string;
  addDomain(hostname: string): Promise<DomainStatus>;
  getDomain(hostname: string): Promise<DomainStatus>;
}

export function normaliseHostname(hostname: string): string {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    throw new Error(`"${hostname}" is not a valid domain name`);
  }
  return host;
}

type VercelDomain = {
  name: string;
  verified: boolean;
  verification?: Array<{ type: string; domain: string; value: string }>;
};

export class VercelDomainProvider implements DomainProvider {
  readonly name = "vercel";
  constructor(
    private readonly token: string,
    private readonly projectId: string,
    private readonly teamId?: string,
    private readonly fetchImpl: FetchLike = defaultFetch(),
  ) {}

  async addDomain(hostname: string) {
    const d = await requestJson<VercelDomain>(this.fetchImpl, "Vercel", this.url(`/v10/projects/${this.projectId}/domains`), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}` },
      body: { name: normaliseHostname(hostname) },
    });
    return this.toStatus(d);
  }

  async getDomain(hostname: string) {
    const host = encodeURIComponent(normaliseHostname(hostname));
    const d = await requestJson<VercelDomain>(this.fetchImpl, "Vercel", this.url(`/v9/projects/${this.projectId}/domains/${host}`), {
      method: "GET",
      headers: { authorization: `Bearer ${this.token}` },
    });
    return this.toStatus(d);
  }

  private url(path: string) {
    const base = `https://api.vercel.com${path}`;
    return this.teamId ? `${base}?teamId=${encodeURIComponent(this.teamId)}` : base;
  }

  private toStatus(d: VercelDomain): DomainStatus {
    return { hostname: d.name, verified: d.verified, verification: d.verification ?? [] };
  }
}

export class FakeDomainProvider implements DomainProvider {
  readonly name = "fake";
  readonly domains = new Map<string, DomainStatus>();
  async addDomain(hostname: string) {
    const status = { hostname: normaliseHostname(hostname), verified: true, verification: [] };
    this.domains.set(status.hostname, status);
    return status;
  }
  async getDomain(hostname: string) {
    const status = this.domains.get(normaliseHostname(hostname));
    if (!status) throw new Error("domain not found");
    return status;
  }
}
