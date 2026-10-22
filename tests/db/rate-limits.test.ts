import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "./harness";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

describe("rate limits", () => {
  it("allows up to the limit in a window, per key", async () => {
    const hit = async (key: string) => (await db.admin.query("select app.hit_rate_limit($1, 3, 600) as ok", [key])).rows[0].ok;
    expect([await hit("a"), await hit("a"), await hit("a"), await hit("a")]).toEqual([true, true, true, false]);
    expect(await hit("b")).toBe(true);
  });

  it("is not usable by visitors or signed-in users", async () => {
    await db.admin.query("begin");
    await db.admin.query("set local role anon");
    await expect(db.admin.query("select app.hit_rate_limit('x', 1, 60)")).rejects.toThrow(/permission denied/);
    await db.admin.query("rollback");
  });
});
