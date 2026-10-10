import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { allowsArea, cachedLookup, classifyHost, devLookup, supabaseLookup, type SiteLookup } from "@/lib/tenancy/host";
import { sessionSecret } from "@/server/session";

// Routes each request to the right company by hostname (issue #23).
// Company websites and stores are served from /s/<slug>/..., company ERPs from
// /e/<slug>/...; those internal paths are never reachable directly.

const platformDomain = process.env.ZIMERP_PLATFORM_DOMAIN ?? "zimerp.co.zw";

const lookup: SiteLookup = cachedLookup(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? supabaseLookup(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    : devLookup(platformDomain),
);

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

  const target = classifyHost(request.headers.get("host"), platformDomain);
  if (target.kind === "invalid") return notFound();
  if (target.kind === "platform") return internal ? notFound() : NextResponse.next({ request: { headers } });

  const site = await lookup(target.lookupHost);
  if (!site || !allowsArea(site, target)) return notFound();

  if (internal) return notFound();
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
