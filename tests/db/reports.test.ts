import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPORTS, findReport, totalsByCurrency } from "@/server/reports";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

// P10: every report runs as the signed-in user and matches the records.
// P17: cost is absent for roles without core.products.view_cost.

let db: Db;
let owner: string;
let cashier: string;
let company: string;
const range = { from: "2026-01-01", to: "2026-12-31" };

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser("owner@reports.test");
  cashier = await db.createUser("cashier@reports.test");
  const other = await db.createUser("other@reports.test");
  company = await createCompanyAs(db, owner, { slug: "reports-co", plan: "business", modules: ["pos", "sales", "inventory"] });
  await addMember(db, company, cashier, "cashier");
  const otherCo = await createCompanyAs(db, other, { slug: "other-reports" });

  for (const c of [company, otherCo]) {
    const q = async (sql: string, params: unknown[]) => (await db.admin.query(sql, params)).rows[0];
    await q("update public.companies set vat_registered = true where id = $1", [c]);
    const hq = (await q("select id from public.branches where company_id = $1", [c])).id;
    const loc = (await q("select id from public.stock_locations where branch_id = $1", [hq])).id;
    const cust = (await q("insert into public.customers (company_id, name) values ($1, 'Tendai Moyo') returning id", [c])).id;
    const prod = (await q("insert into public.products (company_id, sku, name, reorder_level) values ($1, 'CEM-50', 'Cement 50kg', 5) returning id", [c])).id;
    const mov = (
      await q(
        "insert into public.stock_movements (company_id, branch_id, movement_type, product_id, to_location_id, quantity, unit_cost) values ($1, $2, 'receipt', $3, $4, 10, 800) returning id",
        [c, hq, prod, loc],
      )
    ).id;
    await q("update public.stock_movements set docstatus = 1 where id = $1", [mov]);
    const inv = (
      await q(
        "insert into public.sales_invoices (company_id, branch_id, customer_id, currency, invoice_date, due_date) values ($1, $2, $3, 'USD', '2026-06-01', '2026-06-15') returning id",
        [c, hq, cust],
      )
    ).id;
    await q("insert into public.sales_invoice_lines (company_id, invoice_id, product_id, quantity, unit_price_cents) values ($1, $2, $3, 2, 1150)", [c, inv, prod]);
    await q("update public.sales_invoices set docstatus = 1 where id = $1", [inv]);
    const pay = (
      await q(
        "insert into public.payments (company_id, branch_id, customer_id, currency, amount_cents, method, received_on) values ($1, $2, $3, 'USD', 1000, 'ecocash', '2026-06-02') returning id",
        [c, hq, cust],
      )
    ).id;
    await q("insert into public.payment_allocations (company_id, payment_id, invoice_id, amount_cents) values ($1, $2, $3, 1000)", [c, pay, inv]);
    await q("update public.payments set docstatus = 1 where id = $1", [pay]);
  }
});

afterAll(() => db.close());

const run = (user: string, key: string, r = range) =>
  db.asUser(user, (q) => findReport(key)!.run(q, company, r, "USD"));

describe("reports", () => {
  it("sales by day matches the invoice (prices include 15.5% VAT)", async () => {
    expect(await run(owner, "sales-by-day")).toEqual([{ day: "2026-06-01", currency: "USD", invoices: 1, net: "1991", tax: "309", total: "2300" }]);
    expect(await run(owner, "sales-by-day", { from: "2026-07-01", to: "2026-07-31" })).toEqual([]);
  });

  it("sales by product, payments by method and VAT summary", async () => {
    expect(await run(owner, "sales-by-product")).toEqual([
      { sku: "CEM-50", product: "Cement 50kg", currency: "USD", quantity: "2.000", net: "1991", total: "2300" },
    ]);
    expect(await run(owner, "payments-by-method")).toEqual([{ method: "EcoCash", currency: "USD", payments: 1, total: "1000" }]);
    expect(await run(owner, "vat-summary")).toEqual([{ tax_code: "Standard", rate: 1550, currency: "USD", net: "1991", tax: "309", total: "2300" }]);
  });

  it("ages debtors from the due date", async () => {
    const at = (to: string) => run(owner, "debtors-ageing", { from: to, to });
    expect(await at("2026-06-20")).toEqual([
      { customer: "Tendai Moyo", currency: "USD", d0_30: "1300", d31_60: "0", d61_90: "0", d90: "0", total: "1300" },
    ]);
    expect((await at("2026-08-01"))[0]).toMatchObject({ d0_30: "0", d31_60: "1300" });
    expect((await at("2026-10-01"))[0]).toMatchObject({ d90: "1300" });
    expect(await at("2026-05-01")).toEqual([]);
  });

  it("values stock at average cost for roles that may see cost, and hides it otherwise", async () => {
    expect(await run(owner, "stock-valuation")).toEqual([
      { sku: "CEM-50", product: "Cement 50kg", quantity: "8.000", currency: "USD", unit_cost: "800", value: "6400" },
    ]);
    expect(await run(cashier, "stock-valuation")).toEqual([]);
  });

  it("shows nothing of other companies and nothing to roles without sales access", async () => {
    for (const def of REPORTS) {
      const rows = await db.asUser(cashier, (q) => def.run(q, company, range, "USD"));
      // Cashiers have sales.view (they see invoices) but never cost.
      if (def.key === "stock-valuation") expect(rows).toEqual([]);
    }
    const storekeeper = await db.createUser("store@reports.test");
    await addMember(db, company, storekeeper, "storekeeper");
    for (const key of ["sales-by-day", "payments-by-method", "debtors-ageing", "vat-summary"]) {
      expect(await run(storekeeper, key)).toEqual([]);
    }
  });

  it("totals per currency", async () => {
    const def = findReport("sales-by-day")!;
    expect(totalsByCurrency(def, await run(owner, "sales-by-day"))).toEqual([{ currency: "USD", invoices: 1, net: "1991", tax: "309", total: "2300" }]);
  });
});
