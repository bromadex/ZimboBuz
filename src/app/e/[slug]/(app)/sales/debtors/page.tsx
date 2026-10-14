import Link from "next/link";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { currencyLabel, money } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";

// Credit book (P8): who owes what, how late, and against their credit limit.

type Row = {
  customer_id: string; name: string; phone: string | null; currency: string; credit_limit_cents: string | null; customer_currency: string;
  current_cents: string; d30: string; d60: string; d90: string; over90: string; total_cents: string; oldest_due: string | null;
};

export default async function DebtorsPage({ params, searchParams }: PageProps<"/e/[slug]/sales/debtors">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "sales.view");

  const { rows, credits } = await withUser(ctx.userId, async (q) => {
    const rows = (
      await q<Row>(
        `with open as (
           select i.customer_id, i.currency, i.balance_cents, current_date - coalesce(i.due_date, i.invoice_date) as days_late,
                  coalesce(i.due_date, i.invoice_date) as due
           from public.sales_invoices_v i where i.company_id = $1 and i.docstatus = 1 and i.balance_cents > 0
         )
         select c.id as customer_id, c.name, c.phone, o.currency, c.credit_limit_cents, c.currency as customer_currency,
                sum(o.balance_cents) filter (where o.days_late <= 0) as current_cents,
                sum(o.balance_cents) filter (where o.days_late between 1 and 30) as d30,
                sum(o.balance_cents) filter (where o.days_late between 31 and 60) as d60,
                sum(o.balance_cents) filter (where o.days_late between 61 and 90) as d90,
                sum(o.balance_cents) filter (where o.days_late > 90) as over90,
                sum(o.balance_cents) as total_cents, to_char(min(o.due), 'YYYY-MM-DD') as oldest_due
         from open o join public.customers c on c.id = o.customer_id
         group by c.id, c.name, c.phone, o.currency, c.credit_limit_cents, c.currency
         order by sum(o.balance_cents) filter (where o.days_late > 30) desc nulls last, sum(o.balance_cents) desc`,
        [ctx.company.id],
      )
    ).rows;
    const credits = (
      await q<{ customer_id: string; name: string; currency: string; credit_cents: string }>(
        `select c.id as customer_id, c.name, cur as currency, app.customer_credit_cents($1, c.id, cur) as credit_cents
         from public.customers c cross join unnest(array['USD','ZWG','ZAR']) cur
         where c.company_id = $1 and app.customer_credit_cents($1, c.id, cur) > 0
         order by c.name`,
        [ctx.company.id],
      )
    ).rows;
    return { rows, credits };
  });

  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.total_cents));
  const cell = (v: string | null, cur: string, late = false) =>
    v ? <span className={late ? "font-semibold text-red-700 dark:text-red-400" : ""}>{money(v, cur)}</span> : <span className="text-zinc-400">—</span>;

  return (
    <>
      <PageHeader title="Credit book" description="Customers who owe you money, by how long it has been owed (days after the due date)." />
      <Notice error={sp.error} success={sp.success} />
      <div className="mb-4 flex flex-wrap gap-3">
        {[...totals].map(([cur, cents]) => (
          <Card key={cur} className="min-w-48">
            <p className="text-sm text-zinc-500">Owed to you in {currencyLabel(cur)}</p>
            <p className="text-2xl font-bold tabular-nums">{money(cents, cur)}</p>
          </Card>
        ))}
        {totals.size === 0 ? <p className="text-sm text-zinc-500">Nobody owes you anything right now.</p> : null}
      </div>
      {rows.length ? (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2 text-right">Not yet due</th>
                <th className="px-3 py-2 text-right">1–30 days</th>
                <th className="px-3 py-2 text-right">31–60</th>
                <th className="px-3 py-2 text-right">61–90</th>
                <th className="px-3 py-2 text-right">Over 90</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((r) => {
                const over = r.credit_limit_cents && r.currency === r.customer_currency && Number(r.total_cents) > Number(r.credit_limit_cents);
                return (
                  <tr key={`${r.customer_id}-${r.currency}`}>
                    <td className="px-3 py-2">
                      <Link className="font-medium underline" href={`/customers/${r.customer_id}`}>
                        {r.name}
                      </Link>
                      {over ? (
                        <span className="ml-2">
                          <Badge tone="warn">Over credit limit</Badge>
                        </span>
                      ) : null}
                      {r.phone ? <span className="block text-xs text-zinc-500">{r.phone}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{cell(r.current_cents, r.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{cell(r.d30, r.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{cell(r.d60, r.currency, true)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{cell(r.d90, r.currency, true)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{cell(r.over90, r.currency, true)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(r.total_cents, r.currency)}</td>
                    <td className="px-3 py-2 text-right">
                      <Link className="whitespace-nowrap text-xs font-semibold underline" href={`/customers/${r.customer_id}/statement?currency=${r.currency.trim()}`}>
                        Statement
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {credits.length ? (
        <Card title="Customer credit (paid in advance or credited)" className="mt-6">
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {credits.map((c) => (
              <li key={`${c.customer_id}-${c.currency}`} className="flex justify-between py-2">
                <Link className="underline" href={`/customers/${c.customer_id}`}>
                  {c.name}
                </Link>
                <span className="tabular-nums">{money(c.credit_cents, c.currency)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
