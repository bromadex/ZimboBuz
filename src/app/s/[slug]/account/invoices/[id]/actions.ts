"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { friendlyError } from "@/server/data";
import { startInvoicePayment } from "@/server/invoice-payments";
import { currentPortalUser } from "@/server/web/portal";
import { allow, TOO_MANY } from "@/server/rate-limit";
import { requestProtocol } from "@/server/urls";

export async function payInvoice(slug: string, invoiceId: string): Promise<never> {
  const me = await currentPortalUser(slug);
  if (!me) redirect("/account/sign-in");
  if (!(await allow("portalPay", me.userId))) redirect(`/account/invoices/${invoiceId}?error=${encodeURIComponent(TOO_MANY)}`);
  const h = await headers();
  const origin = `${requestProtocol(h.get("x-forwarded-proto"))}://${h.get("host")}`;
  let target: string;
  try {
    target = await startInvoicePayment(me.userId, slug, invoiceId, origin, me.customerEmail);
  } catch (e) {
    const message = e instanceof Error && e.message.startsWith("This business") ? e.message : friendlyError(e);
    redirect(`/account/invoices/${invoiceId}?error=${encodeURIComponent(message)}`);
  }
  redirect(target);
}
