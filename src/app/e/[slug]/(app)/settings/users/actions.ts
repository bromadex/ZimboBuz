"use server";

import { act, changed, text, UserError, uuid } from "@/server/act";
import { AuthNotConfiguredError, userForInvitation } from "@/server/auth";

// P3: inviting people and managing their access. Row-level security and the
// membership rules in the database (last owner, owner-only owner changes,
// plan limits) decide; these actions only read the form.

const PATH = "/settings/users";

function userType(form: FormData): "full" | "light" {
  const value = text(form, "user_type");
  if (value !== "full" && value !== "light") throw new UserError("Please choose full or light.");
  return value;
}

export async function inviteUser(slug: string, form: FormData): Promise<never> {
  return act(slug, PATH, "Invitation sent. They will see it when they sign in.", async (q, ctx) => {
    let invited: { id: string; email: string };
    try {
      invited = await userForInvitation(text(form, "email"));
    } catch (e) {
      if (e instanceof AuthNotConfiguredError) throw new UserError("Invitations need sign-in to be connected first.");
      throw new UserError(e instanceof Error ? e.message : "Please enter a valid email address.");
    }
    if (invited.id === ctx.userId) throw new UserError("You are already a member.");
    await q("select public.invite_member($1, $2, $3, $4)", [ctx.company.id, invited.id, uuid(form, "role_id", "a role"), userType(form)]);
  });
}

export async function updateMember(slug: string, form: FormData): Promise<never> {
  return act(slug, PATH, "Access updated.", async (q, ctx) => {
    await changed(
      q("update public.memberships set role_id = $3, user_type = $4 where company_id = $1 and id = $2", [
        ctx.company.id,
        uuid(form, "id", "a person"),
        uuid(form, "role_id", "a role"),
        userType(form),
      ]),
    );
  });
}

export async function setMemberStatus(slug: string, form: FormData): Promise<never> {
  const status = text(form, "status");
  const message = status === "active" ? "Access switched back on." : "Access switched off. They can no longer sign in to this company.";
  return act(slug, PATH, message, async (q, ctx) => {
    if (status !== "active" && status !== "disabled") throw new UserError("Please choose on or off.");
    const id = uuid(form, "id", "a person");
    const own = await q("select 1 from public.memberships where id = $1 and user_id = $2", [id, ctx.userId]);
    if (own.rowCount && status === "disabled") throw new UserError("You cannot switch off your own access.");
    await changed(q("update public.memberships set status = $3 where company_id = $1 and id = $2", [ctx.company.id, id, status]));
  });
}
