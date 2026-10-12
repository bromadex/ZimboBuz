import type { ReactNode } from "react";
import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/ui";
import { recordHref } from "@/lib/doctypes";
import { currencyLabel, formatDate, formatQuantity, money, todayIso } from "@/lib/format";
import { STATUS_TEXT } from "@/server/billing";
import { requireCompany } from "@/server/company";
import { dashboardDates, loadDashboard } from "@/server/dashboard";
import { withUser } from "@/server/data";

// P1: the guided setup checklist new companies see first (folded away once
// complete). P10: the owner dashboard, showing only what the user's role may
// see: sales, money received, what customers owe, stock and their own
// activities.

interface Step {
  title: string;
  detail: string;
  href: string;
  done: boolean;
  visible: boolean;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  ecocash: "EcoCash",
  onemoney: "OneMoney",
  innbucks: "InnBucks",
  card: "Card",
  bank_transfer: "Bank transfer",
  zipit: "ZIPIT",
  store_credit: "Store credit",
  other: "Other",
};
const ACTIVITY_LABEL: Record<string, string> = { call: "Call", meeting: "Meeting", todo: "To do", email: "Email", visit: "Visit" };

function Tile({ label, children, href }: { label: string; children: ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <div className="mt-1 space-y-0.5">{children}</div>
    </>
  );
  const cls =
    "block h-full rounded-[var(--radius,0.5rem)] border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
  return href ? (
    <Link href={href} className={`${cls} transition hover:border-[var(--brand,#0b6e4f)]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Amounts({ items, empty = "Nothing yet" }: { items: Array<{ currency: string; cents: string }>; empty?: string }) {
  const shown = items.filter((i) => BigInt(i.cents) !== BigInt(0));
  if (!shown.length) return <p className="text-lg font-semibold text-zinc-400">{empty}</p>;
  return (
    <>
      {shown.map((i) => (
        <p key={i.currency} className="text-2xl font-bold tabular-nums">
          {money(i.cents, i.currency)}
        </p>
      ))}
    </>
  );
}

/** Horizontal bars, widths relative to the largest value. */
function Bars({ rows }: { rows: Array<{ label: string; value: number; shown: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between gap-2 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-400">
              {r.shown}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-2 rounded-full bg-[var(--brand,#0b6e4f)]" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function Home({ params, searchParams }: PageProps<"/e/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(slug);
  const can = (p: string) => ctx.permissions.has(p);
  const base = ctx.company.baseCurrency;
  const otherCurrencies = (["USD", "ZWG", "ZAR"] as const).filter((c) => c !== base);
  const dates = dashboardDates(todayIso());

  const { facts, dash, billingAdmin } = await withUser(ctx.userId, async (q) => {
    const id = ctx.company.id;
    const count = async (sql: string) => Number((await q<{ n: string }>(sql, [id])).rows[0]?.n ?? 0);
    const facts = {
      ratesSet: await count("select count(distinct currency) as n from public.exchange_rates where company_id = $1"),
      modules: await count("select count(*) as n from public.company_modules where company_id = $1 and enabled"),
      products: can("core.products.view") ? await count("select count(*) as n from public.products where company_id = $1 and archived_at is null") : 0,
      customers: can("core.customers.view") ? await count("select count(*) as n from public.customers where company_id = $1 and archived_at is null") : 0,
      branded: await count(
        `select count(*) as n from public.company_branding b join public.companies c on c.id = b.company_id
         where b.company_id = $1 and b.updated_at > c.created_at + interval '1 second'`,
      ),
    };
    const dash = await loadDashboard(q, id, ctx.userId, ctx.permissions, dates);
    const billingAdmin = ctx.company.status !== "active" && (await q<{ ok: boolean }>("select app.billing_admin($1) as ok", [id])).rows[0].ok;
    return { facts, dash, billingAdmin };
  });

  const steps: Step[] = [
    { title: "Create your company", detail: `${ctx.company.name} is set up, with a head office and staff roles.`, href: "/", done: true, visible: true },
    {
      title: "Choose your modules and features",
      detail: "Switch on what you use and hide what you don't.",
      href: "/settings/modules",
      done: facts.modules > 0,
      visible: can("admin.modules.manage"),
    },
    {
      title: "Set today's exchange rates",
      detail: `How much ${otherCurrencies.map((c) => (c === "ZWG" ? "ZiG" : c)).join(" and ")} one ${base} buys. Change them whenever you like.`,
      href: "/settings/rates",
      done: facts.ratesSet >= otherCurrencies.length,
      visible: can("core.rates.manage"),
    },
    {
      title: "Add your products",
      detail: facts.products ? `${facts.products} product${facts.products === 1 ? "" : "s"} so far.` : "Add what you sell, with prices.",
      href: "/products",
      done: facts.products > 0,
      visible: can("core.products.create"),
    },
    {
      title: "Add your customers",
      detail: facts.customers ? `${facts.customers} customer${facts.customers === 1 ? "" : "s"} so far.` : "Add regular customers, or let sales add them.",
      href: "/customers",
      done: facts.customers > 0,
      visible: can("core.customers.create"),
    },
    { title: "Make it yours", detail: "Pick your colours, fonts and style.", href: "/settings/branding", done: facts.branded > 0, visible: can("admin.branding.edit") },
  ].filter((s) => s.visible);
  const done = steps.filter((s) => s.done).length;
  const complete = done === steps.length;

  const checklist = (
    <details open={!complete} className="group rounded-[var(--radius,0.5rem)] border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer list-none">
        <span className="flex items-center justify-between gap-2">
          <span className="text-base font-semibold">{complete ? "You're all set up" : `Getting started: ${done} of ${steps.length} done`}</span>
          <span aria-hidden className="text-zinc-500 transition group-open:rotate-90">
            ›
          </span>
        </span>
        <span className="mt-3 block h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <span className="block h-full bg-[var(--brand)] transition-all" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
        </span>
      </summary>
      <ol className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
        {steps.map((step) => (
          <li key={step.title} className="flex items-start gap-3 py-3">
            <span
              aria-label={step.done ? "Done" : "To do"}
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step.done ? "bg-[var(--brand)] text-white" : "border-2 border-zinc-300 dark:border-zinc-600"
              }`}
            >
              {step.done ? "✓" : ""}
            </span>
            <div className="min-w-0 flex-1">
              {step.done && step.href === "/" ? (
                <p className="font-medium">{step.title}</p>
              ) : (
                <Link href={step.href} className="font-medium underline-offset-2 hover:underline">
                  {step.title}
                </Link>
              )}
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );

  const salesFor = (key: "today" | "week" | "month") => (dash.sales ?? []).map((s) => ({ currency: s.currency, cents: s[key] }));
  const todayCount = (dash.sales ?? []).reduce((n, s) => n + s.todayCount, 0);
  const showDaily = dash.daily && dash.daily.some((d) => Number(d.base) > 0);

  return (
    <>
      <PageHeader title={`Welcome to ${ctx.company.name}`} description={`Your business, in one place. ${formatDate(dates.today)}.`} />
      <Notice error={sp.error} success={sp.success} />
      {billingAdmin ? (
        <p className="mb-4 rounded-[var(--radius,0.5rem)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {STATUS_TEXT[ctx.company.status]?.label}.{" "}
          <Link href="/settings/billing" className="font-semibold underline">
            See your subscription and pay
          </Link>
        </p>
      ) : null}

      <div className="space-y-6">
        {!complete ? checklist : null}

        {dash.sales || dash.lowStock !== null ? (
          <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {dash.sales ? (
              <>
                <Tile label={`Sales today${todayCount ? ` (${todayCount} invoice${todayCount === 1 ? "" : "s"})` : ""}`} href="/reports/sales-by-day">
                  <Amounts items={salesFor("today")} empty="None yet" />
                </Tile>
                <Tile label="This week" href={`/reports/sales-by-day?from=${dates.weekStart}&to=${dates.today}`}>
                  <Amounts items={salesFor("week")} />
                </Tile>
                <Tile label="This month" href={`/reports/sales-by-day?from=${dates.monthStart}&to=${dates.today}`}>
                  <Amounts items={salesFor("month")} />
                </Tile>
                <Tile label="Customers owe you" href="/reports/debtors-ageing">
                  <Amounts items={(dash.owed ?? []).map((o) => ({ currency: o.currency, cents: o.total }))} empty="Nothing" />
                  {(dash.owed ?? []).some((o) => BigInt(o.overdue) > BigInt(0)) ? (
                    <p className="text-sm text-red-700 dark:text-red-300">
                      Overdue: {(dash.owed ?? []).filter((o) => BigInt(o.overdue) > BigInt(0)).map((o) => money(o.overdue, o.currency)).join(", ")}
                    </p>
                  ) : null}
                </Tile>
              </>
            ) : null}
            {dash.lowStock !== null ? (
              <Tile label="Low on stock" href="/stock">
                <p className={`text-2xl font-bold tabular-nums ${dash.lowStock ? "text-red-700 dark:text-red-300" : ""}`}>
                  {dash.lowStock} product{dash.lowStock === 1 ? "" : "s"}
                </p>
                <p className="text-sm text-zinc-500">At or below their reorder level</p>
              </Tile>
            ) : null}
          </section>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          {dash.paymentsToday ? (
            <Card title="Money received today">
              {dash.paymentsToday.length ? (
                <Bars
                  rows={dash.paymentsToday.map((p) => ({ label: METHOD_LABEL[p.method] ?? p.method, value: Number(p.total), shown: money(p.total, p.currency) }))}
                />
              ) : (
                <p className="text-sm text-zinc-500">No payments recorded today.</p>
              )}
            </Card>
          ) : null}

          {dash.topProducts ? (
            <Card title="Top products this month">
              {dash.topProducts.length ? (
                <Bars
                  rows={dash.topProducts.map((p) => ({ label: p.name, value: Number(p.base), shown: `${money(p.base, base)} · ${formatQuantity(p.quantity)} sold` }))}
                />
              ) : (
                <p className="text-sm text-zinc-500">No sales this month yet.</p>
              )}
              <p className="mt-3 text-xs text-zinc-500">Values in {currencyLabel(base)}, at each invoice&apos;s exchange rate.</p>
            </Card>
          ) : null}

          {showDaily && dash.daily ? (
            <Card title="Sales, last 14 days" className="lg:col-span-2">
              <div className="flex h-36 items-end gap-1" role="img" aria-label={`Daily sales in ${currencyLabel(base)} for the last 14 days`}>
                {dash.daily.map((d) => {
                  const max = Math.max(1, ...dash.daily!.map((x) => Number(x.base)));
                  return (
                    <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${formatDate(d.day)}: ${money(d.base, base)}`}>
                      <div className="rounded-t bg-[var(--brand,#0b6e4f)]" style={{ height: `${Math.max(1, (Number(d.base) / max) * 100)}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-xs text-zinc-500">
                <span>{formatDate(dash.daily[0].day)}</span>
                <span>Today</span>
              </div>
            </Card>
          ) : null}

          <Card title="Your activities" className={dash.paymentsToday ? "" : "lg:col-span-2"}>
            {dash.activities.length ? (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {dash.activities.map((a) => {
                  const overdue = a.due_on < dates.today;
                  const href = recordHref(a.doctype, a.record_id);
                  const text = `${ACTIVITY_LABEL[a.activity_type] ?? a.activity_type}: ${a.summary}`;
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                      {href ? (
                        <Link href={href} className="min-w-0 font-medium hover:underline">
                          {text}
                        </Link>
                      ) : (
                        <span className="min-w-0">{text}</span>
                      )}
                      <span className={`shrink-0 ${overdue ? "font-semibold text-red-700 dark:text-red-300" : "text-zinc-500"}`}>
                        {overdue ? "Overdue · " : a.due_on === dates.today ? "Today · " : ""}
                        {formatDate(a.due_on)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Nothing assigned to you. Activities you are given on customers and documents appear here.</p>
            )}
          </Card>
        </div>

        {complete ? checklist : null}
      </div>
    </>
  );
}
