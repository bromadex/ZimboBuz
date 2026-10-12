import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { priceLabel } from "@/components/site/blocks";
import { AddToQuoteButton } from "@/components/site/quote-cart";
import { initials } from "@/components/site/site-frame";
import { whatsAppLink } from "@/lib/site/theme";
import { publicProduct, publicSite } from "@/server/web/site-data";

// One product page.
// TODO(sales): a "Buy" button with online payment (feature website.buy) goes
// beside "Add to quote" when checkout is built.

export async function generateMetadata({ params }: PageProps<"/s/[slug]/shop/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  const p = await publicProduct(slug, id);
  return p ? { title: p.name, description: p.description?.slice(0, 160) ?? `${p.name}: ${priceLabel(p)}` } : {};
}

export default async function ProductPage({ params }: PageProps<"/s/[slug]/shop/[id]">) {
  const { slug, id } = await params;
  const site = await publicSite(slug);
  if (!site?.live) return null;
  const p = await publicProduct(slug, id);
  if (!p) notFound();
  const wa = whatsAppLink(site.settings.contactWhatsapp);

  return (
    <section className="zs-section">
      <div className="zs-container">
        <nav className="zs-muted mb-6 text-sm" aria-label="Breadcrumb">
          <Link href="/shop" className="zs-link">
            Shop
          </Link>{" "}
          / <span>{p.name}</span>
        </nav>
        <div className="zs-grid-2" style={{ alignItems: "start" }}>
          <div className="zs-card zs-product zs-reveal" data-reveal="zoom" style={{ boxShadow: "var(--shadow)" }}>
            <div className="zs-product-media" style={{ aspectRatio: "1" }}>
              <span className="zs-product-initials" style={{ fontSize: "5rem" }} aria-hidden>
                {initials(p.name)}
              </span>
            </div>
          </div>
          <div className="zs-reveal" data-reveal="fade-up">
            <h1 className="zs-h2">{p.name}</h1>
            <p className="zs-price mt-4" style={{ fontSize: "1.6rem" }}>
              {priceLabel(p)}
              {p.priceCents !== null && p.unit !== "each" ? <small> / {p.unit}</small> : null}
            </p>
            {p.priceCents !== null && site.vatRegistered && site.pricesIncludeTax ? <p className="zs-muted text-sm">Including VAT</p> : null}
            {p.description ? <div className="zs-prose mt-6 whitespace-pre-line">{p.description}</div> : null}
            <div className="mt-8 space-y-4">
              {site.features.addToQuote ? (
                <AddToQuoteButton
                  slug={slug}
                  quantityInput
                  className="zs-btn"
                  product={{ id: p.id, name: p.name, priceCents: p.priceCents, currency: p.currency }}
                />
              ) : (
                <Link href="/contact" className="zs-btn">
                  Ask about this product
                </Link>
              )}
              <div className="flex flex-wrap gap-3 text-sm">
                {site.features.addToQuote ? (
                  <Link href="/quote" className="zs-link">
                    View your quote →
                  </Link>
                ) : null}
                {wa ? (
                  <a className="zs-link" href={`${wa}?text=${encodeURIComponent(`Hello, I am interested in ${p.name}.`)}`} rel="noopener noreferrer" target="_blank">
                    Ask on WhatsApp
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
