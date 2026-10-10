// Event backbone (issue #21): transactional outbox, per-subscriber deliveries,
// claiming without double delivery, retries with backoff, dead letters.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

let db: Db;
let owner: string;
let company: string;

const emit = (type: string, id = "rec-1") =>
  db.admin
    .query<{ id: string }>("select app.emit_event($1, $2, 'test', $3, '{}') as id", [company, type, id])
    .then((r) => Number(r.rows[0].id));

const claim = (subscriber: string, limit = 50) =>
  db.asService(async (q) =>
    (
      await q<{ delivery_id: string; event_id: string; attempts: number; event_type: string }>(
        "select * from app.claim_deliveries($1, $2)",
        [subscriber, limit],
      )
    ).rows.map((r) => ({ ...r, delivery_id: Number(r.delivery_id), event_id: Number(r.event_id) })),
  );

const delivery = async (id: number) =>
  (await db.admin.query("select * from public.event_deliveries where id = $1", [id])).rows[0];

/** Makes every delivery due now (simulates time passing). */
const makeDue = () =>
  db.admin.query("update public.event_deliveries set next_attempt_at = now() - interval '1 second'");

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  company = await createCompanyAs(db, owner);
});

afterAll(async () => {
  await db?.close();
});

describe("emitting", () => {
  it("records nothing when the business transaction rolls back", async () => {
    await db.admin.query("begin");
    await db.admin.query("select app.emit_event($1, 'sale.submitted', 'test', 'rolled-back', '{}')", [company]);
    await db.admin.query("rollback");
    const { rows } = await db.admin.query("select count(*)::int as n from public.events where aggregate_id = 'rolled-back'");
    expect(rows[0].n).toBe(0);
  });

  it("queues one delivery per subscriber of the event type", async () => {
    const id = await emit("sale.submitted");
    const { rows } = await db.admin.query(
      "select subscriber from public.event_deliveries where event_id = $1 order by subscriber",
      [id],
    );
    expect(rows.map((r) => r.subscriber)).toEqual(["webhooks", "whatsapp"]);
  });

  it("refuses unknown event types", async () => {
    await expect(emit("made.up")).rejects.toThrow(/foreign key/);
  });

  it("cannot be called by signed-in users directly", async () => {
    await expect(
      db.asUser(owner, (q) => q("select app.emit_event($1, 'lead.created', 'test', 'x', '{}')", [company])),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps events append-only", async () => {
    await expect(db.admin.query("update public.events set payload = '{}'")).rejects.toThrow(/cannot be changed/);
  });
});

describe("delivering", () => {
  it("claims due deliveries once and locks them", async () => {
    const id = await emit("lead.created", "lead-1");
    const first = await claim("crm");
    expect(first.map((d) => d.event_id)).toContain(id);
    expect(first.find((d) => d.event_id === id)?.attempts).toBe(1);
    expect(await claim("crm")).toEqual([]);
  });

  it("never gives the same delivery to two concurrent workers", async () => {
    for (let i = 0; i < 10; i++) await emit("stock.low", `p-${i}`);
    const [a, b] = await Promise.all([claim("notifications", 6), claim("notifications", 6)]);
    const ids = [...a, ...b].map((d) => d.delivery_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...a, ...b].filter((d) => d.event_type === "stock.low")).toHaveLength(10);
  });

  it("marks completed deliveries delivered", async () => {
    await emit("payment.received", "pay-1");
    const [d] = (await claim("webhooks")).filter((x) => x.event_type === "payment.received");
    await db.asService((q) => q("select app.complete_delivery($1)", [d.delivery_id]));
    const row = await delivery(d.delivery_id);
    expect(row.status).toBe("delivered");
    expect(row.delivered_at).not.toBeNull();
  });

  it("retries failures with growing delays, then marks them dead", async () => {
    const eventId = await emit("subscription.overdue", "sub-1");
    const { rows } = await db.admin.query(
      "update public.event_deliveries set max_attempts = 3 where event_id = $1 returning id",
      [eventId],
    );
    const id = Number(rows[0].id);
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      await makeDue();
      const claimed = (await claim("notifications")).find((d) => d.delivery_id === id);
      expect(claimed?.attempts).toBe(attempt);
      await db.asService((q) => q("select app.fail_delivery($1, 'gateway timeout')", [id]));
      const row = await delivery(id);
      delays.push((new Date(row.next_attempt_at).getTime() - Date.now()) / 60_000);
      expect(row.status).toBe(attempt < 3 ? "pending" : "dead");
      expect(row.last_error).toBe("gateway timeout");
    }
    expect(delays[1]).toBeGreaterThan(delays[0]);

    await makeDue();
    expect((await claim("notifications")).find((d) => d.delivery_id === id)).toBeUndefined();

    await db.asService((q) => q("select app.retry_dead_delivery($1)", [id]));
    expect((await claim("notifications")).find((d) => d.delivery_id === id)?.attempts).toBe(1);
  });

  it("re-delivers when a worker crashes and its lock expires", async () => {
    const eventId = await emit("approval.requested", "appr-1");
    const [d] = (await claim("notifications")).filter((x) => x.event_id === eventId);
    await db.admin.query("update public.event_deliveries set locked_until = now() - interval '1 second' where id = $1", [
      d.delivery_id,
    ]);
    const again = (await claim("notifications")).find((x) => x.delivery_id === d.delivery_id);
    expect(again?.attempts).toBe(2);
  });

  it("cannot be driven by signed-in users", async () => {
    await expect(db.asUser(owner, (q) => q("select * from app.claim_deliveries('webhooks')"))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("visibility", () => {
  it("shows events to owners but not to cashiers", async () => {
    const cashier = await db.createUser();
    await addMember(db, company, cashier, "cashier");
    const count = (user: string) =>
      db.asUser(user, async (q) => (await q("select count(*)::int as n from public.events")).rows[0].n as number);
    expect(await count(owner)).toBeGreaterThan(0);
    expect(await count(cashier)).toBe(0);
  });
});
