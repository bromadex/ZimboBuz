import { notFound } from "next/navigation";
import { formatDate, money } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { KIND_LABEL, loadStatement } from "../../../(app)/sales/statement";
import { Letterhead } from "../../letterhead";

export default async function PrintStatement({ params, searchParams }: PageProps<"/e/[slug]/print/statements/[id]">) {
  const { slug, id } = await params;
  const ctx = await requirePermission(slug, "sales.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const st = await loadStatement(ctx, id, await searchParams);
  if (!st) notFound();
  const closing = st.lines.length ? Number(st.lines[st.lines.length - 1].balance_cents) : 0;
  return (
    <Letterhead ctx={ctx} title="Statement" number={null}>
      <div className="mb-6 flex justify-between text-sm">
        <div>
          <p className="font-semibold">{st.customer.name}</p>
          {st.customer.company_name ? <p>{st.customer.company_name}</p> : null}
          {st.customer.phone ? <p>{st.customer.phone}</p> : null}
        </div>
        <p>
          {formatDate(st.from)} to {formatDate(st.to)}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b-2 border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="py-2">Date</th>
            <th className="py-2">Details</th>
            <th className="py-2 text-right">Charged</th>
            <th className="py-2 text-right">Paid</th>
            <th className="py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {st.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-2">{l.entry_date ? formatDate(l.entry_date) : formatDate(st.from)}</td>
              <td className="py-2">
                {KIND_LABEL[l.kind]} {l.reference ?? ""}
              </td>
              <td className="py-2 text-right tabular-nums">{Number(l.debit_cents) ? money(l.debit_cents, st.currency) : ""}</td>
              <td className="py-2 text-right tabular-nums">{Number(l.credit_cents) ? money(l.credit_cents, st.currency) : ""}</td>
              <td className="py-2 text-right tabular-nums">{money(l.balance_cents, st.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-6 text-right text-lg font-bold">
        {closing < 0 ? "In credit" : "Amount owed"}: {money(Math.abs(closing), st.currency)}
      </p>
    </Letterhead>
  );
}
