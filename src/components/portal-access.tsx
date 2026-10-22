import Link from "next/link";
import { invitePortalUser, setPortalAccess } from "@/app/e/[slug]/(app)/customers/[id]/portal-actions";
import { Badge, Button, Card, Field } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { CompanyContext } from "@/server/company";
import { withUser } from "@/server/data";
import { userEmails } from "@/server/users";

// Customer portal access for a customer (P19): who may sign in on the company
// website to see this customer's quotes, invoices, payments and statement.

const STATUS = {
  invited: { tone: "draft", label: "Invited" },
  active: { tone: "ok", label: "Active" },
  disabled: { tone: "muted", label: "Switched off" },
} as const;

export async function PortalAccess({ ctx, slug, customerId }: { ctx: CompanyContext; slug: string; customerId: string }) {
  const canManage = ctx.permissions.has("portal.manage");
  if (!canManage) {
    // Admins are told where the portal is switched on; others see nothing.
    if (!ctx.permissions.has("admin.modules.manage")) return null;
    return (
      <Card title="Customer portal">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Let customers see their own quotes, invoices and statements online by switching on the{" "}
          <Link href="/settings/modules" className="font-semibold underline">
            customer portal
          </Link>{" "}
          module{ctx.company.planCode === "starter" ? " (not included on the Starter plan)" : ""}.
        </p>
      </Card>
    );
  }

  const data = await withUser(ctx.userId, async (q) => {
    const users = (
      await q<{ id: string; user_id: string; status: keyof typeof STATUS; invited_at: Date; last_seen_at: Date | null }>(
        `select id, user_id, status, invited_at, last_seen_at from public.portal_users
         where company_id = $1 and customer_id = $2 order by invited_at`,
        [ctx.company.id, customerId],
      )
    ).rows;
    const email = (await q<{ email: string | null }>("select email from public.customers where company_id = $1 and id = $2", [ctx.company.id, customerId])).rows[0]?.email;
    return { users, email };
  });
  const emails = await userEmails(data.users.map((u) => u.user_id));

  return (
    <Card title="Customer portal">
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        People you invite sign in on your website at <code>/account</code> and see only this customer’s quotes, invoices, payments and statement. They can accept quotes there.
      </p>
      {data.users.length ? (
        <ul className="mb-4 divide-y divide-zinc-200 rounded-[var(--radius)] border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {data.users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 break-all font-medium">{emails.get(u.user_id) ?? "Unknown"}</span>
              <Badge tone={STATUS[u.status].tone}>{STATUS[u.status].label}</Badge>
              <span className="text-xs text-zinc-500">{u.last_seen_at ? `Last signed in ${formatDateTime(u.last_seen_at)}` : `Invited ${formatDateTime(u.invited_at)}`}</span>
              <form action={setPortalAccess.bind(null, slug, customerId)}>
                <input type="hidden" name="id" value={u.id} />
                <input type="hidden" name="enable" value={u.status === "disabled" ? "true" : "false"} />
                <button type="submit" className={`text-xs font-semibold underline ${u.status === "disabled" ? "" : "text-red-700 dark:text-red-400"}`}>
                  {u.status === "disabled" ? "Switch on again" : "Switch off"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      <form action={invitePortalUser.bind(null, slug, customerId)} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field label="Invite by email" name="email" type="email" required defaultValue={data.users.length ? "" : (data.email ?? "")} placeholder="customer@example.com" />
        </div>
        <Button type="submit" variant="secondary">
          Invite to portal
        </Button>
      </form>
    </Card>
  );
}
