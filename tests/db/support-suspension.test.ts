import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompanyAs, createTestDb, type Db } from "./harness";

let db: Db;
let owner: string;
let company: string;
const one = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  company = await createCompanyAs(db, owner, { plan: "business" });
});
afterAll(() => db.close());

describe("suspension by support", () => {
  it("is not lifted by the billing run, only by support", async () => {
    await one("select app.suspend_company_by_support($1, 'Reported fraud')", [company]);
    expect((await one("select app.refresh_billing_status($1) as s", [company])).s).toBe("suspended");
    await one("select app.update_billing_statuses()");
    expect((await one("select status from public.companies where id = $1", [company])).status).toBe("suspended");
    expect((await one("select app.lift_support_suspension($1) as s", [company])).s).toBe("active");
  });

  it("cannot be set or lifted by the company", async () => {
    await expect(db.asUser(owner, (q) => q("update public.companies set support_suspended_at = null where id = $1", [company]))).rejects.toThrow(/permission denied/);
    await expect(db.asUser(owner, (q) => q("select app.lift_support_suspension($1)", [company]))).rejects.toThrow(/permission denied/);
  });
});

describe("price audit", () => {
  it("records price changes in the audit log", async () => {
    const p = (await one("insert into public.products (company_id, sku, name) values ($1, 'A', 'A') returning id", [company])).id;
    await db.asUser(owner, async (q) => {
      await q("insert into public.product_prices (company_id, product_id, currency, price_cents) values ($1, $2, 'USD', 100)", [company, p]);
      await q("update public.product_prices set price_cents = 150 where product_id = $1", [p]);
      const rows = (await q("select action, after->>'price_cents' as price from public.audit_events where table_name = 'product_prices' and record_id = $1 order by id", [p])).rows;
      expect(rows).toEqual([
        { action: "insert", price: "100" },
        { action: "update", price: "150" },
      ]);
    });
  });
});
