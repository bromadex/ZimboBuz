import { billingGateway, settle } from "@/server/billing";
import { getPool } from "@/server/db";

// P11: Paynow posts the result of a ZimERP subscription payment here (server
// to server). The message's hash is checked with ZimERP's integration key,
// and the status is confirmed by polling Paynow before the invoice is marked
// paid. Repeated notifications change nothing.

export async function POST(request: Request) {
  const billing = billingGateway();
  if (billing.mode !== "paynow") return new Response("not configured", { status: 404 });
  const body = await request.text();
  try {
    const notified = billing.gateway.parseResultNotification(billing.credentials, body);
    // Confirm with Paynow itself rather than trusting the notification alone.
    const confirmed = notified.pollUrl ? await billing.gateway.pollStatus(billing.credentials, notified.pollUrl) : notified;
    if (confirmed.reference !== notified.reference) return new Response("mismatch", { status: 400 });
    await settle(getPool(), "paynow", confirmed);
    return new Response("ok");
  } catch (e) {
    console.error("billing: result notification refused", e instanceof Error ? e.message : e);
    return new Response("refused", { status: 400 });
  }
}
