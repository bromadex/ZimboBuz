import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

// Credit notes and refunds (20261014100000_credit_notes_refunds).

let db: Db;
let owner: string;
let cashier: string;
let company: string;
let branch: string;
let customer: string;
let cement: string;

const admin = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows[0] as T;

async function committed<T>(user: string, sql: string, params: unknown[]): Promise<T> {
  await db.admin.query("begin");
  try {
    await db.admin.query("set local role authenticated");
    await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    const row = (await db.admin.query(sql, params)).rows[0];
    await db.admin.query("commit");
    return Object.values(row ?? {})[0] as T;
  } catch (e) {
    await db.admin.query("rollback");
    throw e;
  }
}

async function invoice(qty: number) {
  const id = (await admin<{ id: string }>("insert into public.sales_invoices (company_id, branch_id, customer_id, currency) values ($1, $2, $3, 'USD') returning id", [company, branch, customer])).id;
  const line = (
    await admin<{ id: string }>("insert into public.sales_invoice_lines (company_id, invoice_id, product_id, quantity, unit_price_cents, tax_code) values ($1, $2, $3, $4, 1000, 'exempt') returning id", [
      company,
      id,
      cement,
      qty,
    ])
  ).id;
  await admin("update public.sales_invoices set docstatus = 1 where id = $1", [id]);
  return { id, line };
}

const stock = async () => Number((await admin<{ q: string }>("select coalesce(sum(quantity), 0) as q from public.stock_levels where product_id = $1", [cement])).q);
const balance = async (inv: string) => (await admin<{ b: string }>("select total_cents - app.invoice_paid_cents(id) as b from public.sales_invoices where id = $1", [inv])).b;
const credit = async () => (await admin<{ c: string }>("select app.customer_credit_cents($1, $2, 'USD') as c", [company, customer])).c;

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  cashier = await db.createUser();
  company = await createCompanyAs(db, owner, { plan: "business", modules: ["pos", "sales", "inventory"] });
  await addMember(db, company, cashier, "cashier");
  branch = (await admin<{ id: string }>("select id from public.branches where company_id = $1", [company])).id;
  customer = (await admin<{ id: string }>("insert into public.customers (company_id, name) values ($1, 'Rudo') returning id", [company])).id;
  cement = (await admin<{ id: string }>("insert into public.products (company_id, sku, name, tax_code) values ($1, 'CEM', 'Cement', 'exempt') returning id", [company])).id;
  const loc = (await admin<{ id: string }>("select id from public.stock_locations where branch_id = $1", [branch])).id;
  const mov = (await admin<{ id: string }>("insert into public.stock_movements (company_id, branch_id, movement_type, product_id, to_location_id, quantity, unit_cost) values ($1, $2, 'receipt', $3, $4, 50, 600) returning id", [company, branch, cement, loc])).id;
  await admin("update public.stock_movements set docstatus = 1 where id = $1", [mov]);
});

afterAll(() => db.close());

describe("credit notes", () => {
  it("credits part of an unpaid invoice, returns stock and reduces what is owed", async () => {
    const inv = await invoice(5);
    expect(await stock()).toBe(45);
    const note = await committed<string>(owner, "select public.create_credit_note($1, $2, 'Two bags damaged', true)", [inv.id, JSON.stringify([{ invoice_line_id: inv.line, quantity: 2 }])]);
    const cn = await admin<{ number: string; total_cents: string; applied_cents: string; docstatus: number }>("select number, total_cents, applied_cents, docstatus from public.credit_notes where id = $1", [note]);
    expect(cn).toMatchObject({ total_cents: "2000", applied_cents: "2000", docstatus: 1 });
    expect(cn.number).toMatch(/^CRN-HQ-/);
    expect(await balance(inv.id)).toBe("3000");
    expect(await stock()).toBe(47);
    await expect(
      committed(owner, "select public.create_credit_note($1, $2, 'Again', false)", [inv.id, JSON.stringify([{ invoice_line_id: inv.line, quantity: 4 }])]),
    ).rejects.toThrow(/at most 3/);
    await expect(committed(owner, "update public.sales_invoices set docstatus = 2, cancel_reason = 'x' where id = $1", [inv.id])).rejects.toThrow(/credit notes on this invoice/);
  });

  it("turns credit on a paid invoice into customer credit, which can be refunded once", async () => {
    const inv = await invoice(1);
    const pay = (await admin<{ id: string }>("insert into public.payments (company_id, branch_id, customer_id, currency, amount_cents, method) values ($1, $2, $3, 'USD', 1000, 'cash') returning id", [company, branch, customer])).id;
    await admin("insert into public.payment_allocations (company_id, payment_id, invoice_id, amount_cents) values ($1, $2, $3, 1000)", [company, pay, inv.id]);
    await admin("update public.payments set docstatus = 1 where id = $1", [pay]);
    const before = Number(await credit());
    const note = await committed<string>(owner, "select public.create_credit_note($1, $2, 'Returned', false)", [inv.id, JSON.stringify([{ invoice_line_id: inv.line, quantity: 1 }])]);
    expect((await admin<{ a: string }>("select applied_cents as a from public.credit_notes where id = $1", [note])).a).toBe("0");
    expect(Number(await credit()) - before).toBe(1000);
    await expect(committed(cashier, "select public.record_refund($1, 'USD', 1000, 'cash')", [customer])).rejects.toThrow(/not allowed/);
    await committed(owner, "select public.record_refund($1, 'USD', 1000, 'ecocash', 'MP1', $2)", [customer, note]);
    expect(Number(await credit())).toBe(before);
    await expect(committed(owner, "select public.record_refund($1, 'USD', 1, 'cash')", [customer])).rejects.toThrow(/more than the customer's credit/);
    await expect(committed(owner, "select public.cancel_credit_note($1, 'mistake')", [note])).rejects.toThrow(/already been refunded/);
  });

  it("shows credit notes and refunds on the statement, balancing to zero", async () => {
    const rows = await db.asUser(owner, async (q) =>
      (await q<{ kind: string; balance_cents: string }>("select kind, balance_cents from public.customer_statement($1, $2, 'USD', '2000-01-01', '2999-01-01')", [company, customer])).rows,
    );
    expect(rows.map((r) => r.kind)).toEqual(expect.arrayContaining(["invoice", "credit_note", "payment", "refund"]));
    expect(rows[rows.length - 1].balance_cents).toBe("3000"); // the first invoice: 5000 - 2000 credited
  });

  it("only lets permitted roles make credit notes, and keeps the books balanced", async () => {
    const inv = await invoice(1);
    await expect(committed(cashier, "select public.create_credit_note($1, $2, 'x', false)", [inv.id, JSON.stringify([{ invoice_line_id: inv.line, quantity: 1 }])])).rejects.toThrow(/not allowed/);
    const unbalanced = await admin<{ n: string }>(
      "select count(*) as n from (select entry_id from public.journal_lines where company_id = $1 group by entry_id having sum(debit_cents) <> sum(credit_cents)) x",
      [company],
    );
    expect(unbalanced.n).toBe("0");
  });
});
