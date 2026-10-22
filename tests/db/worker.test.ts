// Event worker against the real database (issues #21/#22): a submitted payment
// raises payment.received; the worker sends the WhatsApp receipt exactly once
// and failures are scheduled for retry.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeMessenger } from "@/server/adapters/messaging";
import { createHandlers } from "@/server/events/handlers";
import { PgDeliveryStore, processDeliveries } from "@/server/events/worker";
import { createCompanyAs, createTestDb, type Db } from "./harness";

let db: Db;
let company: string;
let hq: string;

beforeAll(async () => {
  db = await createTestDb();
  company = await createCompanyAs(db, await db.createUser(), { name: "Mhofu Hardware", plan: "pro", modules: ["sales"] });
  hq = (await db.admin.query("select id from public.branches where company_id = $1", [company])).rows[0].id;
});

afterAll(async () => {
  await db?.close();
});

async function receivePayment(whatsapp: string | null, amount: number) {
  const cust = (
    await db.admin.query("insert into public.customers (company_id, name, whatsapp) values ($1, 'Chipo', $2) returning id", [company, whatsapp])
  ).rows[0].id;
  const pay = (
    await db.admin.query(
      "insert into public.payments (company_id, branch_id, customer_id, currency, amount_cents, method) values ($1, $2, $3, 'USD', $4, 'ecocash') returning id",
      [company, hq, cust, amount],
    )
  ).rows[0].id;
  await db.admin.query("update public.payments set docstatus = 1 where id = $1", [pay]);
}

describe("whatsapp worker", () => {
  it("sends one receipt per payment and marks the delivery done", async () => {
    await receivePayment("0771234567", 2310);
    const messaging = new FakeMessenger();
    const handlers = createHandlers({ db: db.admin, adapters: { messaging } });
    const store = new PgDeliveryStore(db.admin);

    expect(await processDeliveries(store, "whatsapp", handlers.whatsapp)).toEqual({ subscriber: "whatsapp", delivered: 1, failed: 0 });
    expect(await processDeliveries(store, "whatsapp", handlers.whatsapp)).toEqual({ subscriber: "whatsapp", delivered: 0, failed: 0 });
    expect(messaging.sent).toHaveLength(1);
    expect((messaging.sent[0] as { text: string }).text).toMatch(/USD 23\.10 \(ref PAY-HQ-\d{4}-0001\)\. Thank you\. Mhofu Hardware$/);
  });

  it("schedules a retry when sending fails", async () => {
    await receivePayment("0779999999", 500);
    const failing = { sendText: async () => { throw new Error("WhatsApp is down"); }, sendTemplate: async () => ({ id: "" }), name: "x", sent: [] };
    const handlers = createHandlers({ db: db.admin, adapters: { messaging: failing as never } });
    const result = await processDeliveries(new PgDeliveryStore(db.admin), "whatsapp", handlers.whatsapp);
    expect(result.failed).toBe(1);
    const { rows } = await db.admin.query(
      "select status, last_error, next_attempt_at > now() as later from public.event_deliveries where subscriber = 'whatsapp' and last_error is not null",
    );
    expect(rows[0]).toMatchObject({ status: "pending", last_error: "WhatsApp is down", later: true });
  });
});
