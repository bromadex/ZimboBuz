"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { act, currency, text, UserError } from "@/server/act";
import type { MobileMethod } from "@/server/adapters/payments/types";
import { getAdapters } from "@/server/adapters/shared";
import { requireCompany } from "@/server/company";
import { friendlyError, withUser } from "@/server/data";
import { gatewayCredentials, recordRequestStatus } from "@/server/payments";
import { requestProtocol } from "@/server/urls";
import { parseMoney } from "@/lib/money";

// Till actions (P5, P6). Checkout returns a result instead of redirecting, so
// the till stays on screen; everything else follows the usual form pattern.

export async function openTill(slug: string, formData: FormData): Promise<never> {
  return act(slug, "/pos", "Till opened. Ready to sell.", async (q, ctx) => {
    const float: Record<string, number> = {};
    for (const cur of ["USD", "ZWG", "ZAR"]) {
      const raw = text(formData, `float_${cur}`);
      if (!raw) continue;
      try {
        const cents = parseMoney(raw);
        if (cents < 0) throw new Error();
        if (cents > 0) float[cur] = cents;
      } catch {
        throw new UserError("Please enter the float like 20.00.");
      }
    }
    const branch = text(formData, "branch_id") || null;
    await q(
      `insert into public.till_sessions (company_id, branch_id, opening_float)
       select $1, b.id, $3 from public.branches b
       where b.company_id = $1 and b.archived_at is null and ($2::uuid is null or b.id = $2::uuid)
       order by b.is_head_office desc limit 1`,
      [ctx.company.id, branch, float],
    );
  });
}

export async function closeTill(slug: string, sessionId: string, formData: FormData): Promise<never> {
  return act(slug, `/pos/sessions/${sessionId}`, "Till closed and cashed up.", async (q) => {
    const counted: Record<string, number> = {};
    for (const cur of ["USD", "ZWG", "ZAR"]) {
      const raw = text(formData, `counted_${cur}`);
      if (!raw) continue;
      try {
        counted[cur] = parseMoney(raw);
      } catch {
        throw new UserError("Please enter the cash counted like 120.00.");
      }
      if (counted[cur] < 0) throw new UserError("Counted cash cannot be negative.");
    }
    await q("select public.close_till($1, $2, $3)", [sessionId, counted, text(formData, "notes") || null]);
  });
}

export interface CheckoutRequest {
  sessionId: string;
  clientRef: string;
  customerId: string | null;
  currency: "USD" | "ZWG" | "ZAR";
  lines: Array<{ productId: string; quantity: number; discountCents?: number }>;
  tenders: Array<{ method: string; currency: string; amountCents: number; reference?: string; paymentRequestId?: string }>;
  changeAsCredit?: boolean;
  onAccount?: boolean;
  changeCurrency?: "USD" | "ZWG" | "ZAR" | null;
}

export type CheckoutResponse =
  | {
      ok: true;
      invoiceId: string;
      number: string;
      currency: string;
      totalCents: number;
      change: Array<{ currency: string; cents: number }>;
      onAccountCents: number;
      duplicate: boolean;
    }
  | { ok: false; error: string };

export async function checkout(slug: string, req: CheckoutRequest): Promise<CheckoutResponse> {
  const ctx = await requireCompany(slug);
  const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
  if (!isUuid(req.sessionId) || !isUuid(req.clientRef) || (req.customerId !== null && !isUuid(req.customerId))) {
    return { ok: false, error: "Something is wrong with this sale. Please start again." };
  }
  try {
    const r = await withUser(ctx.userId, async (q) =>
      (
        await q<{ r: { invoice_id: string; number: string; currency: string; total_cents: number; change: Array<{ currency: string; cents: number }>; on_account_cents?: number; duplicate: boolean } }>(
          "select public.pos_checkout($1, $2, $3, $4, $5, $6, $7, $8, $9) as r",
          [
            req.sessionId,
            req.clientRef,
            req.customerId,
            req.currency,
            JSON.stringify(req.lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, discount_cents: l.discountCents ?? 0 }))),
            JSON.stringify(
              req.tenders.map((t) => ({
                method: t.method,
                currency: t.currency,
                amount_cents: t.amountCents,
                reference: t.reference ?? null,
                ...(t.paymentRequestId ? { payment_request_id: t.paymentRequestId } : {}),
              })),
            ),
            !!req.changeAsCredit,
            !!req.onAccount,
            req.changeCurrency && ["USD", "ZWG", "ZAR"].includes(req.changeCurrency) ? req.changeCurrency : null,
          ],
        )
      ).rows[0].r,
    );
    return {
      ok: true,
      invoiceId: r.invoice_id,
      number: r.number,
      currency: r.currency.trim(),
      totalCents: Number(r.total_cents),
      change: r.change ?? [],
      onAccountCents: Number(r.on_account_cents ?? 0),
      duplicate: r.duplicate,
    };
  } catch (e) {
    const message = friendlyError(e);
    return { ok: false, error: message.charAt(0).toUpperCase() + message.slice(1) };
  }
}

// --- Mobile money through Paynow (P6) --------------------------------------

export type MobileStart = { ok: true; requestId: string; instructions: string; testMode: boolean } | { ok: false; error: string };

export async function startMobilePayment(
  slug: string,
  input: { sessionId: string; method: MobileMethod; currency: string; amountCents: number; phone: string },
): Promise<MobileStart> {
  const ctx = await requireCompany(slug);
  const phone = input.phone.replace(/[^\d+]/g, "");
  if (!/^(\+?263|0)7\d{8}$/.test(phone)) return { ok: false, error: "Please enter the customer's mobile number, like 0771234567." };
  if (!["ecocash", "onemoney", "innbucks"].includes(input.method)) return { ok: false, error: "Please choose EcoCash, OneMoney or InnBucks." };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, error: "Please enter the amount." };
  const credentials = await gatewayCredentials(ctx.company.id, input.currency);
  if (!credentials) return { ok: false, error: `Paynow is not set up for ${input.currency}. Ask an administrator to add it under Settings, Payment gateways.` };
  const gateway = getAdapters().payments.paynow;
  const reference = `POS-${randomUUID().slice(0, 8).toUpperCase()}`;
  try {
    const requestId = await withUser(ctx.userId, async (q) =>
      (
        await q<{ id: string }>(
          `insert into public.payment_requests (company_id, till_session_id, gateway, method, currency, amount_cents, phone, reference)
           values ($1, $2, 'paynow', $3, $4, $5, $6, $7) returning id`,
          [ctx.company.id, input.sessionId, input.method, input.currency, input.amountCents, phone, reference],
        )
      ).rows[0].id,
    );
    const h = await headers();
    const origin = `${requestProtocol(h.get("x-forwarded-proto"))}://${h.get("host")}`;
    const started = await gateway.startMobileCheckout(credentials, {
      reference,
      amountCents: input.amountCents,
      currency: input.currency as "USD" | "ZWG" | "ZAR",
      description: `${ctx.company.name} sale ${reference}`,
      email: ctx.userEmail,
      phone,
      method: input.method,
      resultUrl: `${origin}/api/payments/paynow/result?request=${requestId}`,
    });
    const { getPool } = await import("@/server/db");
    await getPool().query("update public.payment_requests set poll_url = $3 where company_id = $1 and id = $2", [ctx.company.id, requestId, started.pollUrl]);
    return {
      ok: true,
      requestId,
      instructions: started.instructions ?? "Ask the customer to approve the payment on their phone.",
      testMode: gateway.name === "fake",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "GatewayError" ? `Paynow said: ${e.message}` : friendlyError(e) };
  }
}

export async function checkMobilePayment(slug: string, requestId: string): Promise<{ status: string }> {
  const ctx = await requireCompany(slug);
  const req = await withUser(ctx.userId, async (q) =>
    (
      await q<{ id: string; status: string; poll_url: string | null; currency: string }>(
        "select id, status, poll_url, currency from public.payment_requests where company_id = $1 and id = $2",
        [ctx.company.id, requestId],
      )
    ).rows[0],
  );
  if (!req) return { status: "unknown" };
  if (req.status !== "pending" || !req.poll_url) return { status: req.status };
  const credentials = await gatewayCredentials(ctx.company.id, req.currency.trim());
  if (!credentials) return { status: req.status };
  try {
    const s = await getAdapters().payments.paynow.pollStatus(credentials, req.poll_url);
    return { status: await recordRequestStatus(ctx.company.id, requestId, s) };
  } catch {
    return { status: "pending" };
  }
}

/** Test mode only: approve a fake mobile payment (the fake gateway never talks to Paynow). */
export async function simulateMobilePayment(slug: string, requestId: string): Promise<{ status: string }> {
  const ctx = await requireCompany(slug);
  const gateway = getAdapters().payments.paynow as unknown as { name: string; settle?: (reference: string, state: "paid") => void };
  if (gateway.name !== "fake" || !gateway.settle) return { status: "unknown" };
  const req = await withUser(ctx.userId, async (q) =>
    (await q<{ reference: string }>("select reference from public.payment_requests where company_id = $1 and id = $2", [ctx.company.id, requestId])).rows[0],
  );
  if (!req) return { status: "unknown" };
  gateway.settle(req.reference, "paid");
  return checkMobilePayment(slug, requestId);
}

// --- Gateway settings ---------------------------------------------------------

export async function saveGateway(slug: string, formData: FormData): Promise<never> {
  return act(slug, "/settings/payments", "Paynow details saved.", async (q, ctx) => {
    const cur = currency(formData);
    const integrationId = text(formData, "integration_id");
    const key = text(formData, "integration_key");
    const enabled = formData.get("enabled") === "on";
    if (!/^\d{1,12}$/.test(integrationId)) throw new UserError("The Paynow integration ID is a number from your Paynow account.");
    const { sealSecret } = await import("@/server/secrets");
    const { PAYNOW_PURPOSE } = await import("@/server/payments");
    if (key) {
      if (key.length < 8 || key.length > 100) throw new UserError("Please check the integration key.");
      // Update first, then insert: an upsert would need read access to the
      // sealed key column, which users never have.
      const sealed = sealSecret(key, PAYNOW_PURPOSE);
      const r = await q(
        "update public.payment_gateway_accounts set integration_id = $3, integration_key_enc = $4, enabled = $5 where company_id = $1 and gateway = 'paynow' and currency = $2",
        [ctx.company.id, cur, integrationId, sealed, enabled],
      );
      if (!r.rowCount) {
        await q(
          `insert into public.payment_gateway_accounts (company_id, gateway, currency, integration_id, integration_key_enc, enabled)
           values ($1, 'paynow', $2, $3, $4, $5)`,
          [ctx.company.id, cur, integrationId, sealed, enabled],
        );
      }
    } else {
      const r = await q(
        "update public.payment_gateway_accounts set integration_id = $3, enabled = $4 where company_id = $1 and gateway = 'paynow' and currency = $2",
        [ctx.company.id, cur, integrationId, enabled],
      );
      if (!r.rowCount) throw new UserError("Please enter the integration key.");
    }
  });
}
