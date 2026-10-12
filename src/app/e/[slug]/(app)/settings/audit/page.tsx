import { ListView } from "@/components/list-view";
import { Badge, Button, Field, Notice, PageHeader } from "@/components/ui";
import { auditChanges } from "@/lib/audit-diff";
import { formatDateTime, todayIso } from "@/lib/format";
import { likePattern, listParams, withParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { userEmails } from "@/server/users";

// P12: the audit log. Every create and change to business records is kept
// with who did it and the values before and after; nothing here can be
// edited or removed.

const SORTS = [
  { value: "newest", label: "Newest first", sql: "a.at desc, a.id desc" },
  { value: "oldest", label: "Oldest first", sql: "a.at, a.id" },
];

const TABLE_LABEL: Record<string, string> = {
  companies: "Company",
  company_branding: "Brand kit",
  company_modules: "Modules",
  company_features: "Features",
  company_domains: "Domains",
  company_preferences: "Preferences",
  branches: "Branches",
  roles: "Roles",
  role_permissions: "Role permissions",
  memberships: "Users",
  customers: "Customers",
  suppliers: "Suppliers",
  products: "Products",
  subscription_invoices: "Subscription",
};
const label = (t: string) => TABLE_LABEL[t] ?? t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const PERIODS = [
  { value: "today", label: "Today", days: 0 },
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
];

type Row = {
  id: string;
  at: Date;
  table_name: string;
  record_id: string;
  action: "insert" | "update";
  actor_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function AuditPage({ params, searchParams }: PageProps<"/e/[slug]/settings/audit">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "admin.audit.view");
  const lp = listParams(sp, { sorts: SORTS, pageSize: 30 });
  const table = lp.get("table") ?? "";
  const user = lp.get("user") ?? "";
  const period = PERIODS.find((p) => p.value === lp.get("period"));
  const today = todayIso();
  let from = ISO.test(lp.get("from") ?? "") ? lp.get("from")! : "";
  const to = ISO.test(lp.get("to") ?? "") ? lp.get("to")! : "";
  if (period) from = new Date(Date.parse(`${today}T00:00:00Z`) - period.days * 86_400_000).toISOString().slice(0, 10);

  const data = await withUser(ctx.userId, async (q) => {
    const where = `a.company_id = $1
      and ($2 = '' or a.table_name = $2)
      and ($3 = '' or a.actor_id::text = $3)
      and ($4 = '' or a.at >= ($4::date::timestamp at time zone 'Africa/Harare'))
      and ($5 = '' or a.at < (($5::date + 1)::timestamp at time zone 'Africa/Harare'))
      and ($6 = '' or a.record_id ilike $7 or a.after::text ilike $7)`;
    const args = [ctx.company.id, table, user, from, to, lp.q, likePattern(lp.q)];
    const total = Number((await q<{ n: string }>(`select count(*) as n from public.audit_events a where ${where}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select a.id::text as id, a.at, a.table_name, a.record_id, a.action, a.actor_id, a.before, a.after
         from public.audit_events a where ${where} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    const tables = (await q<{ table_name: string }>("select distinct table_name from public.audit_events where company_id = $1 order by 1", [ctx.company.id])).rows;
    const actors = (await q<{ actor_id: string }>("select distinct actor_id from public.audit_events where company_id = $1 and actor_id is not null", [ctx.company.id]))
      .rows;
    const roles = (await q<{ id: string; name: string }>("select id::text, name from public.roles where company_id = $1", [ctx.company.id])).rows;
    const branches = (await q<{ id: string; name: string }>("select id::text, name from public.branches where company_id = $1", [ctx.company.id])).rows;
    return { total, rows, tables, actors, roles, branches };
  });
  const emails = await userEmails([...data.actors.map((a) => a.actor_id), ...data.rows.map((r) => (r.after?.user_id as string) ?? null)]);
  // Show names instead of ids where we know them.
  const names = new Map<string, string>([...data.roles.map((r) => [r.id, r.name] as const), ...data.branches.map((b) => [b.id, b.name] as const), ...emails]);
  const named = (v: string) => names.get(v) ?? v;

  return (
    <>
      <PageHeader title="Audit log" description="Every change to your records: who, when, and the values before and after. Entries can never be changed or removed." />
      <Notice error={sp.error} success={sp.success} />
      <form method="get" action="/settings/audit" className="mb-3 flex flex-wrap items-end gap-2">
        {table ? <input type="hidden" name="table" value={table} /> : null}
        {user ? <input type="hidden" name="user" value={user} /> : null}
        {lp.q ? <input type="hidden" name="q" value={lp.q} /> : null}
        <Field label="From" name="from" type="date" defaultValue={period ? "" : from} max={today} />
        <Field label="To" name="to" type="date" defaultValue={to} max={today} />
        <Button type="submit" variant="secondary">
          Show dates
        </Button>
        {from || to ? (
          <a href={`/settings/audit${withParams(sp, { from: undefined, to: undefined, period: undefined, page: undefined })}`} className="pb-2 text-sm underline">
            Any date
          </a>
        ) : null}
      </form>
      <ListView<Row>
        path="/settings/audit"
        sp={sp}
        params={lp}
        total={data.total}
        rows={data.rows}
        sorts={SORTS}
        searchLabel="Search values or record ids"
        empty="Nothing has been logged yet."
        filters={[
          { name: "table", label: "Record type", options: data.tables.map((t) => ({ value: t.table_name, label: label(t.table_name) })) },
          { name: "user", label: "Who", options: data.actors.map((a) => ({ value: a.actor_id, label: emails.get(a.actor_id) ?? "Unknown" })) },
          { name: "period", label: "When", options: PERIODS.map((p) => ({ value: p.value, label: p.label })) },
        ]}
        columns={[
          { label: "When", cell: (r) => formatDateTime(r.at), className: "whitespace-nowrap" },
          { label: "Who", cell: (r) => (r.actor_id ? emails.get(r.actor_id) ?? "Unknown" : "ZimERP (automatic)") },
          {
            label: "What",
            cell: (r) => (
              <span className="flex flex-wrap items-center gap-1">
                <Badge tone={r.action === "insert" ? "info" : "draft"}>{r.action === "insert" ? "Created" : "Changed"}</Badge>
                {label(r.table_name)}
                {r.after?.name ? <span className="text-zinc-500">· {String(r.after.name)}</span> : null}
                {r.after?.role ? <span className="text-zinc-500">· {String(r.after.role)}</span> : null}
              </span>
            ),
          },
          {
            label: "Details",
            cell: (r) => {
              const changes = auditChanges(r.before, r.after);
              if (!changes.length) return <span className="text-zinc-500">No visible change</span>;
              return (
                <details>
                  <summary className="cursor-pointer text-sm">
                    {changes.length} field{changes.length === 1 ? "" : "s"}
                  </summary>
                  <table className="mt-2 text-xs">
                    <tbody>
                      {changes.map((c) => (
                        <tr key={c.field} className="align-top">
                          <th className="pr-2 text-left font-semibold">{c.field}</th>
                          {r.action === "update" ? <td className="pr-2 text-red-700 line-through dark:text-red-300 break-all">{named(c.before)}</td> : null}
                          <td className="text-emerald-800 dark:text-emerald-300 break-all">{named(c.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              );
            },
          },
        ]}
      />
    </>
  );
}
