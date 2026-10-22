import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, PageHeader } from "@/components/ui";
import { money } from "@/lib/format";
import { billingGateway } from "@/server/billing";
import { requireCompany } from "@/server/company";
import { withUser } from "@/server/data";
import { completeTestPayment } from "../actions";

// Stand-in for Paynow's checkout page when ZimERP's Paynow account is not
// configured (development and demos). No money moves.

export default async function TestCheckoutPage({ params, searchParams }: PageProps<"/e/[slug]/settings/billing/test-checkout">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(slug);
  if (billingGateway().mode !== "test") redirect("/settings/billing");
  const id = typeof sp.invoice === "string" && /^[0-9a-f-]{36}$/i.test(sp.invoice) ? sp.invoice : null;
  const inv = id
    ? await withUser(ctx.userId, async (q) =>
        (
          await q<{ id: string; number: string; description: string; amount_cents: number; status: string }>(
            "select id, number, description, amount_cents, status from public.subscription_invoices where id = $1 and company_id = $2",
            [id, ctx.company.id],
          )
        ).rows[0],
      )
    : undefined;
  if (!inv || inv.status !== "due") redirect("/settings/billing");

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Test payment" description="This stands in for Paynow while online payment is not connected. No money moves." />
      <Card>
        <p className="text-sm text-zinc-500">{inv.number}</p>
        <p className="font-medium">{inv.description}</p>
        <p className="my-3 text-3xl font-bold tabular-nums">{money(inv.amount_cents, "USD")}</p>
        <form action={completeTestPayment.bind(null, slug)}>
          <input type="hidden" name="id" value={inv.id} />
          <Button type="submit" className="w-full">
            Pay {money(inv.amount_cents, "USD")} (test)
          </Button>
        </form>
        <Link href="/settings/billing" className="mt-3 block text-center text-sm underline">
          Cancel
        </Link>
      </Card>
    </div>
  );
}
