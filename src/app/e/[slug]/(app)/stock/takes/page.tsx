import { ListView } from "@/components/list-view";
import { TakeStatus } from "@/components/inventory/take-status";
import { Button, Card, Notice, PageHeader, SelectField, TextArea } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { locationLabel, stockLocations } from "@/server/inventory/data";
import { createStockTake } from "../actions";

const SORTS = [
  { value: "newest", label: "Newest", sql: "t.created_at desc" },
  { value: "oldest", label: "Oldest", sql: "t.created_at" },
];

type Row = {
  id: string;
  number: string | null;
  location_name: string;
  branch_name: string;
  docstatus: number;
  sent: boolean;
  archived: boolean;
  lines: string;
  created_at: Date;
  notes: string | null;
};

const STATUS_SQL: Record<string, string> = {
  counting: "t.docstatus = 0 and t.sent_for_approval_at is null and t.archived_at is null",
  waiting: "t.docstatus = 0 and t.sent_for_approval_at is not null and t.archived_at is null",
  submitted: "t.docstatus = 1",
  cancelled: "t.docstatus = 2",
  archived: "t.archived_at is not null",
};

export default async function StockTakesPage({ params, searchParams }: PageProps<"/e/[slug]/stock/takes">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "inventory.view");
  const canCount = ctx.permissions.has("inventory.stocktake");
  const lp = listParams(sp, { sorts: SORTS });
  const status = STATUS_SQL[lp.get("status") ?? ""] ? lp.get("status")! : "";
  const locationId = /^[0-9a-f-]{36}$/i.test(lp.get("location") ?? "") ? lp.get("location")! : "";

  const data = await withUser(ctx.userId, async (q) => {
    const locations = await stockLocations(q, ctx.company.id);
    const from = `from public.stock_takes t
      join public.stock_locations l on l.id = t.location_id
      join public.branches b on b.id = l.branch_id
      where t.company_id = $1
        and ${status ? STATUS_SQL[status] : "t.archived_at is null"}
        and ($2 = '' or t.location_id::text = $2)
        and ($3 = '' or t.number ilike $4 or t.notes ilike $4 or l.name ilike $4)`;
    const args = [ctx.company.id, locationId, lp.q, likePattern(lp.q)];
    const total = Number((await q<{ n: string }>(`select count(*) as n ${from}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select t.id, t.number, l.name as location_name, b.name as branch_name, t.docstatus,
                t.sent_for_approval_at is not null as sent, t.archived_at is not null as archived, t.created_at, t.notes,
                (select count(*) from public.stock_take_lines x where x.stock_take_id = t.id) as lines
         ${from} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    const featureOn = (await q<{ on: boolean }>("select app.feature_enabled($1, 'inventory.stock_takes') as on", [ctx.company.id])).rows[0].on;
    return { locations, total, rows, featureOn };
  });
  const many = new Set(data.locations.map((l) => l.branch_id)).size > 1;

  return (
    <>
      <PageHeader
        title="Stock takes"
        description="Count what is on the shelves. Whoever counts sends the count for approval; a manager submits it, and any differences are adjusted automatically."
      />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <ListView<Row>
            path="/stock/takes"
            sp={sp}
            params={lp}
            total={data.total}
            rows={data.rows}
            sorts={SORTS}
            searchLabel="Search by number, location or notes"
            filters={[
              {
                name: "status",
                label: "Status",
                options: [
                  { value: "counting", label: "Counting" },
                  { value: "waiting", label: "Waiting for approval" },
                  { value: "submitted", label: "Submitted" },
                  { value: "cancelled", label: "Cancelled" },
                  { value: "archived", label: "Put away" },
                ],
              },
              { name: "location", label: "Location", options: data.locations.map((l) => ({ value: l.id, label: locationLabel(l, many) })) },
            ]}
            href={(t) => `/stock/takes/${t.id}`}
            empty="No stock takes yet."
            columns={[
              { label: "Stock take", cell: (t) => t.number ?? `Started ${formatDate(t.created_at)}`, className: "whitespace-nowrap" },
              { label: "Location", cell: (t) => locationLabel({ name: t.location_name, branch_name: t.branch_name }, many) },
              { label: "Products", cell: (t) => Number(t.lines), className: "tabular-nums" },
              { label: "Started", cell: (t) => formatDate(t.created_at), className: "whitespace-nowrap" },
              { label: "Status", cell: (t) => <TakeStatus docstatus={t.docstatus} sent={t.sent} archived={t.archived} /> },
            ]}
            card={(t) => (
              <>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{t.number ?? "Draft stock take"}</p>
                  <TakeStatus docstatus={t.docstatus} sent={t.sent} archived={t.archived} />
                </div>
                <p className="text-sm text-zinc-500">
                  {t.location_name} · started {formatDate(t.created_at)}
                </p>
                <p className="mt-2 text-sm">
                  {Number(t.lines)} {Number(t.lines) === 1 ? "product" : "products"} counted
                </p>
              </>
            )}
          />
        </div>
        {canCount ? (
          <Card title="Start a stock take" className="self-start">
            <form action={createStockTake.bind(null, slug)} className="space-y-4">
              <SelectField
                label="Location to count"
                name="location_id"
                defaultValue={data.locations.find((l) => l.is_default)?.id}
                options={data.locations.map((l) => ({ value: l.id, label: locationLabel(l, many) }))}
              />
              <TextArea label="Notes" name="notes" rows={2} placeholder="Month-end count" />
              <Button type="submit" className="w-full">
                Start counting
              </Button>
            </form>
          </Card>
        ) : !data.featureOn ? (
          <p className="text-sm text-zinc-500">Stock takes are switched off. An owner can switch them on in Settings › Modules and features.</p>
        ) : null}
      </div>
    </>
  );
}
