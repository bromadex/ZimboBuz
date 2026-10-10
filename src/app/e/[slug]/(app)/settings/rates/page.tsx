import { Button, Card, Field, Notice, PageHeader, Table, Td } from "@/components/ui";
import { requireCompany } from "@/server/company";
import { withUser } from "@/server/data";
import { setRate } from "../../../actions";

// P4: the company sets its own exchange rates. Every document records the
// rate it used, so changing a rate never changes past sales.

const LABEL: Record<string, string> = { USD: "USD", ZWG: "ZiG", ZAR: "ZAR" };

function formatRate(rate: string): string {
  return Number(rate).toLocaleString("en-GB", { maximumFractionDigits: 8 });
}

function formatWhen(at: Date): string {
  return at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Harare" });
}

export default async function RatesPage({ params, searchParams }: PageProps<"/e/[slug]/settings/rates">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(slug);
  const base = ctx.company.baseCurrency;
  const others = (["USD", "ZWG", "ZAR"] as const).filter((c) => c !== base);
  const canSet = ctx.permissions.has("core.rates.manage");

  const history = await withUser(ctx.userId, async (q) =>
    (
      await q<{ id: string; currency: string; rate: string; effective_at: Date }>(
        `select r.id, r.currency, r.rate, r.effective_at
         from public.exchange_rates r where r.company_id = $1
         order by r.effective_at desc, r.id desc limit 30`,
        [ctx.company.id],
      )
    ).rows,
  );
  const latest = new Map<string, (typeof history)[number]>();
  for (const row of history) if (!latest.has(row.currency.trim())) latest.set(row.currency.trim(), row);

  return (
    <>
      <PageHeader
        title="Exchange rates"
        description={`Your books are in ${LABEL[base]}. Set how much of each other currency one ${LABEL[base]} buys; new sales and payments use the latest rate.`}
      />
      <Notice error={sp.error} success={sp.success} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        {others.map((cur) => {
          const now = latest.get(cur);
          return (
            <Card key={cur}>
              <p className="text-sm text-zinc-500">
                1 {LABEL[base]} = {LABEL[cur]}
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{now ? formatRate(now.rate) : "Not set"}</p>
              <p className="mt-1 text-xs text-zinc-500">{now ? `Since ${formatWhen(now.effective_at)}` : `Set a rate before selling in ${LABEL[cur]}.`}</p>
              {canSet ? (
                <form action={setRate.bind(null, slug)} className="mt-4 flex items-end gap-2">
                  <input type="hidden" name="currency" value={cur} />
                  <div className="flex-1">
                    <Field label={`New rate (${LABEL[cur]} per ${LABEL[base]})`} name="rate" required inputMode="decimal" placeholder={now ? formatRate(now.rate) : ""} />
                  </div>
                  <Button type="submit">Save</Button>
                </form>
              ) : null}
            </Card>
          );
        })}
      </div>
      <h2 className="mb-2 text-base font-semibold">Recent changes</h2>
      <Table head={["When", "Currency", "Rate"]} empty="No rates set yet.">
        {history.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap">{formatWhen(r.effective_at)}</Td>
            <Td>{LABEL[r.currency.trim()]}</Td>
            <Td className="tabular-nums">
              1 {LABEL[base]} = {formatRate(r.rate)} {LABEL[r.currency.trim()]}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
