import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate, formatQuantity, money } from "@/lib/format";

// A quote or invoice as the customer sees it in the portal.

export interface PortalDocument {
  kind: "quote" | "invoice";
  id: string;
  number: string;
  date: string;
  valid_until?: string | null;
  due_date?: string | null;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents?: number;
  balance_cents?: number;
  notes: string | null;
  expired?: boolean;
  accepted_at?: string | null;
  lines: Array<{ description: string; quantity: number; unit_price_cents: number; discount_cents: number; total_cents: number }>;
}

export function DocumentView({ doc, companyName, notice, children }: { doc: PortalDocument; companyName: string; notice?: ReactNode; children?: ReactNode }) {
  const c = doc.currency.trim();
  return (
    <section className="zs-section" style={{ paddingTop: "2.5rem" }}>
      <div className="zs-container" style={{ maxWidth: "56rem" }}>
        <Link href={`/account?tab=${doc.kind === "quote" ? "quotes" : "invoices"}`} className="zs-link text-sm">
          ← Back to my account
        </Link>
        {notice}
        <div className="zs-card mt-4 p-5 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="zs-eyebrow">{doc.kind === "quote" ? "Quote" : "Invoice"}</p>
              <h1 className="zs-h2">{doc.number}</h1>
              <p className="zs-muted mt-1">From {companyName}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="zs-muted">Date</dt>
              <dd>{formatDate(doc.date)}</dd>
              {doc.kind === "quote" ? (
                <>
                  <dt className="zs-muted">Valid until</dt>
                  <dd>{formatDate(doc.valid_until)}</dd>
                </>
              ) : (
                <>
                  <dt className="zs-muted">Due</dt>
                  <dd>{formatDate(doc.due_date)}</dd>
                </>
              )}
            </dl>
          </div>
          <div className="zs-scroll mt-6">
            <table className="zs-table">
              <thead>
                <tr><th>Item</th><th className="num">Quantity</th><th className="num">Price</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {doc.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.description}</td>
                    <td className="num">{formatQuantity(l.quantity)}</td>
                    <td className="num">{money(l.unit_price_cents, c)}</td>
                    <td className="num">{money(l.total_cents, c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto mt-4 grid max-w-xs grid-cols-2 gap-y-1 text-sm">
            <dt className="zs-muted">Before VAT</dt>
            <dd className="text-right">{money(doc.subtotal_cents, c)}</dd>
            <dt className="zs-muted">VAT</dt>
            <dd className="text-right">{money(doc.tax_cents, c)}</dd>
            <dt className="font-bold">Total</dt>
            <dd className="zs-price text-right">{money(doc.total_cents, c)}</dd>
            {doc.kind === "invoice" ? (
              <>
                <dt className="zs-muted">Paid</dt>
                <dd className="text-right">{money(doc.paid_cents ?? 0, c)}</dd>
                <dt className="font-bold">Still to pay</dt>
                <dd className="zs-price text-right">{money(doc.balance_cents ?? 0, c)}</dd>
              </>
            ) : null}
          </dl>
          {doc.notes ? <p className="zs-muted mt-6 whitespace-pre-line text-sm">{doc.notes}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}
