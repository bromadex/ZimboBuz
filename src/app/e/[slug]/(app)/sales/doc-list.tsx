import Link from "next/link";
import { ListView } from "@/components/list-view";
import { DocStatusBadge, Notice, PageHeader } from "@/components/ui";
import { formatDate, money } from "@/lib/format";
import { likePattern, listParams, type SearchParams } from "@/lib/list-params";
import type { CompanyContext } from "@/server/company";
import { withUser } from "@/server/data";
import { PaymentStatusBadge } from "./document-view";

// Quote and invoice lists (P16), filterable by customer, quote, lead and till session.

type Row = {
  id: string; number: string | null; docstatus: number; customer_name: string; currency: string;
  doc_date: string; total_cents: string; balance_cents: string | null; payment_status: string | null;
};

const SORTS = [
  { value: "newest", label: "Newest", sql: "d.created_at desc" },
  { value: "date", label: "Date", sql: "doc_date desc, d.number desc" },
  { value: "customer", label: "Customer", sql: "c.name, d.created_at desc" },
  { value: "total", label: "Largest", sql: "d.total_cents desc" },
];

export async function DocList({ ctx, kind, sp }: { ctx: CompanyContext; kind: "quote" | "invoice"; sp: SearchParams }) {
  const quote = kind === "quote";
  const lp = listParams(sp, { sorts: SORTS });
  const table = quote ? "public.quotes" : "public.sales_invoices_v";
  const dateCol = quote ? "d.quote_date" : "d.invoice_date";
  const path = quote ? "/sales/quotes" : "/sales/invoices";
  const status = lp.get("status");
  const statusSql =
    status === "draft" ? "d.docstatus = 0"
    : status === "submitted" ? "d.docstatus = 1"
    : status === "cancelled" ? "d.docstatus = 2"
    : !quote && status === "unpaid" ? "d.docstatus = 1 and d.balance_cents > 0"
    : !quote && status === "overdue" ? "d.docstatus = 1 and d.balance_cents > 0 and d.due_date < current_date"
    : "true";
  const uuidParam = (name: string) => (/^[0-9a-f-]{36}$/i.test(lp.get(name) ?? "") ? lp.get(name)! : null);
  const customer = uuidParam("customer");
  const link = quote ? uuidParam("lead") : uuidParam("quote");
  const session = quote ? null : uuidParam("session");

  const { rows, total } = await withUser(ctx.userId, async (q) => {
    const where = `d.company_id = $1 and ${statusSql}
      and ($2 = '' or d.number ilike $3 or c.name ilike $3)
      and ($4::uuid is null or d.customer_id = $4::uuid)
      and ($5::uuid is null or d.${quote ? "lead_id" : "quote_id"} = $5::uuid)
      ${quote ? "" : "and ($6::uuid is null or d.till_session_id = $6::uuid)"}`;
    const args: unknown[] = [ctx.company.id, lp.q, likePattern(lp.q), customer, link];
    if (!quote) args.push(session);
    const from = `${table} d join public.customers c on c.id = d.customer_id`;
    const total = Number((await q<{ n: string }>(`select count(*) as n from ${from} where ${where}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select d.id, d.number, d.docstatus, c.name as customer_name, d.currency, to_char(${dateCol}, 'YYYY-MM-DD') as doc_date,
                d.total_cents, ${quote ? "null as balance_cents, null as payment_status" : "d.balance_cents, d.payment_status"}
         from ${from} where ${where} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    return { rows, total };
  });

  const canCreate = ctx.permissions.has(quote ? "sales.quote.create" : "sales.invoice.create");
  const statusOptions = [
    { value: "draft", label: "Draft" },
    { value: "submitted", label: "Submitted" },
    { value: "cancelled", label: "Cancelled" },
    ...(quote ? [] : [{ value: "unpaid", label: "Not fully paid" }, { value: "overdue", label: "Overdue" }]),
  ];

  return (
    <>
      <PageHeader
        title={quote ? "Quotes" : "Invoices"}
        description={customer ? "Filtered to one customer." : undefined}
        actions={
          canCreate ? (
            <Link href={`${path}/new${customer ? `?customer=${customer}` : ""}`} className="rounded-[var(--radius)] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">
              New {quote ? "quote" : "invoice"}
            </Link>
          ) : null
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <ListView<Row>
        path={path}
        sp={sp}
        params={lp}
        total={total}
        rows={rows}
        sorts={SORTS}
        searchLabel="Search by number or customer"
        filters={[{ name: "status", label: "Status", options: statusOptions }]}
        href={(r) => `${path}/${r.id}`}
        empty={quote ? "No quotes yet." : "No invoices yet."}
        columns={[
          { label: "Number", cell: (r) => r.number ?? "Draft", className: "whitespace-nowrap" },
          { label: "Customer", cell: (r) => r.customer_name },
          { label: "Date", cell: (r) => formatDate(r.doc_date), className: "whitespace-nowrap" },
          { label: "Total", cell: (r) => money(r.total_cents, r.currency), className: "whitespace-nowrap text-right" },
          ...(quote ? [] : [{ label: "Owed", cell: (r: Row) => (r.docstatus === 1 ? money(r.balance_cents, r.currency) : "—"), className: "whitespace-nowrap text-right" }]),
          {
            label: "Status",
            cell: (r) => (
              <span className="flex gap-1">
                <DocStatusBadge status={r.docstatus} />
                {!quote && r.docstatus === 1 ? <PaymentStatusBadge status={r.payment_status} /> : null}
              </span>
            ),
          },
        ]}
        card={(r) => (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{r.number ?? "Draft"}</p>
              <DocStatusBadge status={r.docstatus} />
            </div>
            <p className="text-sm">{r.customer_name}</p>
            <p className="mt-2 text-lg font-bold tabular-nums">{money(r.total_cents, r.currency)}</p>
            <p className="text-xs text-zinc-500">{formatDate(r.doc_date)}</p>
          </>
        )}
      />
    </>
  );
}
