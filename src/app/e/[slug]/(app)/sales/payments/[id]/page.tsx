import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityPanel, Connections } from "@/components/record-panel";
import { Button, Card, DocStatusBadge, Facts, Field, Notice, PageHeader, RecordLayout } from "@/components/ui";
import { currencyLabel, formatDate, money } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { cancelPayment } from "../../actions";
import { METHOD_LABEL } from "../../labels";

export default async function PaymentPage({ params, searchParams }: PageProps<"/e/[slug]/sales/payments/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "sales.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withUser(ctx.userId, async (q) => {
    const p = (
      await q<{
        id: string; number: string | null; docstatus: number; customer_id: string; customer_name: string; currency: string; amount_cents: string;
        method: string; reference: string | null; received_on: string; exchange_rate: string | null; cancel_reason: string | null; notes: string | null;
      }>(
        `select p.id, p.number, p.docstatus, p.customer_id, c.name as customer_name, p.currency, p.amount_cents, p.method, p.reference,
                to_char(p.received_on, 'YYYY-MM-DD') as received_on, p.exchange_rate, p.cancel_reason, p.notes
         from public.payments p join public.customers c on c.id = p.customer_id where p.company_id = $1 and p.id = $2`,
        [ctx.company.id, id],
      )
    ).rows[0];
    const allocations = p
      ? (
          await q<{ invoice_id: string; number: string; currency: string; amount_cents: string; applied_cents: string | null }>(
            `select a.invoice_id, i.number, i.currency, a.amount_cents, a.applied_cents
             from public.payment_allocations a join public.sales_invoices i on i.id = a.invoice_id where a.payment_id = $1`,
            [id],
          )
        ).rows
      : [];
    return { p, allocations };
  });
  if (!data.p) notFound();
  const p = data.p;
  const cur = p.currency.trim();
  const allocated = data.allocations.reduce((s, a) => s + Number(a.amount_cents), 0);
  const canCancel = p.docstatus === 1 && ctx.permissions.has("sales.invoice.cancel");

  return (
    <>
      <PageHeader
        title={p.number ? `Payment ${p.number}` : "Draft payment"}
        description={
          <span className="flex items-center gap-2">
            <DocStatusBadge status={p.docstatus} />
            <Link className="underline" href={`/customers/${p.customer_id}`}>
              {p.customer_name}
            </Link>
          </span>
        }
        actions={
          p.docstatus === 1 ? (
            <a href={`/print/payments/${p.id}`} target="_blank" className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
              Print receipt
            </a>
          ) : null
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <RecordLayout side={<ActivityPanel ctx={ctx} slug={slug} doctype="payment" recordId={id} back={`/sales/payments/${id}`} />}>
        <Connections ctx={ctx} doctype="payment" recordId={id} />
        {p.docstatus === 2 ? <p className="rounded-[var(--radius)] border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">Cancelled: {p.cancel_reason}</p> : null}
        <Card>
          <Facts
            items={[
              ["Amount", money(p.amount_cents, cur)],
              ["Method", METHOD_LABEL[p.method]],
              ["Received", formatDate(p.received_on)],
              ["Reference", p.reference ?? "—"],
              ...(p.exchange_rate && cur !== ctx.company.baseCurrency
                ? ([["Rate used", `1 ${currencyLabel(ctx.company.baseCurrency)} = ${Number(p.exchange_rate)} ${currencyLabel(cur)}`]] as Array<[string, string]>)
                : []),
              ["Kept as credit", money(Number(p.amount_cents) - allocated, cur)],
            ]}
          />
        </Card>
        <Card title="Invoices paid">
          {data.allocations.length === 0 ? (
            <p className="text-sm text-zinc-500">Not put against any invoice; kept as the customer&apos;s credit.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              {data.allocations.map((a) => (
                <li key={a.invoice_id} className="flex justify-between gap-3 py-2">
                  <Link className="underline" href={`/sales/invoices/${a.invoice_id}`}>
                    {a.number}
                  </Link>
                  <span className="tabular-nums">
                    {money(a.amount_cents, cur)}
                    {a.currency.trim() !== cur && a.applied_cents ? ` = ${money(a.applied_cents, a.currency)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canCancel ? (
          <details className="rounded-[var(--radius)] border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <summary className="cursor-pointer font-semibold text-red-700">Cancel this payment</summary>
            <form action={cancelPayment.bind(null, slug, id)} className="mt-3 space-y-2">
              <Field label="Reason" name="reason" required />
              <Button type="submit" variant="secondary">
                Cancel payment
              </Button>
            </form>
          </details>
        ) : null}
      </RecordLayout>
    </>
  );
}
