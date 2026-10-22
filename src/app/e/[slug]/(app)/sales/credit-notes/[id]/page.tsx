import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityPanel, Connections } from "@/components/record-panel";
import { Button, Card, DocStatusBadge, Facts, Field, Notice, PageHeader, RecordLayout } from "@/components/ui";
import { formatDate, formatQuantity, money } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { cancelCreditNote } from "../../credit-actions";

export default async function CreditNotePage({ params, searchParams }: PageProps<"/e/[slug]/sales/credit-notes/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "sales.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withUser(ctx.userId, async (q) => {
    const cn = (
      await q<{ number: string; docstatus: number; customer_id: string; customer_name: string; invoice_id: string; invoice_number: string; currency: string; credit_date: string; reason: string; return_stock: boolean; subtotal_cents: string; tax_cents: string; total_cents: string; applied_cents: string | null; cancel_reason: string | null }>(
        `select c.number, c.docstatus, c.customer_id, cu.name as customer_name, c.invoice_id, i.number as invoice_number, c.currency,
                to_char(c.credit_date, 'YYYY-MM-DD') as credit_date, c.reason, c.return_stock, c.subtotal_cents, c.tax_cents, c.total_cents,
                c.applied_cents, c.cancel_reason
         from public.credit_notes c join public.customers cu on cu.id = c.customer_id join public.sales_invoices i on i.id = c.invoice_id
         where c.company_id = $1 and c.id = $2`,
        [ctx.company.id, id],
      )
    ).rows[0];
    const lines = (
      await q<{ id: string; description: string; quantity: string; unit_price_cents: string; total_cents: string }>(
        "select id, description, quantity, unit_price_cents, total_cents from public.credit_note_lines where credit_note_id = $1 order by line_no",
        [id],
      )
    ).rows;
    const credit = cn ? (await q<{ c: string }>("select app.customer_credit_cents($1, $2, $3) as c", [ctx.company.id, cn.customer_id, cn.currency])).rows[0].c : "0";
    return { cn, lines, credit };
  });
  if (!data.cn) notFound();
  const { cn } = data;
  const cur = cn.currency.trim();
  const toCredit = Number(cn.total_cents) - Number(cn.applied_cents ?? 0);
  const canRefund = cn.docstatus === 1 && Number(data.credit) > 0 && (ctx.permissions.has("sales.payment.record") || ctx.permissions.has("pos.refund"));

  return (
    <>
      <PageHeader
        title={`Credit note ${cn.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <DocStatusBadge status={cn.docstatus} />
            <Link className="underline" href={`/customers/${cn.customer_id}`}>
              {cn.customer_name}
            </Link>
            · for invoice
            <Link className="underline" href={`/sales/invoices/${cn.invoice_id}`}>
              {cn.invoice_number}
            </Link>
          </span>
        }
        actions={
          <div className="flex gap-2">
            {cn.docstatus === 1 ? (
              <a href={`/print/credit-notes/${id}`} target="_blank" className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
                Print or save PDF
              </a>
            ) : null}
            {canRefund ? (
              <Link href={`/sales/refunds/new?customer=${cn.customer_id}&credit_note=${id}&currency=${cur}`} className="rounded-[var(--radius)] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">
                Refund the customer
              </Link>
            ) : null}
          </div>
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <RecordLayout side={<ActivityPanel ctx={ctx} slug={slug} doctype="credit_note" recordId={id} back={`/sales/credit-notes/${id}`} />}>
        <Connections ctx={ctx} doctype="credit_note" recordId={id} />
        {cn.docstatus === 2 ? <p className="rounded-[var(--radius)] border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">Cancelled: {cn.cancel_reason}</p> : null}
        <Card>
          <Facts
            items={[
              ["Date", formatDate(cn.credit_date)],
              ["Reason", cn.reason],
              ["Total", money(cn.total_cents, cur)],
              ["Taken off the invoice", money(cn.applied_cents ?? 0, cur)],
              ["Became customer credit", money(toCredit, cur)],
              ["Goods returned to stock", cn.return_stock ? "Yes" : "No"],
              ["Customer credit now", money(data.credit, cur)],
            ]}
          />
        </Card>
        <Card title="Items">
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {data.lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 py-2">
                <span>
                  {formatQuantity(l.quantity)} × {l.description} at {money(l.unit_price_cents, cur)}
                </span>
                <span className="tabular-nums">{money(l.total_cents, cur)}</span>
              </li>
            ))}
          </ul>
        </Card>
        {cn.docstatus === 1 && ctx.permissions.has("sales.invoice.cancel") ? (
          <details className="rounded-[var(--radius)] border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <summary className="cursor-pointer font-semibold text-red-700">Cancel this credit note</summary>
            <form action={cancelCreditNote.bind(null, slug, id)} className="mt-3 space-y-2">
              <Field label="Reason" name="reason" required />
              <Button type="submit" variant="secondary">
                Cancel credit note
              </Button>
            </form>
          </details>
        ) : null}
      </RecordLayout>
    </>
  );
}
