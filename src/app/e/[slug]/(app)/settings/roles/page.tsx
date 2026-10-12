import Link from "next/link";
import { Badge, Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { archiveRole, createRole, renameRole, saveRolePermissions } from "./actions";

// P3 and P17: roles and what they allow, grouped by module, plus the fields
// hidden from roles without a particular permission (such as cost prices).

interface Role {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  members: number;
  permissions: number;
}
interface Permission {
  code: string;
  module_code: string;
  module_name: string;
  feature_name: string | null;
  description: string;
  light_ok: boolean;
  on_plan: boolean;
  granted: boolean;
}

const FIELD_LABEL: Record<string, string> = { avg_cost: "Average cost (and margins)" };
const humanise = (s: string) => FIELD_LABEL[s] ?? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export default async function RolesPage({ params, searchParams }: PageProps<"/e/[slug]/settings/roles">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "admin.roles.manage");
  const id = ctx.company.id;

  const data = await withUser(ctx.userId, async (q) => {
    const roles = (
      await q<Role>(
        `select r.id, r.code, r.name, r.is_system,
                (select count(*)::int from public.memberships m where m.role_id = r.id and m.status in ('active','invited')) as members,
                (select count(*)::int from public.role_permissions rp where rp.role_id = r.id) as permissions
         from public.roles r where r.company_id = $1 and r.archived_at is null
         order by (r.code = 'owner' and r.is_system) desc, r.is_system desc, r.name`,
        [id],
      )
    ).rows;
    const selected = roles.find((r) => r.id === sp.role) ?? roles[0];
    const permissions = (
      await q<Permission>(
        `select p.code, p.module_code, mo.name as module_name, f.name as feature_name, p.description, p.light_ok,
                (mo.is_core or exists (select 1 from public.plan_modules pm join public.companies c on c.plan_code = pm.plan_code
                                       where c.id = $1 and pm.module_code = mo.code)) as on_plan,
                exists (select 1 from public.role_permissions rp where rp.role_id = $2 and rp.permission_code = p.code) as granted
         from public.permissions p
         join public.modules mo on mo.code = p.module_code
         left join public.features f on f.code = p.feature_code
         order by mo.sort_order, p.code`,
        [id, selected.id],
      )
    ).rows;
    const restricted = (
      await q<{ doctype: string; doctype_name: string; column_name: string; permission_code: string; description: string; roles: string[] | null }>(
        `select rf.doctype, d.name as doctype_name, rf.column_name, rf.permission_code, p.description,
                (select array_agg(r.name order by r.name) from public.role_permissions rp join public.roles r on r.id = rp.role_id
                 where rp.permission_code = rf.permission_code and r.company_id = $1 and r.archived_at is null) as roles
         from public.restricted_fields rf
         join public.doctypes d on d.code = rf.doctype
         join public.permissions p on p.code = rf.permission_code
         order by d.name, rf.column_name`,
        [id],
      )
    ).rows;
    return { roles, selected, permissions, restricted };
  });
  const { roles, selected, permissions, restricted } = data;
  const isOwnerRole = selected.code === "owner" && selected.is_system;
  const modules = [...new Map(permissions.map((p) => [p.module_code, p.module_name])).entries()];

  return (
    <>
      <PageHeader title="Roles" description="A role is a set of permissions. Give each person the role that matches their job; change a role and everyone with it changes." />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <nav aria-label="Roles" className="overflow-hidden rounded-[var(--radius,0.5rem)] border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            {roles.map((r) => (
              <Link
                key={r.id}
                href={`/settings/roles?role=${r.id}`}
                aria-current={r.id === selected.id ? "page" : undefined}
                className={`flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 text-sm last:border-b-0 dark:border-zinc-800 ${
                  r.id === selected.id ? "bg-zinc-100 font-semibold dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}
              >
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {r.members} {r.members === 1 ? "person" : "people"}
                </span>
              </Link>
            ))}
          </nav>
          <Card title="New role">
            <form action={createRole.bind(null, slug)} className="space-y-3">
              <Field label="Name" name="name" required placeholder="Senior cashier" />
              <SelectField
                label="Start from"
                name="copy_from"
                defaultValue={selected.id}
                options={[{ value: "", label: "No permissions" }, ...roles.map((r) => ({ value: r.id, label: `Copy of ${r.name}` }))]}
              />
              <Button type="submit" className="w-full">
                Create role
              </Button>
            </form>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <p className="text-sm text-zinc-500">
                  {selected.is_system ? "Built-in role" : "Custom role"} · {selected.permissions} permission{selected.permissions === 1 ? "" : "s"} ·{" "}
                  {selected.members} {selected.members === 1 ? "person" : "people"}
                </p>
              </div>
              {!selected.is_system ? (
                <form action={archiveRole.bind(null, slug)}>
                  <input type="hidden" name="id" value={selected.id} />
                  <Button type="submit" variant="secondary" disabled={selected.members > 0} title={selected.members > 0 ? "Move everyone off this role first" : undefined}>
                    Archive role
                  </Button>
                </form>
              ) : null}
            </div>
            {!isOwnerRole ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--brand,#0b6e4f)]">Rename</summary>
                <form action={renameRole.bind(null, slug, selected.id)} className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="min-w-48 flex-1">
                    <Field label="Name" name="name" defaultValue={selected.name} required />
                  </div>
                  <Button type="submit" variant="secondary">
                    Rename
                  </Button>
                </form>
              </details>
            ) : (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">The owner role always has every permission, so it cannot be changed.</p>
            )}
          </Card>

          <form action={saveRolePermissions.bind(null, slug, selected.id)} className="space-y-4">
            {modules.map(([code, name]) => (
              <fieldset key={code} className="rounded-[var(--radius,0.5rem)] border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <legend className="px-1 text-sm font-semibold">{name}</legend>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {permissions
                    .filter((p) => p.module_code === code)
                    .map((p) => (
                      <li key={p.code}>
                        <label className="flex items-start gap-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            name="perm"
                            value={p.code}
                            defaultChecked={p.granted}
                            disabled={isOwnerRole}
                            className="mt-0.5 size-4 shrink-0 accent-[var(--brand,#0b6e4f)]"
                          />
                          <span className="min-w-0 flex-1">
                            {p.description}
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              {!p.light_ok ? <Badge>Full users only</Badge> : null}
                              {p.feature_name ? <Badge tone="info">Needs: {p.feature_name}</Badge> : null}
                              {!p.on_plan ? <Badge tone="draft">Not in your plan</Badge> : null}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                </ul>
              </fieldset>
            ))}
            {!isOwnerRole ? (
              <div className="sticky bottom-0 -mx-1 bg-white/90 px-1 py-3 backdrop-blur dark:bg-zinc-950/90">
                <Button type="submit">Save permissions</Button>
              </div>
            ) : null}
          </form>

          <Card title="Hidden fields">
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              Some details are hidden from screens, reports and exports unless a role has the permission that unlocks them.
            </p>
            <ul className="space-y-2 text-sm">
              {restricted.map((f) => (
                <li key={`${f.doctype}.${f.column_name}`} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                  <p className="font-medium">
                    {f.doctype_name}: {humanise(f.column_name)}
                  </p>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    Unlocked by “{f.description}”. Roles with it: {f.roles?.join(", ") ?? "none"}.
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
