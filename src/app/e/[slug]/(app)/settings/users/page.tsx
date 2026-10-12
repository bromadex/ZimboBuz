import { Badge, Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { userEmails } from "@/server/users";
import { inviteUser, setMemberStatus, updateMember } from "./actions";

// P3: who can use this company's ERP, with which role, as a full or light
// user. People are never deleted: their access is switched off instead.

interface Member {
  id: string;
  user_id: string;
  role_id: string;
  role_name: string;
  user_type: "full" | "light";
  status: "invited" | "active" | "disabled";
  created_at: Date;
  invited_at: Date | null;
}

const STATUS = {
  active: { label: "Active", tone: "ok" },
  invited: { label: "Invited", tone: "info" },
  disabled: { label: "Switched off", tone: "muted" },
} as const;

const TYPE_OPTIONS = [
  { value: "full", label: "Full user" },
  { value: "light", label: "Light user (view, approve, self-service)" },
];

export default async function UsersPage({ params, searchParams }: PageProps<"/e/[slug]/settings/users">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "admin.users.manage");

  const { members, roles, maxFull, isOwner } = await withUser(ctx.userId, async (q) => {
    const members = (
      await q<Member>(
        `select m.id, m.user_id, m.role_id, r.name as role_name, m.user_type, m.status, m.created_at, m.invited_at
         from public.memberships m join public.roles r on r.id = m.role_id
         where m.company_id = $1
         order by case m.status when 'active' then 0 when 'invited' then 1 else 2 end, m.created_at`,
        [ctx.company.id],
      )
    ).rows;
    const roles = (
      await q<{ id: string; name: string; code: string; is_system: boolean }>(
        "select id, name, code, is_system from public.roles where company_id = $1 and archived_at is null order by is_system desc, name",
        [ctx.company.id],
      )
    ).rows;
    const maxFull = (
      await q<{ max_full_users: number | null }>(
        "select pl.max_full_users from public.companies c join public.plans pl on pl.code = c.plan_code where c.id = $1",
        [ctx.company.id],
      )
    ).rows[0]?.max_full_users;
    const isOwner = (await q<{ ok: boolean }>("select app.is_owner($1) as ok", [ctx.company.id])).rows[0].ok;
    return { members, roles, maxFull, isOwner };
  });
  const emails = await userEmails(members.map((m) => m.user_id));
  const fullUsed = members.filter((m) => m.user_type === "full" && m.status !== "disabled").length;
  const roleOptions = roles
    .filter((r) => r.code !== "owner" || !r.is_system || isOwner) // only owners hand out the owner role
    .map((r) => ({ value: r.id, label: r.name }));
  const cashier = roles.find((r) => r.code === "cashier");

  return (
    <>
      <PageHeader
        title="Users"
        description={
          maxFull == null
            ? `Your ${ctx.company.planName} plan has no limit on full users.`
            : `Your ${ctx.company.planName} plan includes ${maxFull} full user${maxFull === 1 ? "" : "s"}; ${fullUsed} in use (invitations count). Light users do not count.`
        }
      />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ul className="space-y-3" aria-label="Users">
          {members.map((m) => {
            const me = m.user_id === ctx.userId;
            return (
              <li key={m.id} className="rounded-[var(--radius,0.5rem)] border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {emails.get(m.user_id) ?? "Unknown"} {me ? <span className="text-sm font-normal text-zinc-500">(you)</span> : null}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {m.role_name} · {m.user_type === "full" ? "Full user" : "Light user"}
                      {m.status === "invited" && m.invited_at ? ` · invited ${formatDate(m.invited_at)}` : ""}
                    </p>
                  </div>
                  <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                </div>
                {m.status !== "disabled" ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-[var(--brand,#0b6e4f)]">Change access</summary>
                    <form action={updateMember.bind(null, slug)} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                      <input type="hidden" name="id" value={m.id} />
                      <SelectField label="Role" name="role_id" defaultValue={m.role_id} options={roleOptions.some((o) => o.value === m.role_id) ? roleOptions : [{ value: m.role_id, label: m.role_name }, ...roleOptions]} />
                      <SelectField label="User type" name="user_type" defaultValue={m.user_type} options={TYPE_OPTIONS} />
                      <Button type="submit">Save</Button>
                    </form>
                    {!me ? (
                      <form action={setMemberStatus.bind(null, slug)} className="mt-3">
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="status" value="disabled" />
                        <Button type="submit" variant="secondary">
                          {m.status === "invited" ? "Cancel invitation" : "Switch off access"}
                        </Button>
                      </form>
                    ) : null}
                  </details>
                ) : (
                  <form action={setMemberStatus.bind(null, slug)} className="mt-3">
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="status" value="active" />
                    <Button type="submit" variant="secondary">
                      Switch access back on
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>

        <Card title="Invite someone" className="self-start">
          <form action={inviteUser.bind(null, slug)} className="space-y-4">
            <Field label="Email address" name="email" type="email" required placeholder="rudo@example.co.zw" />
            <SelectField label="Role" name="role_id" defaultValue={cashier?.id} options={roleOptions} />
            <SelectField label="User type" name="user_type" defaultValue="full" options={TYPE_OPTIONS} />
            <p className="text-xs text-zinc-500">
              They sign in at this address with their email and accept the invitation. Roles decide what they can do; see Roles.
            </p>
            <Button type="submit" className="w-full">
              Invite
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
