import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Facts, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { currencyLabel } from "@/lib/format";
import { requireCompany } from "@/server/company";
import { withUser } from "@/server/data";
import { addBranch, archiveBranch, renameBranch, restoreBranch, saveCompanyName, saveTax, saveTwoStepRequirement } from "./actions";

// Company settings: details, VAT, two-step requirement and branches.

interface Branch {
  id: string;
  code: string;
  name: string;
  is_head_office: boolean;
  archived_at: Date | null;
}

export default async function CompanyPage({ params, searchParams }: PageProps<"/e/[slug]/settings/company">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(slug);
  const can = (p: string) => ctx.permissions.has(p);
  if (!can("admin.company.edit") && !can("core.settings.tax")) redirect("/?error=" + encodeURIComponent("You do not have permission to open that page."));

  const data = await withUser(ctx.userId, async (q) => {
    const company = (
      await q<{ vat_number: string | null; max_branches: number | null }>(
        "select c.vat_number, pl.max_branches from public.companies c join public.plans pl on pl.code = c.plan_code where c.id = $1",
        [ctx.company.id],
      )
    ).rows[0];
    const branches = (
      await q<Branch>(
        "select id, code, name, is_head_office, archived_at from public.branches where company_id = $1 order by archived_at nulls first, is_head_office desc, name",
        [ctx.company.id],
      )
    ).rows;
    const requireTwoStep = (await q<{ r: boolean }>("select app.requires_two_step($1) as r", [ctx.company.id])).rows[0].r;
    return { ...company, branches, requireTwoStep };
  });
  const activeBranches = data.branches.filter((b) => !b.archived_at).length;
  const canBranches = can("admin.branches.manage");

  return (
    <>
      <PageHeader title="Company" description="Your company's details, VAT settings and branches." />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Details">
          <Facts
            items={[
              ["Plan", <Link key="p" href="/settings/billing" className="underline">{ctx.company.planName}</Link>],
              ["ERP address", `erp.${ctx.company.slug}`],
              ["Base currency", currencyLabel(ctx.company.baseCurrency)],
            ]}
          />
          <p className="mt-3 text-xs text-zinc-500">The web address and base currency are fixed once your books exist. Contact ZimERP support to change them.</p>
          {can("admin.company.edit") ? (
            <form action={saveCompanyName.bind(null, slug)} className="mt-4 flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <Field label="Company name" name="name" defaultValue={ctx.company.name} required maxLength={120} />
              </div>
              <Button type="submit">Save</Button>
            </form>
          ) : (
            <p className="mt-4 font-medium">{ctx.company.name}</p>
          )}
        </Card>

        <Card title="VAT">
          {can("core.settings.tax") ? (
            <form action={saveTax.bind(null, slug)} className="space-y-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" name="vat_registered" defaultChecked={ctx.company.vatRegistered} className="size-4 accent-[var(--brand,#0b6e4f)]" />
                Registered for VAT with ZIMRA
              </label>
              <Field label="VAT number" name="vat_number" defaultValue={data.vat_number ?? ""} hint="Printed on invoices and receipts. Needed when registered." />
              <SelectField
                label="Your prices"
                name="prices_include_tax"
                defaultValue={ctx.company.pricesIncludeTax ? "yes" : "no"}
                options={[
                  { value: "yes", label: "Include VAT (shelf prices)" },
                  { value: "no", label: "Exclude VAT (VAT added on top)" },
                ]}
              />
              <Button type="submit">Save VAT settings</Button>
            </form>
          ) : (
            <Facts
              items={[
                ["Registered", ctx.company.vatRegistered ? "Yes" : "No"],
                ["VAT number", data.vat_number ?? "—"],
                ["Prices", ctx.company.pricesIncludeTax ? "Include VAT" : "Exclude VAT"],
              ]}
            />
          )}
        </Card>

        {can("admin.company.edit") ? (
          <Card title="Sign-in security">
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              Require two-step sign-in (a code from an authenticator app) for everyone who manages the company: users, roles, billing, settings.
              They are asked to set it up the next time they open the ERP.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge tone={data.requireTwoStep ? "ok" : "muted"}>{data.requireTwoStep ? "Required" : "Optional"}</Badge>
              <form action={saveTwoStepRequirement.bind(null, slug)}>
                <input type="hidden" name="require" value={String(!data.requireTwoStep)} />
                <Button type="submit" variant="secondary">
                  {data.requireTwoStep ? "Make it optional" : "Require two-step sign-in"}
                </Button>
              </form>
            </div>
            {!ctx.twoStep.enabled ? (
              <p className="mt-3 text-xs text-zinc-500">
                You have not turned it on for yourself yet. <Link href="/account/security" className="underline">Set it up</Link>.
              </p>
            ) : null}
          </Card>
        ) : null}

        <Card title="Branches">
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            {data.max_branches == null
              ? `Your ${ctx.company.planName} plan has no limit on branches.`
              : `Your ${ctx.company.planName} plan includes ${data.max_branches} branch${data.max_branches === 1 ? "" : "es"}; ${activeBranches} in use.`}
          </p>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.branches.map((b) => (
              <li key={b.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={b.archived_at ? "text-zinc-500 line-through" : "font-medium"}>
                    <span className="mr-2 font-mono text-xs">{b.code}</span>
                    {b.name}
                  </p>
                  <span className="flex gap-1">
                    {b.is_head_office ? <Badge tone="info">Head office</Badge> : null}
                    {b.archived_at ? <Badge>Archived</Badge> : null}
                  </span>
                </div>
                {canBranches && !b.archived_at ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-semibold text-[var(--brand,#0b6e4f)]">Change</summary>
                    <form action={renameBranch.bind(null, slug)} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={b.id} />
                      <div className="min-w-40 flex-1">
                        <Field label="Name" name="name" defaultValue={b.name} required />
                      </div>
                      <Button type="submit" variant="secondary">
                        Rename
                      </Button>
                    </form>
                    {!b.is_head_office ? (
                      <form action={archiveBranch.bind(null, slug)} className="mt-2">
                        <input type="hidden" name="id" value={b.id} />
                        <Button type="submit" variant="secondary">
                          Archive branch
                        </Button>
                      </form>
                    ) : null}
                  </details>
                ) : null}
                {canBranches && b.archived_at ? (
                  <form action={restoreBranch.bind(null, slug)} className="mt-2">
                    <input type="hidden" name="id" value={b.id} />
                    <Button type="submit" variant="secondary">
                      Restore
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          {canBranches ? (
            <form action={addBranch.bind(null, slug)} className="mt-4 grid gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-[7rem_1fr_auto] sm:items-end dark:border-zinc-800">
              <Field label="Code" name="code" required placeholder="BYO" maxLength={6} />
              <Field label="Branch name" name="name" required placeholder="Bulawayo" />
              <Button type="submit">Add branch</Button>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}
