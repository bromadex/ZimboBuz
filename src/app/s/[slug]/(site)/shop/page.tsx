import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/site/blocks";
import { publicProducts, publicSite } from "@/server/web/site-data";

// The online shop: every product shown online, with search and pages.

export const metadata: Metadata = { title: "Shop" };

const PAGE_SIZE = 24;

export default async function ShopPage({ params, searchParams }: PageProps<"/s/[slug]/shop">) {
  const { slug } = await params;
  const sp = await searchParams;
  const site = await publicSite(slug);
  if (!site?.live) return null;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(1000, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1));
  const { rows, total } = await publicProducts(slug).list({ search: q || null, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => `/shop?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <>
      <section className="zs-hero">
        <div className="zs-hero-bg" aria-hidden />
        <div className="zs-container py-12 sm:py-16">
          <p className="zs-eyebrow">Shop</p>
          <h1 className="zs-h2">{q ? `Results for “${q}”` : "Everything we sell"}</h1>
          <form action="/shop" method="get" role="search" className="mt-6 flex max-w-xl gap-2">
            <input name="q" defaultValue={q} className="zs-input" placeholder="Search products" aria-label="Search products" />
            <button type="submit" className="zs-btn">
              Search
            </button>
          </form>
          {site.features.addToQuote ? (
            <p className="zs-lead mt-4 text-base">Add what you need to your quote and send us one request. We reply quickly.</p>
          ) : null}
        </div>
      </section>
      <section className="zs-section" style={{ paddingTop: "2.5rem" }}>
        <div className="zs-container">
          <p className="zs-muted mb-5 text-sm">
            {total === 0 ? "" : `${total} product${total === 1 ? "" : "s"}`}
            {site.pricesIncludeTax && site.vatRegistered ? " · prices include VAT" : ""}
          </p>
          {rows.length ? (
            <ProductGrid products={rows} site={site} />
          ) : (
            <div className="zs-card p-10 text-center">
              <p className="zs-h3">{q ? "Nothing matches your search" : "No products online yet"}</p>
              <p className="zs-muted mt-2">{q ? "Try a different word, or ask us directly." : "Please check back soon, or get in touch."}</p>
              <Link href={q ? "/shop" : "/contact"} className="zs-btn mt-5">
                {q ? "Show all products" : "Contact us"}
              </Link>
            </div>
          )}
          {pages > 1 ? (
            <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Pages">
              {page > 1 ? <Link className="zs-btn zs-btn-ghost zs-btn-small" href={link(page - 1)}>Previous</Link> : null}
              <span className="zs-muted text-sm">
                Page {page} of {pages}
              </span>
              {page < pages ? <Link className="zs-btn zs-btn-ghost zs-btn-small" href={link(page + 1)}>Next</Link> : null}
            </nav>
          ) : null}
        </div>
      </section>
    </>
  );
}
