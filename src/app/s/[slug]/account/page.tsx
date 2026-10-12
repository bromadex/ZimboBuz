import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDate, money } from "@/lib/format";
import { currentPortalUser, portalQuery } from "@/server/web/portal";

// Customer portal home (P19): the signed-in customer's own invoices, quotes,
// payments and statement. Everything comes through the portal_* functions.

const TABS = [
  { key: "invoices", label: "Invoices" },
  { key: "quotes", label: "Quotes" },
  { key: "payments", label: "Payments" },
  { key: "statement", label: "Statement" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const METHODS: Record<string, string> = {
  cash: "Cash", ecocash: "EcoCash", onemoney: "OneMoney", innbucks: "InnBucks", card: "Card",
  bank_transfer: "Bank transfer", zipit: "ZIPIT", store_credit: "Store credit", other: "Other",
};

type Invoice = { id: string; number: string; invoice_date: string; due_date: string | null; currency: string; total_cents: string; paid_cents: string; balance_cents: string };
type Quote = { id: string; number: string; quote_date: string; valid_until: string | null; currency: string; total_cents: string; accepted_at: Date | null };
type Payment = { id: string; number: string; received_on: string; currency: string; amount_cents: string; method: string; reference: string | null };
type Entry = { entry_date: string; kind: string; number: string; currency: string; debit_cents: string; credit_cents: string; balance_cents: string };

const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? ""));

export default async function PortalHome({ params, searchParams }: PageProps<"/s/[slug]/account">) {
  const { slug } = await params;
  const sp = await searchParams;
  const me = await currentPortalUser(slug);
  if (!me) redirect("/account/sign-in");
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "invoices";

  const [invoices, quotes] = await Promise.all([
    portalQuery<Invoice>(me.userId, "select * from public.portal_invoices($1)", [slug]),
    portalQuery<Quote>(me.userId, "select * from public.portal_quotes($1)", [slug]),
  ]);
  const payments = tab === "payments" ? await portalQuery<Payment>(me.userId, "select * from public.portal_payments($1)", [slug]) : [];
  const statement = tab === "statement" ? await portalQuery<Entry>(me.userId, "select * from public.portal_statement($1)", [slug]) : [];

  const owed = new Map<string, bigint>();
  for (const i of invoices) owed.set(i.currency.trim(), (owed.get(i.currency.trim()) ?? BigInt(0)) + BigInt(i.balance_cents));
  const owedText = [...owed].filter(([, v]) => v !== BigInt(0)).map(([c, v]) => money(v, c));
  const openQuotes = quotes.filter((q) => !q.accepted_at && (!q.valid_until || iso(q.valid_until) >= new Date().toISOString().slice(0, 10))).length;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="zs-section" style={{ paddingTop: "2.5rem" }}>
      <div className="zs-container">
        <p className="zs-eyebrow">My account</p>
        <h1 className="zs-h2">Hello, {me.customerName}</h1>
        <p className="zs-muted mt-2">Your account with {me.companyName}.</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="zs-card p-5">
            <p className="zs-muted text-sm">You owe</p>
            <p className="zs-price mt-1" style={{ fontSize: "1.5rem" }}>{owedText.length ? owedText.join(" · ") : "Nothing"}</p>
          </div>
          <div className="zs-card p-5">
            <p className="zs-muted text-sm">Quotes waiting for you</p>
            <p className="zs-price mt-1" style={{ fontSize: "1.5rem" }}>{openQuotes}</p>
          </div>
          <div className="zs-card p-5">
            <p className="zs-muted text-sm">Invoices</p>
            <p className="zs-price mt-1" style={{ fontSize: "1.5rem" }}>{invoices.length}</p>
          </div>
        </div>

        <nav className="mt-10 flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }} aria-label="Account sections">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/account?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className="whitespace-nowrap px-4 py-2.5 text-sm font-semibold"
              style={{
                textDecoration: "none",
                borderBottom: `3px solid ${tab === t.key ? "var(--brand)" : "transparent"}`,
                color: tab === t.key ? "var(--fg)" : "var(--muted)",
              }}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="zs-card zs-scroll mt-4">
          {tab === "invoices" ? (
            <table className="zs-table">
              <thead>
                <tr><th>Invoice</th><th>Date</th><th>Due</th><th className="num">Total</th><th className="num">Still to pay</th></tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td><Link className="zs-link" href={`/account/invoices/${i.id}`}>{i.number}</Link></td>
                    <td>{formatDate(i.invoice_date)}</td>
                    <td>
                      {formatDate(i.due_date)}
                      {i.due_date && iso(i.due_date) < today && BigInt(i.balance_cents) > BigInt(0) ? <> <span className="zs-badge zs-badge-warn">Overdue</span></> : null}
                    </td>
                    <td className="num">{money(i.total_cents, i.currency)}</td>
                    <td className="num">{BigInt(i.balance_cents) === BigInt(0) ? <span className="zs-badge zs-badge-ok">Paid</span> : money(i.balance_cents, i.currency)}</td>
                  </tr>
                ))}
                {invoices.length === 0 ? <tr><td colSpan={5} className="zs-muted">No invoices yet.</td></tr> : null}
              </tbody>
            </table>
          ) : null}
          {tab === "quotes" ? (
            <table className="zs-table">
              <thead>
                <tr><th>Quote</th><th>Date</th><th>Valid until</th><th className="num">Total</th><th>Status</th></tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id}>
                    <td><Link className="zs-link" href={`/account/quotes/${q.id}`}>{q.number}</Link></td>
                    <td>{formatDate(q.quote_date)}</td>
                    <td>{formatDate(q.valid_until)}</td>
                    <td className="num">{money(q.total_cents, q.currency)}</td>
                    <td>
                      {q.accepted_at ? (
                        <span className="zs-badge zs-badge-ok">Accepted</span>
                      ) : q.valid_until && iso(q.valid_until) < today ? (
                        <span className="zs-badge">Expired</span>
                      ) : (
                        <span className="zs-badge zs-badge-warn">Waiting for you</span>
                      )}
                    </td>
                  </tr>
                ))}
                {quotes.length === 0 ? <tr><td colSpan={5} className="zs-muted">No quotes yet.</td></tr> : null}
              </tbody>
            </table>
          ) : null}
          {tab === "payments" ? (
            <table className="zs-table">
              <thead>
                <tr><th>Receipt</th><th>Date</th><th>Method</th><th>Reference</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.number}</td>
                    <td>{formatDate(p.received_on)}</td>
                    <td>{METHODS[p.method] ?? p.method}</td>
                    <td>{p.reference ?? "—"}</td>
                    <td className="num">{money(p.amount_cents, p.currency)}</td>
                  </tr>
                ))}
                {payments.length === 0 ? <tr><td colSpan={5} className="zs-muted">No payments yet.</td></tr> : null}
              </tbody>
            </table>
          ) : null}
          {tab === "statement" ? (
            <table className="zs-table">
              <thead>
                <tr><th>Date</th><th>Details</th><th className="num">Charged</th><th className="num">Paid</th><th className="num">Balance</th></tr>
              </thead>
              <tbody>
                {statement.map((e, i) => (
                  <tr key={i}>
                    <td>{formatDate(e.entry_date)}</td>
                    <td>{e.kind === "invoice" ? "Invoice" : "Payment"} {e.number}</td>
                    <td className="num">{e.debit_cents !== "0" ? money(e.debit_cents, e.currency) : ""}</td>
                    <td className="num">{e.credit_cents !== "0" ? money(e.credit_cents, e.currency) : ""}</td>
                    <td className="num"><strong>{money(e.balance_cents, e.currency)}</strong></td>
                  </tr>
                ))}
                {statement.length === 0 ? <tr><td colSpan={5} className="zs-muted">Nothing on your statement yet.</td></tr> : null}
              </tbody>
            </table>
          ) : null}
        </div>
        {tab === "statement" && statement.length ? (
          <p className="zs-muted mt-3 text-sm">Each currency has its own running balance. Payments are shown in the currency you paid in.</p>
        ) : null}
      </div>
    </section>
  );
}
