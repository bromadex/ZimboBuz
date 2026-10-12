import "server-only";
import { getAdapters } from "./adapters/shared";
import { getPool } from "./db";
import { gatewayCredentials } from "./payments";

// Online store orders: payment through the company's own Paynow account.

export interface WebOrder {
  id: string;
  company_id: string;
  reference: string;
  currency: string;
  total_cents: string;
  status: string;
  poll_url: string | null;
  problem: string | null;
}

export async function loadOrder(slug: string, id: string): Promise<WebOrder | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await getPool().query<WebOrder>(
    `select w.id, w.company_id, w.reference, w.currency, w.total_cents, w.status, w.poll_url, w.problem
     from public.web_orders w join public.companies c on c.id = w.company_id where w.id = $1 and c.slug = $2`,
    [id, slug],
  );
  return rows[0] ?? null;
}

/** Applies a confirmed payment exactly once. */
export async function settleOrder(orderId: string, gatewayReference: string): Promise<string> {
  const { rows } = await getPool().query<{ s: string }>("select app.complete_web_order($1, $2) as s", [orderId, gatewayReference]);
  return rows[0].s;
}

/** Asks Paynow for the latest status of a pending order and settles it when paid. */
export async function refreshOrder(order: WebOrder): Promise<string> {
  if (order.status !== "pending" || !order.poll_url) return order.status;
  const credentials = await gatewayCredentials(order.company_id, order.currency.trim());
  if (!credentials) return order.status;
  try {
    const s = await getAdapters().payments.paynow.pollStatus(credentials, order.poll_url);
    if (s.state === "paid") return settleOrder(order.id, s.gatewayReference ?? s.reference);
    if (s.state === "cancelled" || s.state === "failed") {
      await getPool().query("update public.web_orders set status = $2 where id = $1 and status = 'pending'", [order.id, s.state]);
      return s.state;
    }
  } catch {
    /* gateway unreachable: try again later */
  }
  return order.status;
}
