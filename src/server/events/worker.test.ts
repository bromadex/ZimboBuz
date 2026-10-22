import { describe, expect, it } from "vitest";
import { FakeMessenger } from "../adapters/messaging";
import { whatsappHandler } from "./handlers";
import { processDeliveries, type Delivery, type DeliveryStore } from "./worker";

class MemoryStore implements DeliveryStore {
  completed: number[] = [];
  failed: Array<[number, string]> = [];
  constructor(private queue: Delivery[]) {}
  async claim(_s: string, limit: number) {
    return this.queue.splice(0, limit);
  }
  async complete(id: number) {
    this.completed.push(id);
  }
  async fail(id: number, error: string) {
    this.failed.push([id, error]);
  }
}

const delivery = (id: number, eventType = "payment.received", payload: Record<string, unknown> = {}): Delivery => ({
  deliveryId: id,
  eventId: id,
  companyId: "c1",
  eventType,
  aggregateType: "payment",
  aggregateId: `p${id}`,
  payload,
  attempts: 1,
});

describe("processDeliveries", () => {
  it("completes successes and reports failures without stopping the batch", async () => {
    const store = new MemoryStore([delivery(1), delivery(2), delivery(3)]);
    const result = await processDeliveries(store, "test", async (d) => {
      if (d.deliveryId === 2) throw new Error("gateway timeout");
    });
    expect(result).toEqual({ subscriber: "test", delivered: 2, failed: 1 });
    expect(store.completed).toEqual([1, 3]);
    expect(store.failed).toEqual([[2, "gateway timeout"]]);
  });
});

describe("whatsappHandler", () => {
  const db = (row: Record<string, unknown> | undefined) => ({
    query: async () => ({ rows: row ? [row] : [] }),
  });

  it("sends a payment receipt to the customer's WhatsApp number", async () => {
    const messaging = new FakeMessenger();
    const handler = whatsappHandler({
      db: db({ name: "Chipo", whatsapp: "0771234567", phone: null, company_name: "Mhofu Hardware" }) as never,
      adapters: { messaging },
    });
    await handler(delivery(1, "payment.received", { customer_id: "x", currency: "USD", amount_cents: 2310, number: "PAY-HQ-2026-0001" }));
    expect(messaging.sent).toEqual([
      {
        to: "263771234567",
        text: "Hello Chipo, we have received your payment of USD 23.10 (ref PAY-HQ-2026-0001). Thank you. Mhofu Hardware",
      },
    ]);
  });

  it("does nothing when the customer has no number or for other events", async () => {
    const messaging = new FakeMessenger();
    const noNumber = whatsappHandler({ db: db({ name: "A", whatsapp: null, phone: null, company_name: "B" }) as never, adapters: { messaging } });
    await noNumber(delivery(1, "payment.received", { customer_id: "x", currency: "USD", amount_cents: 1 }));
    await noNumber(delivery(2, "stock.low"));
    expect(messaging.sent).toEqual([]);
  });
});
