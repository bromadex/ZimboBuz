import { formatMoney, type CurrencyCode } from "@/lib/money";
import type { Adapters } from "../adapters";
import type { Queryable } from "../db";
import type { Handler } from "./worker";

// Subscriber handlers. Each subscriber in public.event_subscribers needs one
// here before the scheduler processes its queue.

export interface HandlerDeps {
  db: Queryable;
  adapters: Pick<Adapters, "messaging">;
}

type Contact = { name: string; whatsapp: string | null; phone: string | null; company_name: string };

async function customerContact(db: Queryable, companyId: string, customerId: unknown): Promise<Contact | null> {
  if (typeof customerId !== "string") return null;
  const { rows } = await db.query<Contact>(
    `select c.name, c.whatsapp, c.phone, co.name as company_name
     from public.customers c join public.companies co on co.id = c.company_id
     where c.id = $1 and c.company_id = $2`,
    [customerId, companyId],
  );
  return rows[0] ?? null;
}

/** WhatsApp receipts for customers (§3.3): invoices issued and payments received. */
export function whatsappHandler(deps: HandlerDeps): Handler {
  return async (d) => {
    if (d.eventType !== "sale.submitted" && d.eventType !== "payment.received") return;
    const contact = await customerContact(deps.db, d.companyId, d.payload.customer_id);
    const to = contact?.whatsapp ?? contact?.phone;
    if (!contact || !to) return; // nothing to send to; not a failure

    const currency = d.payload.currency as CurrencyCode;
    const text =
      d.eventType === "payment.received"
        ? `Hello ${contact.name}, we have received your payment of ${formatMoney(Number(d.payload.amount_cents), currency)} ` +
          `(ref ${d.payload.number}). Thank you. ${contact.company_name}`
        : `Hello ${contact.name}, your invoice ${d.payload.number} for ${formatMoney(Number(d.payload.total_cents), currency)} ` +
          `has been issued. Thank you for your business. ${contact.company_name}`;
    await deps.adapters.messaging.sendText({ to, text });
  };
}

/**
 * Subscribers whose work arrives with later features. Their deliveries are
 * acknowledged so queues do not grow:
 *   webhooks — public API webhooks (#73); no endpoints can be registered yet
 *   crm — leads are already recorded by submit_website_enquiry()
 *   notifications — in-app notification centre (built with the ERP screens)
 */
const acknowledge: Handler = async () => {};

export function createHandlers(deps: HandlerDeps): Record<string, Handler> {
  return {
    whatsapp: whatsappHandler(deps),
    webhooks: acknowledge,
    crm: acknowledge,
    notifications: acknowledge,
  };
}
