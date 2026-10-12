import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageBlocks } from "@/components/site/blocks";
import { SiteFooter, SiteHeader, SiteRoot } from "@/components/site/site-frame";
import { requirePermission } from "@/server/company";
import { previewPage, previewProducts, previewSite } from "@/server/web/site-data";
import { previewEnquiry } from "../../../../s/[slug]/actions";
import "@/components/site/site.css";

// Draft preview for the page editor (P9). Served on the ERP host, outside the
// ERP shell, only to signed-in members with website.view; it renders the
// draft with the same components as the public site.

export const metadata: Metadata = { title: "Preview", robots: { index: false } };

export default async function SitePreview({ params }: PageProps<"/e/[slug]/site-preview/[id]">) {
  const { slug, id } = await params;
  const ctx = await requirePermission(slug, "website.view");
  const [site, page] = await Promise.all([previewSite(ctx), previewPage(ctx, id)]);
  if (!page) notFound();
  return (
    <SiteRoot site={site} preview>
      <SiteHeader site={site} current={page.slug === "home" ? "/" : `/${page.slug}`} />
      <main className="flex flex-1 flex-col">
        <PageBlocks blocks={page.blocks} site={site} products={previewProducts(ctx)} enquiry={previewEnquiry} preview />
      </main>
      <SiteFooter site={site} />
    </SiteRoot>
  );
}
