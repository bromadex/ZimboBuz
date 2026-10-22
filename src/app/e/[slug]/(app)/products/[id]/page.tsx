import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityPanel, Connections } from "@/components/record-panel";
import { Badge, Button, Card, DocStatusBadge, Facts, Field, Notice, PageHeader, RecordLayout, SelectField, Table, Td, TextArea } from "@/components/ui";
import { currencyLabel, formatDate, formatQuantity, money } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { MOVEMENT_TYPES, TAX_LABELS } from "@/server/inventory/data";
import { assetUrl } from "@/lib/site/theme";
import { saveProductPrices, setProductArchived, setProductPicture, updateProduct } from "../actions";

type Product = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  unit: string;
  is_stock_item: boolean;
  tax_code: string;
  reorder_level: string | null;
  avg_cost: string | null;
  show_online: boolean;
  archived_at: Date | null;
  image_key: string | null;
};

export default async function ProductPage({ params, searchParams }: PageProps<"/e/[slug]/products/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "core.products.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const base = ctx.company.baseCurrency;
  const canEdit = ctx.permissions.has("core.products.edit");
  const canSeeCost = ctx.permissions.has("core.products.view_cost");
  const canSeeStock = ctx.permissions.has("inventory.view");
  const canMove = ctx.permissions.has("inventory.move");

  const data = await withUser(ctx.userId, async (q) => {
    const product = (
      await q<Product>(
        `select id, sku, barcode, name, description, unit, is_stock_item, tax_code, reorder_level, avg_cost, show_online, archived_at, image_key
         from public.products_v where company_id = $1 and id = $2`,
        [ctx.company.id, id],
      )
    ).rows[0];
    if (!product) return null;
    // Price in each currency: the explicit price, or the base price converted
    // at the latest rate (as app.price_cents does when selling).
    const prices = (
      await q<{ currency: string; explicit: string | null; effective: string | null; rate: string | null }>(
        `select c.cur as currency, pp.price_cents as explicit,
                case when pp.price_cents is not null then pp.price_cents
                     when c.cur <> $3 and bp.price_cents is not null and r.rate is not null then app.convert_cents(bp.price_cents, 1, r.rate)
                end as effective,
                r.rate
         from unnest(array['USD','ZWG','ZAR']) as c(cur)
         left join public.product_prices pp on pp.product_id = $2 and pp.currency = c.cur
         left join public.product_prices bp on bp.product_id = $2 and bp.currency = $3
         left join lateral (
           select x.rate from public.exchange_rates x
           where x.company_id = $1 and x.currency = c.cur and x.effective_at <= now()
           order by x.effective_at desc, x.id desc limit 1
         ) r on true
         order by c.cur = $3 desc, c.cur`,
        [ctx.company.id, id, base],
      )
    ).rows;
    const levels = canSeeStock
      ? (
          await q<{ location_id: string; name: string; branch_name: string; quantity: string }>(
            `select s.location_id, l.name, b.name as branch_name, s.quantity
             from public.stock_levels s join public.stock_locations l on l.id = s.location_id join public.branches b on b.id = l.branch_id
             where s.company_id = $1 and s.product_id = $2 and (s.quantity <> 0 or l.archived_at is null)
             order by b.name, l.is_default desc, l.name`,
            [ctx.company.id, id],
          )
        ).rows
      : [];
    const movements = canSeeStock
      ? (
          await q<{ id: string; number: string | null; movement_type: string; quantity: string; docstatus: number; created_at: Date; from_name: string | null; to_name: string | null }>(
            `select m.id, m.number, m.movement_type, m.quantity, m.docstatus, m.created_at, f.name as from_name, t.name as to_name
             from public.stock_movements m
             left join public.stock_locations f on f.id = m.from_location_id
             left join public.stock_locations t on t.id = m.to_location_id
             where m.company_id = $1 and m.product_id = $2
             order by m.created_at desc limit 10`,
            [ctx.company.id, id],
          )
        ).rows
      : [];
    const branches = Number((await q<{ n: string }>("select count(*) as n from public.branches where company_id = $1 and archived_at is null", [ctx.company.id])).rows[0].n);
    return { product, prices, levels, movements, branches };
  });
  if (!data) notFound();
  const p = data.product;
  const back = `/products/${id}`;
  const onHand = data.levels.reduce((sum, l) => sum + Number(l.quantity), 0);
  const low = p.is_stock_item && p.reorder_level !== null && onHand <= Number(p.reorder_level);
  const unit = p.unit === "each" ? "" : ` ${p.unit}`;
  const basePrice = data.prices.find((x) => x.currency === base);

  return (
    <>
      <PageHeader
        title={p.name}
        description={
          <span className="font-mono">
            {p.sku}
            {p.archived_at ? " · archived" : ""}
          </span>
        }
        actions={
          canMove && p.is_stock_item && !p.archived_at ? (
            <div className="flex flex-wrap gap-2">
              <Link href={`/stock/movements/new?product=${id}&type=receipt`} className="rounded-[var(--radius)] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">
                Receive stock
              </Link>
              <Link href={`/stock/movements/new?product=${id}&type=issue`} className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
                Issue or adjust
              </Link>
            </div>
          ) : null
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <RecordLayout side={<ActivityPanel ctx={ctx} slug={slug} doctype="product" recordId={id} back={back} />}>
        <Connections ctx={ctx} doctype="product" recordId={id} />
        <Card>
          <Facts
            items={[
              ["Price", money(basePrice?.explicit ?? null, base)],
              ["Type", p.is_stock_item ? "Stock item" : "Service"],
              ["Unit", p.unit],
              ["VAT", TAX_LABELS[p.tax_code]],
              ["Barcode", p.barcode ?? "—"],
              ...(p.is_stock_item && canSeeStock
                ? ([
                    [
                      "In stock",
                      <span key="s">
                        {formatQuantity(onHand)}
                        {unit} {low ? <Badge tone="warn">Low</Badge> : null}
                      </span>,
                    ],
                  ] as Array<[string, ReactNode]>)
                : []),
              ...(p.is_stock_item ? ([["Reorder level", p.reorder_level === null ? "Not set" : `${formatQuantity(p.reorder_level)}${unit}`]] as Array<[string, ReactNode]>) : []),
              ...(p.is_stock_item && canSeeCost && p.avg_cost !== null
                ? ([
                    ["Average cost", money(Math.round(Number(p.avg_cost)), base)],
                    ...(canSeeStock ? [["Stock value", money(Math.round(Number(p.avg_cost) * onHand), base)]] : []),
                  ] as Array<[string, ReactNode]>)
                : []),
              ["Online", p.show_online ? "Shown in the online store" : "Hidden online"],
              ["Status", p.archived_at ? `Archived ${formatDate(p.archived_at)}` : "Active"],
            ]}
          />
          {p.description ? <p className="mt-4 whitespace-pre-wrap border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">{p.description}</p> : null}
        </Card>

        <Card title="Picture">
          <div className="flex flex-wrap items-start gap-4">
            {p.image_key ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetUrl(p.image_key) ?? ""} alt={p.name} className="size-32 rounded-[var(--radius)] border border-zinc-200 object-cover dark:border-zinc-800" />
            ) : (
              <div className="flex size-32 items-center justify-center rounded-[var(--radius)] border border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700">No picture</div>
            )}
            {canEdit ? (
              <div className="space-y-2">
                <form action={setProductPicture.bind(null, slug, id)} className="flex flex-wrap items-center gap-2">
                  <input type="file" name="picture" accept="image/png,image/jpeg,image/webp" required aria-label="Product picture" className="text-sm" />
                  <Button type="submit" variant="secondary">
                    {p.image_key ? "Replace picture" : "Upload picture"}
                  </Button>
                </form>
                {p.image_key ? (
                  <form action={setProductPicture.bind(null, slug, id)}>
                    <input type="hidden" name="remove" value="yes" />
                    <button type="submit" className="text-xs text-zinc-500 underline">
                      Remove picture
                    </button>
                  </form>
                ) : null}
                <p className="text-xs text-zinc-500">PNG, JPEG or WebP, up to 1 MB. Shown in your online store and at the till.</p>
              </div>
            ) : null}
          </div>
        </Card>

        <Card title="Prices">
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            Sales in another currency use the price you set for it, or the {currencyLabel(base)} price converted at your current exchange rate.
          </p>
          {canEdit && !p.archived_at ? (
            <form action={saveProductPrices.bind(null, slug, id)} className="space-y-3">
              {data.prices.map((x) => (
                <PriceRow key={x.currency} price={x} base={base} editable />
              ))}
              <p className="text-xs text-zinc-500">Leave a currency empty to convert from the {currencyLabel(base)} price.</p>
              <Button type="submit">Save prices</Button>
            </form>
          ) : (
            <div className="space-y-3">
              {data.prices.map((x) => (
                <PriceRow key={x.currency} price={x} base={base} />
              ))}
            </div>
          )}
        </Card>

        {p.is_stock_item && canSeeStock ? (
          <Card title="Stock by location">
            <Table head={["Location", "Quantity"]} empty="No stock recorded yet.">
              {data.levels.map((l) => (
                <tr key={l.location_id}>
                  <Td>{data.branches > 1 ? `${l.branch_name}: ${l.name}` : l.name}</Td>
                  <Td className="tabular-nums">
                    {formatQuantity(l.quantity)}
                    {unit}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        ) : null}

        {canSeeStock && (p.is_stock_item || data.movements.length) ? (
          <Card title="Recent stock movements">
            <Table head={["Movement", "Type", "Quantity", "Where", "Status"]} empty="No movements yet.">
              {data.movements.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/stock/movements/${m.id}`} className="font-medium text-[var(--brand)] hover:underline">
                      {m.number ?? "Draft"}
                    </Link>
                    <span className="block text-xs text-zinc-500">{formatDate(m.created_at)}</span>
                  </Td>
                  <Td>{MOVEMENT_TYPES[m.movement_type]?.label ?? m.movement_type}</Td>
                  <Td className="tabular-nums">{formatQuantity(m.quantity)}</Td>
                  <Td>{m.from_name && m.to_name ? `${m.from_name} → ${m.to_name}` : (m.to_name ?? m.from_name)}</Td>
                  <Td>
                    <DocStatusBadge status={m.docstatus} />
                  </Td>
                </tr>
              ))}
            </Table>
            {data.movements.length ? (
              <p className="mt-3 text-sm">
                <Link href={`/stock/movements?product=${id}`} className="font-semibold text-[var(--brand)] underline">
                  See all movements
                </Link>
              </p>
            ) : null}
          </Card>
        ) : null}

        {canEdit && !p.archived_at ? (
          <Card title="Edit details">
            <form action={updateProduct.bind(null, slug, id)} className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" name="name" required defaultValue={p.name} />
              <Field label="Product code" name="sku" required defaultValue={p.sku} />
              <Field label="Barcode" name="barcode" inputMode="numeric" defaultValue={p.barcode ?? ""} />
              <Field label="Unit" name="unit" defaultValue={p.unit} hint="For example each, bag, kg or litre." />
              <SelectField
                label="VAT"
                name="tax_code"
                defaultValue={p.tax_code}
                options={Object.entries(TAX_LABELS).map(([value, label]) => ({ value, label }))}
              />
              <Field
                label="Reorder level"
                name="reorder_level"
                inputMode="decimal"
                defaultValue={p.reorder_level === null ? "" : formatQuantity(p.reorder_level).replace(/,/g, "")}
                hint="You are alerted when stock falls to this level. Leave empty for no alert."
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_stock_item" defaultChecked={p.is_stock_item} />
                Keep stock of this item
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="show_online" defaultChecked={p.show_online} />
                Show in the online store
              </label>
              <div className="sm:col-span-2">
                <TextArea label="Description" name="description" defaultValue={p.description ?? ""} hint="Shown to customers online." />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit">Save changes</Button>
              </div>
            </form>
          </Card>
        ) : null}

        {canEdit ? (
          <form action={setProductArchived.bind(null, slug, id)}>
            <input type="hidden" name="archive" value={String(!p.archived_at)} />
            <button type="submit" className={`text-sm font-semibold underline ${p.archived_at ? "text-[var(--brand)]" : "text-red-700 dark:text-red-400"}`}>
              {p.archived_at ? "Restore this product" : "Archive this product"}
            </button>
            {!p.archived_at ? <span className="ml-2 text-xs text-zinc-500">Archived products are hidden from sale but kept with their history.</span> : null}
          </form>
        ) : null}
      </RecordLayout>
    </>
  );
}

function PriceRow({
  price,
  base,
  editable = false,
}: {
  price: { currency: string; explicit: string | null; effective: string | null; rate: string | null };
  base: string;
  editable?: boolean;
}) {
  const cur = price.currency.trim();
  const isBase = cur === base;
  const how = isBase
    ? "Your main price"
    : price.explicit !== null
      ? "Set for this currency"
      : price.effective !== null
        ? `Converted at 1 ${currencyLabel(base)} = ${Number(price.rate).toLocaleString("en-GB", { maximumFractionDigits: 8 })} ${currencyLabel(cur)}`
        : price.rate === null
          ? `No exchange rate set for ${currencyLabel(cur)} yet`
          : "No main price yet";
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-100 pb-3 last:border-0 dark:border-zinc-800">
      <div className="min-w-40">
        <p className="text-sm font-semibold">{currencyLabel(cur)}</p>
        <p className="text-xs text-zinc-500">{how}</p>
      </div>
      {editable ? (
        <label className="w-40 text-sm">
          <span className="sr-only">Price in {currencyLabel(cur)}</span>
          <input
            name={`price_${cur}`}
            inputMode="decimal"
            required={isBase}
            defaultValue={price.explicit === null ? "" : (Number(price.explicit) / 100).toFixed(2)}
            placeholder={price.effective === null ? "" : (Number(price.effective) / 100).toFixed(2)}
            className="w-full rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-3 py-2 text-right text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
      ) : (
        <p className="font-semibold tabular-nums">{money(price.effective, cur)}</p>
      )}
    </div>
  );
}
