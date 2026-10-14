import { resolveNs } from "node:dns/promises";
import { normaliseHostname } from "./domains";

// Registering domains for companies (master plan §10.2). ZimERP registers
// .co.zw and other domains through its registrar account (name.co.zw).
// Until that account has an API connection, orders are fulfilled by ZimERP
// staff ("manual"): availability is checked through DNS and the order waits
// for staff to complete it (app.complete_domain_order).

export type Availability = "available" | "taken" | "unknown";

export type RegistrationResult = { status: "registered"; reference: string } | { status: "pending" } | { status: "failed"; problem: string };

export interface DomainRegistrar {
  readonly name: string;
  checkAvailability(hostname: string): Promise<Availability>;
  register(hostname: string, years: number): Promise<RegistrationResult>;
}

type NsResolver = (hostname: string) => Promise<string[]>;

/** Availability from DNS (a registered domain has name servers); registration by ZimERP staff. */
export class ManualRegistrar implements DomainRegistrar {
  readonly name = "manual";
  constructor(private readonly resolve: NsResolver = resolveNs) {}

  async checkAvailability(hostname: string): Promise<Availability> {
    const host = normaliseHostname(hostname);
    try {
      const ns = await this.resolve(host);
      return ns.length ? "taken" : "unknown";
    } catch (e) {
      const code = (e as { code?: string }).code;
      // NXDOMAIN: nobody has registered it. Other errors: cannot tell.
      return code === "ENOTFOUND" ? "available" : code === "ENODATA" ? "taken" : "unknown";
    }
  }

  async register(): Promise<RegistrationResult> {
    return { status: "pending" };
  }
}

/** For tests and demos: names in `taken` are taken; everything else registers at once. */
export class FakeRegistrar implements DomainRegistrar {
  readonly name = "fake";
  readonly registered = new Set<string>();
  constructor(readonly taken = new Set(["google.com", "zimerp.co.zw", "taken.co.zw"])) {}

  async checkAvailability(hostname: string): Promise<Availability> {
    const host = normaliseHostname(hostname);
    return this.taken.has(host) || this.registered.has(host) ? "taken" : "available";
  }

  async register(hostname: string, years: number): Promise<RegistrationResult> {
    const host = normaliseHostname(hostname);
    if (this.taken.has(host) || this.registered.has(host)) return { status: "failed", problem: "That domain is already registered." };
    this.registered.add(host);
    return { status: "registered", reference: `FAKE-${host}-${years}Y` };
  }
}
