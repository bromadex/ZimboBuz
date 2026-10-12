import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/site/site-frame";
import { publicSite } from "@/server/web/site-data";
import { currentPortalUser } from "@/server/web/portal";
import { portalSignOut } from "../actions";

// Customer portal shell (P19): the company's brand, same look as its website.

export const metadata: Metadata = { title: "My account", robots: { index: false } };

export default async function PortalLayout({ children, params }: LayoutProps<"/s/[slug]">) {
  const { slug } = await params;
  const site = await publicSite(slug);
  if (!site) return null;
  const me = await currentPortalUser(slug);

  return (
    <>
      <header className="zs-header">
        <div className="zs-container zs-header-row">
          <Brand site={site} />
          <div className="zs-header-actions" style={{ marginLeft: "auto" }}>
            {site.live ? (
              <Link href="/" className="zs-cart-link">
                Website
              </Link>
            ) : null}
            {me ? (
              <form action={portalSignOut}>
                <button type="submit" className="zs-cart-link" style={{ border: 0, cursor: "pointer" }}>
                  Sign out
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        {site.features.portal ? (
          children
        ) : (
          <section className="zs-section">
            <div className="zs-container max-w-xl text-center">
              <h1 className="zs-h2">Online accounts are not available</h1>
              <p className="zs-lead mx-auto mt-4">Please contact {site.companyName} for copies of your invoices and statements.</p>
            </div>
          </section>
        )}
      </main>
      <footer className="zs-footer" style={{ paddingBlock: "1.5rem" }}>
        <div className="zs-container zs-muted flex flex-wrap justify-between gap-2 text-sm">
          <span>© {new Date().getFullYear()} {site.companyName}</span>
          <span>Customer portal by ZimERP</span>
        </div>
      </footer>
    </>
  );
}
