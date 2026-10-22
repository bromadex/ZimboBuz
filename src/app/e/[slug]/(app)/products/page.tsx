import { ListView, type Filter } from "@/components/list-view";
import { Badge, Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { currencyLabel, formatQuantity, money } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { TAX_LABELS } from "@/server/inventory/data";
import { addProduct } from "../../actions";

const SORTS = [
  { value: "name", label: "Name", sql: "p.name, p.sku" },
  { value: "code", label: "Code", sql: "p.sku" },
  { value: "newest", label: "Newest", sql: "p.created_at desc" },
  { value: "price", label: "Highest price", sql: "pp.price_cents desc nulls last, p.name" },
  { value: "stock", label: "Least stock", sql: "coalesce(s.qty, 0), p.name" },
];

type Row = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  unit: string;
  tax_code: string;
  is_stock_item: boolean;
  avg_cost: string | null;
  reorder_level: string | null;
  archived: boolean;
  price_cents: string | null;
  qty: string | null;
};

export default async function ProductsPage({ params, searchParams }: PageProps<"/e/[slug]/products">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "core.products.view");
  const base = ctx.company.baseCurrency;
  const canCreate = ctx.permissions.has("core.products.create");
  const canSeeCost = ctx.permissions.has("core.products.view_cost");
  const canSeeStock = ctx.permissions.has("inventory.view");
  const lp = listParams(sp, { sorts: canSeeStock ? SORTS : SORTS.slice(0, 4) });
  const archived = lp.get("archived") === "yes";
  const kind = lp.get("kind") === "stock" || lp.get("kind") === "service" ? lp.get("kind")! : "";
  const low = canSeeStock && lp.get("stock") === "low";

  // products_v shows cost only to roles allowed to see it (P17).
  const { rows, total } = await withUser(ctx.userId, async (q) => {
    const from = `from public.products_v p
      left join public.product_prices pp on pp.product_id = p.id and pp.currency = $2
      left join lateral (select sum(l.quantity) as qty from public.stock_levels l where l.product_id = p.id) s on true
      where p.company_id = $1 and (p.archived_at is null) <> $3
        and ($4 = '' or p.name ilike $5 or p.sku ilike $5 or p.barcode ilike $5)
        and ($6 = '' or p.is_stock_item = ($6 = 'stock'))
        and (not $7 or (p.is_stock_item and p.reorder_level is not null and coalesce(s.qty, 0) <= p.reorder_level))`;
    const args = [ctx.company.id, base, archived, lp.q, likePattern(lp.q), kind, low];
    const total = Number((await q<{ n: string }>(`select count(*) as n ${from}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select p.id, p.sku, p.name, p.barcode, p.unit, p.tax_code, p.is_stock_item, p.avg_cost, p.reorder_level,
                p.archived_at is not null as archived, pp.price_cents, s.qty
         ${from} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    return { rows, total };
  });

  const isLow = (p: Row) => p.is_stock_item && p.reorder_level !== null && Number(p.qty ?? 0) <= Number(p.reorder_level);
  const stockCell = (p: Row) =>
    !p.is_stock_item ? (
      <span className="text-zinc-500">Service</span>
    ) : (
      <span className="whitespace-nowrap">
        {formatQuantity(p.qty ?? 0)} {p.unit !== "each" ? p.unit : ""} {isLow(p) ? <Badge tone="warn">Low</Badge> : null}
      </span>
    );

  const filters: Filter[] = [
    { name: "kind", label: "Type", options: [{ value: "stock", label: "Stock items" }, { value: "service", label: "Services" }] },
    ...(canSeeStock ? [{ name: "stock", label: "Stock", options: [{ value: "low", label: "Low stock" }] }] : []),
    { name: "archived", label: "Archived", options: [{ value: "yes", label: "Archived only" }] },
  ];

  return (
    <>
      <PageHeader
        title={ctx.terms.products}
        description={`Prices are in ${currencyLabel(base)}, your main currency. Other currencies use your exchange rates unless you set a price for them on the product.`}
      />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <ListView<Row>
            path="/products"
            sp={sp}
            params={lp}
            total={total}
            rows={rows}
            sorts={canSeeStock ? SORTS : SORTS.slice(0, 4)}
            filters={filters}
            searchLabel="Search by name, code or barcode"
            href={(p) => `/products/${p.id}`}
            empty={canCreate ? "No products yet. Add your first one, or import a list from Settings › Import data." : "No products yet."}
            columns={[
              { label: "Name", cell: (p) => p.name },
              { label: "Code", cell: (p) => <span className="font-mono text-xs">{p.sku}</span>, className: "whitespace-nowrap" },
              { label: "Price", cell: (p) => money(p.price_cents, base), className: "whitespace-nowrap text-right" },
              ...(canSeeStock ? [{ label: "In stock", cell: stockCell }] : []),
              ...(canSeeCost
                ? [{ label: "Average cost", cell: (p: Row) => (p.is_stock_item && p.avg_cost !== null ? money(Math.round(Number(p.avg_cost)), base) : "—"), className: "whitespace-nowrap text-right" }]
                : []),
              { label: "VAT", cell: (p) => TAX_LABELS[p.tax_code], className: "whitespace-nowrap" },
            ]}
            card={(p) => (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold">{p.name}</p>
                  <p className="whitespace-nowrap font-semibold tabular-nums text-[var(--brand,#0b6e4f)]">{money(p.price_cents, base)}</p>
                </div>
                <p className="mt-1 font-mono text-xs text-zinc-500">
                  {p.sku}
                  {p.barcode ? ` · ${p.barcode}` : ""}
                </p>
                <p className="mt-3 text-sm">
                  {canSeeStock ? stockCell(p) : p.is_stock_item ? `Sold per ${p.unit}` : "Service"}
                  {p.archived ? (
                    <span className="ml-2">
                      <Badge>Archived</Badge>
                    </span>
                  ) : null}
                </p>
              </>
            )}
          />
        </div>

        {canCreate ? (
          <Card title={`Add a ${ctx.terms.product.toLowerCase()}`} className="self-start">
            <form action={addProduct.bind(null, slug)} className="space-y-4">
              <Field label="Name" name="name" required placeholder="Cement 50kg" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Product code" name="sku" required placeholder="CEM-50" />
                <Field label="Barcode" name="barcode" inputMode="numeric" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Price (${currencyLabel(base)})`} name="price" required inputMode="decimal" placeholder="12.50" />
                <Field label="Unit" name="unit" defaultValue="each" />
              </div>
              <SelectField
                label="VAT"
                name="tax_code"
                defaultValue="standard"
                options={Object.entries(TAX_LABELS).map(([value, label]) => ({ value, label }))}
                hint={ctx.company.vatRegistered ? undefined : "You are not VAT-registered, so no VAT is charged yet."}
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_stock_item" defaultChecked />
                Keep stock of this item
              </label>
              <Button type="submit" className="w-full">
                Add product
              </Button>
              <p className="text-xs text-zinc-500">Open the product afterwards to add prices in other currencies, a reorder level and a description.</p>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
