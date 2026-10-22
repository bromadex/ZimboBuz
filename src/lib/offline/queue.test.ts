import { describe, expect, it } from "vitest";
import { MemoryQueueStorage, OfflineQueue, type OperationOutcome, type QueuedOperation } from "./queue";

function makeQueue() {
  let n = 0;
  let t = Date.parse("2026-10-11T08:00:00Z");
  return new OfflineQueue(
    new MemoryQueueStorage(),
    () => `op-${String(++n).padStart(4, "0")}`,
    () => new Date((t += 1000)),
  );
}

const base = { companyId: "c1", deviceId: "till-1", type: "insert" as const, target: "customers" };
const applied = (id: string): OperationOutcome => ({ status: "applied", result: { id }, error: null, duplicate: false });

describe("OfflineQueue", () => {
  it("uploads actions in the order they were taken", async () => {
    const q = makeQueue();
    await q.enqueue({ ...base, payload: { name: "A" } });
    await q.enqueue({ ...base, payload: { name: "B" } });
    const seen: string[] = [];
    const report = await q.flush(async (op) => {
      seen.push(op.payload.name as string);
      return applied(op.clientOpId);
    });
    expect(seen).toEqual(["A", "B"]);
    expect(report.applied).toHaveLength(2);
    expect(await q.pending()).toBe(0);
  });

  it("stops at a network error and keeps the rest for next time, with the same ids", async () => {
    const q = makeQueue();
    await q.enqueue({ ...base, payload: { name: "A" } });
    await q.enqueue({ ...base, payload: { name: "B" } });
    await q.enqueue({ ...base, payload: { name: "C" } });
    let calls = 0;
    const report = await q.flush(async (op) => {
      if (++calls === 2) throw new Error("offline");
      return applied(op.clientOpId);
    });
    expect(report).toMatchObject({ interrupted: true, remaining: 2 });

    const ids: string[] = [];
    await q.flush(async (op) => {
      ids.push(op.clientOpId);
      return applied(op.clientOpId);
    });
    expect(ids).toEqual(["op-0002", "op-0003"]);
  });

  it("removes refused actions and reports why", async () => {
    const q = makeQueue();
    await q.enqueue({ ...base, type: "submit", target: "sales_invoices", payload: { id: "inv" } });
    const report = await q.flush(async () => ({ status: "rejected", result: null, error: "not enough stock", duplicate: false }));
    expect(report.rejected[0].outcome.error).toBe("not enough stock");
    expect(await q.pending()).toBe(0);
  });

  it("never runs two uploads at once", async () => {
    const q = makeQueue();
    await q.enqueue({ ...base, payload: { name: "A" } });
    let active = 0;
    let maxActive = 0;
    const upload = async (op: QueuedOperation) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return applied(op.clientOpId);
    };
    const [a, b] = await Promise.all([q.flush(upload), q.flush(upload)]);
    expect(maxActive).toBe(1);
    expect(a).toBe(b);
  });
});
