import Link from "next/link";
import type { ReactNode } from "react";
import type { Block, ContactBlock, FeaturedProductsBlock, HeroBlock, ImageTextBlock, ProductsBlock } from "@/lib/site/blocks";
import { assetUrl, whatsAppLink } from "@/lib/site/theme";
import { money } from "@/lib/format";
import type { ProductSource, SiteProduct, SiteView } from "@/server/web/site-data";
import type { EnquiryState } from "./enquiry-state";
import { AddToQuoteButton, ContactForm } from "./quote-cart";
import { initials } from "./site-frame";

// Renders page blocks for the public site and the editor preview (the same
// components, as in master plan §12.7).

export type EnquiryAction = (state: EnquiryState, form: FormData) => Promise<EnquiryState>;

interface Ctx {
  site: SiteView;
  products: ProductSource;
  enquiry: EnquiryAction | null;
  preview: boolean;
}

function Paragraphs({ text, className = "zs-prose" }: { text: string; className?: string }) {
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className={className}>
      {parts.map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  );
}

function Img({ src, alt }: { src: string | null; alt: string }) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- company uploads, served as is
  return <img src={src} alt={alt} loading="lazy" decoding="async" />;
}

function Button({ label, href, ghost = false }: { label: string; href: string; ghost?: boolean }) {
  if (!label || !href) return null;
  const external = /^https?:/i.test(href);
  return external ? (
    <a href={href} className={ghost ? "zs-btn zs-btn-ghost" : "zs-btn"} rel="noopener noreferrer" target="_blank">
      {label}
    </a>
  ) : (
    <Link href={href} className={ghost ? "zs-btn zs-btn-ghost" : "zs-btn"}>
      {label}
    </Link>
  );
}

export function priceLabel(p: Pick<SiteProduct, "priceCents" | "currency">): string {
  return p.priceCents === null ? "Price on request" : money(p.priceCents, p.currency);
}

export function ProductCard({ product, site }: { product: SiteProduct; site: SiteView }) {
  return (
    <article className="zs-card zs-product">
      <Link href={`/shop/${product.id}`} className="zs-product-media" aria-label={product.name} tabIndex={-1}>
        {product.imageKey ? (
          <Img src={assetUrl(product.imageKey)} alt="" />
        ) : (
          <span className="zs-product-initials" aria-hidden>
            {initials(product.name)}
          </span>
        )}
      </Link>
      <div className="zs-product-body">
        <Link href={`/shop/${product.id}`} className="zs-product-name">
          {product.name}
        </Link>
        {product.description ? <p className="zs-product-desc">{product.description}</p> : null}
        <div className="zs-product-foot">
          <span className="zs-price">
            {priceLabel(product)}
            {product.priceCents !== null && product.unit !== "each" ? <small> / {product.unit}</small> : null}
          </span>
          {site.features.addToQuote ? (
            <AddToQuoteButton slug={site.slug} product={{ id: product.id, name: product.name, priceCents: product.priceCents, currency: product.currency }} />
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, site }: { products: SiteProduct[]; site: SiteView }) {
  return (
    <div className="zs-grid zs-stagger">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} site={site} />
      ))}
    </div>
  );
}

function Section({ children, tint = false, block }: { children: ReactNode; tint?: boolean; block: Block }) {
  return (
    <section className={`zs-section ${tint ? "zs-section-tint" : ""}`} id={block.id}>
      <div className="zs-container zs-reveal" data-reveal={block.reveal}>
        {children}
      </div>
    </section>
  );
}

function SectionHead({ heading, text, action }: { heading: string; text?: string; action?: ReactNode }) {
  if (!heading && !text && !action) return null;
  return (
    <div className="zs-section-head">
      <div>
        {heading ? <h2 className="zs-h2">{heading}</h2> : null}
        {text ? <p className="zs-lead mt-3">{text}</p> : null}
      </div>
      {action}
    </div>
  );
}

function Hero({ b, site }: { b: HeroBlock; site: SiteView }) {
  const image = assetUrl(b.image);
  const bold = site.settings.template === "bold";
  return (
    <section className="zs-hero" id={b.id}>
      <div className="zs-hero-bg" aria-hidden />
      <div className={`zs-container zs-hero-grid ${image ? "zs-has-image" : ""}`}>
        <div className="zs-reveal" data-reveal={b.reveal}>
          {b.eyebrow ? <p className="zs-eyebrow">{b.eyebrow}</p> : null}
          <h1 className="zs-h1">{b.heading || site.companyName}</h1>
          {b.text ? <p className="zs-lead mt-5">{b.text}</p> : null}
          <div className="zs-hero-actions">
            <Button label={b.button_label} href={b.button_link} />
            <Button label={b.secondary_label} href={b.secondary_link} ghost />
          </div>
        </div>
        {image || !bold ? (
          <div className="zs-hero-art zs-reveal" data-reveal={b.reveal === "none" ? "none" : "zoom"}>
            {image ? <Img src={image} alt="" /> : <span className="zs-hero-art-mark" aria-hidden>{initials(site.companyName)}</span>}
          </div>
        ) : null}
      </div>
    </section>
  );
}

async function Featured({ b, ctx }: { b: FeaturedProductsBlock; ctx: Ctx }) {
  const { rows } = await ctx.products.list({ limit: b.count, ids: b.product_ids.length ? b.product_ids : null });
  if (!rows.length) return ctx.preview ? <EmptyHint block={b} text="Products you mark as shown online will appear here." /> : null;
  return (
    <Section block={b}>
      <SectionHead heading={b.heading} text={b.text} action={<Link href="/shop" className="zs-link">See all products →</Link>} />
      <ProductGrid products={rows} site={ctx.site} />
    </Section>
  );
}

async function Products({ b, ctx }: { b: ProductsBlock; ctx: Ctx }) {
  const { rows, total } = await ctx.products.list({ limit: b.count });
  return (
    <Section block={b} tint>
      <SectionHead
        heading={b.heading}
        text={b.text}
        action={
          b.show_search ? (
            <form action="/shop" method="get" role="search" className="flex w-full max-w-sm gap-2">
              <input name="q" className="zs-input" placeholder="Search products" aria-label="Search products" />
              <button className="zs-btn" type="submit">Search</button>
            </form>
          ) : null
        }
      />
      {rows.length ? <ProductGrid products={rows} site={ctx.site} /> : <p className="zs-muted">New products are on their way.</p>}
      {total > rows.length ? (
        <p className="mt-8 text-center">
          <Link href="/shop" className="zs-btn zs-btn-ghost">
            See all {total} products
          </Link>
        </p>
      ) : null}
    </Section>
  );
}

function ImageText({ b }: { b: ImageTextBlock }) {
  const image = assetUrl(b.image);
  const media = (
    <div className="zs-media">
      {image ? <Img src={image} alt={b.heading} /> : <div className="zs-hero-art h-full" style={{ aspectRatio: "auto", boxShadow: "none" }} />}
    </div>
  );
  return (
    <Section block={b}>
      <div className="zs-grid-2">
        {b.image_side === "left" ? media : null}
        <div>
          {b.heading ? <h2 className="zs-h2 mb-5">{b.heading}</h2> : null}
          {b.body ? <Paragraphs text={b.body} /> : null}
          {b.button_label && b.button_link ? (
            <div className="mt-6">
              <Button label={b.button_label} href={b.button_link} />
            </div>
          ) : null}
        </div>
        {b.image_side === "right" ? media : null}
      </div>
    </Section>
  );
}

function Contact({ b, ctx }: { b: ContactBlock; ctx: Ctx }) {
  const s = ctx.site.settings;
  const wa = whatsAppLink(s.contactWhatsapp);
  const details: Array<[string, string, ReactNode]> = [];
  if (s.contactPhone) details.push(["☏", "Phone", <a key="p" href={`tel:${s.contactPhone.replace(/[^\d+]/g, "")}`}>{s.contactPhone}</a>]);
  if (wa) details.push(["✆", "WhatsApp", <a key="w" href={wa} rel="noopener noreferrer" target="_blank">{s.contactWhatsapp}</a>]);
  if (s.contactEmail) details.push(["@", "Email", <a key="e" href={`mailto:${s.contactEmail}`}>{s.contactEmail}</a>]);
  if (s.address) details.push(["⌂", "Address", s.address]);
  if (s.openingHours) details.push(["◷", "Opening hours", s.openingHours]);
  const showDetails = b.show_details && details.length > 0;
  return (
    <Section block={b}>
      <SectionHead heading={b.heading} text={b.text} />
      <div className={showDetails && b.show_form ? "zs-grid-2" : ""} style={{ alignItems: "start" }}>
        {showDetails ? (
          <dl className="zs-contact-list">
            {details.map(([icon, label, value]) => (
              <div key={label} className="zs-contact-item">
                <span className="zs-contact-icon" aria-hidden>{icon}</span>
                <div>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              </div>
            ))}
          </dl>
        ) : null}
        {b.show_form ? (
          <div className="zs-card p-5 sm:p-7">
            {ctx.enquiry ? <ContactForm action={ctx.enquiry} /> : <p className="zs-muted">The enquiry form appears here.</p>}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function EmptyHint({ block, text }: { block: Block; text: string }) {
  return (
    <section className="zs-section" id={block.id}>
      <div className="zs-container">
        <p className="zs-notice">{text}</p>
      </div>
    </section>
  );
}

export async function PageBlocks({ blocks, ...ctx }: { blocks: Block[] } & Ctx) {
  return (
    <>
      {blocks.map((b) => {
        switch (b.type) {
          case "hero":
            return <Hero key={b.id} b={b} site={ctx.site} />;
          case "text":
            return (
              <Section key={b.id} block={b}>
                <div className={`max-w-3xl ${b.align === "center" ? "mx-auto text-center" : ""}`}>
                  {b.heading ? <h2 className="zs-h2 mb-5">{b.heading}</h2> : null}
                  {b.body ? <Paragraphs text={b.body} /> : null}
                </div>
              </Section>
            );
          case "featured_products":
            return <Featured key={b.id} b={b} ctx={ctx} />;
          case "products":
            return <Products key={b.id} b={b} ctx={ctx} />;
          case "image_text":
            return <ImageText key={b.id} b={b} />;
          case "contact":
            return <Contact key={b.id} b={b} ctx={ctx} />;
          case "cta":
            return (
              <section key={b.id} className="zs-section" id={b.id}>
                <div className="zs-container">
                  <div className="zs-cta zs-reveal" data-reveal={b.reveal}>
                    <div className="zs-hero-bg" aria-hidden />
                    <div className="flex flex-wrap items-center justify-between gap-6">
                      <div className="max-w-2xl">
                        <h2 className="zs-h2">{b.heading}</h2>
                        {b.text ? <p className="zs-lead mt-3">{b.text}</p> : null}
                      </div>
                      <Button label={b.button_label} href={b.button_link} />
                    </div>
                  </div>
                </div>
              </section>
            );
          case "testimonials":
            if (!b.items.length) return ctx.preview ? <EmptyHint key={b.id} block={b} text="Add what your customers say about you." /> : null;
            return (
              <Section key={b.id} block={b} tint>
                <SectionHead heading={b.heading} />
                <div className="zs-grid zs-stagger">
                  {b.items.map((t, i) => (
                    <figure key={i} className="zs-card zs-quote">
                      <blockquote>{t.quote}</blockquote>
                      {t.name ? (
                        <figcaption>
                          {t.name}
                          {t.role ? <span>{t.role}</span> : null}
                        </figcaption>
                      ) : null}
                    </figure>
                  ))}
                </div>
              </Section>
            );
          case "gallery":
            if (!b.images.length) return ctx.preview ? <EmptyHint key={b.id} block={b} text="Choose pictures for your gallery." /> : null;
            return (
              <Section key={b.id} block={b}>
                <SectionHead heading={b.heading} />
                <div className="zs-gallery zs-stagger">
                  {b.images.map((k) => (
                    <figure key={k}>
                      <Img src={assetUrl(k)} alt="" />
                    </figure>
                  ))}
                </div>
              </Section>
            );
        }
      })}
    </>
  );
}
