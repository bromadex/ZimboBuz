import "server-only";
import type { GatewayCredentials } from "./adapters/payments/types";
import { getPool } from "./db";
import { openSecret } from "./secrets";

// A company's own payment gateway credentials. Money goes straight to each
// company's account; ZimERP only relays the request. Keys are sealed in the
// database and only opened here, on the server.

export const PAYNOW_PURPOSE = "paynow-integration-key";

export async function gatewayCredentials(companyId: string, currency: string): Promise<GatewayCredentials | null> {
  const { rows } = await getPool().query<{ integration_id: string; integration_key_enc: string }>(
    `select integration_id, integration_key_enc from public.payment_gateway_accounts
     where company_id = $1 and gateway = 'paynow' and currency = $2 and enabled`,
    [companyId, currency],
  );
  if (!rows[0]) return null;
  return { integrationId: rows[0].integration_id, integrationKey: openSecret(rows[0].integration_key_enc, PAYNOW_PURPOSE) };
}

/** Records a gateway's verdict on a payment request (server only; requests are matched by id and company). */
export async function recordRequestStatus(
  companyId: string,
  requestId: string,
  status: { state: string; gatewayReference?: string; rawStatus: string },
): Promise<string> {
  const next = status.state === "paid" ? "paid" : status.state === "cancelled" ? "cancelled" : status.state === "failed" ? "failed" : "pending";
  const { rows } = await getPool().query<{ status: string }>(
    `update public.payment_requests
     set status = case when status = 'pending' then $3 else status end,
         gateway_reference = coalesce(gateway_reference, $4), raw_status = $5,
         paid_at = case when status = 'pending' and $3 = 'paid' then now() else paid_at end
     where company_id = $1 and id = $2 returning status`,
    [companyId, requestId, next, status.gatewayReference ?? null, status.rawStatus],
  );
  return rows[0]?.status ?? "unknown";
}
