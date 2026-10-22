import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

// Rules added for the Release 1 screens (20261012090000_screens_foundation).

let db: Db;
let owner: string;
let cashier: string;
let company: string;
let branch: string;
let customer: string;

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  cashier = await db.createUser();
  company = await createCompanyAs(db, owner, { plan: "business" });
  await addMember(db, company, cashier, "cashier");
  branch = (await db.admin.query("select id from public.branches where company_id = $1", [company])).rows[0].id;
  customer = (await db.admin.query("insert into public.customers (company_id, name) values ($1, 'C') returning id", [company])).rows[0].id;
});

afterAll(() => db.close());

describe("company details", () => {
  it("lets the owner rename the company but not change plan, status or address", async () => {
    await db.asUser(owner, async (q) => {
      expect((await q("update public.companies set name = 'New name' where id = $1", [company])).rowCount).toBe(1);
    });
    for (const sql of [
      "update public.companies set plan_code = 'enterprise' where id = $1",
      "update public.companies set status = 'active' where id = $1",
      "update public.companies set slug = 'taken' where id = $1",
      "update public.companies set base_currency = 'ZWG' where id = $1",
    ]) {
      await expect(db.asUser(owner, (q) => q(sql, [company]))).rejects.toThrow(/permission denied/);
    }
  });

  it("needs the VAT permission to change VAT settings", async () => {
    await db.admin.query(
      `delete from public.role_permissions rp using public.roles r
       where rp.role_id = r.id and r.company_id = $1 and r.code = 'owner' and rp.permission_code = 'core.settings.tax'`,
      [company],
    );
    await expect(
      db.asUser(owner, (q) => q("update public.companies set vat_registered = true where id = $1", [company])),
    ).rejects.toThrow(/VAT settings/);
    await db.admin.query(
      `insert into public.role_permissions (company_id, role_id, permission_code)
       select $1, id, 'core.settings.tax' from public.roles where company_id = $1 and code = 'owner'`,
      [company],
    );
    await db.asUser(owner, async (q) => {
      expect((await q("update public.companies set vat_registered = true, vat_number = '1234' where id = $1", [company])).rowCount).toBe(1);
    });
  });
});

describe("removing draft lines", () => {
  it("removes a line from a draft quote, not from a submitted one, and not for others", async () => {
    const quote = (
      await db.admin.query(
        "insert into public.quotes (company_id, branch_id, customer_id, currency) values ($1, $2, $3, 'USD') returning id",
        [company, branch, customer],
      )
    ).rows[0].id;
    const line = async () =>
      (
        await db.admin.query(
          "insert into public.quote_lines (company_id, quote_id, description, quantity, unit_price_cents) values ($1, $2, 'Work', 1, 1000) returning id",
          [company, quote],
        )
      ).rows[0].id as string;
    const first = await line();
    await expect(db.asUser(cashier, (q) => q("select public.remove_draft_line('quote_lines', $1)", [first]))).rejects.toThrow(/not allowed/);
    await db.asUser(owner, async (q) => {
      await q("select public.remove_draft_line('quote_lines', $1)", [first]);
      expect((await q("select count(*)::int as n from public.quote_lines where id = $1", [first])).rows[0].n).toBe(0);
    });
    await expect(db.asUser(owner, (q) => q("select public.remove_draft_line('customers', $1)", [first]))).rejects.toThrow(/cannot be removed/);

    const second = await line();
    await db.admin.query("update public.quotes set docstatus = 1 where id = $1", [quote]);
    await expect(db.asUser(owner, (q) => q("select public.remove_draft_line('quote_lines', $1)", [second]))).rejects.toThrow(/draft/);
  });
});
