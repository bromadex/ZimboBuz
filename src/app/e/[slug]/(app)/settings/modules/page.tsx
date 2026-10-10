import { Card, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { setFeature, setModule } from "../../../actions";

// P2: choose modules, then switch individual features on or off. Switched-off
// features disappear from menus and are refused by the database.

interface ModuleRow {
  code: string;
  name: string;
  on_plan: boolean;
  enabled: boolean;
  counts_toward_limit: boolean;
}
interface FeatureRow {
  code: string;
  module_code: string;
  name: string;
  enabled: boolean;
}

function Switch({ on, label }: { on: boolean; label: string }) {
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-[var(--brand)]" : "bg-zinc-300 dark:bg-zinc-700"}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
    </button>
  );
}

export default async function ModulesPage({ params, searchParams }: PageProps<"/e/[slug]/settings/modules">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "admin.modules.manage");

  const { modules, features, limit } = await withUser(ctx.userId, async (q) => {
    const id = ctx.company.id;
    const modules = (
      await q<ModuleRow>(
        `select m.code, m.name, m.counts_toward_limit,
                exists (select 1 from public.plan_modules pm where pm.plan_code = c.plan_code and pm.module_code = m.code) as on_plan,
                coalesce(cm.enabled, false) as enabled
         from public.modules m
         cross join public.companies c
         left join public.company_modules cm on cm.company_id = c.id and cm.module_code = m.code
         where c.id = $1 and not m.is_core
         order by m.sort_order`,
        [id],
      )
    ).rows;
    const features = (
      await q<FeatureRow>(
        `select f.code, f.module_code, f.name, coalesce(cf.enabled, f.default_on) as enabled
         from public.features f
         left join public.company_features cf on cf.company_id = $1 and cf.feature_code = f.code
         order by f.module_code, f.name`,
        [id],
      )
    ).rows;
    const limit = (await q<{ max_modules: number | null }>(
      "select pl.max_modules from public.companies c join public.plans pl on pl.code = c.plan_code where c.id = $1",
      [id],
    )).rows[0]?.max_modules;
    return { modules, features, limit };
  });
  const counted = modules.filter((m) => m.enabled && m.counts_toward_limit).length;

  return (
    <>
      <PageHeader
        title="Modules and features"
        description={
          limit == null
            ? `Your ${ctx.company.planName} plan includes every module.`
            : `Your ${ctx.company.planName} plan includes up to ${limit} module${limit === 1 ? "" : "s"}; you are using ${counted}. The website does not count.`
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <div className="space-y-4">
        {modules.map((m) => {
          const moduleFeatures = features.filter((f) => f.module_code === m.code);
          return (
            <Card key={m.code}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold">{m.name}</h2>
                  <p className="text-sm text-zinc-500">
                    {!m.on_plan ? "Not included in your plan. Upgrade to use it." : m.enabled ? "On" : "Off"}
                  </p>
                </div>
                {m.on_plan ? (
                  <form action={setModule.bind(null, slug)}>
                    <input type="hidden" name="module" value={m.code} />
                    <input type="hidden" name="enabled" value={String(!m.enabled)} />
                    <Switch on={m.enabled} label={`${m.name}: ${m.enabled ? "switch off" : "switch on"}`} />
                  </form>
                ) : null}
              </div>
              {m.enabled && moduleFeatures.length ? (
                <ul className="mt-4 divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {moduleFeatures.map((f) => (
                    <li key={f.code} className="flex items-center justify-between gap-4 py-2 pl-2">
                      <span className="text-sm">{f.name}</span>
                      <form action={setFeature.bind(null, slug)}>
                        <input type="hidden" name="feature" value={f.code} />
                        <input type="hidden" name="enabled" value={String(!f.enabled)} />
                        <Switch on={f.enabled} label={`${f.name}: ${f.enabled ? "switch off" : "switch on"}`} />
                      </form>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
