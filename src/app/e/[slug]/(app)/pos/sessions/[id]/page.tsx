import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityPanel, Connections } from "@/components/record-panel";
import { Button, Card, Facts, Field, Notice, PageHeader, RecordLayout, TextArea } from "@/components/ui";
import { currencyLabel, formatDateTime, money } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { userEmails } from "@/server/users";
import { METHOD_LABEL } from "../../../sales/labels";
import { closeTill } from "../../actions";

// Till session and cash-up (P5): what was sold and taken, expected cash per
// currency, and the counted amounts with any difference.

export default async function TillSessionPage({ params, searchParams }: PageProps<"/e/[slug]/pos/sessions/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "pos.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withUser(ctx.userId, async (q) => {
    const s = (
      await q<{ id: string; number: string | null; docstatus: number; opened_by: string; opened_at: Date; submitted_at: Date | null; opening_float: Record<string, number>; expected_cash: Record<string, number> | null; counted_cash: Record<string, number> | null; closing_notes: string | null }>(
        `select id, number, docstatus, opened_by, opened_at, submitted_at, opening_float, expected_cash, counted_cash, closing_notes
         from public.till_sessions where company_id = $1 and id = $2`,
        [ctx.company.id, id],
      )
    ).rows[0];
    if (!s) return null;
    const sales = (
      await q<{ currency: string; n: string; total: string }>(
        "select currency, count(*) as n, sum(total_cents) as total from public.sales_invoices where till_session_id = $1 and docstatus = 1 group by currency",
        [id],
      )
    ).rows;
    const takings = (
      await q<{ method: string; currency: string; total: string }>(
        "select method, currency, sum(amount_cents) as total from public.payments where till_session_id = $1 and docstatus = 1 group by method, currency order by method, currency",
        [id],
      )
    ).rows;
    const expected = s.docstatus === 0 ? ((await q<{ e: Record<string, number> }>("select app.till_expected_cash($1) as e", [id])).rows[0].e ?? {}) : (s.expected_cash ?? {});
    return { s, sales, takings, expected };
  });
  if (!data) notFound();
  const { s } = data;
  const names = await userEmails([s.opened_by]);
  const open = s.docstatus === 0;
  const canClose = open && ctx.permissions.has("pos.till.close") && (s.opened_by === ctx.userId || ctx.permissions.has("pos.void"));
  const currencies = [...new Set([...Object.keys(data.expected), ...Object.keys(s.counted_cash ?? {}), ...Object.keys(s.opening_float)])];

  return (
    <>
      <PageHeader
        title={s.number ? `Till ${s.number}` : "Open till"}
        description={`${names.get(s.opened_by) ?? "Cashier"} · opened ${formatDateTime(s.opened_at)}${s.submitted_at ? ` · closed ${formatDateTime(s.submitted_at)}` : ""}`}
        actions={open && s.opened_by === ctx.userId ? <Link className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700" href="/pos">Back to the till</Link> : null}
      />
      <Notice error={sp.error} success={sp.success} />
      <RecordLayout side={<ActivityPanel ctx={ctx} slug={slug} doctype="till_session" recordId={id} back={`/pos/sessions/${id}`} />}>
        <Connections ctx={ctx} doctype="till_session" recordId={id} />
        <Card title="Sales">
          <Facts
            items={
              data.sales.length
                ? data.sales.map((r) => [`${r.n} sale${r.n === "1" ? "" : "s"} in ${currencyLabel(r.currency)}`, money(r.total, r.currency)] as [string, string])
                : [["Sales", "None yet"]]
            }
          />
        </Card>
        <Card title="Money taken">
          {data.takings.length ? (
            <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              {data.takings.map((t) => (
                <li key={`${t.method}-${t.currency}`} className="flex justify-between py-2">
                  <span>{METHOD_LABEL[t.method]}</span>
                  <span className="tabular-nums">{money(t.total, t.currency)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">Nothing yet.</p>
          )}
        </Card>
        <Card title={open ? "Cash up" : "Cash count"}>
          <table className="mb-4 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-1">Currency</th>
                <th className="py-1 text-right">Float</th>
                <th className="py-1 text-right">Should be in the till</th>
                {!open ? <th className="py-1 text-right">Counted</th> : null}
                {!open ? <th className="py-1 text-right">Difference</th> : null}
              </tr>
            </thead>
            <tbody>
              {currencies.map((c) => {
                const diff = (s.counted_cash?.[c] ?? 0) - (data.expected[c] ?? 0);
                return (
                  <tr key={c}>
                    <td className="py-1">{currencyLabel(c)}</td>
                    <td className="py-1 text-right tabular-nums">{money(s.opening_float[c] ?? 0, c)}</td>
                    <td className="py-1 text-right tabular-nums">{money(data.expected[c] ?? 0, c)}</td>
                    {!open ? <td className="py-1 text-right tabular-nums">{money(s.counted_cash?.[c] ?? 0, c)}</td> : null}
                    {!open ? (
                      <td className={`py-1 text-right font-semibold tabular-nums ${diff < 0 ? "text-red-700" : diff > 0 ? "text-amber-700" : ""}`}>
                        {diff === 0 ? "Exact" : `${diff > 0 ? "Over " : "Short "}${money(Math.abs(diff), c)}`}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {s.closing_notes ? <p className="text-sm">Notes: {s.closing_notes}</p> : null}
          {canClose ? (
            <form action={closeTill.bind(null, slug, id)} className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <p className="text-sm">Count the cash in the drawer for each currency and enter it below. Any difference is recorded.</p>
              <div className="grid grid-cols-3 gap-3">
                {(["USD", "ZWG", "ZAR"] as const).map((c) => (
                  <Field key={c} label={`Counted ${currencyLabel(c)}`} name={`counted_${c}`} inputMode="decimal" placeholder="0.00" required={currencies.includes(c)} />
                ))}
              </div>
              <TextArea label="Notes" name="notes" />
              <Button type="submit">Close till</Button>
            </form>
          ) : null}
        </Card>
      </RecordLayout>
    </>
  );
}
