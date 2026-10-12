import Link from "next/link";
import { ListView } from "@/components/list-view";
import { DocStatusBadge, Notice, PageHeader } from "@/components/ui";
import { formatDate, money } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { METHOD_LABEL } from "../labels";

const SORTS = [
  { value: "newest", label: "Newest", sql: "p.created_at desc" },
  { value: "date", label: "Date", sql: "p.received_on desc, p.number desc" },
  { value: "amount", label: "Largest", sql: "p.amount_cents desc" },
];

type Row = { id: string; number: string | null; docstatus: number; customer_name: string; currency: string; amount_cents: string; method: string; received_on: string };

export default async function PaymentsPage({ params, searchParams }: PageProps<"/e/[slug]/sales/payments">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "sales.view");
  const lp = listParams(sp, { sorts: SORTS });
  const id = (name: string) => (/^[0-9a-f-]{36}$/i.test(lp.get(name) ?? "") ? lp.get(name)! : null);
  const method = lp.get("method") && METHOD_LABEL[lp.get("method")!] ? lp.get("method")! : null;

  const { rows, total } = await withUser(ctx.userId, async (q) => {
    const where = `p.company_id = $1 and ($2 = '' or p.number ilike $3 or c.name ilike $3 or p.reference ilike $3)
      and ($4::uuid is null or p.customer_id = $4::uuid) and ($5::text is null or p.method = $5)
      and ($6::uuid is null or p.till_session_id = $6::uuid)`;
    const args = [ctx.company.id, lp.q, likePattern(lp.q), id("customer"), method, id("session")];
    const from = "public.payments p join public.customers c on c.id = p.customer_id";
    const total = Number((await q<{ n: string }>(`select count(*) as n from ${from} where ${where}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select p.id, p.number, p.docstatus, c.name as customer_name, p.currency, p.amount_cents, p.method,
                to_char(p.received_on, 'YYYY-MM-DD') as received_on
         from ${from} where ${where} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    return { rows, total };
  });

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received from customers, by any method and in any currency."
        actions={
          ctx.permissions.has("sales.payment.record") ? (
            <Link href="/sales/payments/new" className="rounded-[var(--radius)] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">
              Record payment
            </Link>
          ) : null
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <ListView<Row>
        path="/sales/payments"
        sp={sp}
        params={lp}
        total={total}
        rows={rows}
        sorts={SORTS}
        searchLabel="Search by number, customer or reference"
        filters={[{ name: "method", label: "Method", options: Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label })) }]}
        href={(r) => `/sales/payments/${r.id}`}
        empty="No payments yet."
        columns={[
          { label: "Number", cell: (r) => r.number ?? "Draft", className: "whitespace-nowrap" },
          { label: "Customer", cell: (r) => r.customer_name },
          { label: "Date", cell: (r) => formatDate(r.received_on), className: "whitespace-nowrap" },
          { label: "Method", cell: (r) => METHOD_LABEL[r.method] },
          { label: "Amount", cell: (r) => money(r.amount_cents, r.currency), className: "whitespace-nowrap text-right" },
          { label: "Status", cell: (r) => <DocStatusBadge status={r.docstatus} /> },
        ]}
        card={(r) => (
          <>
            <p className="font-semibold">{r.number ?? "Draft"}</p>
            <p className="text-sm">{r.customer_name}</p>
            <p className="mt-2 text-lg font-bold tabular-nums">{money(r.amount_cents, r.currency)}</p>
            <p className="text-xs text-zinc-500">
              {METHOD_LABEL[r.method]} · {formatDate(r.received_on)}
            </p>
          </>
        )}
      />
    </>
  );
}
