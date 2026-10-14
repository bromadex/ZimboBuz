import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityPanel } from "@/components/record-panel";
import { Card, Facts, Notice, PageHeader, RecordLayout } from "@/components/ui";
import { formatDate, money } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { METHOD_LABEL } from "../../labels";

export default async function RefundPage({ params, searchParams }: PageProps<"/e/[slug]/sales/refunds/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "sales.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await withUser(ctx.userId, async (q) =>
    (
      await q<{ number: string; customer_id: string; customer_name: string; currency: string; amount_cents: string; method: string; reference: string | null; refunded_on: string; credit_note_id: string | null; till_session_id: string | null }>(
        `select r.number, r.customer_id, c.name as customer_name, r.currency, r.amount_cents, r.method, r.reference,
                to_char(r.refunded_on, 'YYYY-MM-DD') as refunded_on, r.credit_note_id, r.till_session_id
         from public.refunds r join public.customers c on c.id = r.customer_id where r.company_id = $1 and r.id = $2`,
        [ctx.company.id, id],
      )
    ).rows[0],
  );
  if (!r) notFound();
  return (
    <>
      <PageHeader
        title={`Refund ${r.number}`}
        description={
          <Link className="underline" href={`/customers/${r.customer_id}`}>
            {r.customer_name}
          </Link>
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <RecordLayout side={<ActivityPanel ctx={ctx} slug={slug} doctype="refund" recordId={id} back={`/sales/refunds/${id}`} />}>
        <Card>
          <Facts
            items={[
              ["Amount", money(r.amount_cents, r.currency)],
              ["Paid back by", METHOD_LABEL[r.method]],
              ["Date", formatDate(r.refunded_on)],
              ["Reference", r.reference ?? "—"],
              ["Credit note", r.credit_note_id ? <Link className="underline" href={`/sales/credit-notes/${r.credit_note_id}`}>Open</Link> : "—"],
              ["From a till", r.till_session_id ? <Link className="underline" href={`/pos/sessions/${r.till_session_id}`}>Yes</Link> : "No"],
            ]}
          />
        </Card>
      </RecordLayout>
    </>
  );
}
