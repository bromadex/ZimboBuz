import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityPanel, Connections } from "@/components/record-panel";
import { Button, Card, DocStatusBadge, Facts, Field, Notice, PageHeader, RecordLayout } from "@/components/ui";
import { recordHref } from "@/lib/doctypes";
import { formatDateTime, formatQuantity, money } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { MOVEMENT_TYPES } from "@/server/inventory/data";
import { userEmails } from "@/server/users";
import { cancelMovement, submitMovement } from "../../actions";

const SOURCE_NAMES: Record<string, string> = { stock_take: "Stock take", sales_invoice: "Invoice", pos_sale: "Till sale" };

export default async function MovementPage({ params, searchParams }: PageProps<"/e/[slug]/stock/movements/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "inventory.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const canMove = ctx.permissions.has("inventory.move");
  const canSeeCost = ctx.permissions.has("core.products.view_cost");

  const m = await withUser(ctx.userId, async (q) =>
    (
      await q<{
        id: string; number: string | null; movement_type: string; product_id: string; product_name: string; sku: string; unit: string;
        quantity: string; unit_cost: string | null; from_name: string | null; to_name: string | null; notes: string | null;
        source_doctype: string | null; source_id: string | null; docstatus: number; created_by: string | null; created_at: Date;
        submitted_at: Date | null; cancelled_at: Date | null; cancelled_by: string | null; cancel_reason: string | null;
      }>(
        `select m.id, m.number, m.movement_type, m.product_id, p.name as product_name, p.sku, p.unit, m.quantity, m.unit_cost,
                fl.name as from_name, tl.name as to_name, m.notes, m.source_doctype, m.source_id, m.docstatus,
                m.created_by, m.created_at, m.submitted_at, m.cancelled_at, m.cancelled_by, m.cancel_reason
         from public.stock_movements_v m
         join public.products p on p.id = m.product_id
         left join public.stock_locations fl on fl.id = m.from_location_id
         left join public.stock_locations tl on tl.id = m.to_location_id
         where m.company_id = $1 and m.id = $2`,
        [ctx.company.id, id],
      )
    ).rows[0],
  );
  if (!m) notFound();
  const names = await userEmails([m.created_by, m.cancelled_by]);
  const who = (u: string | null) => (u === ctx.userId ? "you" : u ? (names.get(u) ?? "a colleague") : "ZimERP");
  const back = `/stock/movements/${id}`;
  const sourceHref = m.source_doctype && m.source_id ? recordHref(m.source_doctype, m.source_id) : null;
  const sourceName = m.source_doctype ? (SOURCE_NAMES[m.source_doctype] ?? "Another document") : null;
  const unit = m.unit === "each" ? "" : ` ${m.unit}`;

  const facts: Array<[string, ReactNode]> = [
    ["Status", <DocStatusBadge key="s" status={m.docstatus} />],
    ["Type", MOVEMENT_TYPES[m.movement_type]?.label ?? m.movement_type],
    [
      "Product",
      <Link key="p" href={`/products/${m.product_id}`} className="text-[var(--brand)] underline">
        {m.product_name}
      </Link>,
    ],
    ["Quantity", `${formatQuantity(m.quantity)}${unit}`],
    ...(m.from_name ? ([["From", m.from_name]] as Array<[string, ReactNode]>) : []),
    ...(m.to_name ? ([["To", m.to_name]] as Array<[string, ReactNode]>) : []),
    ...(canSeeCost && m.unit_cost !== null
      ? ([
          ["Cost of one unit", money(Math.round(Number(m.unit_cost)), ctx.company.baseCurrency)],
          ["Value", money(Math.round(Number(m.unit_cost) * Number(m.quantity)), ctx.company.baseCurrency)],
        ] as Array<[string, ReactNode]>)
      : []),
    ...(sourceName
      ? ([
          [
            "Made by",
            sourceHref ? (
              <Link key="src" href={sourceHref} className="text-[var(--brand)] underline">
                {sourceName}
              </Link>
            ) : (
              sourceName
            ),
          ],
        ] as Array<[string, ReactNode]>)
      : []),
    ["Recorded", `${formatDateTime(m.created_at)} by ${who(m.created_by)}`],
    ...(m.cancelled_at ? ([["Cancelled", `${formatDateTime(m.cancelled_at)} by ${who(m.cancelled_by)}`]] as Array<[string, ReactNode]>) : []),
  ];

  return (
    <>
      <PageHeader
        title={m.number ? `Stock movement ${m.number}` : "Draft stock movement"}
        description={`${MOVEMENT_TYPES[m.movement_type]?.label ?? ""} · ${m.product_name}`}
        actions={
          <Link href={`/stock/movements?product=${m.product_id}`} className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
            More for this product
          </Link>
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <RecordLayout side={<ActivityPanel ctx={ctx} slug={slug} doctype="stock_movement" recordId={id} back={back} />}>
        <Connections ctx={ctx} doctype="stock_movement" recordId={id} />
        <Card>
          <Facts items={facts} />
          {m.notes ? <p className="mt-4 whitespace-pre-wrap border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">{m.notes}</p> : null}
          {m.cancel_reason ? (
            <p className="mt-4 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
              <span className="font-semibold">Reason for cancelling:</span> {m.cancel_reason}
            </p>
          ) : null}
        </Card>

        {canMove && m.docstatus === 0 ? (
          <Card title="Not yet submitted">
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">This movement was saved as a draft (for example on a device that was offline). Stock changes when it is submitted.</p>
            <form action={submitMovement.bind(null, slug, id)}>
              <Button type="submit">Submit movement</Button>
            </form>
          </Card>
        ) : null}

        {canMove && m.docstatus === 1 ? (
          m.source_doctype ? (
            <p className="text-sm text-zinc-500">
              This movement was made by {sourceName?.toLowerCase()}. To reverse it, cancel that {sourceName?.toLowerCase()}.
            </p>
          ) : (
            <Card title="Cancel this movement">
              <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
                Cancelling reverses the stock change. It cannot be undone; record a new movement if you need it again.
              </p>
              <form action={cancelMovement.bind(null, slug, id)} className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 basis-60">
                  <Field label="Reason" name="reason" required placeholder="Entered the wrong quantity" />
                </div>
                <Button type="submit" variant="secondary">
                  Cancel movement
                </Button>
              </form>
            </Card>
          )
        ) : null}
      </RecordLayout>
    </>
  );
}
