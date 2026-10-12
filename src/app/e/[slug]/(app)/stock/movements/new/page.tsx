import Link from "next/link";
import { Button, Card, Field, Notice, PageHeader, SelectField, TextArea } from "@/components/ui";
import { currencyLabel, formatQuantity } from "@/lib/format";
import { one } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { locationLabel, stockLocations, stockProducts } from "@/server/inventory/data";
import { createMovement } from "../../actions";

const TYPES = [
  { value: "receipt", tab: "Receive", title: "Receive stock", help: "Stock delivered by a supplier or brought in. The cost updates the product's average cost." },
  { value: "issue", tab: "Issue", title: "Issue stock", help: "Stock used up, given out or taken for the business, not sold." },
  { value: "adjustment_in", tab: "Adjust in", title: "Adjust stock up", help: "Stock found or counted short before. Valued at the average cost unless you give a cost." },
  { value: "adjustment_out", tab: "Adjust out", title: "Adjust stock down", help: "Stock damaged, expired, lost or stolen." },
  { value: "transfer", tab: "Transfer", title: "Transfer stock", help: "Stock moved from one location to another, including to another branch." },
] as const;

export default async function NewMovementPage({ params, searchParams }: PageProps<"/e/[slug]/stock/movements/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "inventory.move");
  const type = TYPES.find((t) => t.value === one(sp, "type")) ?? TYPES[0];
  const productParam = one(sp, "product") ?? "";
  const productId = /^[0-9a-f-]{36}$/i.test(productParam) ? productParam : "";
  const base = currencyLabel(ctx.company.baseCurrency);

  const data = await withUser(ctx.userId, async (q) => {
    const [locations, products] = [await stockLocations(q, ctx.company.id), await stockProducts(q, ctx.company.id)];
    const levels = productId
      ? (
          await q<{ location_id: string; quantity: string }>(
            "select location_id, quantity from public.stock_levels where company_id = $1 and product_id = $2 and quantity <> 0",
            [ctx.company.id, productId],
          )
        ).rows
      : [];
    const branches = new Set(locations.map((l) => l.branch_id)).size;
    return { locations, products, levels, branches };
  });
  const many = data.branches > 1;
  const held = new Map(data.levels.map((l) => [l.location_id, l.quantity]));
  const locationOptions = data.locations.map((l) => ({ value: l.id, label: locationLabel(l, many) }));
  const main = data.locations.find((l) => l.is_default)?.id;
  const chosen = data.products.find((p) => p.id === productId);
  const inbound = type.value === "receipt" || type.value === "adjustment_in" || type.value === "transfer";
  const outbound = type.value !== "receipt" && type.value !== "adjustment_in";

  return (
    <>
      <PageHeader
        title="Move stock"
        actions={
          <Link href="/stock/movements" className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
            All movements
          </Link>
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <nav aria-label="Kind of movement" className="mb-4 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <Link
            key={t.value}
            href={`/stock/movements/new?type=${t.value}${productId ? `&product=${productId}` : ""}`}
            aria-current={t.value === type.value ? "page" : undefined}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${
              t.value === type.value
                ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"
            }`}
          >
            {t.tab}
          </Link>
        ))}
      </nav>
      <Card title={type.title} className="max-w-2xl">
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{type.help}</p>
        {chosen ? (
          <p className="mb-4 rounded-[var(--radius)] bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-950">
            {chosen.name} in stock now:{" "}
            {data.levels.length
              ? data.locations
                  .filter((l) => held.has(l.id))
                  .map((l) => `${locationLabel(l, many)} ${formatQuantity(held.get(l.id)!)}`)
                  .join(", ")
              : "none anywhere yet"}
            .
          </p>
        ) : null}
        {data.products.length === 0 ? (
          <p className="text-sm">
            There are no stock items yet.{" "}
            <Link href="/products" className="font-semibold text-[var(--brand)] underline">
              Add a product
            </Link>{" "}
            first.
          </p>
        ) : (
          <form action={createMovement.bind(null, slug)} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="movement_type" value={type.value} />
            <div className="sm:col-span-2">
              <SelectField
                label="Product"
                name="product_id"
                required
                defaultValue={chosen?.id ?? ""}
                options={[{ value: "", label: "Choose a product" }, ...data.products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))]}
              />
            </div>
            {outbound ? (
              <SelectField label={type.value === "transfer" ? "From" : "Take it from"} name="from_location_id" defaultValue={main} options={locationOptions} />
            ) : null}
            {inbound ? (
              <SelectField
                label={type.value === "transfer" ? "To" : "Put it in"}
                name="to_location_id"
                defaultValue={type.value === "transfer" ? data.locations.find((l) => l.id !== main)?.id : main}
                options={locationOptions}
              />
            ) : null}
            <Field
              label={`Quantity${chosen && chosen.unit !== "each" ? ` (${chosen.unit})` : ""}`}
              name="quantity"
              required
              inputMode="decimal"
              placeholder="10"
            />
            {type.value === "receipt" || type.value === "adjustment_in" ? (
              <Field
                label={`Cost of one unit (${base})`}
                name="unit_cost"
                required={type.value === "receipt"}
                inputMode="decimal"
                placeholder="9.80"
                hint={type.value === "receipt" ? "What you paid per unit, before VAT." : "Leave empty to use the current average cost."}
              />
            ) : null}
            <div className="sm:col-span-2">
              <TextArea
                label="Notes"
                name="notes"
                rows={2}
                placeholder={type.value === "receipt" ? "Supplier and delivery note number" : type.value === "transfer" ? "Who took it" : "Why"}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">{type.title}</Button>
              <p className="mt-2 text-xs text-zinc-500">Stock changes as soon as you save. To undo, open the movement and cancel it.</p>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
