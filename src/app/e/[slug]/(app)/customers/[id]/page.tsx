import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalAccess } from "@/components/portal-access";
import { ActivityPanel, Connections } from "@/components/record-panel";
import { Button, Card, Facts, Field, Notice, PageHeader, RecordLayout, SelectField, TextArea } from "@/components/ui";
import { CURRENCY_OPTIONS, currencyLabel, money } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { archiveCustomer, updateCustomer } from "../../../actions";

export default async function CustomerPage({ params, searchParams }: PageProps<"/e/[slug]/customers/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "core.customers.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const canEdit = ctx.permissions.has("core.customers.edit");
  const canSeeSales = ctx.permissions.has("sales.view");

  const data = await withUser(ctx.userId, async (q) => {
    const customer = (
      await q<{
        id: string; name: string; company_name: string | null; email: string | null; phone: string | null; whatsapp: string | null;
        vat_number: string | null; currency: string; credit_limit_cents: string | null; notes: string | null; archived_at: Date | null;
      }>(
        `select id, name, company_name, email, phone, whatsapp, vat_number, currency, credit_limit_cents, notes, archived_at
         from public.customers where company_id = $1 and id = $2`,
        [ctx.company.id, id],
      )
    ).rows[0];
    const balances = canSeeSales
      ? (
          await q<{ currency: string; balance: string }>(
            `select currency, sum(balance_cents) as balance from public.sales_invoices_v
             where company_id = $1 and customer_id = $2 and docstatus = 1 group by currency having sum(balance_cents) <> 0`,
            [ctx.company.id, id],
          )
        ).rows
      : [];
    const credits = canSeeSales
      ? (
          await q<{ currency: string; c: string }>(
            "select cur as currency, app.customer_credit_cents($1, $2, cur) as c from unnest(array['USD','ZWG','ZAR']) cur",
            [ctx.company.id, id],
          )
        ).rows.filter((r) => Number(r.c) > 0)
      : [];
    return { customer, balances, credits };
  });
  if (!data.customer) notFound();
  const c = data.customer;
  const back = `/customers/${id}`;

  return (
    <>
      <PageHeader
        title={c.name}
        description={c.company_name ?? undefined}
        actions={
          canSeeSales ? (
            <div className="flex gap-2">
              <Link href={`/customers/${id}/statement`} className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
                Statement
              </Link>
              {ctx.permissions.has("sales.quote.create") ? (
                <Link href={`/sales/quotes/new?customer=${id}`} className="rounded-[var(--radius)] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">
                  New quote
                </Link>
              ) : null}
            </div>
          ) : null
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <RecordLayout side={<ActivityPanel ctx={ctx} slug={slug} doctype="customer" recordId={id} back={back} />}>
        <Connections ctx={ctx} doctype="customer" recordId={id} />
        <Card>
          <Facts
            items={[
              ["Phone", c.phone ?? "—"],
              ["WhatsApp", c.whatsapp ?? c.phone ?? "—"],
              ["Email", c.email ?? "—"],
              ["Usually pays in", currencyLabel(c.currency)],
              ["VAT number", c.vat_number ?? "—"],
              ["Credit limit", c.credit_limit_cents ? money(c.credit_limit_cents, c.currency) : "None"],
              ["Owes you", data.balances.length ? data.balances.map((b) => money(b.balance, b.currency)).join(", ") : "Nothing"],
              [
                "Credit with you",
                data.credits.length ? (
                  <span>
                    {data.credits.map((c) => money(c.c, c.currency)).join(", ")}
                    {ctx.permissions.has("sales.payment.record") || ctx.permissions.has("pos.refund") ? (
                      <>
                        {" "}
                        <Link className="text-xs underline" href={`/sales/refunds/new?customer=${id}`}>
                          Refund
                        </Link>
                      </>
                    ) : null}
                  </span>
                ) : (
                  "None"
                ),
              ],
              ["Status", c.archived_at ? "Archived" : "Active"],
            ]}
          />
        </Card>
        {canEdit && !c.archived_at ? (
          <Card title="Edit details">
            <form action={updateCustomer.bind(null, slug, id)} className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" name="name" required defaultValue={c.name} />
              <Field label="Business name" name="company_name" defaultValue={c.company_name ?? ""} />
              <Field label="Phone" name="phone" type="tel" defaultValue={c.phone ?? ""} />
              <Field label="WhatsApp" name="whatsapp" type="tel" defaultValue={c.whatsapp ?? ""} />
              <Field label="Email" name="email" type="email" defaultValue={c.email ?? ""} />
              <Field label="VAT number" name="vat_number" defaultValue={c.vat_number ?? ""} />
              <SelectField label="Usually pays in" name="currency" defaultValue={c.currency} options={CURRENCY_OPTIONS} />
              <Field
                label={`Credit limit (${currencyLabel(c.currency)})`}
                name="credit_limit"
                inputMode="decimal"
                defaultValue={c.credit_limit_cents ? (Number(c.credit_limit_cents) / 100).toFixed(2) : ""}
                hint="Leave empty for no limit."
              />
              <div className="sm:col-span-2">
                <TextArea label="Notes" name="notes" defaultValue={c.notes ?? ""} />
              </div>
              <div className="flex gap-3 sm:col-span-2">
                <Button type="submit">Save changes</Button>
              </div>
            </form>
            <form action={archiveCustomer.bind(null, slug)} className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="text-sm font-semibold text-red-700 underline">
                Archive this customer
              </button>
            </form>
          </Card>
        ) : null}
        <PortalAccess ctx={ctx} slug={slug} customerId={id} />
      </RecordLayout>
    </>
  );
}
