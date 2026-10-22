import Link from "next/link";
import { Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import type { Currency } from "@/lib/pos/math";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { assetUrl } from "@/lib/site/theme";
import { openTill } from "./actions";
import { PosTerminal, type PosProduct } from "./terminal";

// The till (P5). A cashier opens their till with a float, sells, then closes
// and counts the cash (Till sessions).

export default async function PosPage({ params, searchParams }: PageProps<"/e/[slug]/pos">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "pos.sell");
  const can = (p: string) => ctx.permissions.has(p);

  const data = await withUser(ctx.userId, async (q) => {
    const id = ctx.company.id;
    const session = (
      await q<{ id: string; number: string | null; opened_at: Date }>(
        "select id, number, opened_at from public.till_sessions where company_id = $1 and opened_by = auth.uid() and docstatus = 0",
        [id],
      )
    ).rows[0];
    const branches = (await q<{ id: string; name: string }>("select id, name from public.branches where company_id = $1 and archived_at is null order by is_head_office desc, name", [id])).rows;
    if (!session) return { session: null, branches };

    const rateRows = (
      await q<{ currency: string; rate: string }>(
        `select distinct on (currency) currency, rate from public.exchange_rates
         where company_id = $1 and effective_at <= now() order by currency, effective_at desc, id desc`,
        [id],
      )
    ).rows;
    const rates: Partial<Record<Currency, number>> = { [ctx.company.baseCurrency]: 1 };
    for (const r of rateRows) rates[r.currency.trim() as Currency] = Number(r.rate);

    const products = (
      await q<{ id: string; sku: string; barcode: string | null; name: string; rate_bp: number; prices: Record<string, string> | null; stock: string | null; image_key: string | null }>(
        `select p.id, p.sku, p.barcode, p.name, p.image_key, app.tax_rate_bp(p.company_id, p.tax_code, current_date) as rate_bp,
                (select jsonb_object_agg(pp.currency, pp.price_cents) from public.product_prices pp where pp.product_id = p.id) as prices,
                ${can("inventory.view") ? "case when p.is_stock_item then (select coalesce(sum(s.quantity), 0) from public.stock_levels s join public.stock_locations l on l.id = s.location_id where s.product_id = p.id and l.branch_id = (select branch_id from public.till_sessions where id = $2)) end" : "null"} as stock
         from public.products p where p.company_id = $1 and p.archived_at is null order by p.name limit 3000`,
        [id, session.id],
      )
    ).rows;
    const customers = can("core.customers.view")
      ? (
          await q<{ id: string; name: string; phone: string | null }>(
            "select id, name, phone from public.customers where company_id = $1 and archived_at is null and not is_walk_in order by name limit 3000",
            [id],
          )
        ).rows
      : [];
    const changeAsCredit = (await q<{ on: boolean }>("select app.feature_enabled($1, 'pos.change_as_credit') as on", [id])).rows[0].on;
    const gateways = (
      await q<{ currency: string }>("select currency from public.payment_gateway_accounts where company_id = $1 and gateway = 'paynow' and enabled", [id]).catch(() => ({ rows: [] }))
    ).rows.map((r) => r.currency.trim() as Currency);
    return { session, branches, rates, products, customers, changeAsCredit, gateways };
  });

  if (!data.session) {
    return (
      <>
        <PageHeader title="Till" description="Open your till to start selling." actions={<Link className="text-sm underline" href="/pos/sessions">Past till sessions</Link>} />
        <Notice error={sp.error} success={sp.success} />
        <Card title="Open the till" className="max-w-xl">
          <form action={openTill.bind(null, slug)} className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Count the cash you are starting with (the float). Leave a currency empty if you have none.</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="USD" name="float_USD" inputMode="decimal" placeholder="0.00" />
              <Field label="ZiG" name="float_ZWG" inputMode="decimal" placeholder="0.00" />
              <Field label="ZAR" name="float_ZAR" inputMode="decimal" placeholder="0.00" />
            </div>
            {data.branches.length > 1 ? <SelectField label="Branch" name="branch_id" options={data.branches.map((b) => ({ value: b.id, label: b.name }))} /> : null}
            <Button type="submit">Open till</Button>
          </form>
        </Card>
      </>
    );
  }

  const products: PosProduct[] = data.products!.map((p) => {
    const prices: PosProduct["prices"] = {};
    const base = p.prices?.[ctx.company.baseCurrency];
    for (const cur of ["USD", "ZWG", "ZAR"] as Currency[]) {
      const own = p.prices?.[cur];
      if (own !== undefined) prices[cur] = Number(own);
      else if (base !== undefined && data.rates![cur]) prices[cur] = Math.round(Number(base) * data.rates![cur]!);
    }
    return { id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, rateBp: p.rate_bp, prices, stock: p.stock === null ? null : Number(p.stock), imageUrl: assetUrl(p.image_key) };
  });

  return (
    <>
      <PageHeader
        title="Till"
        description={`Till ${data.session.number ?? "open"} · opened ${data.session.opened_at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Harare" })}`}
        actions={
          <Link href={`/pos/sessions/${data.session.id}`} className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
            Close and cash up
          </Link>
        }
      />
      <Notice error={sp.error} success={sp.success} />
      {products.length === 0 ? (
        <Card>
          <p className="text-sm">
            Add products first. <Link className="underline" href="/products">Go to products</Link>
          </p>
        </Card>
      ) : (
        <PosTerminal
          slug={slug}
          sessionId={data.session.id}
          baseCurrency={ctx.company.baseCurrency as Currency}
          inclusive={ctx.company.pricesIncludeTax}
          rates={data.rates!}
          products={products}
          customers={data.customers!}
          canDiscount={can("pos.discount")}
          canOnAccount={can("sales.credit.manage")}
          canChangeAsCredit={data.changeAsCredit!}
          mobileCurrencies={data.gateways!}
        />
      )}
    </>
  );
}
