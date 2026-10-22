import { notFound } from "next/navigation";
import { currencyLabel, formatDate, formatQuantity, money } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { loadDocument } from "../../../(app)/sales/data";
import { METHOD_LABEL } from "../../../(app)/sales/labels";
import { Letterhead } from "../../letterhead";

// Printable quote, tax invoice and payment receipt.

export default async function PrintDocument({ params }: PageProps<"/e/[slug]/print/[kind]/[id]">) {
  const { slug, kind, id } = await params;
  const ctx = await requirePermission(slug, "sales.view");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["quotes", "invoices", "payments", "credit-notes"].includes(kind)) notFound();

  if (kind === "credit-notes") {
    const data = await withUser(ctx.userId, async (q) => {
      const c = (
        await q<{ number: string; docstatus: number; customer_name: string; invoice_number: string; currency: string; credit_date: string; reason: string; subtotal_cents: string; tax_cents: string; total_cents: string }>(
          `select c.number, c.docstatus, cu.name as customer_name, i.number as invoice_number, c.currency, to_char(c.credit_date, 'YYYY-MM-DD') as credit_date,
                  c.reason, c.subtotal_cents, c.tax_cents, c.total_cents
           from public.credit_notes c join public.customers cu on cu.id = c.customer_id join public.sales_invoices i on i.id = c.invoice_id
           where c.company_id = $1 and c.id = $2`,
          [ctx.company.id, id],
        )
      ).rows[0];
      const lines = (
        await q<{ id: string; description: string; quantity: string; unit_price_cents: string; tax_rate_bp: number; total_cents: string }>(
          "select id, description, quantity, unit_price_cents, tax_rate_bp, total_cents from public.credit_note_lines where credit_note_id = $1 order by line_no",
          [id],
        )
      ).rows;
      return { c, lines };
    });
    if (!data.c || data.c.docstatus !== 1) notFound();
    const c = data.c;
    const cur = c.currency.trim();
    return (
      <Letterhead ctx={ctx} title="Credit note" number={c.number}>
        <div className="mb-6 flex justify-between text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">For</p>
            <p className="font-semibold">{c.customer_name}</p>
          </div>
          <div className="text-right">
            <p>Date: {formatDate(c.credit_date)}</p>
            <p>Against invoice {c.invoice_number}</p>
            <p>Reason: {c.reason}</p>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b-2 border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit price</th>
              <th className="py-2 text-right">VAT</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {data.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2">{l.description}</td>
                <td className="py-2 text-right tabular-nums">{formatQuantity(l.quantity)}</td>
                <td className="py-2 text-right tabular-nums">{money(l.unit_price_cents, cur)}</td>
                <td className="py-2 text-right">{l.tax_rate_bp ? `${l.tax_rate_bp / 100}%` : "—"}</td>
                <td className="py-2 text-right tabular-nums">{money(l.total_cents, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 ml-auto w-64 space-y-1 text-sm">
          <p className="flex justify-between"><span>Before VAT</span><span className="tabular-nums">{money(c.subtotal_cents, cur)}</span></p>
          <p className="flex justify-between"><span>VAT</span><span className="tabular-nums">{money(c.tax_cents, cur)}</span></p>
          <p className="flex justify-between border-t-2 border-zinc-900 pt-1 text-base font-bold"><span>Total credited</span><span className="tabular-nums">{money(c.total_cents, cur)}</span></p>
        </div>
      </Letterhead>
    );
  }

  if (kind === "payments") {
    const data = await withUser(ctx.userId, async (q) => {
      const p = (
        await q<{ number: string | null; docstatus: number; customer_name: string; currency: string; amount_cents: string; method: string; reference: string | null; received_on: string }>(
          `select p.number, p.docstatus, c.name as customer_name, p.currency, p.amount_cents, p.method, p.reference, to_char(p.received_on, 'YYYY-MM-DD') as received_on
           from public.payments p join public.customers c on c.id = p.customer_id where p.company_id = $1 and p.id = $2`,
          [ctx.company.id, id],
        )
      ).rows[0];
      const allocations = (
        await q<{ number: string; amount_cents: string }>(
          "select i.number, a.amount_cents from public.payment_allocations a join public.sales_invoices i on i.id = a.invoice_id where a.payment_id = $1",
          [id],
        )
      ).rows;
      return { p, allocations };
    });
    if (!data.p || data.p.docstatus !== 1) notFound();
    const p = data.p;
    return (
      <Letterhead ctx={ctx} title="Receipt" number={p.number}>
        <p className="mb-6">
          Received from <strong>{p.customer_name}</strong> on {formatDate(p.received_on)}:
        </p>
        <p className="mb-6 text-4xl font-bold tabular-nums">{money(p.amount_cents, p.currency)}</p>
        <p>
          Paid by {METHOD_LABEL[p.method]}
          {p.reference ? `, reference ${p.reference}` : ""}.
        </p>
        {data.allocations.length ? <p className="mt-2">For invoice {data.allocations.map((a) => `${a.number} (${money(a.amount_cents, p.currency)})`).join(", ")}.</p> : null}
        <p className="mt-12 text-sm text-zinc-500">Thank you.</p>
      </Letterhead>
    );
  }

  const doc = await withUser(ctx.userId, (q) => loadDocument(q, ctx, kind === "quotes" ? "quote" : "invoice", id));
  if (!doc || doc.header.docstatus !== 1) notFound();
  const h = doc.header;
  const cur = h.currency.trim();
  const quote = kind === "quotes";
  const title = quote ? "Quotation" : ctx.company.vatRegistered ? "Tax invoice" : "Invoice";

  return (
    <Letterhead ctx={ctx} title={title} number={h.number}>
      <div className="mb-6 grid grid-cols-2 gap-6 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">{quote ? "For" : "Bill to"}</p>
          <p className="font-semibold">{h.customer_name}</p>
        </div>
        <div className="text-right">
          <p>
            {quote ? "Date" : "Invoice date"}: {formatDate(h.doc_date)}
          </p>
          {h.second_date ? (
            <p>
              {quote ? "Valid until" : "Due"}: {formatDate(h.second_date)}
            </p>
          ) : null}
          <p>Currency: {currencyLabel(cur)}</p>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b-2 border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Unit price</th>
            <th className="py-2 text-right">VAT</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {doc.lines.map((l) => (
            <tr key={l.id}>
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-right tabular-nums">{formatQuantity(l.quantity)}</td>
              <td className="py-2 text-right tabular-nums">{money(l.unit_price_cents, cur)}</td>
              <td className="py-2 text-right">{l.tax_rate_bp ? `${l.tax_rate_bp / 100}%` : "—"}</td>
              <td className="py-2 text-right tabular-nums">{money(l.total_cents, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 ml-auto w-64 space-y-1 text-sm">
        <p className="flex justify-between">
          <span>Before VAT</span>
          <span className="tabular-nums">{money(h.subtotal_cents, cur)}</span>
        </p>
        <p className="flex justify-between">
          <span>VAT</span>
          <span className="tabular-nums">{money(h.tax_cents, cur)}</span>
        </p>
        <p className="flex justify-between border-t-2 border-zinc-900 pt-1 text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{money(h.total_cents, cur)}</span>
        </p>
        {!quote && Number(h.paid_cents) > 0 ? (
          <>
            <p className="flex justify-between">
              <span>Paid</span>
              <span className="tabular-nums">{money(h.paid_cents, cur)}</span>
            </p>
            <p className="flex justify-between font-semibold">
              <span>Still to pay</span>
              <span className="tabular-nums">{money(h.balance_cents, cur)}</span>
            </p>
          </>
        ) : null}
      </div>
      {h.notes ? <p className="mt-8 whitespace-pre-wrap text-sm">{h.notes}</p> : null}
    </Letterhead>
  );
}
