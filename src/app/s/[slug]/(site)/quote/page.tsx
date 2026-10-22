import type { Metadata } from "next";
import Link from "next/link";
import { QuoteCart } from "@/components/site/quote-cart";
import { getPool } from "@/server/db";
import { publicSite } from "@/server/web/site-data";
import { sendEnquiry } from "../../actions";

// The visitor's quote request: the products they added, and their details.

export const metadata: Metadata = { title: "Your quote", robots: { index: false } };

export default async function QuotePage({ params }: PageProps<"/s/[slug]/quote">) {
  const { slug } = await params;
  const site = await publicSite(slug);
  if (!site?.live) return null;
  // Currencies with a working Paynow account (no secrets read here).
  const buyCurrencies = site.features.buy
    ? (
        await getPool().query<{ currency: string }>(
          `select g.currency from public.payment_gateway_accounts g join public.companies c on c.id = g.company_id
           where c.slug = $1 and g.gateway = 'paynow' and g.enabled`,
          [slug],
        )
      ).rows.map((r) => r.currency.trim())
    : [];
  return (
    <section className="zs-section">
      <div className="zs-container">
        <p className="zs-eyebrow">Request a quote</p>
        <h1 className="zs-h2 mb-8">Your quote</h1>
        {site.features.addToQuote ? (
          <QuoteCart slug={slug} action={sendEnquiry.bind(null, slug)} buyCurrencies={buyCurrencies} />
        ) : (
          <div className="zs-card p-8">
            <p>
              Please <Link href="/contact" className="zs-link">contact us</Link> for prices and orders.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
