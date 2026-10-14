"use server";

import { allow, TOO_MANY } from "@/server/rate-limit";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { EnquiryState } from "@/components/site/enquiry-state";
import { normaliseHost } from "@/lib/tenancy/host";
import { devSignIn, endSession, startSession } from "@/server/auth";
import { friendlyError, withUser } from "@/server/data";
import { getPool } from "@/server/db";
import { withAnon } from "@/server/web/anon";
import { currentPortalUser } from "@/server/web/portal";

// Form actions on company websites: enquiries and quote requests from
// visitors, and customer portal sign-in and quote acceptance.

const SLUG = /^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/;

/** The company domain to record the enquiry against: this host if it is theirs, else their main website address. */
async function siteHostname(slug: string): Promise<string | null> {
  const host = normaliseHost((await headers()).get("host"));
  const { rows } = await getPool().query<{ hostname: string }>(
    `select d.hostname from public.company_domains d join public.companies c on c.id = d.company_id
     where c.slug = $1 and d.kind <> 'erp' and d.archived_at is null and d.verified_at is not null
     order by (d.hostname = $2) desc, d.is_primary desc, d.created_at limit 1`,
    [slug, host],
  );
  return rows[0]?.hostname ?? null;
}

function field(form: FormData, key: string, max: number): string {
  return String(form.get(key) ?? "").trim().slice(0, max);
}

export async function sendEnquiry(slug: string, _state: EnquiryState, form: FormData): Promise<EnquiryState> {
  if (!SLUG.test(slug)) return { status: "error", error: "This site is not available." };
  const name = field(form, "name", 200);
  const email = field(form, "email", 320);
  const phone = field(form, "phone", 40);
  const message = field(form, "message", 5000);
  if (!name) return { status: "error", error: "Please tell us your name." };
  if (!(await allow("enquiry", slug))) return { status: "error", error: TOO_MANY };
  if (!email && !phone) return { status: "error", error: "Please give an email address or a phone number so we can reply." };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: "error", error: "That email address does not look right." };

  let items: Array<{ product_id: string; quantity: number }> | null = null;
  if (form.has("items")) {
    try {
      const parsed = JSON.parse(String(form.get("items")));
      items = (Array.isArray(parsed) ? parsed : [])
        .filter((i) => i && typeof i.product_id === "string" && /^[0-9a-f-]{36}$/i.test(i.product_id))
        .slice(0, 100)
        .map((i) => ({ product_id: i.product_id, quantity: Math.min(9999, Math.max(1, Math.round(Number(i.quantity) || 1))) }));
    } catch {
      items = [];
    }
    if (!items.length) return { status: "error", error: "Your quote is empty. Please add some products first." };
  }

  // Spam robots fill in every field; people never see this one.
  if (field(form, "website", 200)) return { status: "sent", reference: "RECEIVED" };

  const hostname = await siteHostname(slug);
  if (!hostname) return { status: "error", error: "This site cannot take messages at the moment. Please call us instead." };
  try {
    const result = await withAnon(async (q) =>
      (
        await q<{ r: { reference: string } }>("select public.submit_website_enquiry($1, $2, $3, $4, $5, $6) as r", [
          hostname,
          name,
          email || null,
          phone || null,
          message || null,
          items ? JSON.stringify(items) : null,
        ])
      ).rows[0].r,
    );
    return { status: "sent", reference: result.reference };
  } catch (error) {
    const message = friendlyError(error);
    return { status: "error", error: message.charAt(0).toUpperCase() + message.slice(1) };
  }
}

/** Used by the editor preview: forms look real but send nothing. */
export async function previewEnquiry(_state: EnquiryState, _form: FormData): Promise<EnquiryState> {
  void _state;
  void _form;
  return { status: "error", error: "This is a preview. Messages are sent from your live website." };
}

// --- Customer portal (P19) ----------------------------------------------------

export async function portalSignIn(slug: string, form: FormData): Promise<never> {
  const email = String(form.get("email") ?? "");
  if (!(await allow("signIn", slug))) redirect(`/account/sign-in?${new URLSearchParams({ error: TOO_MANY })}`);
  let error: string | null = null;
  try {
    const userId = await devSignIn(email);
    const me = await withUser(userId, async (q) => (await q<{ r: unknown }>("select public.portal_sign_in($1) as r", [slug])).rows[0].r);
    if (!me) {
      error = "We could not find an account for that email address. Please ask us to invite you to the customer portal.";
    } else {
      await startSession(userId);
    }
  } catch (e) {
    error = e instanceof Error && e.message.startsWith("Please") ? e.message : friendlyError(e);
  }
  if (error) redirect(`/account/sign-in?${new URLSearchParams({ error })}`);
  redirect("/account");
}

export async function portalSignOut(): Promise<never> {
  await endSession();
  redirect("/account/sign-in?success=" + encodeURIComponent("You have signed out."));
}

export async function acceptQuote(slug: string, quoteId: string, form: FormData): Promise<never> {
  const user = await currentPortalUser(slug);
  if (!user) redirect("/account/sign-in");
  const back = `/account/quotes/${quoteId}`;
  let error: string | null = null;
  try {
    await withUser(user.userId, (q) =>
      q("select public.portal_accept_quote($1, $2, $3)", [slug, quoteId, String(form.get("note") ?? "").slice(0, 1000)]),
    );
  } catch (e) {
    const m = friendlyError(e);
    error = m.charAt(0).toUpperCase() + m.slice(1);
  }
  redirect(`${back}?${new URLSearchParams(error ? { error } : { success: "Thank you. We have your acceptance and will be in touch." })}`);
}
