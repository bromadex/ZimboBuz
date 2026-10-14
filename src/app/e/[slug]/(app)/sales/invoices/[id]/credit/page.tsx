import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, Field, Notice, PageHeader } from "@/components/ui";
import { formatQuantity, money } from "@/lib/format";
import { requireCompany } from "@/server/company";
import { withUser } from "@/server/data";
import { createCreditNote } from "../../../credit-actions";

// Credit or take back items from a submitted invoice (P8).

export default async function CreditInvoicePage({ params, searchParams }: PageProps<"/e/[slug]/sales/invoices/[id]/credit">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(slug);
  if (!(ctx.permissions.has("sales.invoice.cancel") || ctx.permissions.has("pos.refund"))) notFound();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withUser(ctx.userId, async (q) => {
    const inv = (
      await q<{ number: string; currency: string; docstatus: number; customer_name: string; balance_cents: string }>(
        `select i.number, i.currency, i.docstatus, c.name as customer_name, i.total_cents - app.invoice_paid_cents(i.id) as balance_cents
         from public.sales_invoices i join public.customers c on c.id = i.customer_id where i.company_id = $1 and i.id = $2`,
        [ctx.company.id, id],
      )
    ).rows[0];
    const lines = (
      await q<{ id: string; description: string; quantity: string; unit_price_cents: string; total_cents: string; credited: string; is_stock_item: boolean | null }>(
        `select l.id, l.description, l.quantity, l.unit_price_cents, l.total_cents, p.is_stock_item,
                coalesce((select sum(cl.quantity) from public.credit_note_lines cl join public.credit_notes cn on cn.id = cl.credit_note_id
                          where cl.invoice_line_id = l.id and cn.docstatus = 1), 0) as credited
         from public.sales_invoice_lines l left join public.products p on p.id = l.product_id
         where l.invoice_id = $1 order by l.line_no`,
        [id],
      )
    ).rows;
    return { inv, lines };
  });
  if (!data.inv || data.inv.docstatus !== 1) notFound();
  const { inv, lines } = data;
  const cur = inv.currency.trim();

  return (
    <>
      <PageHeader
        title={`Credit invoice ${inv.number}`}
        description={
          <>
            {inv.customer_name} · still owed {money(inv.balance_cents, cur)}.{" "}
            <Link className="underline" href={`/sales/invoices/${id}`}>
              Back to the invoice
            </Link>
          </>
        }
      />
      <Notice error={sp.error} />
      <Card className="max-w-3xl">
        <form action={createCreditNote.bind(null, slug, id)} className="space-y-5">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2">Item</th>
                <th className="py-2 text-right">Invoiced</th>
                <th className="py-2 text-right">Already credited</th>
                <th className="py-2 pl-3">Credit now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {lines.map((l) => {
                const left = Number(l.quantity) - Number(l.credited);
                return (
                  <tr key={l.id}>
                    <td className="py-2">
                      {l.description}
                      <span className="block text-xs text-zinc-500">{money(l.unit_price_cents, cur)} each</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatQuantity(l.quantity)}</td>
                    <td className="py-2 text-right tabular-nums">{Number(l.credited) ? formatQuantity(l.credited) : "—"}</td>
                    <td className="py-2 pl-3">
                      {left > 0 ? (
                        <input
                          name={`qty_${l.id}`}
                          inputMode="decimal"
                          placeholder={`up to ${formatQuantity(left)}`}
                          aria-label={`Quantity of ${l.description} to credit`}
                          className="w-28 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                        />
                      ) : (
                        <span className="text-xs text-zinc-500">All credited</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Field label="Reason" name="reason" required placeholder="Damaged, returned, wrong price…" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="return_stock" defaultChecked={lines.some((l) => l.is_stock_item)} />
            The goods came back: put them back into stock
          </label>
          <p className="text-xs text-zinc-500">
            The credit first reduces what is still owed on this invoice. Anything more becomes the customer&apos;s credit, which you can refund or use on later sales.
          </p>
          <Button type="submit">Make credit note</Button>
        </form>
      </Card>
    </>
  );
}
