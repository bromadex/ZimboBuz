import { Button, Card, Field, Notice, PageHeader, SelectField, Table, Td } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { addProduct, archiveProduct } from "../../actions";

const TAX_LABELS: Record<string, string> = { standard: "Standard VAT", zero_rated: "Zero-rated", exempt: "Exempt" };

export default async function ProductsPage({ params, searchParams }: PageProps<"/e/[slug]/products">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "core.products.view");
  const base = ctx.company.baseCurrency;
  const canCreate = ctx.permissions.has("core.products.create");
  const canEdit = ctx.permissions.has("core.products.edit");
  const canSeeCost = ctx.permissions.has("core.products.view_cost");

  // products_v shows cost only to roles allowed to see it (P17).
  const products = await withUser(ctx.userId, async (q) =>
    (
      await q<{ id: string; sku: string; name: string; unit: string; tax_code: string; is_stock_item: boolean; avg_cost: string | null; price_cents: string | null }>(
        `select p.id, p.sku, p.name, p.unit, p.tax_code, p.is_stock_item, p.avg_cost, pp.price_cents
         from public.products_v p
         left join public.product_prices pp on pp.product_id = p.id and pp.currency = $2
         where p.company_id = $1 and p.archived_at is null
         order by p.name`,
        [ctx.company.id, base],
      )
    ).rows,
  );

  return (
    <>
      <PageHeader title="Products" description={`Prices are in ${base === "ZWG" ? "ZiG" : base}, your main currency. Other currencies use your exchange rates.`} />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Table
          head={["Code", "Name", "Price", ...(canSeeCost ? ["Average cost"] : []), "VAT", ""]}
          empty="No products yet. Add your first one."
        >
          {products.map((p) => (
            <tr key={p.id}>
              <Td className="whitespace-nowrap font-mono text-xs">{p.sku}</Td>
              <Td>
                {p.name}
                {p.unit !== "each" || !p.is_stock_item ? (
                  <span className="block text-xs text-zinc-500">
                    {[p.unit !== "each" ? `per ${p.unit}` : null, p.is_stock_item ? null : "service"].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </Td>
              <Td className="whitespace-nowrap">{p.price_cents === null ? "—" : formatMoney(BigInt(p.price_cents), base)}</Td>
              {canSeeCost ? (
                <Td className="whitespace-nowrap">{p.avg_cost === null ? "—" : formatMoney(BigInt(Math.round(Number(p.avg_cost))), base)}</Td>
              ) : null}
              <Td>{TAX_LABELS[p.tax_code]}</Td>
              <Td className="text-right">
                {canEdit ? (
                  <form action={archiveProduct.bind(null, slug)}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="text-xs font-semibold text-zinc-500 hover:text-red-700">
                      Archive
                    </button>
                  </form>
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>

        {canCreate ? (
          <Card title="Add a product">
            <form action={addProduct.bind(null, slug)} className="space-y-4">
              <Field label="Name" name="name" required placeholder="Cement 50kg" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Product code" name="sku" required placeholder="CEM-50" />
                <Field label="Barcode" name="barcode" inputMode="numeric" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Price (${base === "ZWG" ? "ZiG" : base})`} name="price" required inputMode="decimal" placeholder="12.50" />
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
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
