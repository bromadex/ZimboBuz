// Addresses of a company's ERP and website, built from the request so the
// same code works on zimerp.co.zw, on a staging domain and on localhost ports.

export function platformDomain(env: Record<string, string | undefined> = process.env): string {
  return (env.ZIMERP_PLATFORM_DOMAIN ?? "zimerp.co.zw").toLowerCase();
}

function portOf(host: string | null | undefined): string {
  const match = /:(\d+)$/.exec(host ?? "");
  return match ? `:${match[1]}` : "";
}

export function requestProtocol(forwardedProto: string | null | undefined, nodeEnv = process.env.NODE_ENV): "http" | "https" {
  const first = forwardedProto?.split(",")[0]?.trim();
  if (first === "http" || first === "https") return first;
  return nodeEnv === "production" ? "https" : "http";
}

/** https://erp.<slug>.<platform>[:port] */
export function erpOrigin(slug: string, platform: string, requestHost: string | null, protocol: "http" | "https"): string {
  return `${protocol}://erp.${slug}.${platform}${portOf(requestHost)}`;
}

/** https://<slug>.<platform>[:port] */
export function siteOrigin(slug: string, platform: string, requestHost: string | null, protocol: "http" | "https"): string {
  return `${protocol}://${slug}.${platform}${portOf(requestHost)}`;
}

/** Only same-site relative paths may be used as a "next" redirect. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
