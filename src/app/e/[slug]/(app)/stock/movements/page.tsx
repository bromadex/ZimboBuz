import Link from "next/link";
import { ListView, type Filter } from "@/components/list-view";
import { DocStatusBadge, Notice, PageHeader } from "@/components/ui";
import { formatDate, formatQuantity } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { locationLabel, MOVEMENT_TYPES, stockLocations } from "@/server/inventory/data";

const SORTS = [
  { value: "newest", label: "Newest", sql: "m.created_at desc" },
  { value: "oldest", label: "Oldest", sql: "m.created_at" },
  { value: "product", label: "Product", sql: "p.name, m.created_at desc" },
];

const UUID = /^[0-9a-f-]{36}$/i;

type Row = {
  id: string;
  number: string | null;
  movement_type: string;
  product_id: string;
  product_name: string;
  sku: string;
  unit: string;
  quantity: string;
  from_name: string | null;
  to_name: string | null;
  docstatus: number;
  source_doctype: string | null;
  created_at: Date;
};

export default async function MovementsPage({ params, searchParams }: PageProps<"/e/[slug]/stock/movements">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "inventory.view");
  const lp = listParams(sp, { sorts: SORTS });
  const productId = UUID.test(lp.get("product") ?? "") ? lp.get("product")! : "";
  const sourceId = UUID.test(lp.get("source") ?? "") ? lp.get("source")! : "";
  const locationId = UUID.test(lp.get("location") ?? "") ? lp.get("location")! : "";
  const type = MOVEMENT_TYPES[lp.get("type") ?? ""] ? lp.get("type")! : "";
  const status = ["0", "1", "2"].includes(lp.get("status") ?? "") ? Number(lp.get("status")) : -1;

  const data = await withUser(ctx.userId, async (q) => {
    const locations = await stockLocations(q, ctx.company.id, { includeArchived: true });
    const from = `from public.stock_movements m
      join public.products p on p.id = m.product_id
      left join public.stock_locations fl on fl.id = m.from_location_id
      left join public.stock_locations tl on tl.id = m.to_location_id
      where m.company_id = $1
        and ($2 = '' or m.product_id::text = $2)
        and ($3 = '' or m.source_id::text = $3)
        and ($4 = '' or m.from_location_id::text = $4 or m.to_location_id::text = $4)
        and ($5 = '' or m.movement_type = $5)
        and ($6 < 0 or m.docstatus = $6)
        and ($7 = '' or m.number ilike $8 or p.name ilike $8 or p.sku ilike $8 or m.notes ilike $8)`;
    const args = [ctx.company.id, productId, sourceId, locationId, type, status, lp.q, likePattern(lp.q)];
    const total = Number((await q<{ n: string }>(`select count(*) as n ${from}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select m.id, m.number, m.movement_type, m.product_id, p.name as product_name, p.sku, p.unit, m.quantity,
                fl.name as from_name, tl.name as to_name, m.docstatus, m.source_doctype, m.created_at
         ${from} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    const product = productId
      ? (await q<{ name: string }>("select name from public.products where company_id = $1 and id = $2", [ctx.company.id, productId])).rows[0]
      : undefined;
    const source = sourceId
      ? (
          await q<{ label: string }>(
            `select coalesce(t.number, 'Draft stock take') as label from public.stock_takes t where t.company_id = $1 and t.id = $2
             union all
             select coalesce(i.number, 'Draft invoice') from public.sales_invoices i where i.company_id = $1 and i.id = $2`,
            [ctx.company.id, sourceId],
          )
        ).rows[0]
      : undefined;
    const branches = Number((await q<{ n: string }>("select count(*) as n from public.branches where company_id = $1 and archived_at is null", [ctx.company.id])).rows[0].n);
    return { locations, total, rows, product, source, branches };
  });

  // The product and source filters come from connection buttons; keep them as
  // choices in the filter bar so "Apply" does not drop them.
  const filters: Filter[] = [
    ...(productId ? [{ name: "product", label: "Product", options: [{ value: productId, label: data.product?.name ?? "This product" }] }] : []),
    ...(sourceId ? [{ name: "source", label: "Made by", options: [{ value: sourceId, label: data.source?.label ?? "This document" }] }] : []),
    { name: "type", label: "Type", options: Object.entries(MOVEMENT_TYPES).map(([value, t]) => ({ value, label: t.label })) },
    {
      name: "status",
      label: "Status",
      options: [
        { value: "1", label: "Submitted" },
        { value: "0", label: "Draft" },
        { value: "2", label: "Cancelled" },
      ],
    },
    { name: "location", label: "Location", options: data.locations.map((l) => ({ value: l.id, label: locationLabel(l, data.branches > 1) })) },
  ];

  const where = (m: Row) => (m.from_name && m.to_name ? `${m.from_name} → ${m.to_name}` : m.to_name ? `Into ${m.to_name}` : `Out of ${m.from_name}`);

  return (
    <>
      <PageHeader
        title="Stock movements"
        description={
          productId && data.product
            ? `Movements of ${data.product.name}.`
            : sourceId && data.source
              ? `Movements made by ${data.source.label}.`
              : "Every receipt, issue, transfer, sale and adjustment. Submitted movements are locked; cancel one to reverse it."
        }
        actions={
          ctx.permissions.has("inventory.move") ? (
            <Link
              href={`/stock/movements/new${productId ? `?product=${productId}` : ""}`}
              className="rounded-[var(--radius)] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white"
            >
              Move stock
            </Link>
          ) : null
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <ListView<Row>
        path="/stock/movements"
        sp={sp}
        params={lp}
        total={data.total}
        rows={data.rows}
        sorts={SORTS}
        filters={filters}
        searchLabel="Search by number, product or notes"
        href={(m) => `/stock/movements/${m.id}`}
        empty="No stock movements yet."
        columns={[
          { label: "Number", cell: (m) => m.number ?? "Draft", className: "whitespace-nowrap" },
          { label: "Date", cell: (m) => formatDate(m.created_at), className: "whitespace-nowrap" },
          { label: "Product", cell: (m) => m.product_name },
          { label: "Type", cell: (m) => MOVEMENT_TYPES[m.movement_type]?.label ?? m.movement_type, className: "whitespace-nowrap" },
          {
            label: "Quantity",
            cell: (m) => {
              const t = MOVEMENT_TYPES[m.movement_type];
              const sign = t?.inbound && !t.outbound ? "+" : t?.outbound && !t.inbound ? "−" : "";
              return (
                <span className="whitespace-nowrap tabular-nums">
                  {sign}
                  {formatQuantity(m.quantity)}
                  {m.unit !== "each" ? ` ${m.unit}` : ""}
                </span>
              );
            },
            className: "text-right",
          },
          { label: "Where", cell: where },
          { label: "Status", cell: (m) => <DocStatusBadge status={m.docstatus} /> },
        ]}
        card={(m) => (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{m.product_name}</p>
              <DocStatusBadge status={m.docstatus} />
            </div>
            <p className="text-xs text-zinc-500">
              {m.number ?? "Draft"} · {formatDate(m.created_at)}
            </p>
            <p className="mt-2 text-sm">
              {MOVEMENT_TYPES[m.movement_type]?.label}: {formatQuantity(m.quantity)} {m.unit} · {where(m)}
            </p>
          </>
        )}
      />
    </>
  );
}
