import Link from "next/link";
import { Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { CURRENCY_OPTIONS, currencyLabel, formatDate, money, todayIso } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { recordPayment } from "../../actions";
import { loadPickers } from "../../data";
import { METHOD_LABEL } from "../../labels";

// Record a payment and say which invoices it pays (P8). Anything not put
// against an invoice stays as the customer's credit.

export default async function NewPaymentPage({ params, searchParams }: PageProps<"/e/[slug]/sales/payments/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "sales.payment.record");
  const { customers, branches } = await loadPickers(ctx);
  const customerId = typeof sp.customer === "string" && customers.some((c) => c.id === sp.customer) ? sp.customer : null;
  const invoiceId = typeof sp.invoice === "string" ? sp.invoice : null;
  const customer = customers.find((c) => c.id === customerId);

  const open = customerId
    ? await withUser(ctx.userId, async (q) =>
        (
          await q<{ id: string; number: string; currency: string; invoice_date: string; due_date: string | null; balance_cents: string }>(
            `select id, number, currency, to_char(invoice_date, 'YYYY-MM-DD') as invoice_date, to_char(due_date, 'YYYY-MM-DD') as due_date, balance_cents
             from public.sales_invoices_v where company_id = $1 and customer_id = $2 and docstatus = 1 and balance_cents > 0
             order by invoice_date, number`,
            [ctx.company.id, customerId],
          )
        ).rows,
      )
    : [];
  const preselected = open.find((i) => i.id === invoiceId);
  const currency = preselected?.currency.trim() ?? customer?.currency.trim() ?? ctx.company.baseCurrency;

  return (
    <>
      <PageHeader title="Record a payment" description="Choose the customer first to see what they owe." />
      <Notice error={sp.error} />
      <Card className="mb-4 max-w-3xl">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <SelectField label="Customer" name="customer" defaultValue={customerId ?? ""} options={[{ value: "", label: "Choose a customer" }, ...customers.map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
          <Button type="submit" variant="secondary">
            Show what they owe
          </Button>
        </form>
      </Card>

      {customerId ? (
        <Card className="max-w-3xl">
          <form action={recordPayment.bind(null, slug)} className="space-y-5">
            <input type="hidden" name="customer_id" value={customerId} />
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField label="Currency received" name="currency" defaultValue={currency} options={CURRENCY_OPTIONS} />
              <Field
                label="Amount received"
                name="amount"
                required
                inputMode="decimal"
                defaultValue={preselected && preselected.currency.trim() === currency ? (Number(preselected.balance_cents) / 100).toFixed(2) : ""}
              />
              <SelectField label="How they paid" name="method" defaultValue="cash" options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
              <Field label="Reference" name="reference" hint="Receipt, EcoCash or bank reference" />
              <Field label="Date received" name="received_on" type="date" defaultValue={todayIso()} />
              {branches.length > 1 ? <SelectField label="Branch" name="branch_id" options={branches.map((b) => ({ value: b.id, label: b.name }))} /> : null}
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Put it against these invoices</legend>
              {open.length === 0 ? (
                <p className="text-sm text-zinc-500">{customer?.name} owes nothing. The payment will be kept as their credit.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                      <tr>
                        <th className="py-2">Invoice</th>
                        <th className="py-2">Due</th>
                        <th className="py-2 text-right">Owed</th>
                        <th className="py-2 pl-3">Pay now (in the currency received)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {open.map((i) => (
                        <tr key={i.id}>
                          <td className="py-2">
                            <Link className="underline" href={`/sales/invoices/${i.id}`}>
                              {i.number}
                            </Link>{" "}
                            <span className="text-xs text-zinc-500">{formatDate(i.invoice_date)}</span>
                          </td>
                          <td className="py-2">{i.due_date ? formatDate(i.due_date) : "—"}</td>
                          <td className="py-2 text-right tabular-nums">{money(i.balance_cents, i.currency)}</td>
                          <td className="py-2 pl-3">
                            <input
                              name={`alloc_${i.id}`}
                              inputMode="decimal"
                              aria-label={`Amount for ${i.number}`}
                              defaultValue={i.id === invoiceId && i.currency.trim() === currency ? (Number(i.balance_cents) / 100).toFixed(2) : ""}
                              className="w-32 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-zinc-500">
                    Amounts are in the currency received ({currencyLabel(currency)} by default) and converted at today&apos;s rate. Anything left over is kept as the customer&apos;s credit.
                  </p>
                </div>
              )}
            </fieldset>
            <Button type="submit">Record payment</Button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
