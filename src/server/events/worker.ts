import type { Queryable } from "../db";

// Event delivery worker (issue #21, master plan §12.5). Claims due deliveries
// for one subscriber, runs its handler for each, and reports success or
// failure; the database schedules retries with backoff and dead-letters
// deliveries that keep failing.

export interface Delivery {
  deliveryId: number;
  eventId: number;
  companyId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface DeliveryStore {
  claim(subscriber: string, limit: number): Promise<Delivery[]>;
  complete(deliveryId: number): Promise<void>;
  fail(deliveryId: number, error: string): Promise<void>;
}

export type Handler = (delivery: Delivery) => Promise<void>;

export interface BatchResult {
  subscriber: string;
  delivered: number;
  failed: number;
}

export async function processDeliveries(
  store: DeliveryStore,
  subscriber: string,
  handler: Handler,
  limit = 50,
): Promise<BatchResult> {
  const result: BatchResult = { subscriber, delivered: 0, failed: 0 };
  for (const delivery of await store.claim(subscriber, limit)) {
    try {
      await handler(delivery);
      await store.complete(delivery.deliveryId);
      result.delivered += 1;
    } catch (error) {
      await store.fail(delivery.deliveryId, error instanceof Error ? error.message : String(error));
      result.failed += 1;
    }
  }
  return result;
}

type ClaimRow = {
  delivery_id: string;
  event_id: string;
  company_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
};

/** Delivery store backed by the app.claim_deliveries() family of functions. */
export class PgDeliveryStore implements DeliveryStore {
  constructor(private readonly db: Queryable) {}

  async claim(subscriber: string, limit: number): Promise<Delivery[]> {
    const { rows } = await this.db.query<ClaimRow>("select * from app.claim_deliveries($1, $2)", [subscriber, limit]);
    return rows.map((r) => ({
      deliveryId: Number(r.delivery_id),
      eventId: Number(r.event_id),
      companyId: r.company_id,
      eventType: r.event_type,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      payload: r.payload,
      attempts: r.attempts,
    }));
  }

  async complete(deliveryId: number): Promise<void> {
    await this.db.query("select app.complete_delivery($1)", [deliveryId]);
  }

  async fail(deliveryId: number, error: string): Promise<void> {
    await this.db.query("select app.fail_delivery($1, $2)", [deliveryId, error]);
  }
}
