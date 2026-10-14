import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompanyAs, createTestDb, type Db } from "./harness";

// Paying invoices from the customer portal (20261014110000_portal_invoice_payments).

let db: Db;
let company: string;
let customer: string;
let buyer: string;
let stranger: string;
let invoice: string;

const admin = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows[0] as T;

async function as<T>(user: string, sql: string, params: unknown[]): Promise<T> {
  await db.admin.query("begin");
  try {
    await db.admin.query("set local role authenticated");
    await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    const row = (await db.admin.query(sql, params)).rows[0];
    await db.admin.query("commit");
    return Object.values(row)[0] as T;
  } catch (e) {
    await db.admin.query("rollback");
    throw e;
  }
}

beforeAll(async () => {
  db = await createTestDb();
  const owner = await db.createUser();
  buyer = await db.createUser("buyer@test.local");
  stranger = await db.createUser("stranger@test.local");
  company = await createCompanyAs(db, owner, { slug: "payco", plan: "business", modules: ["sales", "portal"] });
  const branch = (await admin<{ id: string }>("select id from public.branches where company_id = $1", [company])).id;
  customer = (await admin<{ id: string }>("insert into public.customers (company_id, name) values ($1, 'Buyer') returning id", [company])).id;
  await admin("insert into public.portal_users (company_id, customer_id, user_id, status) values ($1, $2, $3, 'active')", [company, customer, buyer]);
  invoice = (await admin<{ id: string }>("insert into public.sales_invoices (company_id, branch_id, customer_id, currency) values ($1, $2, $3, 'USD') returning id", [company, branch, customer])).id;
  await admin("insert into public.sales_invoice_lines (company_id, invoice_id, description, quantity, unit_price_cents, tax_code) values ($1, $2, 'Work', 1, 4000, 'exempt')", [company, invoice]);
  await admin("update public.sales_invoices set docstatus = 1 where id = $1", [invoice]);
});

afterAll(() => db.close());

describe("portal invoice payments", () => {
  it("lets only the invoice's customer start a payment for what is owed", async () => {
    await expect(as(stranger, "select public.portal_start_invoice_payment('payco', $1)", [invoice])).rejects.toThrow(/not allowed/);
    const r = await as<{ link_id: string; amount_cents: number }>(buyer, "select public.portal_start_invoice_payment('payco', $1)", [invoice]);
    expect(Number(r.amount_cents)).toBe(4000);
  });

  it("records the confirmed payment once and settles the invoice", async () => {
    const r = await as<{ link_id: string }>(buyer, "select public.portal_start_invoice_payment('payco', $1)", [invoice]);
    expect((await admin<{ s: string }>("select app.complete_invoice_payment($1, 'PN-1') as s", [r.link_id])).s).toBe("paid");
    expect((await admin<{ s: string }>("select app.complete_invoice_payment($1, 'PN-1') as s", [r.link_id])).s).toBe("paid");
    expect((await admin<{ b: string }>("select total_cents - app.invoice_paid_cents(id) as b from public.sales_invoices where id = $1", [invoice])).b).toBe("0");
    await expect(as(buyer, "select public.portal_start_invoice_payment('payco', $1)", [invoice])).rejects.toThrow(/already paid/);
  });

  it("keeps a second payment for an already-settled invoice as credit and flags it", async () => {
    // the earlier pending link from the first test is now paid twice over
    const pending = (await admin<{ id: string }>("select id from public.invoice_payment_links where status = 'pending' and invoice_id = $1 limit 1", [invoice])).id;
    expect((await admin<{ s: string }>("select app.complete_invoice_payment($1, 'PN-2') as s", [pending])).s).toBe("needs_attention");
    expect((await admin<{ c: string }>("select app.customer_credit_cents($1, $2, 'USD') as c", [company, customer])).c).toBe("4000");
  });
});
