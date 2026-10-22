import Link from "next/link";
import { ListView } from "@/components/list-view";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { formatQuantity, money } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { locationLabel, stockLocations } from "@/server/inventory/data";

const SORTS = [
  { value: "name", label: "Product", sql: "p.name, p.sku, l.name" },
  { value: "least", label: "Least stock", sql: "coalesce(s.quantity, 0), p.name" },
  { value: "most", label: "Most stock", sql: "coalesce(s.quantity, 0) desc, p.name" },
  { value: "value", label: "Highest value", sql: "coalesce(s.quantity, 0) * coalesce(p.avg_cost, 0) desc, p.name" },
];

type Row = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  location_name: string | null;
  branch_name: string | null;
  quantity: string | null;
  total: string | null;
  reorder_level: string | null;
  avg_cost: string | null;
};

export default async function StockPage({ params, searchParams }: PageProps<"/e/[slug]/stock">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "inventory.view");
  const base = ctx.company.baseCurrency;
  const canSeeCost = ctx.permissions.has("core.products.view_cost");
  const sorts = canSeeCost ? SORTS : SORTS.slice(0, 3);
  const lp = listParams(sp, { sorts });
  const locationId = /^[0-9a-f-]{36}$/i.test(lp.get("location") ?? "") ? lp.get("location")! : "";
  const low = lp.get("stock") === "low";

  const data = await withUser(ctx.userId, async (q) => {
    const locations = await stockLocations(q, ctx.company.id);
    // One row per product and location; products never stocked show once with nothing.
    const from = `from public.products_v p
      left join public.stock_levels s on s.product_id = p.id and ($2 = '' or s.location_id::text = $2)
      left join public.stock_locations l on l.id = s.location_id
      left join public.branches b on b.id = l.branch_id
      left join lateral (select sum(x.quantity) as total from public.stock_levels x where x.product_id = p.id) t on true
      where p.company_id = $1 and p.archived_at is null and p.is_stock_item
        and ($2 = '' or s.location_id is not null)
        and ($3 = '' or p.name ilike $4 or p.sku ilike $4 or p.barcode ilike $4)
        and (not $5 or (p.reorder_level is not null and coalesce(t.total, 0) <= p.reorder_level))`;
    const args = [ctx.company.id, locationId, lp.q, likePattern(lp.q), low];
    const total = Number((await q<{ n: string }>(`select count(*) as n ${from}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select p.id || ':' || coalesce(s.location_id::text, '') as id, p.id as product_id, p.sku, p.name, p.unit,
                l.name as location_name, b.name as branch_name, s.quantity, t.total, p.reorder_level, p.avg_cost
         ${from} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    const summary = (
      await q<{ low: string; stocked: string; value: string | null }>(
        `select count(*) filter (where p.reorder_level is not null and coalesce(t.total, 0) <= p.reorder_level) as low,
                count(*) filter (where coalesce(t.total, 0) > 0) as stocked,
                sum(coalesce(t.total, 0) * p.avg_cost) as value
         from public.products_v p
         left join lateral (select sum(x.quantity) as total from public.stock_levels x where x.product_id = p.id) t on true
         where p.company_id = $1 and p.archived_at is null and p.is_stock_item`,
        [ctx.company.id],
      )
    ).rows[0];
    const branches = Number((await q<{ n: string }>("select count(*) as n from public.branches where company_id = $1 and archived_at is null", [ctx.company.id])).rows[0].n);
    return { locations, total, rows, summary, branches };
  });

  const many = data.branches > 1;
  const isLow = (r: Row) => r.reorder_level !== null && Number(r.total ?? 0) <= Number(r.reorder_level);
  const lowCount = Number(data.summary.low);
  const canMove = ctx.permissions.has("inventory.move");
  const linkClass = "rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700";

  return (
    <>
      <PageHeader
        title="Stock levels"
        description="How much of each product you have at each location. Stock changes only through stock movements, sales and stock takes."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/stock/locations" className={linkClass}>
              Locations
            </Link>
            <Link href="/stock/takes" className={linkClass}>
              Stock takes
            </Link>
            {canMove ? (
              <Link href="/stock/movements/new" className="rounded-[var(--radius)] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">
                Move stock
              </Link>
            ) : null}
          </div>
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Link href={low ? "/stock" : "/stock?stock=low"} className="block">
          <Card className={lowCount ? "border-red-300 dark:border-red-900" : ""}>
            <p className="text-sm text-zinc-500">Low stock</p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${lowCount ? "text-red-700 dark:text-red-400" : ""}`}>{lowCount}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {lowCount ? (low ? "Showing only these. Tap to show everything." : "At or below their reorder level. Tap to see them.") : "Nothing at or below its reorder level."}
            </p>
          </Card>
        </Link>
        <Card>
          <p className="text-sm text-zinc-500">Products in stock</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{Number(data.summary.stocked)}</p>
        </Card>
        {canSeeCost ? (
          <Card>
            <p className="text-sm text-zinc-500">Stock value at average cost</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{money(Math.round(Number(data.summary.value ?? 0)), base)}</p>
          </Card>
        ) : null}
      </div>

      <ListView<Row>
        path="/stock"
        sp={sp}
        params={lp}
        total={data.total}
        rows={data.rows}
        sorts={sorts}
        searchLabel="Search by product name, code or barcode"
        filters={[
          { name: "location", label: "Location", options: data.locations.map((l) => ({ value: l.id, label: locationLabel(l, many) })) },
          { name: "stock", label: "Stock", options: [{ value: "low", label: "Low stock" }] },
        ]}
        href={(r) => `/products/${r.product_id}`}
        empty="No stock items yet. Add products and receive stock to see levels here."
        columns={[
          { label: "Product", cell: (r) => r.name },
          { label: "Code", cell: (r) => <span className="font-mono text-xs">{r.sku}</span>, className: "whitespace-nowrap" },
          { label: "Location", cell: (r) => (r.location_name ? locationLabel({ name: r.location_name, branch_name: r.branch_name ?? "" }, many) : <span className="text-zinc-500">Never stocked</span>) },
          {
            label: "Quantity",
            cell: (r) => (
              <span className={`whitespace-nowrap tabular-nums ${isLow(r) ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>
                {formatQuantity(r.quantity ?? 0)}
                {r.unit !== "each" ? ` ${r.unit}` : ""} {isLow(r) ? <Badge tone="warn">Low</Badge> : null}
              </span>
            ),
          },
          { label: "Reorder level", cell: (r) => (r.reorder_level === null ? "—" : formatQuantity(r.reorder_level)), className: "whitespace-nowrap" },
          ...(canSeeCost
            ? [
                {
                  label: "Value",
                  cell: (r: Row) => money(Math.round(Number(r.quantity ?? 0) * Number(r.avg_cost ?? 0)), base),
                  className: "whitespace-nowrap text-right",
                },
              ]
            : []),
        ]}
        card={(r) => (
          <div className={isLow(r) ? "border-l-4 border-red-500 pl-3" : ""}>
            <p className="font-semibold">{r.name}</p>
            <p className="font-mono text-xs text-zinc-500">{r.sku}</p>
            <p className="mt-2 text-sm">
              <span className="text-2xl font-bold tabular-nums">{formatQuantity(r.quantity ?? 0)}</span> {r.unit}
              {r.location_name ? ` at ${r.location_name}` : ""}
            </p>
            {isLow(r) ? (
              <p className="mt-1 text-xs font-semibold text-red-700 dark:text-red-400">
                Low: {formatQuantity(r.total ?? 0)} in total, reorder at {formatQuantity(r.reorder_level!)}
              </p>
            ) : null}
          </div>
        )}
      />
    </>
  );
}
