import { createHash, timingSafeEqual } from "node:crypto";
import {
  GatewayError,
  type CheckoutRequest,
  type CheckoutStarted,
  type GatewayCredentials,
  type MobileCheckoutRequest,
  type PaymentGateway,
  type PaymentState,
  type PaymentStatus,
} from "./types";

// Paynow (https://www.paynow.co.zw) integration over its HTTP interface.
// Messages are form-encoded; every message carries a hash: SHA-512 (upper-case
// hex) of all field values in order, followed by the integration key.
// Paynow integrations are per currency, so companies may hold one per currency.

const DEFAULT_BASE_URL = "https://www.paynow.co.zw/interface";

type Fields = Array<[string, string]>;
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export function paynowHash(fields: Fields, integrationKey: string): string {
  const joined = fields
    .filter(([key]) => key.toLowerCase() !== "hash")
    .map(([, value]) => value)
    .join("");
  return createHash("sha512").update(joined + integrationKey, "utf8").digest("hex").toUpperCase();
}

export function parseFields(body: string): Fields {
  return [...new URLSearchParams(body).entries()];
}

function encode(fields: Fields): string {
  return new URLSearchParams(fields).toString();
}

function get(fields: Fields, key: string): string | undefined {
  return fields.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
}

/** Throws unless the message's hash matches its fields. Constant-time compare. */
export function verifyPaynowHash(fields: Fields, integrationKey: string): void {
  const given = get(fields, "hash") ?? "";
  const expected = paynowHash(fields, integrationKey);
  const a = Buffer.from(given.toUpperCase());
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new GatewayError("Paynow message failed hash verification", "paynow");
  }
}

const PAID = new Set(["paid", "awaiting delivery", "delivered"]);

export function toPaymentState(raw: string): PaymentState {
  const s = raw.trim().toLowerCase();
  if (PAID.has(s)) return "paid";
  if (s === "cancelled") return "cancelled";
  if (s === "refunded") return "refunded";
  if (s === "disputed") return "disputed";
  if (s === "failed" || s === "error") return "failed";
  return "pending"; // created, sent, awaiting...
}

function centsToAmount(cents: number): string {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new GatewayError("Amount must be a positive whole number of cents", "paynow");
  }
  return (cents / 100).toFixed(2);
}

function amountToCents(amount: string | undefined): number | undefined {
  if (amount === undefined || amount === "") return undefined;
  return Math.round(Number(amount) * 100);
}

export interface PaynowOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

export class PaynowGateway implements PaymentGateway {
  readonly name = "paynow";
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: PaynowOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  async startWebCheckout(credentials: GatewayCredentials, request: CheckoutRequest): Promise<CheckoutStarted> {
    const fields: Fields = [
      ["resulturl", request.resultUrl],
      ["returnurl", request.returnUrl],
      ["reference", request.reference],
      ["amount", centsToAmount(request.amountCents)],
      ["id", credentials.integrationId],
      ["additionalinfo", request.description],
      ["authemail", request.email ?? ""],
      ["status", "Message"],
    ];
    const reply = await this.send(`${this.baseUrl}/initiatetransaction`, fields, credentials);
    return { redirectUrl: get(reply, "browserurl"), pollUrl: this.requirePollUrl(reply) };
  }

  async startMobileCheckout(credentials: GatewayCredentials, request: MobileCheckoutRequest): Promise<CheckoutStarted> {
    const fields: Fields = [
      ["resulturl", request.resultUrl],
      ["returnurl", request.returnUrl ?? request.resultUrl],
      ["reference", request.reference],
      ["amount", centsToAmount(request.amountCents)],
      ["id", credentials.integrationId],
      ["additionalinfo", request.description],
      ["authemail", request.email ?? ""],
      ["phone", request.phone.replace(/\s+/g, "")],
      ["method", request.method],
      ["status", "Message"],
    ];
    const reply = await this.send(`${this.baseUrl}/remotetransaction`, fields, credentials);
    return {
      pollUrl: this.requirePollUrl(reply),
      instructions: get(reply, "instructions") ?? "Ask the customer to approve the payment on their phone.",
    };
  }

  async pollStatus(credentials: GatewayCredentials, pollUrl: string): Promise<PaymentStatus> {
    const res = await this.fetchImpl(pollUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    if (!res.ok) throw new GatewayError(`Paynow poll failed with HTTP ${res.status}`, "paynow");
    const fields = parseFields(await res.text());
    return this.toStatus(fields, credentials);
  }

  parseResultNotification(credentials: GatewayCredentials, body: string): PaymentStatus {
    return this.toStatus(parseFields(body), credentials);
  }

  private toStatus(fields: Fields, credentials: GatewayCredentials): PaymentStatus {
    verifyPaynowHash(fields, credentials.integrationKey);
    const raw = get(fields, "status") ?? "";
    return {
      reference: get(fields, "reference") ?? "",
      gatewayReference: get(fields, "paynowreference"),
      amountCents: amountToCents(get(fields, "amount")),
      state: toPaymentState(raw),
      rawStatus: raw,
      pollUrl: get(fields, "pollurl"),
    };
  }

  private async send(url: string, fields: Fields, credentials: GatewayCredentials): Promise<Fields> {
    const body = encode([...fields, ["hash", paynowHash(fields, credentials.integrationKey)]]);
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new GatewayError(`Paynow request failed with HTTP ${res.status}`, "paynow");
    const reply = parseFields(await res.text());
    const status = (get(reply, "status") ?? "").toLowerCase();
    if (status === "error") {
      throw new GatewayError(get(reply, "error") ?? "Paynow returned an error", "paynow");
    }
    verifyPaynowHash(reply, credentials.integrationKey);
    return reply;
  }

  private requirePollUrl(reply: Fields): string {
    const pollUrl = get(reply, "pollurl");
    if (!pollUrl) throw new GatewayError("Paynow did not return a poll URL", "paynow");
    return pollUrl;
  }
}
