import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TakeStatus } from "@/components/inventory/take-status";
import { ActivityPanel, Connections } from "@/components/record-panel";
import { Button, Card, Facts, Field, Notice, PageHeader, RecordLayout, SelectField, Table, Td } from "@/components/ui";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { stockProducts } from "@/server/inventory/data";
import { userEmails } from "@/server/users";
import {
  addAllTakeProducts,
  cancelStockTake,
  countProduct,
  removeTakeLine,
  sendTakeForApproval,
  setStockTakeArchived,
  submitStockTake,
} from "../../actions";

type Line = {
  id: string;
  product_id: string;
  name: string;
  sku: string;
  unit: string;
  counted_qty: string;
  system_qty: string | null;
  variance_qty: string | null;
};

export default async function StockTakePage({ params, searchParams }: PageProps<"/e/[slug]/stock/takes/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "inventory.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const canCount = ctx.permissions.has("inventory.stocktake");
  const canApprove = ctx.permissions.has("inventory.stocktake.approve");

  const data = await withUser(ctx.userId, async (q) => {
    const take = (
      await q<{
        id: string; number: string | null; location_name: string; notes: string | null; docstatus: number; created_by: string | null;
        created_at: Date; sent_for_approval_at: Date | null; sent_for_approval_by: string | null; submitted_at: Date | null;
        submitted_by: string | null; cancelled_at: Date | null; cancel_reason: string | null; archived_at: Date | null;
      }>(
        `select t.id, t.number, l.name as location_name, t.notes, t.docstatus, t.created_by, t.created_at, t.sent_for_approval_at,
                t.sent_for_approval_by, t.submitted_at, t.submitted_by, t.cancelled_at, t.cancel_reason, t.archived_at
         from public.stock_takes t join public.stock_locations l on l.id = t.location_id
         where t.company_id = $1 and t.id = $2`,
        [ctx.company.id, id],
      )
    ).rows[0];
    if (!take) return null;
    const lines = (
      await q<Line>(
        `select x.id, x.product_id, p.name, p.sku, p.unit, x.counted_qty, x.system_qty, x.variance_qty
         from public.stock_take_lines x join public.products p on p.id = x.product_id
         where x.stock_take_id = $1 order by p.name, p.sku`,
        [id],
      )
    ).rows;
    const products = take.docstatus === 0 && canCount ? await stockProducts(q, ctx.company.id) : [];
    return { take, lines, products };
  });
  if (!data) notFound();
  const t = data.take;
  const back = `/stock/takes/${id}`;
  const names = await userEmails([t.created_by, t.sent_for_approval_by, t.submitted_by]);
  const who = (u: string | null) => (u === ctx.userId ? "you" : u ? (names.get(u) ?? "a colleague") : "ZimERP");
  const draft = t.docstatus === 0 && !t.archived_at;
  const editable = draft && canCount;
  const counted = new Set(data.lines.map((l) => l.product_id));
  const remaining = data.products.filter((p) => !counted.has(p.id));
  const differences = data.lines.filter((l) => l.variance_qty !== null && Number(l.variance_qty) !== 0).length;
  const qtyInput =
    "w-24 rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-950";

  const facts: Array<[string, ReactNode]> = [
    ["Status", <TakeStatus key="s" docstatus={t.docstatus} sent={!!t.sent_for_approval_at} archived={!!t.archived_at} />],
    ["Location", t.location_name],
    ["Products counted", data.lines.length],
    ["Started", `${formatDateTime(t.created_at)} by ${who(t.created_by)}`],
  ];
  if (t.sent_for_approval_at) facts.push(["Sent for approval", `${formatDateTime(t.sent_for_approval_at)} by ${who(t.sent_for_approval_by)}`]);
  if (t.submitted_at) facts.push(["Submitted", `${formatDateTime(t.submitted_at)} by ${who(t.submitted_by)}`]);
  if (t.docstatus === 1) facts.push(["Differences", differences ? `${differences} adjusted` : "None"]);
  if (t.cancelled_at) facts.push(["Cancelled", formatDateTime(t.cancelled_at)]);

  return (
    <>
      <PageHeader
        title={t.number ? `Stock take ${t.number}` : `Stock take of ${t.location_name}`}
        description={t.notes ?? undefined}
        actions={
          <Link href="/stock/takes" className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
            All stock takes
          </Link>
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <RecordLayout side={<ActivityPanel ctx={ctx} slug={slug} doctype="stock_take" recordId={id} back={back} />}>
        <Connections ctx={ctx} doctype="stock_take" recordId={id} />
        <Card>
          <Facts items={facts} />
          {t.cancel_reason ? (
            <p className="mt-4 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
              <span className="font-semibold">Reason for cancelling:</span> {t.cancel_reason}
            </p>
          ) : null}
        </Card>

        {editable ? (
          <Card title="Count a product">
            {remaining.length ? (
              <form action={countProduct.bind(null, slug, id)} className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 basis-60">
                  <SelectField
                    label="Product"
                    name="product_id"
                    required
                    options={[{ value: "", label: "Choose a product" }, ...remaining.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))]}
                  />
                </div>
                <div className="w-32">
                  <Field label="Counted" name="counted_qty" required inputMode="decimal" placeholder="0" />
                </div>
                <Button type="submit">Add</Button>
              </form>
            ) : (
              <p className="text-sm text-zinc-500">Every stock item is on this count.</p>
            )}
            <form action={addAllTakeProducts.bind(null, slug, id)} className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <Button type="submit" variant="secondary">
                Add all products in this location
              </Button>
              <p className="mt-1 text-xs text-zinc-500">Lines start at the quantity the system expects; change any that differ from what you count.</p>
            </form>
          </Card>
        ) : null}

        <Card title="Counted products">
          {t.docstatus === 0 ? (
            data.lines.length === 0 ? (
              <p className="text-sm text-zinc-500">Nothing counted yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="font-medium">{l.name}</p>
                      <p className="font-mono text-xs text-zinc-500">{l.sku}</p>
                    </div>
                    {editable ? (
                      <div className="flex items-center gap-3">
                        <form action={countProduct.bind(null, slug, id)} className="flex items-center gap-2">
                          <input type="hidden" name="product_id" value={l.product_id} />
                          <label className="sr-only" htmlFor={`qty-${l.id}`}>
                            Counted quantity of {l.name}
                          </label>
                          <input id={`qty-${l.id}`} name="counted_qty" defaultValue={formatQuantity(l.counted_qty).replace(/,/g, "")} inputMode="decimal" required className={qtyInput} />
                          <span className="text-xs text-zinc-500">{l.unit}</span>
                          <button type="submit" className="text-xs font-semibold text-[var(--brand)] underline">
                            Save
                          </button>
                        </form>
                        <form action={removeTakeLine.bind(null, slug, id)}>
                          <input type="hidden" name="line_id" value={l.id} />
                          <button type="submit" className="text-xs text-zinc-500 underline hover:text-red-700">
                            Remove
                          </button>
                        </form>
                      </div>
                    ) : (
                      <p className="tabular-nums">
                        {formatQuantity(l.counted_qty)} {l.unit}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <Table head={["Product", "Counted", "System", "Difference"]} empty="Nothing was counted.">
              {data.lines.map((l) => {
                const v = Number(l.variance_qty ?? 0);
                return (
                  <tr key={l.id}>
                    <Td>
                      {l.name}
                      <span className="block font-mono text-xs text-zinc-500">{l.sku}</span>
                    </Td>
                    <Td className="tabular-nums">{formatQuantity(l.counted_qty)}</Td>
                    <Td className="tabular-nums">{l.system_qty === null ? "—" : formatQuantity(l.system_qty)}</Td>
                    <Td className={`tabular-nums font-semibold ${v < 0 ? "text-red-700 dark:text-red-400" : v > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}`}>
                      {v > 0 ? "+" : v < 0 ? "−" : ""}
                      {formatQuantity(Math.abs(v))}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        {draft && (canCount || canApprove) ? (
          <Card title="Finish">
            <div className="flex flex-wrap items-start gap-4">
              {canCount && !t.sent_for_approval_at ? (
                <form action={sendTakeForApproval.bind(null, slug, id)}>
                  <Button type="submit" variant={canApprove ? "secondary" : "primary"}>
                    Send for approval
                  </Button>
                </form>
              ) : null}
              {canApprove ? (
                <form action={submitStockTake.bind(null, slug, id)}>
                  <Button type="submit">Approve and submit</Button>
                </form>
              ) : null}
            </div>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              {canApprove
                ? "Submitting records the system quantities and adjusts stock to what was counted. It cannot be changed afterwards, only cancelled."
                : t.sent_for_approval_at
                  ? "Waiting for a manager to approve. You can still correct counts until then."
                  : "When you have counted everything, send it for approval. A manager then submits it."}
            </p>
            {canCount ? (
              <form action={setStockTakeArchived.bind(null, slug, id)} className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <input type="hidden" name="archive" value="true" />
                <button type="submit" className="text-sm font-semibold text-red-700 underline dark:text-red-400">
                  Put this draft away
                </button>
                <span className="ml-2 text-xs text-zinc-500">For a count that was started by mistake. Nothing changes in stock.</span>
              </form>
            ) : null}
          </Card>
        ) : null}

        {t.archived_at && t.docstatus === 0 && canCount ? (
          <form action={setStockTakeArchived.bind(null, slug, id)}>
            <input type="hidden" name="archive" value="false" />
            <button type="submit" className="text-sm font-semibold text-[var(--brand)] underline">
              Take this draft out again
            </button>
          </form>
        ) : null}

        {t.docstatus === 1 && canApprove ? (
          <Card title="Cancel this stock take">
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Cancelling reverses every adjustment it made.</p>
            <form action={cancelStockTake.bind(null, slug, id)} className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1 basis-60">
                <Field label="Reason" name="reason" required placeholder="Counted the wrong shelf" />
              </div>
              <Button type="submit" variant="secondary">
                Cancel stock take
              </Button>
            </form>
          </Card>
        ) : null}
      </RecordLayout>
    </>
  );
}
