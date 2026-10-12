import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompanyAs, createTestDb, type Db } from "./harness";

// Database support for the sales screens (20261012100000_sales_screens).

let db: Db;
let owner: string;
let company: string;
let branch: string;
let customer: string;

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows[0] as T;

async function invoice(currency: string, cents: number, date = "2026-10-01") {
  const { id } = await one<{ id: string }>(
    "insert into public.sales_invoices (company_id, branch_id, customer_id, currency, invoice_date) values ($1, $2, $3, $4, $5) returning id",
    [company, branch, customer, currency, date],
  );
  await one(
    "insert into public.sales_invoice_lines (company_id, invoice_id, description, quantity, unit_price_cents, tax_code) values ($1, $2, 'Work', 1, $3, 'exempt')",
    [company, id, cents],
  );
  await one("update public.sales_invoices set docstatus = 1 where id = $1", [id]);
  return id;
}

async function pay(currency: string, cents: number, allocations: Array<[string, number]>, date = "2026-10-05") {
  const { id } = await one<{ id: string }>(
    "insert into public.payments (company_id, branch_id, customer_id, currency, amount_cents, method, received_on) values ($1, $2, $3, $4, $5, 'cash', $6) returning id",
    [company, branch, customer, currency, cents, date],
  );
  for (const [inv, amount] of allocations) {
    await one("insert into public.payment_allocations (company_id, payment_id, invoice_id, amount_cents) values ($1, $2, $3, $4)", [company, id, inv, amount]);
  }
  await one("update public.payments set docstatus = 1 where id = $1", [id]);
  return id;
}

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  company = await createCompanyAs(db, owner, { plan: "business", modules: ["pos", "sales"] });
  branch = (await one<{ id: string }>("select id from public.branches where company_id = $1", [company])).id;
  customer = (await one<{ id: string }>("insert into public.customers (company_id, name) values ($1, 'Tendai') returning id", [company])).id;
  await one("insert into public.exchange_rates (company_id, currency, rate, effective_at) values ($1, 'ZWG', 26.75, '2026-01-01')", [company]);
});

afterAll(() => db.close());

describe("amending", () => {
  it("copies a cancelled invoice into a new draft linked to the original", async () => {
    const inv = await invoice("USD", 5000);
    await one("update public.sales_invoices set docstatus = 2, cancel_reason = 'Wrong price' where id = $1", [inv]);
    const copy = await db.asUser(owner, async (q) => {
      const id = (await q<{ id: string }>("select public.amend_document('sales_invoice', $1) as id", [inv])).rows[0].id;
      const row = (await q("select docstatus, amended_from, number, total_cents from public.sales_invoices where id = $1", [id])).rows[0];
      return row;
    });
    expect(copy).toMatchObject({ docstatus: 0, amended_from: inv, number: null, total_cents: "5000" });
  });

  it("refuses to amend documents that are not cancelled", async () => {
    const inv = await invoice("USD", 100);
    await expect(db.asUser(owner, (q) => q("select public.amend_document('sales_invoice', $1)", [inv]))).rejects.toThrow(/only cancelled/);
  });
});

describe("paying in another currency", () => {
  it("settles a ZiG invoice with US dollars when cents cannot convert exactly", async () => {
    // ZiG 100.00 at 26.75 = USD 3.7383...; USD 3.74 converts to ZiG 100.05.
    const inv = await invoice("ZWG", 10000);
    await pay("USD", 374, [[inv, 374]]);
    const v = await db.asUser(owner, async (q) =>
      (await q("select balance_cents, payment_status from public.sales_invoices_v where id = $1", [inv])).rows[0],
    );
    expect(v).toEqual({ balance_cents: "0", payment_status: "paid" });
  });

  it("still refuses a real overpayment of an invoice", async () => {
    const inv = await invoice("ZWG", 10000);
    await expect(pay("USD", 500, [[inv, 500]])).rejects.toThrow(/exceeds the balance/);
  });
});

describe("customer statement", () => {
  it("lists invoices, payments and advances with an opening and running balance", async () => {
    const other = (await one<{ id: string }>("insert into public.customers (company_id, name) values ($1, 'Rudo') returning id", [company])).id;
    const prev = customer;
    customer = other;
    const old = await invoice("USD", 1000, "2026-09-10");
    const a = await invoice("USD", 2000, "2026-10-02");
    await pay("USD", 3500, [[a, 1500], [old, 1000]], "2026-10-06");
    customer = prev;
    const rows = await db.asUser(owner, async (q) =>
      (
        await q<{ kind: string; debit_cents: string; credit_cents: string; balance_cents: string }>(
          "select kind, debit_cents, credit_cents, balance_cents from public.customer_statement($1, $2, 'USD', '2026-10-01', '2026-10-31')",
          [company, other],
        )
      ).rows,
    );
    expect(rows[0]).toMatchObject({ kind: "opening", balance_cents: "1000" });
    expect(rows[1]).toMatchObject({ kind: "invoice", debit_cents: "2000", balance_cents: "3000" });
    expect(rows.find((r) => r.kind === "advance")?.credit_cents).toBe("1000");
    expect(rows.filter((r) => r.kind === "payment").map((r) => r.credit_cents).sort()).toEqual(["1000", "1500"]);
    expect(rows[rows.length - 1].balance_cents).toBe("-500"); // USD 5.00 more paid than invoiced
  });
});
