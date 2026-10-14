import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, Field, PageHeader, SelectField } from "@/components/ui";
import { CURRENCY_OPTIONS, formatDate, money } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { KIND_LABEL, loadStatement, statementHref } from "../../../sales/statement";

export default async function StatementPage({ params, searchParams }: PageProps<"/e/[slug]/customers/[id]/statement">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "sales.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const st = await loadStatement(ctx, id, sp);
  if (!st) notFound();
  const closing = st.lines.length ? st.lines[st.lines.length - 1].balance_cents : "0";
  const query = new URLSearchParams({ currency: st.currency, from: st.from, to: st.to }).toString();

  return (
    <>
      <PageHeader
        title={`Statement: ${st.customer.name}`}
        description={<Link className="underline" href={`/customers/${id}`}>Back to customer</Link>}
        actions={
          <a href={`/print/statements/${id}?${query}`} target="_blank" className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
            Print or save PDF
          </a>
        }
      />
      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <SelectField label="Currency" name="currency" defaultValue={st.currency} options={CURRENCY_OPTIONS} />
          <Field label="From" name="from" type="date" defaultValue={st.from} />
          <Field label="To" name="to" type="date" defaultValue={st.to} />
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </Card>
      <div className="overflow-x-auto rounded-[var(--radius)] border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Details</th>
              <th className="px-3 py-2 text-right">Charged</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {st.lines.map((l, i) => (
              <tr key={i}>
                <td className="px-3 py-2 whitespace-nowrap">{l.entry_date ? formatDate(l.entry_date) : formatDate(st.from)}</td>
                <td className="px-3 py-2">
                  {KIND_LABEL[l.kind]}{" "}
                  {l.reference && l.document_id ? (
                    <Link className="underline" href={statementHref(l.kind, l.document_id)}>
                      {l.reference}
                    </Link>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(l.debit_cents) ? money(l.debit_cents, st.currency) : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(l.credit_cents) ? money(l.credit_cents, st.currency) : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.balance_cents, st.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td colSpan={4} className="px-3 py-2 text-right">
                {Number(closing) < 0 ? "In credit" : "Amount owed"} on {formatDate(st.to)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{money(Math.abs(Number(closing)), st.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
