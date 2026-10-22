import "server-only";
import { cache } from "react";
import { currentUserId } from "../auth";
import { withUser } from "../data";

// The customer signed in to a company's portal (P19). Sessions are per host:
// signing in on the website does not sign anyone in to the ERP, and back.

export interface PortalUser {
  userId: string;
  companyName: string;
  customerName: string;
  customerEmail: string | null;
  baseCurrency: string;
  canAccept: boolean;
}

export const currentPortalUser = cache(async (slug: string): Promise<PortalUser | null> => {
  const userId = await currentUserId();
  if (!userId) return null;
  const me = await withUser(userId, async (q) =>
    (await q<{ me: Record<string, unknown> | null }>("select public.portal_me($1) as me", [slug])).rows[0]?.me,
  );
  if (!me) return null;
  return {
    userId,
    companyName: String(me.company_name),
    customerName: String(me.customer_name),
    customerEmail: (me.customer_email as string | null) ?? null,
    baseCurrency: String(me.base_currency).trim(),
    canAccept: me.can_accept === true,
  };
});

/** Runs a portal function as the signed-in customer. */
export async function portalQuery<R extends Record<string, unknown>>(userId: string, sql: string, params: unknown[]): Promise<R[]> {
  return withUser(userId, async (q) => (await q<R>(sql, params)).rows);
}
