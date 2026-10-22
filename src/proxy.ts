import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  allowsArea,
  cachedLookup,
  canonicalHost,
  classifyHost,
  databaseLookup,
  storedLookupHost,
  devLookup,
  supabaseLookup,
  type SiteLookup,
} from "@/lib/tenancy/host";
import { decideSingleHost, singleHost, VIEW_COOKIE, viewValue } from "@/lib/tenancy/single-host";
import { getPool } from "@/server/db";
import { sessionSecret } from "@/server/session";

// Routes each request to the right company by hostname (issue #23).
// Company websites and stores are served from /s/<slug>/..., company ERPs from
// /e/<slug>/...; those internal paths are never reachable directly.

const platformDomain = process.env.ZIMERP_PLATFORM_DOMAIN ?? "zimerp.co.zw";

// Supabase when connected; the database directly when only DATABASE_URL is
// set; otherwise platform addresses resolve to their slug (no own domains).
const lookup: SiteLookup = cachedLookup(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? supabaseLookup(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    : process.env.DATABASE_URL
      ? databaseLookup((sql, params) => getPool().query(sql, params))
      : devLookup(platformDomain),
  Number(process.env.SITE_LOOKUP_CACHE_MS ?? 60_000),
);

function portOf(host: string | null): string {
  const match = /:(\d+)$/.exec(host ?? "");
  return match ? `:${match[1]}` : "";
}

// Some requests come back through the proxy from the server itself: the
// standalone build re-enters rewritten requests, and a form action that
// redirects renders the target page by calling the server at its own address
// (e.g. localhost), carrying the original request's headers. Rewrites carry
// this token, derived from the server secret so every instance agrees, which
// lets those requests through (or back to the same company); requests from
// outside can never present it.
let cachedToken: string | undefined;
function routeToken(): string {
  cachedToken ??= createHmac("sha256", sessionSecret()).update("zimerp-route-token").digest("hex");
  return cachedToken;
}
function hasRouteToken(request: NextRequest): boolean {
  const given = Buffer.from(request.headers.get("x-zimerp-route") ?? "");
  const expected = Buffer.from(routeToken());
  return given.length === expected.length && timingSafeEqual(given, expected);
}
const ROUTING_HEADERS = ["x-zimerp-route", "x-zimerp-company", "x-zimerp-area"];
const SLUG = /^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/;

const notFound = () =>
  new NextResponse("This site is not on ZimERP.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const internal = pathname === "/s" || pathname === "/e" || pathname.startsWith("/s/") || pathname.startsWith("/e/");
  if (hasRouteToken(request)) {
    if (internal) return NextResponse.next();
    const company = request.headers.get("x-zimerp-company") ?? "";
    const area = request.headers.get("x-zimerp-area");
    if (SLUG.test(company) && (area === "erp" || area === "site")) {
      const url = request.nextUrl.clone();
      url.pathname = `${area === "erp" ? "/e" : "/s"}/${company}${pathname === "/" ? "" : pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  const headers = new Headers(request.headers);
  for (const name of ROUTING_HEADERS) headers.delete(name);

  // Test mode on one address (src/lib/tenancy/single-host.ts).
  const single = singleHost();
  if (single && (request.headers.get("host") ?? "").toLowerCase() === single) {
    const decision = decideSingleHost(pathname, request.cookies.get(VIEW_COOKIE)?.value);
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
    const cookie = { httpOnly: true, sameSite: "lax" as const, secure: proto === "https", path: "/", maxAge: 30 * 24 * 60 * 60 };
    if (decision.kind === "enter") {
      // The browser keeps any #fragment (sign-in email links) across this redirect.
      const response = NextResponse.redirect(`${proto}://${single}${decision.rest}${search}`, 303);
      response.cookies.set(VIEW_COOKIE, viewValue(decision.area, decision.slug), cookie);
      return response;
    }
    if (decision.kind === "leave") {
      const response = NextResponse.redirect(`${proto}://${single}/`, 303);
      response.cookies.delete(VIEW_COOKIE);
      return response;
    }
    if (decision.kind === "platform") return internal ? notFound() : NextResponse.next({ request: { headers } });
    if (internal) return notFound();
    const url = request.nextUrl.clone();
    url.pathname = `${decision.area === "erp" ? "/e" : "/s"}/${decision.slug}${pathname === "/" ? "" : pathname}`;
    url.search = search;
    headers.set("x-zimerp-route", routeToken());
    headers.set("x-zimerp-company", decision.slug);
    headers.set("x-zimerp-area", decision.area === "erp" ? "erp" : "site");
    return NextResponse.rewrite(url, { request: { headers } });
  }

  const target = classifyHost(request.headers.get("host"), platformDomain);
  if (target.kind === "invalid") return notFound();
  if (target.kind === "platform") return internal ? notFound() : NextResponse.next({ request: { headers } });

  // ZimERP addresses are routed by their slug even when the lookup finds no
  // live domain (a suspended company must still reach its ERP to pay); own
  // domains must be connected and verified.
  const found = await lookup(storedLookupHost(target, platformDomain));
  const site =
    found ?? (target.custom ? null : { companySlug: target.lookupHost.slice(0, -(platformDomain.length + 1)), kind: "website" as const, companyName: "" });
  if (!site || !allowsArea(site, target)) return notFound();

  if (internal) return notFound();

  // Visitors on an address that is not the company's main one are sent there
  // (pages only: form posts and API calls are left alone).
  if (request.method === "GET" || request.method === "HEAD") {
    const main = canonicalHost(site, target, request.headers.get("host") ?? "", platformDomain);
    if (main) {
      const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
      const port = main.endsWith(`.${platformDomain}`) ? portOf(request.headers.get("host")) : "";
      return NextResponse.redirect(`${proto}://${main}${port}${pathname}${search}`, 308);
    }
  }

  const prefix = target.area === "erp" ? "/e" : "/s";
  const url = request.nextUrl.clone();
  url.pathname = `${prefix}/${site.companySlug}${pathname === "/" ? "" : pathname}`;
  url.search = search;

  headers.set("x-zimerp-route", routeToken());
  headers.set("x-zimerp-company", site.companySlug);
  headers.set("x-zimerp-area", target.area);
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?)$).*)"],
};
