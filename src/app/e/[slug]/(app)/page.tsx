import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/ui";
import { requireCompany } from "@/server/company";
import { withUser } from "@/server/data";

// P1: the guided setup checklist new companies see first.

interface Step {
  title: string;
  detail: string;
  href: string;
  done: boolean;
  visible: boolean;
}

export default async function Home({ params, searchParams }: PageProps<"/e/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(slug);
  const can = (p: string) => ctx.permissions.has(p);
  const otherCurrencies = (["USD", "ZWG", "ZAR"] as const).filter((c) => c !== ctx.company.baseCurrency);

  const facts = await withUser(ctx.userId, async (q) => {
    const id = ctx.company.id;
    const count = async (sql: string) => Number((await q<{ n: string }>(sql, [id])).rows[0]?.n ?? 0);
    return {
      ratesSet: await count("select count(distinct currency) as n from public.exchange_rates where company_id = $1"),
      modules: await count("select count(*) as n from public.company_modules where company_id = $1 and enabled"),
      products: can("core.products.view")
        ? await count("select count(*) as n from public.products where company_id = $1 and archived_at is null")
        : 0,
      customers: can("core.customers.view")
        ? await count("select count(*) as n from public.customers where company_id = $1 and archived_at is null")
        : 0,
      branded: await count(
        `select count(*) as n from public.company_branding b join public.companies c on c.id = b.company_id
         where b.company_id = $1 and b.updated_at > c.created_at + interval '1 second'`,
      ),
    };
  });

  const steps: Step[] = [
    {
      title: "Create your company",
      detail: `${ctx.company.name} is set up, with a head office and staff roles.`,
      href: "/",
      done: true,
      visible: true,
    },
    {
      title: "Choose your modules and features",
      detail: "Switch on what you use and hide what you don't.",
      href: "/settings/modules",
      done: facts.modules > 0,
      visible: can("admin.modules.manage"),
    },
    {
      title: "Set today's exchange rates",
      detail: `How much ${otherCurrencies.map((c) => (c === "ZWG" ? "ZiG" : c)).join(" and ")} one ${ctx.company.baseCurrency} buys. Change them whenever you like.`,
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
    {
      title: "Make it yours",
      detail: "Pick your colours, fonts and style.",
      href: "/settings/branding",
      done: facts.branded > 0,
      visible: can("admin.branding.edit"),
    },
  ].filter((s) => s.visible);
  const done = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader title={`Welcome to ${ctx.company.name}`} description="Your business, in one place." />
      <Notice error={sp.error} success={sp.success} />
      <Card title={done === steps.length ? "You're all set up" : `Getting started: ${done} of ${steps.length} done`}>
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full bg-[var(--brand)] transition-all" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
        </div>
        <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">
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
      </Card>
    </>
  );
}
