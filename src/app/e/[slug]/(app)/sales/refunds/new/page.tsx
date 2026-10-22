import { Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { CURRENCY_OPTIONS, currencyLabel, money } from "@/lib/format";
import { requireCompany } from "@/server/company";
import { withUser } from "@/server/data";
import { notFound } from "next/navigation";
import { recordRefund } from "../../credit-actions";
import { METHOD_LABEL } from "../../labels";

// Pay back a customer's credit (P8).

export default async function NewRefundPage({ params, searchParams }: PageProps<"/e/[slug]/sales/refunds/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(slug);
  if (!(ctx.permissions.has("sales.payment.record") || ctx.permissions.has("pos.refund"))) notFound();
  const customerId = typeof sp.customer === "string" && /^[0-9a-f-]{36}$/i.test(sp.customer) ? sp.customer : null;
  if (!customerId) notFound();
  const data = await withUser(ctx.userId, async (q) => {
    const customer = (await q<{ name: string }>("select name from public.customers where company_id = $1 and id = $2", [ctx.company.id, customerId])).rows[0];
    const credits = (
      await q<{ currency: string; c: string }>(
        "select cur as currency, app.customer_credit_cents($1, $2, cur) as c from unnest(array['USD','ZWG','ZAR']) cur",
        [ctx.company.id, customerId],
      )
    ).rows.filter((r) => Number(r.c) > 0);
    const till = (await q<{ id: string }>("select id from public.till_sessions where company_id = $1 and opened_by = auth.uid() and docstatus = 0", [ctx.company.id])).rows[0];
    return { customer, credits, till };
  });
  if (!data.customer) notFound();
  const wanted = typeof sp.currency === "string" ? sp.currency : data.credits[0]?.currency;
  const current = data.credits.find((c) => c.currency === wanted) ?? data.credits[0];

  return (
    <>
      <PageHeader title={`Refund ${data.customer.name}`} description="Pay back money the customer has as credit." />
      <Notice error={sp.error} />
      <Card className="max-w-2xl">
        {data.credits.length === 0 ? (
          <p className="text-sm">{data.customer.name} has no credit to refund.</p>
        ) : (
          <form action={recordRefund.bind(null, slug)} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="customer_id" value={customerId} />
            {typeof sp.credit_note === "string" ? <input type="hidden" name="credit_note_id" value={sp.credit_note} /> : null}
            <p className="text-sm sm:col-span-2">
              Credit available: {data.credits.map((c) => money(c.c, c.currency)).join(", ")}
            </p>
            <SelectField label="Currency" name="currency" defaultValue={current.currency} options={CURRENCY_OPTIONS.filter((o) => data.credits.some((c) => c.currency === o.value))} />
            <Field label={`Amount (${currencyLabel(current.currency)})`} name="amount" required inputMode="decimal" defaultValue={(Number(current.c) / 100).toFixed(2)} />
            <SelectField
              label="Paid back by"
              name="method"
              defaultValue="cash"
              options={Object.entries(METHOD_LABEL).filter(([v]) => v !== "store_credit").map(([value, label]) => ({ value, label }))}
            />
            <Field label="Reference" name="reference" hint="EcoCash or bank reference" />
            {data.till ? (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="hidden" name="till_session_id" value={data.till.id} />
                <input type="checkbox" name="from_till" defaultChecked />
                Cash comes out of my open till
              </label>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit">Record refund</Button>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
