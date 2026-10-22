// Test mode on one address (ZIMERP_SINGLE_HOST, e.g. zimerp.vercel.app), for
// demos and pilots before the platform domain is bought. Companies normally
// live on their own hosts (<slug>.zimerp.co.zw, erp.<slug>.zimerp.co.zw);
// here one address serves everything:
//
//   /erp/<slug>/...   switches this browser to the company's ERP
//   /site/<slug>/...  switches it to the company's website and portal
//   /leave            back to ZimERP's own pages
//   /signup           always ZimERP's sign-up
//
// After switching, the app's usual addresses (/, /products, /account ...)
// belong to that company until the browser switches again. One area at a
// time per browser: that is the price of having no subdomains.

export const VIEW_COOKIE = "zimerp_view";

export type Area = "erp" | "site";

export type SingleHostDecision =
  | { kind: "enter"; area: Area; slug: string; rest: string }
  | { kind: "leave" }
  | { kind: "platform" }
  | { kind: "company"; area: Area; slug: string };

const SLUG = /^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/;
/** ZimERP's own pages, never a company's. */
const PLATFORM_PREFIXES = ["/signup"];

export function readView(cookie: string | undefined | null): { area: Area; slug: string } | null {
  const m = /^(erp|site):([a-z0-9-]+)$/.exec(cookie ?? "");
  return m && SLUG.test(m[2]) ? { area: m[1] as Area, slug: m[2] } : null;
}

export function viewValue(area: Area, slug: string): string {
  return `${area}:${slug}`;
}

export function decideSingleHost(pathname: string, cookie: string | undefined | null): SingleHostDecision {
  const entry = /^\/(erp|site)\/([a-z0-9-]+)(\/.*)?$/.exec(pathname);
  if (entry && SLUG.test(entry[2])) return { kind: "enter", area: entry[1] as Area, slug: entry[2], rest: entry[3] || "/" };
  if (pathname === "/leave") return { kind: "leave" };
  if (PLATFORM_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return { kind: "platform" };
  const view = readView(cookie);
  return view ? { kind: "company", ...view } : { kind: "platform" };
}

/** The single host, when test mode is on. */
export function singleHost(env: Record<string, string | undefined> = process.env): string | null {
  const host = (env.ZIMERP_SINGLE_HOST ?? "").trim().toLowerCase();
  return /^[a-z0-9.-]+(:\d+)?$/.test(host) ? host : null;
}
