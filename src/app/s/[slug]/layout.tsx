import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteRoot } from "@/components/site/site-frame";
import { publicSite } from "@/server/web/site-data";
import "@/components/site/site.css";

// Company websites, stores and customer portals (P9, P19), reached only
// through the proxy at <slug>.<platform domain> or the company's own domain.
// Every visit reads the latest published content.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: LayoutProps<"/s/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const site = await publicSite(slug);
  if (!site) return {};
  return {
    title: { default: site.companyName, template: `%s · ${site.companyName}` },
    description: site.settings.seoDescription ?? site.settings.tagline ?? `${site.companyName}: products, prices and contact details.`,
    icons: site.branding.logoUrl ? { icon: site.branding.logoUrl } : undefined,
    openGraph: { siteName: site.companyName, type: "website" },
  };
}

export default async function SiteLayout({ children, params }: LayoutProps<"/s/[slug]">) {
  const { slug } = await params;
  const site = await publicSite(slug);
  if (!site) notFound();
  return <SiteRoot site={site}>{children}</SiteRoot>;
}
