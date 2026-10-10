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

const notFound = () =>
  new NextResponse("This site is not on ZimERP.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const internal = pathname === "/s" || pathname === "/e" || pathname.startsWith("/s/") || pathname.startsWith("/e/");
  const target = classifyHost(request.headers.get("host"), platformDomain);

  if (target.kind === "invalid") return notFound();
  if (target.kind === "platform") return internal ? notFound() : NextResponse.next();

  const site = await lookup(target.lookupHost);
  if (!site || !allowsArea(site, target)) return notFound();

  const prefix = target.area === "erp" ? "/e" : "/s";
  const url = request.nextUrl.clone();
  url.pathname = `${prefix}/${site.companySlug}${internal ? "" : pathname === "/" ? "" : pathname}`;
  url.search = search;
  if (internal) return notFound();

  const headers = new Headers(request.headers);
  headers.set("x-zimerp-company", site.companySlug);
  headers.set("x-zimerp-area", target.area);
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?)$).*)"],
};
