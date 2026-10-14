import "server-only";
import { getAdapters } from "./adapters/shared";
import { withUser } from "./data";
import { getPool } from "./db";
import { gatewayCredentials } from "./payments";

// Paying an invoice from the customer portal (P19) through the company's own
// Paynow account. Mirrors online store orders (./web-orders.ts).

export interface PaymentLink {
  id: string;
  company_id: string;
  invoice_id: string;
  reference: string;
  currency: string;
  amount_cents: string;
  status: string;
  poll_url: string | null;
}

/** Whether the company can take online payment in a currency (no secrets read). */
export async function canPayOnline(slug: string, currency: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `select 1 from public.payment_gateway_accounts g join public.companies c on c.id = g.company_id
     where c.slug = $1 and g.gateway = 'paynow' and g.currency = $2 and g.enabled`,
    [slug, currency.trim()],
  );
  return rows.length > 0;
}

/** Starts the payment and returns where to send the customer. */
export async function startInvoicePayment(userId: string, slug: string, invoiceId: string, origin: string, email: string | null): Promise<string> {
  const link = await withUser(userId, async (q) =>
    (
      await q<{ r: { link_id: string; reference: string; currency: string; amount_cents: number; company_id: string } }>(
        "select public.portal_start_invoice_payment($1, $2) as r",
        [slug, invoiceId],
      )
    ).rows[0].r,
  );
  const credentials = await gatewayCredentials(link.company_id, link.currency.trim());
  if (!credentials) throw new Error("This business cannot take online payments yet.");
  const gateway = getAdapters().payments.paynow;
  const back = `${origin}/account/invoices/${invoiceId}?payment=${link.link_id}`;
  const started = await gateway.startWebCheckout(credentials, {
    reference: link.reference,
    amountCents: Number(link.amount_cents),
    currency: link.currency.trim() as "USD" | "ZWG" | "ZAR",
    description: `Invoice payment ${link.reference}`,
    email: email ?? undefined,
    returnUrl: back,
    resultUrl: `${origin}/api/portal/pay/result?link=${link.link_id}`,
  });
  await getPool().query("update public.invoice_payment_links set poll_url = $2 where id = $1", [link.link_id, started.pollUrl]);
  return gateway.name === "fake" ? `${back}&test=1` : (started.redirectUrl ?? back);
}

export async function loadLink(id: string, invoiceId: string): Promise<PaymentLink | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await getPool().query<PaymentLink>(
    "select id, company_id, invoice_id, reference, currency, amount_cents, status, poll_url from public.invoice_payment_links where id = $1 and invoice_id = $2",
    [id, invoiceId],
  );
  return rows[0] ?? null;
}

export async function settleLink(id: string, gatewayReference: string): Promise<string> {
  return (await getPool().query<{ s: string }>("select app.complete_invoice_payment($1, $2) as s", [id, gatewayReference])).rows[0].s;
}

/** Checks with Paynow and records the payment once it is confirmed. */
export async function refreshLink(link: PaymentLink): Promise<string> {
  if (link.status !== "pending" || !link.poll_url) return link.status;
  const credentials = await gatewayCredentials(link.company_id, link.currency.trim());
  if (!credentials) return link.status;
  try {
    const s = await getAdapters().payments.paynow.pollStatus(credentials, link.poll_url);
    if (s.state === "paid") return settleLink(link.id, s.gatewayReference ?? s.reference);
    if (s.state === "cancelled" || s.state === "failed") {
      await getPool().query("update public.invoice_payment_links set status = $2 where id = $1 and status = 'pending'", [link.id, s.state]);
      return s.state;
    }
  } catch {
    /* try again on the next visit */
  }
  return link.status;
}
