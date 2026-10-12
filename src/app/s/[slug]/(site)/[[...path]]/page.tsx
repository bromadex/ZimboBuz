import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageBlocks } from "@/components/site/blocks";
import { publicPage, publicProducts, publicSite } from "@/server/web/site-data";
import { sendEnquiry } from "../../actions";

// A published website page: "/" is the page with address "home".

function pageSlugOf(path: string[] | undefined): string | null {
  if (!path?.length) return "home";
  if (path.length > 1 || !/^[a-z0-9-]{1,60}$/.test(path[0])) return null;
  return path[0];
}

export async function generateMetadata({ params }: PageProps<"/s/[slug]/[[...path]]">): Promise<Metadata> {
  const { slug, path } = await params;
  const page = pageSlugOf(path);
  const content = page ? await publicPage(slug, page) : null;
  if (!content) return {};
  return {
    title: page === "home" ? { absolute: (await publicSite(slug))?.companyName ?? content.title } : content.title,
    ...(content.description ? { description: content.description } : {}),
  };
}

export default async function SitePage({ params }: PageProps<"/s/[slug]/[[...path]]">) {
  const { slug, path } = await params;
  const site = await publicSite(slug);
  if (!site?.live) return null;
  const page = pageSlugOf(path);
  const content = page ? await publicPage(slug, page) : null;
  if (!content) notFound();
  return (
    <PageBlocks
      blocks={content.blocks}
      site={site}
      products={publicProducts(slug)}
      enquiry={sendEnquiry.bind(null, slug)}
      preview={false}
    />
  );
}
