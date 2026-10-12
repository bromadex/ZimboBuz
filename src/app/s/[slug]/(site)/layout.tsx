import { ComingSoon, SiteFooter, SiteHeader } from "@/components/site/site-frame";
import { publicSite } from "@/server/web/site-data";

// Website pages and the shop: header and footer, or "coming soon" while the
// site is not published.
export default async function SitePagesLayout({ children, params }: LayoutProps<"/s/[slug]">) {
  const { slug } = await params;
  const site = await publicSite(slug);
  if (!site) return null;
  if (!site.live) return <ComingSoon site={site} />;
  return (
    <>
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 zs-btn">
        Skip to content
      </a>
      <SiteHeader site={site} />
      <main id="content" className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter site={site} />
    </>
  );
}
