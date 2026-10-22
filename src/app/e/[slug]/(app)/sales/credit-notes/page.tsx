import Link from "next/link";
import { ListView } from "@/components/list-view";
import { DocStatusBadge, Notice, PageHeader } from "@/components/ui";
import { formatDate, money } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";

const SORTS = [{ value: "newest", label: "Newest", sql: "c.created_at desc" }, { value: "total", label: "Largest", sql: "c.total_cents desc" }];
type Row = { id: string; number: string | null; docstatus: number; customer_name: string; invoice_number: string; currency: string; total_cents: string; credit_date: string; reason: string };

export default async function CreditNotesPage({ params, searchParams }: PageProps<"/e/[slug]/sales/credit-notes">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "sales.view");
  const lp = listParams(sp, { sorts: SORTS });
  const id = (n: string) => (/^[0-9a-f-]{36}$/i.test(lp.get(n) ?? "") ? lp.get(n)! : null);
  const { rows, total } = await withUser(ctx.userId, async (q) => {
    const where = `c.company_id = $1 and ($2 = '' or c.number ilike $3 or cu.name ilike $3 or i.number ilike $3)
      and ($4::uuid is null or c.invoice_id = $4::uuid) and ($5::uuid is null or c.customer_id = $5::uuid)`;
    const args = [ctx.company.id, lp.q, likePattern(lp.q), id("invoice"), id("customer")];
    const from = "public.credit_notes c join public.customers cu on cu.id = c.customer_id join public.sales_invoices i on i.id = c.invoice_id";
    const total = Number((await q<{ n: string }>(`select count(*) as n from ${from} where ${where}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select c.id, c.number, c.docstatus, cu.name as customer_name, i.number as invoice_number, c.currency, c.total_cents,
                to_char(c.credit_date, 'YYYY-MM-DD') as credit_date, c.reason
         from ${from} where ${where} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    return { rows, total };
  });
  return (
    <>
      <PageHeader
        title="Credit notes"
        description="Money taken off invoices for returns, damage or mistakes. Make one from the invoice."
        actions={
          <Link href="/sales/refunds" className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
            Refunds
          </Link>
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <ListView<Row>
        path="/sales/credit-notes"
        sp={sp}
        params={lp}
        total={total}
        rows={rows}
        sorts={SORTS}
        searchLabel="Search by number, customer or invoice"
        href={(r) => `/sales/credit-notes/${r.id}`}
        empty="No credit notes yet."
        columns={[
          { label: "Number", cell: (r) => r.number, className: "whitespace-nowrap" },
          { label: "Customer", cell: (r) => r.customer_name },
          { label: "Invoice", cell: (r) => r.invoice_number, className: "whitespace-nowrap" },
          { label: "Date", cell: (r) => formatDate(r.credit_date), className: "whitespace-nowrap" },
          { label: "Reason", cell: (r) => r.reason },
          { label: "Amount", cell: (r) => money(r.total_cents, r.currency), className: "whitespace-nowrap text-right" },
          { label: "Status", cell: (r) => <DocStatusBadge status={r.docstatus} /> },
        ]}
      />
    </>
  );
}
