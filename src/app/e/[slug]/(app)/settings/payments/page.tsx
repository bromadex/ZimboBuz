import { Badge, Button, Card, Field, Notice, PageHeader } from "@/components/ui";
import { currencyLabel } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { saveGateway } from "../../pos/actions";

// Payment gateways (P6): each company connects its own Paynow integrations,
// one per currency, so money goes straight to the company.

export default async function PaymentSettingsPage({ params, searchParams }: PageProps<"/e/[slug]/settings/payments">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "admin.company.edit");
  const accounts = await withUser(ctx.userId, async (q) =>
    (
      await q<{ currency: string; integration_id: string; enabled: boolean; updated_at: Date }>(
        "select currency, integration_id, enabled, updated_at from public.payment_gateway_accounts where company_id = $1 and gateway = 'paynow'",
        [ctx.company.id],
      )
    ).rows,
  );
  return (
    <>
      <PageHeader
        title="Payment gateways"
        description="Connect your own Paynow account so customers can pay by EcoCash, OneMoney, InnBucks and cards. Money goes straight into your account; ZimERP never holds it."
      />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-4 lg:grid-cols-3">
        {(["USD", "ZWG", "ZAR"] as const).map((cur) => {
          const a = accounts.find((x) => x.currency.trim() === cur);
          return (
            <Card key={cur} title={`Paynow (${currencyLabel(cur)})`}>
              <p className="mb-3">{a ? <Badge tone={a.enabled ? "ok" : "muted"}>{a.enabled ? "Connected" : "Switched off"}</Badge> : <Badge>Not connected</Badge>}</p>
              <form action={saveGateway.bind(null, slug)} className="space-y-3">
                <input type="hidden" name="currency" value={cur} />
                <Field label="Integration ID" name="integration_id" defaultValue={a?.integration_id ?? ""} required inputMode="numeric" />
                <Field label="Integration key" name="integration_key" type="password" autoComplete="off" placeholder={a ? "Saved. Enter a new key to replace it" : ""} required={!a} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="enabled" defaultChecked={a ? a.enabled : true} />
                  Use for {currencyLabel(cur)} payments
                </label>
                <Button type="submit" variant="secondary">
                  Save
                </Button>
              </form>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
        Find these in your Paynow account under Receive Payments, then 3rd Party Integration. Keys are stored encrypted and are never shown again.
      </p>
    </>
  );
}
