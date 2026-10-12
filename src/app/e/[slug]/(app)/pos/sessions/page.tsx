import { ListView } from "@/components/list-view";
import { DocStatusBadge, Notice, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { userEmails } from "@/server/users";

const SORTS = [{ value: "newest", label: "Newest", sql: "s.opened_at desc" }];
type Row = { id: string; number: string | null; docstatus: number; opened_by: string; opened_at: Date; submitted_at: Date | null; sales: string };

export default async function TillSessionsPage({ params, searchParams }: PageProps<"/e/[slug]/pos/sessions">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "pos.view");
  const lp = listParams(sp, { sorts: SORTS });
  const status = lp.get("status");
  const { rows, total } = await withUser(ctx.userId, async (q) => {
    const where = `s.company_id = $1 and ($2::text is null or ($2 = 'open' and s.docstatus = 0) or ($2 = 'closed' and s.docstatus = 1)) and ($3 = '' or s.number ilike '%' || $3 || '%')`;
    const args = [ctx.company.id, status ?? null, lp.q];
    const total = Number((await q<{ n: string }>(`select count(*) as n from public.till_sessions s where ${where}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select s.id, s.number, s.docstatus, s.opened_by, s.opened_at, s.submitted_at,
                (select count(*) from public.sales_invoices i where i.till_session_id = s.id and i.docstatus = 1) as sales
         from public.till_sessions s where ${where} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    return { rows, total };
  });
  const names = await userEmails(rows.map((r) => r.opened_by));
  return (
    <>
      <PageHeader title="Till sessions" description="Each time a till is opened and cashed up." />
      <Notice error={sp.error} success={sp.success} />
      <ListView<Row>
        path="/pos/sessions"
        sp={sp}
        params={lp}
        total={total}
        rows={rows}
        href={(r) => `/pos/sessions/${r.id}`}
        searchLabel="Search by number"
        filters={[{ name: "status", label: "Status", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }] }]}
        columns={[
          { label: "Till", cell: (r) => r.number ?? "Open till", className: "whitespace-nowrap" },
          { label: "Cashier", cell: (r) => names.get(r.opened_by) ?? "—" },
          { label: "Opened", cell: (r) => formatDateTime(r.opened_at), className: "whitespace-nowrap" },
          { label: "Closed", cell: (r) => (r.submitted_at ? formatDateTime(r.submitted_at) : "Still open"), className: "whitespace-nowrap" },
          { label: "Sales", cell: (r) => r.sales, className: "text-right" },
          { label: "Status", cell: (r) => (r.docstatus === 0 ? "Open" : <DocStatusBadge status={r.docstatus} />) },
        ]}
      />
    </>
  );
}
