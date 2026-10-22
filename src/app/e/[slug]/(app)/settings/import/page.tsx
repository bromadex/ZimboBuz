import { Notice, PageHeader } from "@/components/ui";
import { currencyLabel } from "@/lib/format";
import type { ImportKind } from "@/lib/import";
import { requireCompany } from "@/server/company";
import { withUser } from "@/server/data";
import { locationLabel, stockLocations } from "@/server/inventory/data";
import { previewImport, runImport } from "./actions";
import { ImportForm } from "./import-form";

// P18: bring products (with opening stock) and customers in from a spreadsheet.

export default async function ImportPage({ params, searchParams }: PageProps<"/e/[slug]/settings/import">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(slug);
  const kinds: ImportKind[] = [
    ...(ctx.permissions.has("core.products.create") ? (["products"] as const) : []),
    ...(ctx.permissions.has("core.customers.create") ? (["customers"] as const) : []),
  ];
  const locations =
    kinds.includes("products") && ctx.permissions.has("inventory.move")
      ? await withUser(ctx.userId, (q) => stockLocations(q, ctx.company.id))
      : [];
  const many = new Set(locations.map((l) => l.branch_id)).size > 1;
  const base = currencyLabel(ctx.company.baseCurrency);

  return (
    <>
      <PageHeader
        title="Import data"
        description={`Bring in your product list and customers from a spreadsheet. Prices and costs are in ${base}, your main currency.`}
      />
      <Notice error={sp.error} success={sp.success} />
      {kinds.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">You do not have permission to add products or customers. Ask an owner or manager.</p>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <ImportForm
              kinds={kinds}
              locations={locations.map((l) => ({ value: l.id, label: locationLabel(l, many) }))}
              defaultLocation={locations.find((l) => l.is_default)?.id ?? locations[0]?.id ?? ""}
              preview={previewImport.bind(null, slug)}
              run={runImport.bind(null, slug)}
            />
          </div>
          <aside className="space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Good to know</h2>
            {kinds.includes("products") ? (
              <>
                <p>
                  <strong>Products</strong> need a code, a name and a price. The VAT type is standard, zero-rated or exempt (standard if empty). Codes and
                  barcodes must not already be in use.
                </p>
                <p>
                  An <strong>opening quantity</strong> needs a unit cost; it is recorded as stock received, so stock levels and average costs are right from
                  day one.
                </p>
              </>
            ) : null}
            {kinds.includes("customers") ? (
              <p>
                <strong>Customers</strong> need a name or a business name. The same phone number or email is never entered twice. Currency is USD, ZiG or ZAR (
                {base} if empty).
              </p>
            ) : null}
            <p>Nothing is saved until you press Import, and then either every row is added or none are.</p>
          </aside>
        </div>
      )}
    </>
  );
}
