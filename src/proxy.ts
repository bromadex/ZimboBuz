import { NextResponse, type NextRequest } from "next/server";
import { allowsArea, cachedLookup, classifyHost, devLookup, supabaseLookup, type SiteLookup } from "@/lib/tenancy/host";

// Routes each request to the right company by hostname (issue #23).
// Company websites and stores are served from /s/<slug>/..., company ERPs from
// /e/<slug>/...; those internal paths are never reachable directly.

const platformDomain = process.env.ZIMERP_PLATFORM_DOMAIN ?? "zimerp.co.zw";

const lookup: SiteLookup = cachedLookup(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? supabaseLookup(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    : devLookup(platformDomain),
);

// Some servers (e.g. the standalone build) pass rewritten requests through the
// proxy again. Rewrites carry this per-process token so they are let through;
// requests from outside can never present it.
const ROUTE_TOKEN = crypto.randomUUID();
const ROUTING_HEADERS = ["x-zimerp-route", "x-zimerp-company", "x-zimerp-area"];

const notFound = () =>
  new NextResponse("This site is not on ZimERP.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const internal = pathname === "/s" || pathname === "/e" || pathname.startsWith("/s/") || pathname.startsWith("/e/");
  if (internal && request.headers.get("x-zimerp-route") === ROUTE_TOKEN) return NextResponse.next();

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

  headers.set("x-zimerp-route", ROUTE_TOKEN);
  headers.set("x-zimerp-company", site.companySlug);
  headers.set("x-zimerp-area", target.area);
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?)$).*)"],
};
