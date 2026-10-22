import Link from "next/link";
import { completeActivity, postMessage, scheduleActivity, setFollowing } from "@/app/e/[slug]/(app)/record-actions";
import { formatDate, formatDateTime, todayIso } from "@/lib/format";
import { connectionHref } from "@/lib/doctypes";
import type { CompanyContext } from "@/server/company";
import { withUser } from "@/server/data";
import { companyMembers, userEmails } from "@/server/users";
import { Button } from "./ui";

// The panel beside every record (P14, P15): linked records with counts
// (smart buttons), the timeline of messages, notes and system events,
// followers, and scheduled activities.

const ACTIVITY_LABEL: Record<string, string> = { call: "Call", meeting: "Meeting", todo: "To do", email: "Email", visit: "Visit" };

export async function Connections({ ctx, doctype, recordId }: { ctx: CompanyContext; doctype: string; recordId: string }) {
  const links = await withUser(ctx.userId, async (q) =>
    (
      await q<{ doctype: string; link_column: string; label: string; record_count: string }>(
        "select doctype, link_column, label, record_count from public.record_connections($1, $2, $3)",
        [ctx.company.id, doctype, recordId],
      ).catch(() => ({ rows: [] }))
    ).rows,
  );
  const shown = links.filter((l) => connectionHref(l.doctype, l.link_column, recordId));
  if (shown.length === 0) return null;
  return (
    <nav aria-label="Connected records" className="mb-4 flex flex-wrap gap-2">
      {shown.map((l) => (
        <Link
          key={`${l.doctype}-${l.link_column}`}
          href={connectionHref(l.doctype, l.link_column, recordId)!}
          className="inline-flex items-center gap-2 rounded-[var(--radius,0.5rem)] border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:border-[var(--brand)] dark:border-zinc-800 dark:bg-zinc-900"
        >
          {l.label}
          <span className="rounded-full bg-zinc-100 px-2 text-xs tabular-nums dark:bg-zinc-800">{l.record_count}</span>
        </Link>
      ))}
    </nav>
  );
}

export async function ActivityPanel({
  ctx,
  slug,
  doctype,
  recordId,
  back,
}: {
  ctx: CompanyContext;
  slug: string;
  doctype: string;
  recordId: string;
  /** This record's page, to come back to after posting. */
  back: string;
}) {
  const data = await withUser(ctx.userId, async (q) => {
    const messages = (
      await q<{ id: string; kind: string; body: string; author_id: string | null; created_at: Date }>(
        `select id, kind, body, author_id, created_at from public.record_messages
         where company_id = $1 and doctype = $2 and record_id = $3 order by created_at desc limit 50`,
        [ctx.company.id, doctype, recordId],
      )
    ).rows;
    const activities = (
      await q<{ id: string; activity_type: string; summary: string; due_on: string; assigned_to: string; created_by: string; status: string }>(
        `select id, activity_type, summary, to_char(due_on, 'YYYY-MM-DD') as due_on, assigned_to, created_by, status
         from public.record_activities where company_id = $1 and doctype = $2 and record_id = $3
         order by (status = 'open') desc, due_on limit 30`,
        [ctx.company.id, doctype, recordId],
      )
    ).rows;
    const followers = (
      await q<{ user_id: string }>(
        `select user_id from public.record_followers where company_id = $1 and doctype = $2 and record_id = $3 and active`,
        [ctx.company.id, doctype, recordId],
      )
    ).rows.map((r) => r.user_id);
    return { messages, activities, followers };
  });
  const members = await companyMembers(ctx.company.id);
  const names = await userEmails([...data.messages.map((m) => m.author_id), ...data.activities.map((a) => a.assigned_to), ...data.followers]);
  const who = (id: string | null) => (id === ctx.userId ? "You" : id ? (names.get(id) ?? "A colleague") : "ZimERP");
  const following = data.followers.includes(ctx.userId);
  const today = todayIso();
  const hidden = (
    <>
      <input type="hidden" name="doctype" value={doctype} />
      <input type="hidden" name="record_id" value={recordId} />
    </>
  );

  return (
    <aside aria-label="Activity" className="space-y-5 text-sm">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Activities</h2>
          <form action={setFollowing.bind(null, slug, back)}>
            {hidden}
            <input type="hidden" name="follow" value={String(!following)} />
            <button type="submit" className="text-xs font-semibold text-[var(--brand)] underline">
              {following ? "Unfollow" : "Follow"}
            </button>
          </form>
        </div>
        <p className="mb-2 text-xs text-zinc-500">
          {data.followers.length ? `Followed by ${data.followers.map(who).join(", ")}.` : "Nobody follows this yet."}
        </p>
        <ul className="mb-3 space-y-2">
          {data.activities.map((a) => (
            <li
              key={a.id}
              className={`rounded-[var(--radius)] border px-3 py-2 ${
                a.status !== "open"
                  ? "border-zinc-200 text-zinc-500 line-through dark:border-zinc-800"
                  : a.due_on < today
                    ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950"
                    : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <p>
                <span className="font-semibold">{ACTIVITY_LABEL[a.activity_type]}</span>: {a.summary}
              </p>
              <p className="text-xs text-zinc-500">
                {who(a.assigned_to)} · due {formatDate(a.due_on)}
                {a.status === "open" && a.due_on < today ? " · overdue" : ""}
              </p>
              {a.status === "open" && (a.assigned_to === ctx.userId || a.created_by === ctx.userId) ? (
                <form action={completeActivity.bind(null, slug, back)} className="mt-1 flex gap-3">
                  <input type="hidden" name="id" value={a.id} />
                  <button name="status" value="done" className="text-xs font-semibold text-[var(--brand)] underline">
                    Mark done
                  </button>
                  <button name="status" value="cancelled" className="text-xs text-zinc-500 underline">
                    Cancel
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        <details className="rounded-[var(--radius)] border border-zinc-200 p-3 dark:border-zinc-800">
          <summary className="cursor-pointer font-medium">Schedule an activity</summary>
          <form action={scheduleActivity.bind(null, slug, back)} className="mt-3 space-y-2">
            {hidden}
            <div className="grid grid-cols-2 gap-2">
              <select name="activity_type" className="rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950" aria-label="Type">
                {Object.entries(ACTIVITY_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <input type="date" name="due_on" defaultValue={today} required aria-label="Due on" className="rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950" />
            </div>
            <input name="summary" required placeholder="What needs doing?" aria-label="Summary" className="w-full rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950" />
            <select name="assigned_to" defaultValue={ctx.userId} aria-label="Assigned to" className="w-full rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950">
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === ctx.userId ? `Me (${m.email})` : m.email}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" className="w-full">
              Schedule
            </Button>
          </form>
        </details>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Timeline</h2>
        <form action={postMessage.bind(null, slug, back)} className="mb-3 space-y-2">
          {hidden}
          <textarea name="body" rows={2} required placeholder="Write a message or a private note" aria-label="Message" className="w-full rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950" />
          <div className="flex gap-2">
            <Button type="submit" name="kind" value="message" variant="secondary">
              Post
            </Button>
            <Button type="submit" name="kind" value="note" variant="secondary">
              Add note
            </Button>
          </div>
        </form>
        <ol className="space-y-2 border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
          {data.messages.map((m) => (
            <li key={m.id}>
              <p className="text-xs text-zinc-500">
                {who(m.author_id)} · {formatDateTime(m.created_at)}
                {m.kind === "note" ? " · note" : ""}
              </p>
              <p className={m.kind === "system" ? "italic text-zinc-600 dark:text-zinc-400" : "whitespace-pre-wrap"}>{m.body}</p>
            </li>
          ))}
          {data.messages.length === 0 ? <li className="text-zinc-500">No activity yet.</li> : null}
        </ol>
      </section>
    </aside>
  );
}
