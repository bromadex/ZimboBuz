import Link from "next/link";
import { Badge, Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { formatQuantity } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { stockLocations } from "@/server/inventory/data";
import { addLocation, makeMainLocation, renameLocation, setLocationArchived } from "../actions";

// Stock locations per branch: shelves, stores, yards or vans. Managed by
// people who manage branches (admin.branches.manage).

export default async function LocationsPage({ params, searchParams }: PageProps<"/e/[slug]/stock/locations">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "inventory.view");
  const canManage = ctx.permissions.has("admin.branches.manage");

  const data = await withUser(ctx.userId, async (q) => {
    const locations = await stockLocations(q, ctx.company.id, { includeArchived: true });
    const branches = (
      await q<{ id: string; name: string; code: string }>(
        "select id, name, code from public.branches where company_id = $1 and archived_at is null order by is_head_office desc, name",
        [ctx.company.id],
      )
    ).rows;
    const held = (
      await q<{ location_id: string; products: string; units: string }>(
        `select location_id, count(*) filter (where quantity <> 0) as products, sum(quantity) as units
         from public.stock_levels where company_id = $1 group by location_id`,
        [ctx.company.id],
      )
    ).rows;
    return { locations, branches, held: new Map(held.map((h) => [h.location_id, h])) };
  });

  return (
    <>
      <PageHeader
        title="Stock locations"
        description="Where you keep stock in each branch: a shop floor, a back store, a yard or a van. Sales take stock from the branch's main location."
        actions={
          <Link href="/stock" className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
            Back to stock levels
          </Link>
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {data.branches.map((b) => (
            <Card key={b.id} title={`${b.name} (${b.code})`}>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.locations
                  .filter((l) => l.branch_id === b.id)
                  .map((l) => {
                    const held = data.held.get(l.id);
                    const products = Number(held?.products ?? 0);
                    return (
                      <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className={`font-semibold ${l.archived ? "text-zinc-500 line-through" : ""}`}>
                            {l.name} <span className="font-mono text-xs font-normal text-zinc-500">{l.code}</span>{" "}
                            {l.is_default ? <Badge tone="ok">Main</Badge> : null} {l.archived ? <Badge>Archived</Badge> : null}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {products ? (
                              <Link href={`/stock?location=${l.id}`} className="underline">
                                {products} {products === 1 ? "product" : "products"}, {formatQuantity(held!.units)} units
                              </Link>
                            ) : (
                              "No stock here"
                            )}
                          </p>
                        </div>
                        {canManage ? (
                          <div className="flex flex-wrap items-center gap-3">
                            {!l.archived ? (
                              <form action={renameLocation.bind(null, slug, l.id)} className="flex gap-2">
                                <label className="sr-only" htmlFor={`name-${l.id}`}>
                                  Name
                                </label>
                                <input
                                  id={`name-${l.id}`}
                                  name="name"
                                  defaultValue={l.name}
                                  required
                                  className="w-36 rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                                />
                                <button type="submit" className="text-xs font-semibold text-[var(--brand)] underline">
                                  Rename
                                </button>
                              </form>
                            ) : null}
                            {!l.archived && !l.is_default ? (
                              <form action={makeMainLocation.bind(null, slug, l.id)}>
                                <button type="submit" className="text-xs font-semibold text-[var(--brand)] underline">
                                  Make main
                                </button>
                              </form>
                            ) : null}
                            {!l.is_default ? (
                              <form action={setLocationArchived.bind(null, slug, l.id)}>
                                <input type="hidden" name="archive" value={String(!l.archived)} />
                                <button type="submit" className={`text-xs font-semibold underline ${l.archived ? "text-[var(--brand)]" : "text-red-700 dark:text-red-400"}`}>
                                  {l.archived ? "Restore" : "Archive"}
                                </button>
                              </form>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            </Card>
          ))}
        </div>
        {canManage ? (
          <Card title="Add a location" className="self-start">
            <form action={addLocation.bind(null, slug)} className="space-y-4">
              {data.branches.length > 1 ? (
                <SelectField label="Branch" name="branch_id" options={data.branches.map((b) => ({ value: b.id, label: b.name }))} />
              ) : (
                <input type="hidden" name="branch_id" value={data.branches[0]?.id ?? ""} />
              )}
              <Field label="Name" name="name" required placeholder="Back store" />
              <Field label="Short code" name="code" required placeholder="BACK" hint="2 to 12 letters, numbers or hyphens." />
              <Button type="submit" className="w-full">
                Add location
              </Button>
            </form>
          </Card>
        ) : (
          <p className="text-sm text-zinc-500">Ask someone who manages branches to add or change locations.</p>
        )}
      </div>
    </>
  );
}
