import { createAdapters } from "./adapters";
import { PaynowGateway } from "./adapters/payments/paynow";
import type { GatewayCredentials, PaymentGateway, PaymentStatus } from "./adapters/payments/types";
import type { Queryable } from "./db";

// P11: companies paying ZimERP. ZimERP's own Paynow account (not the
// company's) takes the payment; a verified result notification, or polling
// when a notification is missed, marks the invoice paid through
// app.mark_subscription_paid, which also returns the company to active.
//
// Without Paynow credentials, or with ADAPTERS=fake, a test checkout is used
// instead, except in production where online payment is then unavailable.

type Env = Record<string, string | undefined>;

export type BillingGateway =
  | { mode: "paynow"; gateway: PaymentGateway; credentials: GatewayCredentials }
  | { mode: "test" }
  | { mode: "unavailable" };

export function billingGateway(env: Env = process.env): BillingGateway {
  const id = env.PAYNOW_ZIMERP_INTEGRATION_ID;
  const key = env.PAYNOW_ZIMERP_INTEGRATION_KEY;
  if (env.ADAPTERS !== "fake" && id && key) {
    const gateway = createAdapters(env).payments.paynow ?? new PaynowGateway({ baseUrl: env.PAYNOW_BASE_URL });
    return { mode: "paynow", gateway, credentials: { integrationId: id, integrationKey: key } };
  }
  if (env.ADAPTERS === "fake" || env.NODE_ENV !== "production") return { mode: "test" };
  return { mode: "unavailable" };
}

export interface DueInvoice {
  id: string;
  number: string;
  description: string;
  amount_cents: number;
}

/** Starts a Paynow web checkout for an invoice and remembers where to check on it. */
export async function startPaynowCheckout(
  db: Queryable,
  billing: Extract<BillingGateway, { mode: "paynow" }>,
  invoice: DueInvoice,
  urls: { returnUrl: string; resultUrl: string },
): Promise<string> {
  const started = await billing.gateway.startWebCheckout(billing.credentials, {
    reference: invoice.number,
    amountCents: invoice.amount_cents,
    currency: "USD",
    description: `ZimERP ${invoice.description}`,
    returnUrl: urls.returnUrl,
    resultUrl: urls.resultUrl,
  });
  await db.query("update public.subscription_invoices set poll_url = $2, gateway = 'paynow' where id = $1 and status = 'due'", [invoice.id, started.pollUrl]);
  if (!started.redirectUrl) throw new Error("Paynow did not return a checkout page");
  return started.redirectUrl;
}

/** Applies a verified gateway status. Returns true when an invoice became paid. */
export async function settle(db: Queryable, gateway: string, status: PaymentStatus): Promise<boolean> {
  if (status.state !== "paid") return false;
  const inv = (await db.query<{ id: string }>("select id from public.subscription_invoices where number = $1", [status.reference])).rows[0];
  if (!inv) return false;
  const { rows } = await db.query<{ changed: boolean }>("select app.mark_subscription_paid($1, $2, $3, $4) as changed", [
    inv.id,
    gateway,
    status.gatewayReference ?? null,
    status.amountCents ?? null,
  ]);
  return rows[0].changed;
}

/** Records a test payment (test mode only). */
export async function settleTestPayment(db: Queryable, invoiceId: string): Promise<boolean> {
  const inv = (await db.query<{ amount_cents: number }>("select amount_cents from public.subscription_invoices where id = $1", [invoiceId])).rows[0];
  if (!inv) return false;
  const { rows } = await db.query<{ changed: boolean }>("select app.mark_subscription_paid($1, 'test', $2, $3) as changed", [
    invoiceId,
    `TEST-${Date.now()}`,
    inv.amount_cents,
  ]);
  return rows[0].changed;
}

/** Checks unpaid invoices that have a checkout in progress (catches missed notifications). */
export async function pollPendingPayments(db: Queryable, billing: BillingGateway, companyId?: string): Promise<number> {
  if (billing.mode !== "paynow") return 0;
  const pending = (
    await db.query<{ poll_url: string }>(
      "select poll_url from public.subscription_invoices where status = 'due' and poll_url is not null and ($1::uuid is null or company_id = $1)",
      [companyId ?? null],
    )
  ).rows;
  let paid = 0;
  for (const { poll_url } of pending) {
    try {
      if (await settle(db, "paynow", await billing.gateway.pollStatus(billing.credentials, poll_url))) paid++;
    } catch (e) {
      console.error("billing: poll failed", e instanceof Error ? e.message : e);
    }
  }
  return paid;
}

/** The daily billing run: issue this month's invoices, catch missed payments, move overdue companies. */
export async function runBilling(db: Queryable, on: string, billing = billingGateway()) {
  const issued = (await db.query<{ n: number }>("select app.issue_subscription_invoices($1::date) as n", [on])).rows[0].n;
  const paid = await pollPendingPayments(db, billing);
  const statusChanges = (await db.query<{ n: number }>("select app.update_billing_statuses($1::date) as n", [on])).rows[0].n;
  return { on, issued, paid, statusChanges };
}

export const STATUS_TEXT: Record<string, { label: string; tone: "ok" | "draft" | "warn" | "muted"; text: string }> = {
  active: { label: "Active", tone: "ok", text: "Everything is working." },
  grace: {
    label: "Payment overdue",
    tone: "draft",
    text: "A payment is more than a week overdue. Everything still works for now. If it stays unpaid for two weeks after its due date, the company becomes read-only.",
  },
  read_only: {
    label: "Read-only",
    tone: "warn",
    text: "A payment is more than two weeks overdue, so the company is read-only: you can sign in, view and export everything, but not record anything new. Paying puts everything back straight away.",
  },
  suspended: {
    label: "Suspended",
    tone: "muted",
    text: "A payment is more than 60 days overdue, so the company is suspended. Your records are kept. Pay what is owed to switch it back on, or contact ZimERP support.",
  },
};
