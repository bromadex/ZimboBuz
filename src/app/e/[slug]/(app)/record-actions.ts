"use server";

import { act, text, UserError, uuid } from "@/server/act";

// Activity panel actions (P14): messages, notes, following and scheduled activities.

const TYPES = ["call", "meeting", "todo", "email", "visit"];

export async function postMessage(slug: string, back: string, formData: FormData): Promise<never> {
  return act(slug, back, formData.get("kind") === "note" ? "Note added." : "Message posted.", async (q, ctx) => {
    const body = text(formData, "body");
    if (!body) throw new UserError("Please write something first.");
    await q(
      `insert into public.record_messages (company_id, doctype, record_id, kind, body, author_id)
       values ($1, $2, $3, $4, $5, auth.uid())`,
      [ctx.company.id, text(formData, "doctype"), uuid(formData, "record_id"), formData.get("kind") === "note" ? "note" : "message", body.slice(0, 10000)],
    );
  });
}

export async function setFollowing(slug: string, back: string, formData: FormData): Promise<never> {
  const follow = text(formData, "follow") === "true";
  return act(slug, back, follow ? "You are following this record." : "You stopped following this record.", (q, ctx) =>
    q(
      `insert into public.record_followers (company_id, doctype, record_id, user_id, active)
       values ($1, $2, $3, auth.uid(), $4)
       on conflict (company_id, doctype, record_id, user_id) do update set active = excluded.active`,
      [ctx.company.id, text(formData, "doctype"), uuid(formData, "record_id"), follow],
    ),
  );
}

export async function scheduleActivity(slug: string, back: string, formData: FormData): Promise<never> {
  return act(slug, back, "Activity scheduled.", async (q, ctx) => {
    const type = text(formData, "activity_type");
    const summary = text(formData, "summary");
    const due = text(formData, "due_on");
    if (!TYPES.includes(type)) throw new UserError("Please choose a type of activity.");
    if (!summary) throw new UserError("Please say what needs doing.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new UserError("Please choose a due date.");
    await q(
      `insert into public.record_activities (company_id, doctype, record_id, activity_type, summary, due_on, assigned_to, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, auth.uid())`,
      [ctx.company.id, text(formData, "doctype"), uuid(formData, "record_id"), type, summary.slice(0, 500), due, uuid(formData, "assigned_to", "who will do it")],
    );
  });
}

export async function completeActivity(slug: string, back: string, formData: FormData): Promise<never> {
  const status = text(formData, "status") === "cancelled" ? "cancelled" : "done";
  return act(slug, back, status === "done" ? "Marked as done." : "Activity cancelled.", async (q, ctx) => {
    const r = await q("update public.record_activities set status = $3 where company_id = $1 and id = $2 and status = 'open'", [
      ctx.company.id,
      uuid(formData, "id"),
      status,
    ]);
    if (!r.rowCount) throw new UserError("Only the person it is assigned to, or who created it, can close an activity.");
  });
}
