import { ListView } from "@/components/list-view";
import { Notice, PageHeader } from "@/components/ui";
import { formatDate, money } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { METHOD_LABEL } from "../labels";

const SORTS = [{ value: "newest", label: "Newest", sql: "r.created_at desc" }];
type Row = { id: string; number: string; customer_name: string; currency: string; amount_cents: string; method: string; refunded_on: string };

export default async function RefundsPage({ params, searchParams }: PageProps<"/e/[slug]/sales/refunds">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "sales.view");
  const lp = listParams(sp, { sorts: SORTS });
  const id = (n: string) => (/^[0-9a-f-]{36}$/i.test(lp.get(n) ?? "") ? lp.get(n)! : null);
  const { rows, total } = await withUser(ctx.userId, async (q) => {
    const where = `r.company_id = $1 and r.docstatus = 1 and ($2 = '' or r.number ilike $3 or c.name ilike $3)
      and ($4::uuid is null or r.customer_id = $4::uuid) and ($5::uuid is null or r.till_session_id = $5::uuid)`;
    const args = [ctx.company.id, lp.q, likePattern(lp.q), id("customer"), id("session")];
    const from = "public.refunds r join public.customers c on c.id = r.customer_id";
    const total = Number((await q<{ n: string }>(`select count(*) as n from ${from} where ${where}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select r.id, r.number, c.name as customer_name, r.currency, r.amount_cents, r.method, to_char(r.refunded_on, 'YYYY-MM-DD') as refunded_on
         from ${from} where ${where} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    return { rows, total };
  });
  return (
    <>
      <PageHeader title="Refunds" description="Money paid back to customers from their credit." />
      <Notice error={sp.error} success={sp.success} />
      <ListView<Row>
        path="/sales/refunds"
        sp={sp}
        params={lp}
        total={total}
        rows={rows}
        searchLabel="Search by number or customer"
        href={(r) => `/sales/refunds/${r.id}`}
        empty="No refunds yet. Refund a customer from a credit note or their customer page."
        columns={[
          { label: "Number", cell: (r) => r.number, className: "whitespace-nowrap" },
          { label: "Customer", cell: (r) => r.customer_name },
          { label: "Date", cell: (r) => formatDate(r.refunded_on), className: "whitespace-nowrap" },
          { label: "Method", cell: (r) => METHOD_LABEL[r.method] },
          { label: "Amount", cell: (r) => money(r.amount_cents, r.currency), className: "whitespace-nowrap text-right" },
        ]}
      />
    </>
  );
}
