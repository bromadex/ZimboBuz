import { redirect } from "next/navigation";
import { Badge, Button, Card, Notice, PageHeader, Table, Td } from "@/components/ui";
import { formatDate, money } from "@/lib/format";
import { billingGateway, pollPendingPayments, STATUS_TEXT } from "@/server/billing";
import { requireCompany } from "@/server/company";
import { withUser } from "@/server/data";
import { getPool } from "@/server/db";
import { changePlan, payInvoice } from "./actions";

// P11: the company's ZimERP subscription: plan, status, invoices, paying and
// changing plan. Works when the company is read-only or suspended too, so it
// can always pay.

interface Invoice {
  id: string;
  number: string;
  description: string;
  amount_cents: number;
  status: "due" | "paid" | "void";
  due_on: Date;
  paid_at: Date | null;
  gateway: string | null;
}
interface Plan {
  code: string;
  name: string;
  price_usd_cents: number;
  max_full_users: number | null;
  max_modules: number | null;
  max_branches: number | null;
}

const limit = (n: number | null, one: string, many: string) => (n == null ? `Unlimited ${many}` : `${n} ${n === 1 ? one : many}`);

export default async function BillingPage({ params, searchParams }: PageProps<"/e/[slug]/settings/billing">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(slug);
  const allowed = await withUser(ctx.userId, async (q) => (await q<{ ok: boolean }>("select app.billing_admin($1) as ok", [ctx.company.id])).rows[0].ok);
  if (!allowed) redirect("/?error=" + encodeURIComponent("You do not have permission to open that page."));

  const billing = billingGateway();
  // Back from Paynow: check on the payment straight away rather than waiting for its notice.
  if (sp.returned) await pollPendingPayments(getPool(), billing, ctx.company.id);

  const { invoices, plans, status } = await withUser(ctx.userId, async (q) => ({
    invoices: (
      await q<Invoice>(
        `select id, number, description, amount_cents, status, due_on, paid_at, gateway
         from public.subscription_invoices where company_id = $1 order by created_at desc limit 24`,
        [ctx.company.id],
      )
    ).rows,
    plans: (await q<Plan>("select code, name, price_usd_cents, max_full_users, max_modules, max_branches from public.plans order by sort_order")).rows,
    status: (await q<{ status: string }>("select status from public.companies where id = $1", [ctx.company.id])).rows[0].status,
  }));
  const current = plans.find((p) => p.code === ctx.company.planCode)!;
  const owed = invoices.filter((i) => i.status === "due").reduce((n, i) => n + i.amount_cents, 0);
  const s = STATUS_TEXT[status] ?? STATUS_TEXT.active;

  return (
    <>
      <PageHeader title="Subscription" description="Your ZimERP plan and invoices. Prices are in US dollars, per month." />
      <Notice error={sp.error} success={sp.success} />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <p className="text-sm text-zinc-500">Your plan</p>
          <p className="mt-1 text-2xl font-bold">{current.name}</p>
          <p className="text-sm">{current.price_usd_cents === 0 ? "Free" : `${money(current.price_usd_cents, "USD")} a month`}</p>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-zinc-500">Status</p>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
          <p className="mt-2 text-sm">{s.text}</p>
          {owed > 0 ? <p className="mt-2 text-sm font-semibold">To pay: {money(owed, "USD")}</p> : null}
        </Card>
      </div>

      <h2 className="mb-2 text-base font-semibold">Invoices</h2>
      {billing.mode === "test" ? (
        <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">Test mode: payments here are pretend and no money moves.</p>
      ) : null}
      <div className="mb-8">
        <Table head={["Invoice", "For", "Amount", "Due", "Status", ""]} empty="No invoices yet. Paid plans are invoiced on the 1st of each month.">
          {invoices.map((i) => (
            <tr key={i.id}>
              <Td className="whitespace-nowrap font-mono text-xs">{i.number}</Td>
              <Td>{i.description}</Td>
              <Td className="whitespace-nowrap tabular-nums">{money(i.amount_cents, "USD")}</Td>
              <Td className="whitespace-nowrap">{formatDate(i.due_on)}</Td>
              <Td>
                {i.status === "paid" ? (
                  <Badge tone="ok">Paid {formatDate(i.paid_at)}</Badge>
                ) : i.status === "void" ? (
                  <Badge>Void</Badge>
                ) : (
                  <Badge tone="draft">Due</Badge>
                )}
              </Td>
              <Td>
                {i.status === "due" ? (
                  <form action={payInvoice.bind(null, slug)}>
                    <input type="hidden" name="id" value={i.id} />
                    <Button type="submit" className="whitespace-nowrap">
                      Pay now
                    </Button>
                  </form>
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-zinc-500">Pay with EcoCash, OneMoney, InnBucks, card or bank through Paynow.</p>
      </div>

      <h2 className="mb-2 text-base font-semibold">Change plan</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Upgrades start straight away; you are invoiced the difference for the rest of this month. Moving to a smaller plan also takes effect straight away
        once your users, modules and branches fit it.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {plans.map((p) => {
          const isCurrent = p.code === current.code;
          const up = p.price_usd_cents > current.price_usd_cents;
          return (
            <li
              key={p.code}
              className={`flex flex-col rounded-[var(--radius,0.5rem)] border bg-white p-4 dark:bg-zinc-900 ${
                isCurrent ? "border-[var(--brand,#0b6e4f)] ring-2 ring-[var(--brand,#0b6e4f)]/30" : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <p className="font-semibold">{p.name}</p>
              <p className="text-lg font-bold">{p.price_usd_cents === 0 ? "Free" : money(p.price_usd_cents, "USD")}</p>
              <ul className="mt-2 mb-3 flex-1 space-y-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                <li>{limit(p.max_full_users, "full user", "full users")}</li>
                <li>{p.max_modules == null ? "All modules" : limit(p.max_modules, "module", "modules")}</li>
                <li>{limit(p.max_branches, "branch", "branches")}</li>
              </ul>
              {isCurrent ? (
                <Badge tone="ok">Your plan</Badge>
              ) : (
                <form action={changePlan.bind(null, slug)}>
                  <input type="hidden" name="plan" value={p.code} />
                  <Button type="submit" variant={up ? "primary" : "secondary"} className="w-full">
                    {up ? `Upgrade to ${p.name}` : `Move to ${p.name}`}
                  </Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
