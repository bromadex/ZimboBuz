"use server";

import { act, text, UserError } from "@/server/act";
import { authMode } from "@/server/auth";
import { getPool } from "@/server/db";
import { companyOrigins } from "@/server/domains";
import { platformDomain } from "@/server/urls";
import { adapters } from "@/server/web/services";

// Customer portal access (P19), from the customer's page in the ERP. Needs
// portal.manage (which already requires the portal module on the plan and
// switched on); row-level security enforces it.

/**
 * The sign-in for an email address, created if new. Development sign-in
 * creates it directly; with Supabase sign-in this becomes Supabase's
 * "invite user" call (issue #18).
 */
async function userForEmail(email: string): Promise<string> {
  if (authMode() !== "dev") throw new UserError("Inviting customers needs Supabase sign-in, which is not connected yet.");
  const pool = getPool();
  const existing = await pool.query<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows } = await pool.query<{ id: string }>("insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id", [email]);
  return rows[0].id;
}

export async function invitePortalUser(slug: string, customerId: string, form: FormData): Promise<never> {
  const back = `/customers/${customerId}`;
  let notice = "";
  return act(
    slug,
    back,
    "",
    async (q, ctx) => {
      if (!ctx.permissions.has("portal.manage")) throw new UserError("You do not have permission to manage the customer portal.");
      const email = text(form, "email").toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) throw new UserError("Please enter the customer's email address.");
      const customer = (
        await q<{ name: string }>("select name from public.customers where company_id = $1 and id = $2 and archived_at is null", [ctx.company.id, customerId])
      ).rows[0];
      if (!customer) throw new UserError("That customer no longer exists.");

      const userId = await userForEmail(email);
      if ((await getPool().query("select 1 from public.memberships where company_id = $1 and user_id = $2", [ctx.company.id, userId])).rowCount) {
        throw new UserError("That email belongs to one of your staff. Please use the customer's own email address.");
      }
      const existing = (
        await q<{ id: string; customer_id: string; status: string }>(
          "select id, customer_id, status from public.portal_users where company_id = $1 and user_id = $2",
          [ctx.company.id, userId],
        )
      ).rows[0];
      if (existing && existing.customer_id !== customerId) throw new UserError("That email already has portal access for another customer.");
      if (existing && existing.status !== "disabled") throw new UserError("That email already has portal access.");
      if (existing) {
        await q("update public.portal_users set status = 'invited' where id = $1", [existing.id]);
      } else {
        await q("insert into public.portal_users (company_id, customer_id, user_id) values ($1, $2, $3)", [ctx.company.id, customerId, userId]);
      }

      const link = `${(await companyOrigins(slug)).site}/account/sign-in`;
      try {
        await adapters().email.send({
          from: `${ctx.company.name} <${process.env.PORTAL_EMAIL_FROM ?? `no-reply@${platformDomain()}`}>`,
          to: [email],
          subject: `Your account with ${ctx.company.name}`,
          text:
            `Hello ${customer.name},\n\n${ctx.company.name} has invited you to their customer portal, where you can see your quotes, ` +
            `invoices, payments and statement, and accept quotes online.\n\nSign in with this email address at:\n${link}\n`,
        });
        notice = `Invitation sent to ${email}. They sign in at ${link}.`;
      } catch {
        notice = `Access given to ${email}, but the invitation email could not be sent. They can sign in at ${link}.`;
      }
    },
    { then: () => `${back}?${new URLSearchParams({ success: notice })}` },
  );
}

export async function setPortalAccess(slug: string, customerId: string, form: FormData): Promise<never> {
  const enable = text(form, "enable") === "true";
  return act(slug, `/customers/${customerId}`, enable ? "Portal access switched back on." : "Portal access switched off.", async (q, ctx) => {
    const r = await q(
      `update public.portal_users set status = case when $4 then case when activated_at is null then 'invited' else 'active' end else 'disabled' end
       where company_id = $1 and customer_id = $2 and id = $3`,
      [ctx.company.id, customerId, text(form, "id"), enable],
    );
    if (!r.rowCount) throw new UserError("You do not have permission to do that, or it no longer exists.");
  });
}
