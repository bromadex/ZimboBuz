import Link from "next/link";
import { ListView } from "@/components/list-view";
import { Badge, Notice, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { setLeadStatus } from "../sales/actions";

// Website and store enquiries (leads). Store quote requests arrive with a draft quote.

const STATUS: Record<string, { label: string; tone: "info" | "draft" | "ok" | "muted" | "warn" }> = {
  new: { label: "New", tone: "info" },
  contacted: { label: "Contacted", tone: "draft" },
  quoted: { label: "Quoted", tone: "draft" },
  won: { label: "Won", tone: "ok" },
  lost: { label: "Lost", tone: "muted" },
};
const SOURCE: Record<string, string> = { website_form: "Website form", store_quote: "Store quote request", whatsapp: "WhatsApp", manual: "Added by staff" };
const SORTS = [{ value: "newest", label: "Newest", sql: "l.created_at desc" }, { value: "oldest", label: "Oldest", sql: "l.created_at" }];

type Row = { id: string; name: string; email: string | null; phone: string | null; message: string | null; status: string; source: string; customer_id: string; quote_id: string | null; created_at: Date };

export default async function LeadsPage({ params, searchParams }: PageProps<"/e/[slug]/leads">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "sales.view");
  const lp = listParams(sp, { sorts: SORTS });
  const status = lp.get("status") && STATUS[lp.get("status")!] ? lp.get("status")! : null;
  const customer = /^[0-9a-f-]{36}$/i.test(lp.get("customer") ?? "") ? lp.get("customer")! : null;
  const canEdit = ctx.permissions.has("sales.quote.create");

  const { rows, total } = await withUser(ctx.userId, async (q) => {
    const where = `l.company_id = $1 and ($2::text is null or l.status = $2) and ($3::uuid is null or l.customer_id = $3::uuid)
      and ($4 = '' or l.name ilike $5 or l.email ilike $5 or l.phone ilike $5 or l.message ilike $5)`;
    const args = [ctx.company.id, status, customer, lp.q, likePattern(lp.q)];
    const total = Number((await q<{ n: string }>(`select count(*) as n from public.leads l where ${where}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select l.id, l.name, l.email, l.phone, l.message, l.status, l.source, l.customer_id, l.quote_id, l.created_at
         from public.leads l where ${where} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    return { rows, total };
  });

  return (
    <>
      <PageHeader title="Enquiries" description="Messages and quote requests from your website and store. Each one is linked to a customer." />
      <Notice error={sp.error} success={sp.success} />
      <ListView<Row>
        path="/leads"
        sp={sp}
        params={lp}
        total={total}
        rows={rows}
        sorts={SORTS}
        searchLabel="Search enquiries"
        filters={[{ name: "status", label: "Status", options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })) }]}
        empty="No enquiries yet. They arrive here from your website's contact form and store."
        columns={[
          {
            label: "From",
            cell: (r) => (
              <>
                <Link className="font-medium underline" href={`/customers/${r.customer_id}`}>
                  {r.name}
                </Link>
                <span className="block text-xs text-zinc-500">{[r.phone, r.email].filter(Boolean).join(" · ")}</span>
              </>
            ),
          },
          { label: "Message", cell: (r) => <span className="line-clamp-2 max-w-md">{r.message ?? "—"}</span> },
          { label: "Source", cell: (r) => SOURCE[r.source] },
          { label: "Received", cell: (r) => formatDateTime(r.created_at), className: "whitespace-nowrap" },
          { label: "Status", cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
          {
            label: "Next step",
            cell: (r) => (
              <div className="flex flex-wrap items-center gap-2">
                {r.quote_id ? (
                  <Link className="text-xs font-semibold underline" href={`/sales/quotes/${r.quote_id}`}>
                    Open quote
                  </Link>
                ) : canEdit ? (
                  <Link className="text-xs font-semibold underline" href={`/sales/quotes/new?customer=${r.customer_id}&lead=${r.id}`}>
                    Make a quote
                  </Link>
                ) : null}
                {canEdit ? (
                  <form action={setLeadStatus.bind(null, slug, r.id)} className="flex gap-1">
                    <select name="status" defaultValue={r.status} aria-label="Status" className="rounded border border-zinc-300 px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-950">
                      {Object.entries(STATUS).map(([v, s]) => (
                        <option key={v} value={v}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="text-xs font-semibold underline">
                      Save
                    </button>
                  </form>
                ) : null}
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
