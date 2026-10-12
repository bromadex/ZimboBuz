import { notFound } from "next/navigation";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { loadDocument, loadPickers } from "../../data";
import { DocumentView } from "../../document-view";

export default async function InvoicePage({ params, searchParams }: PageProps<"/e/[slug]/sales/invoices/[id]">) {
  const { slug, id } = await params;
  const ctx = await requirePermission(slug, "sales.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withUser(ctx.userId, async (q) => {
    const doc = await loadDocument(q, ctx, "invoice", id);
    const payments = doc
      ? (
          await q<{ id: string; number: string | null; received_on: string; method: string; amount_cents: string; currency: string; applied_cents: string | null }>(
            `select p.id, p.number, to_char(p.received_on, 'YYYY-MM-DD') as received_on, p.method, p.amount_cents, p.currency, a.applied_cents
             from public.payment_allocations a join public.payments p on p.id = a.payment_id
             where a.invoice_id = $1 and p.docstatus = 1 order by p.received_on`,
            [id],
          )
        ).rows
      : [];
    return { doc, payments };
  });
  if (!data.doc) notFound();
  const pickers = data.doc.header.docstatus === 0 ? await loadPickers(ctx) : { customers: [], products: [] };
  return (
    <DocumentView
      ctx={ctx}
      slug={slug}
      kind="invoice"
      header={data.doc.header}
      lines={data.doc.lines}
      customers={pickers.customers}
      products={pickers.products}
      payments={data.payments}
      sp={await searchParams}
    />
  );
}
