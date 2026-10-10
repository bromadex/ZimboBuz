import type {
  CheckoutRequest,
  CheckoutStarted,
  GatewayCredentials,
  MobileCheckoutRequest,
  PaymentGateway,
  PaymentState,
  PaymentStatus,
} from "./types";

/** In-memory gateway for tests and local development. */
export class FakePaymentGateway implements PaymentGateway {
  readonly name = "fake";
  readonly started: Array<CheckoutRequest | MobileCheckoutRequest> = [];
  private readonly states = new Map<string, PaymentStatus>();

  async startWebCheckout(_c: GatewayCredentials, request: CheckoutRequest): Promise<CheckoutStarted> {
    return this.start(request, `https://pay.test/checkout/${request.reference}`);
  }

  async startMobileCheckout(_c: GatewayCredentials, request: MobileCheckoutRequest): Promise<CheckoutStarted> {
    return { ...this.start(request), instructions: "Approve on your phone (test)" };
  }

  async pollStatus(_c: GatewayCredentials, pollUrl: string): Promise<PaymentStatus> {
    const status = this.states.get(pollUrl);
    if (!status) throw new Error(`unknown poll URL ${pollUrl}`);
    return status;
  }

  parseResultNotification(_c: GatewayCredentials, body: string): PaymentStatus {
    return JSON.parse(body) as PaymentStatus;
  }

  /** Test helper: move a checkout to a new state. */
  settle(reference: string, state: PaymentState): void {
    const pollUrl = `https://pay.test/poll/${reference}`;
    const current = this.states.get(pollUrl);
    if (!current) throw new Error(`unknown reference ${reference}`);
    this.states.set(pollUrl, { ...current, state, rawStatus: state });
  }

  private start(request: CheckoutRequest | MobileCheckoutRequest, redirectUrl?: string): CheckoutStarted {
    this.started.push(request);
    const pollUrl = `https://pay.test/poll/${request.reference}`;
    this.states.set(pollUrl, {
      reference: request.reference,
      gatewayReference: `T-${this.started.length}`,
      amountCents: request.amountCents,
      state: "pending",
      rawStatus: "Sent",
      pollUrl,
    });
    return { redirectUrl, pollUrl };
  }
}
