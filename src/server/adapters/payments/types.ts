// Payment gateway adapter (master plan §7, §12.8). Each company connects its
// own gateway account, so credentials are passed per call, never global.

export type Currency = "USD" | "ZWG" | "ZAR";

export type MobileMethod = "ecocash" | "onemoney" | "innbucks";

export interface GatewayCredentials {
  integrationId: string;
  integrationKey: string;
}

export interface CheckoutRequest {
  /** Our reference, e.g. the invoice number. */
  reference: string;
  amountCents: number;
  currency: Currency;
  description: string;
  /** Payer's email (required by some gateways for web checkout). */
  email?: string;
  /** Where the customer returns after paying in the browser. */
  returnUrl: string;
  /** Where the gateway posts the result (server to server). */
  resultUrl: string;
}

export interface MobileCheckoutRequest extends Omit<CheckoutRequest, "returnUrl"> {
  phone: string;
  method: MobileMethod;
  returnUrl?: string;
}

export interface CheckoutStarted {
  /** Browser checkout page (web checkout only). */
  redirectUrl?: string;
  /** URL to poll for the transaction status. */
  pollUrl: string;
  /** Text to show the cashier, e.g. "Approve on your phone". */
  instructions?: string;
}

export type PaymentState = "pending" | "paid" | "cancelled" | "failed" | "refunded" | "disputed";

export interface PaymentStatus {
  reference: string;
  gatewayReference?: string;
  amountCents?: number;
  state: PaymentState;
  /** The gateway's own status text, kept for the audit trail. */
  rawStatus: string;
  pollUrl?: string;
}

export interface PaymentGateway {
  readonly name: string;
  startWebCheckout(credentials: GatewayCredentials, request: CheckoutRequest): Promise<CheckoutStarted>;
  startMobileCheckout(credentials: GatewayCredentials, request: MobileCheckoutRequest): Promise<CheckoutStarted>;
  pollStatus(credentials: GatewayCredentials, pollUrl: string): Promise<PaymentStatus>;
  /**
   * Parses and verifies a result notification posted by the gateway.
   * Throws if the notification is not authentic.
   */
  parseResultNotification(credentials: GatewayCredentials, body: string): PaymentStatus;
}

export class GatewayError extends Error {
  constructor(message: string, readonly gateway: string) {
    super(message);
    this.name = "GatewayError";
  }
}
