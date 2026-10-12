"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { act, text, UserError } from "@/server/act";
import { billingGateway, settleTestPayment, startPaynowCheckout, type DueInvoice } from "@/server/billing";
import { requireCompany } from "@/server/company";
import { friendlyError, withUser } from "@/server/data";
import { getPool } from "@/server/db";
import { requestProtocol } from "@/server/urls";

// P11: paying ZimERP and changing plan. Who may do this is decided by the
// database (app.billing_admin, which still works when the company is
// read-only or suspended); plan changes only through public.change_plan.

const PATH = "/settings/billing";

function back(params: Record<string, string>): never {
  redirect(`${PATH}?${new URLSearchParams(params)}`);
}

/** The invoice, if the signed-in user may pay it (row-level security decides). */
async function dueInvoice(slug: string, id: string): Promise<DueInvoice> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) back({ error: "Please choose an invoice." });
  const ctx = await requireCompany(slug);
  const inv = await withUser(ctx.userId, async (q) =>
    (
      await q<DueInvoice & { status: string }>(
        "select id, number, description, amount_cents, status from public.subscription_invoices where id = $1 and company_id = $2",
        [id, ctx.company.id],
      )
    ).rows[0],
  );
  if (!inv) back({ error: "You do not have permission to do that." });
  if (inv.status !== "due") back({ success: `Invoice ${inv.number} is already paid.` });
  return inv;
}

export async function payInvoice(slug: string, form: FormData): Promise<never> {
  const inv = await dueInvoice(slug, text(form, "id"));
  const billing = billingGateway();
  if (billing.mode === "test") redirect(`${PATH}/test-checkout?invoice=${inv.id}`);
  if (billing.mode === "unavailable") back({ error: "Online payment is not available yet. Please contact ZimERP support to pay." });
  const h = await headers();
  const origin = `${requestProtocol(h.get("x-forwarded-proto"))}://${h.get("host")}`;
  let target: string;
  try {
    target = await startPaynowCheckout(getPool(), billing, inv, {
      returnUrl: `${origin}${PATH}?returned=1`,
      resultUrl: `${origin}/api/billing/paynow/result`,
    });
  } catch (e) {
    console.error("billing: checkout failed", e instanceof Error ? e.message : e);
    back({ error: "Paynow could not start the payment. Please try again in a few minutes." });
  }
  redirect(target);
}

export async function completeTestPayment(slug: string, form: FormData): Promise<never> {
  const inv = await dueInvoice(slug, text(form, "id"));
  if (billingGateway().mode !== "test") back({ error: "Test payments are not available here." });
  await settleTestPayment(getPool(), inv.id);
  back({ success: `Thank you. Invoice ${inv.number} is paid.` });
}

export async function changePlan(slug: string, form: FormData): Promise<never> {
  const plan = text(form, "plan");
  return act(slug, PATH, "Your plan has been changed.", async (q, ctx) => {
    if (!plan) throw new UserError("Please choose a plan.");
    try {
      await q("select public.change_plan($1, $2)", [ctx.company.id, plan]);
    } catch (e) {
      throw new UserError(friendlyError(e));
    }
  });
}
