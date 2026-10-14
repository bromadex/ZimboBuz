// Helpers for companies' own domains (master plan §12.6): the bare domain
// (mybusiness.co.zw) and its www twin travel together, and DNS instructions
// depend on which of the two it is.

/** Second-level endings used like top-level ones (co.zw, org.uk ...). */
const SECOND_LEVEL = new Set(["co", "org", "ac", "gov", "net", "com", "edu", "mil", "nic"]);

/** Number of labels in the part people buy (mybusiness.co.zw → 3, mybusiness.com → 2). */
function registrableLength(labels: string[]): number {
  const n = labels.length;
  return n >= 3 && SECOND_LEVEL.has(labels[n - 2]) && labels[n - 1].length === 2 ? 3 : 2;
}

/** mybusiness.co.zw for mybusiness.co.zw, www.mybusiness.co.zw or shop.mybusiness.co.zw. */
export function registrableDomain(host: string): string {
  const labels = host.split(".");
  return labels.slice(-registrableLength(labels)).join(".");
}

/** True for the bare domain itself (no www or other prefix). */
export function isApex(host: string): boolean {
  return registrableDomain(host) === host;
}

/** The other half of a bare/www pair, or null for other names (shop.mybusiness.co.zw). */
export function wwwPartner(host: string): string | null {
  if (isApex(host)) return `www.${host}`;
  if (host.startsWith("www.") && isApex(host.slice(4))) return host.slice(4);
  return null;
}

/** Of a bare/www pair, the one used as the main address: the www name. */
export function preferredOfPair(a: string, b: string): string {
  return a.startsWith("www.") ? a : b.startsWith("www.") ? b : a;
}

export interface DnsRecord {
  type: "A" | "CNAME";
  name: string;
  value: string;
}

/** The DNS record a company adds at its registrar for one hostname. */
export function dnsRecordFor(host: string, target: { cname: string; apexIp: string | null }): DnsRecord {
  const labels = host.split(".");
  // Bare domains cannot use CNAME records.
  if (isApex(host)) return { type: "A", name: "@", value: target.apexIp ?? "Ask ZimERP support for the address" };
  return { type: "CNAME", name: labels.slice(0, labels.length - registrableLength(labels)).join("."), value: target.cname };
}

/** Name ideas from a company name: mhofu-hardware, mhofuhardware. */
export function domainLabel(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(pvt|private|ltd|limited|t\/a)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}
