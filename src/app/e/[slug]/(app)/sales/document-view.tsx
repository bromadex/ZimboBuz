import Link from "next/link";
import { ActivityPanel, Connections } from "@/components/record-panel";
import { Badge, Button, Card, DocStatusBadge, Facts, Field, Notice, PageHeader, RecordLayout, SelectField, TextArea } from "@/components/ui";
import { CURRENCY_OPTIONS, currencyLabel, formatDate, formatQuantity, money } from "@/lib/format";
import type { CompanyContext } from "@/server/company";
import { addLine, amendDocument, cancelDocument, convertQuote, removeLine, submitDocument, updateHeader, type DocKind } from "./actions";
import type { DocHeader, DocLine } from "./data";

// Quote and invoice record page (P8) with the document lifecycle (P13).

const TAX_LABEL: Record<string, string> = { standard: "VAT", zero_rated: "Zero-rated", exempt: "Exempt" };

export function PaymentStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return status === "paid" ? <Badge tone="ok">Paid</Badge> : status === "partly_paid" ? <Badge tone="info">Partly paid</Badge> : <Badge tone="warn">Unpaid</Badge>;
}

export function DocumentView({
  ctx,
  slug,
  kind,
  header: h,
  lines,
  customers,
  products,
  payments,
  sp,
}: {
  ctx: CompanyContext;
  slug: string;
  kind: DocKind;
  header: DocHeader;
  lines: DocLine[];
  customers: Array<{ id: string; name: string }>;
  products: Array<{ id: string; sku: string; name: string }>;
  payments?: Array<{ id: string; number: string | null; received_on: string; method: string; amount_cents: string; currency: string; applied_cents: string | null }>;
  sp: Record<string, string | string[] | undefined>;
}) {
  const quote = kind === "quote";
  const noun = quote ? "Quote" : "Invoice";
  const base = quote ? "/sales/quotes" : "/sales/invoices";
  const back = `${base}/${h.id}`;
  const draft = h.docstatus === 0;
  const can = (p: string) => ctx.permissions.has(p);
  const canEdit = can(quote ? "sales.quote.create" : "sales.invoice.create");
  const canSubmit = can(quote ? "sales.quote.create" : "sales.invoice.submit");
  const canCancel = can(quote ? "sales.quote.create" : "sales.invoice.cancel");
  const cur = h.currency.trim();
  const editable = draft && canEdit;

  return (
    <>
      <PageHeader
        title={h.number ? `${noun} ${h.number}` : `Draft ${noun.toLowerCase()}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <DocStatusBadge status={h.docstatus} />
            {!quote && h.docstatus === 1 ? <PaymentStatusBadge status={h.payment_status} /> : null}
            <Link className="underline" href={`/customers/${h.customer_id}`}>
              {h.customer_name}
            </Link>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {h.docstatus === 1 ? (
              <a href={`/print/${quote ? "quotes" : "invoices"}/${h.id}`} target="_blank" className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
                Print or save PDF
              </a>
            ) : null}
            {!quote && h.docstatus === 1 && h.payment_status !== "paid" && can("sales.payment.record") ? (
              <Link href={`/sales/payments/new?customer=${h.customer_id}&invoice=${h.id}`} className="rounded-[var(--radius)] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">
                Record payment
              </Link>
            ) : null}
            {quote && h.docstatus === 1 && can("sales.invoice.create") ? (
              <form action={convertQuote.bind(null, slug, h.id)}>
                <Button type="submit">Make invoice</Button>
              </form>
            ) : null}
          </div>
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <RecordLayout side={<ActivityPanel ctx={ctx} slug={slug} doctype={quote ? "quote" : "sales_invoice"} recordId={h.id} back={back} />}>
        <Connections ctx={ctx} doctype={quote ? "quote" : "sales_invoice"} recordId={h.id} />
        {h.docstatus === 2 ? (
          <p className="rounded-[var(--radius)] border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            Cancelled: {h.cancel_reason}
          </p>
        ) : null}
        {h.amended_from ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This replaces a cancelled {noun.toLowerCase()}.{" "}
            <Link className="underline" href={`${base}/${h.amended_from}`}>
              See the original
            </Link>
          </p>
        ) : null}

        <Card>
          <Facts
            items={[
              ["Customer", h.customer_name],
              ["Currency", currencyLabel(cur)],
              [quote ? "Date" : "Invoice date", formatDate(h.doc_date)],
              [quote ? "Valid until" : "Due", h.second_date ? formatDate(h.second_date) : "—"],
              ["Branch", h.branch_name],
              ...(!quote && h.exchange_rate && cur !== ctx.company.baseCurrency
                ? ([["Rate used", `1 ${currencyLabel(ctx.company.baseCurrency)} = ${Number(h.exchange_rate)} ${currencyLabel(cur)}`]] as Array<[string, string]>)
                : []),
              ...(!quote && h.docstatus === 1
                ? ([
                    ["Paid", money(h.paid_cents, cur)],
                    ["Still owed", money(h.balance_cents, cur)],
                  ] as Array<[string, string]>)
                : []),
            ]}
          />
          {h.notes ? <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">{h.notes}</p> : null}
        </Card>

        <Card title="Items">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Price</th>
                  <th className="py-2 pr-3 text-right">Discount</th>
                  <th className="py-2 pr-3">VAT</th>
                  <th className="py-2 text-right">Total</th>
                  {editable ? <th className="py-2" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-3">
                      {l.description}
                      {l.sku ? <span className="block font-mono text-xs text-zinc-500">{l.sku}</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatQuantity(l.quantity)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{money(l.unit_price_cents, cur)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{Number(l.discount_cents) ? money(l.discount_cents, cur) : "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{l.tax_rate_bp ? `VAT ${l.tax_rate_bp / 100}%` : l.tax_code === "standard" ? "—" : TAX_LABEL[l.tax_code]}</td>
                    <td className="py-2 text-right tabular-nums whitespace-nowrap">{money(l.total_cents, cur)}</td>
                    {editable ? (
                      <td className="py-2 pl-2 text-right">
                        <form action={removeLine.bind(null, slug, kind, h.id)}>
                          <input type="hidden" name="line_id" value={l.id} />
                          <button type="submit" className="text-xs font-semibold text-zinc-500 hover:text-red-700" aria-label={`Remove ${l.description}`}>
                            Remove
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-zinc-500">
                      No items yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot className="text-sm">
                <tr>
                  <td colSpan={5} className="pt-3 text-right text-zinc-500">
                    Before VAT
                  </td>
                  <td className="pt-3 text-right tabular-nums">{money(h.subtotal_cents, cur)}</td>
                </tr>
                <tr>
                  <td colSpan={5} className="text-right text-zinc-500">
                    VAT
                  </td>
                  <td className="text-right tabular-nums">{money(h.tax_cents, cur)}</td>
                </tr>
                <tr className="text-base font-bold">
                  <td colSpan={5} className="text-right">
                    Total
                  </td>
                  <td className="text-right tabular-nums">{money(h.total_cents, cur)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {!ctx.company.vatRegistered ? <p className="mt-2 text-xs text-zinc-500">Your company is not VAT-registered, so no VAT is charged.</p> : null}

          {editable ? (
            <form action={addLine.bind(null, slug, kind, h.id)} className="mt-5 grid gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-6 dark:border-zinc-800">
              <div className="sm:col-span-3">
                <SelectField
                  label="Product"
                  name="product_id"
                  defaultValue=""
                  options={[{ value: "", label: "— Type a description instead —" }, ...products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))]}
                />
              </div>
              <div className="sm:col-span-3">
                <Field label="Description" name="description" placeholder="Optional for products" />
              </div>
              <div className="sm:col-span-2">
                <Field label="Quantity" name="quantity" defaultValue="1" inputMode="decimal" required />
              </div>
              <div className="sm:col-span-2">
                <Field label={`Price (${currencyLabel(cur)})`} name="unit_price" inputMode="decimal" hint="Empty: the product's price" />
              </div>
              <div className="sm:col-span-2">
                <Field label="Discount" name="discount" inputMode="decimal" placeholder="0.00" />
              </div>
              <div className="sm:col-span-6">
                <Button type="submit" variant="secondary">
                  Add line
                </Button>
              </div>
            </form>
          ) : null}
        </Card>

        {payments && payments.length ? (
          <Card title="Payments">
            <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2">
                  <Link className="underline" href={`/sales/payments/${p.id}`}>
                    {p.number} · {formatDate(p.received_on)} · {p.method.replace("_", " ")}
                  </Link>
                  <span className="tabular-nums">{money(p.applied_cents, cur)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {editable ? (
          <Card title="Details">
            <form action={updateHeader.bind(null, slug, kind, h.id)} className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Customer" name="customer_id" defaultValue={h.customer_id} options={customers.map((c) => ({ value: c.id, label: c.name }))} />
              <SelectField label="Currency" name="currency" defaultValue={cur} options={CURRENCY_OPTIONS} />
              {quote ? (
                <Field label="Valid until" name="valid_until" type="date" defaultValue={h.second_date ?? ""} />
              ) : (
                <>
                  <Field label="Invoice date" name="invoice_date" type="date" defaultValue={h.doc_date} required />
                  <Field label="Due date" name="due_date" type="date" defaultValue={h.second_date ?? ""} />
                </>
              )}
              <div className="sm:col-span-2">
                <TextArea label="Notes for the customer" name="notes" defaultValue={h.notes ?? ""} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" variant="secondary">
                  Save details
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-start gap-4">
          {draft && canSubmit ? (
            <form action={submitDocument.bind(null, slug, kind, h.id)}>
              <Button type="submit">Submit {noun.toLowerCase()}</Button>
              <p className="mt-1 max-w-xs text-xs text-zinc-500">
                {quote ? "Gives it a number and locks it." : "Gives it a number, locks it, records the sale and takes the items out of stock."}
              </p>
            </form>
          ) : null}
          {h.docstatus === 1 && canCancel ? (
            <details className="rounded-[var(--radius)] border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <summary className="cursor-pointer font-semibold text-red-700">Cancel this {noun.toLowerCase()}</summary>
              <form action={cancelDocument.bind(null, slug, kind, h.id)} className="mt-3 space-y-2">
                <Field label="Reason" name="reason" required />
                <Button type="submit" variant="secondary">
                  Cancel {noun.toLowerCase()}
                </Button>
              </form>
            </details>
          ) : null}
          {h.docstatus === 2 && canEdit ? (
            <form action={amendDocument.bind(null, slug, kind, h.id)}>
              <Button type="submit" variant="secondary">
                Amend (make a corrected copy)
              </Button>
            </form>
          ) : null}
        </div>
      </RecordLayout>
    </>
  );
}
