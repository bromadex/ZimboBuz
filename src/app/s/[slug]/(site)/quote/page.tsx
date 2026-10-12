import type { Metadata } from "next";
import Link from "next/link";
import { QuoteCart } from "@/components/site/quote-cart";
import { publicSite } from "@/server/web/site-data";
import { sendEnquiry } from "../../actions";

// The visitor's quote request: the products they added, and their details.

export const metadata: Metadata = { title: "Your quote", robots: { index: false } };

export default async function QuotePage({ params }: PageProps<"/s/[slug]/quote">) {
  const { slug } = await params;
  const site = await publicSite(slug);
  if (!site?.live) return null;
  return (
    <section className="zs-section">
      <div className="zs-container">
        <p className="zs-eyebrow">Request a quote</p>
        <h1 className="zs-h2 mb-8">Your quote</h1>
        {site.features.addToQuote ? (
          <QuoteCart slug={slug} action={sendEnquiry.bind(null, slug)} />
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
