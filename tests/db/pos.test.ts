import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

// Till sessions, checkout with split payments and change, cash-up and
// mobile money confirmation (20261012110000_point_of_sale).

let db: Db;
let owner: string;
let cashier: string;
let company: string;
let branch: string;
let cement: string;
let bread: string;

const admin = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows[0] as T;

type Result = { invoice_id: string; number: string; total_cents: string; change: Array<{ currency: string; cents: number }>; duplicate: boolean; on_account_cents: number };

/** Runs as a signed-in user and commits, so later tests see the result. */
async function committed<T>(user: string, sql: string, params: unknown[]): Promise<T> {
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

function openTill(user: string, float: Record<string, number> = { USD: 2000 }): Promise<string> {
  return committed(user, "insert into public.till_sessions (company_id, branch_id, opening_float) values ($1, $2, $3) returning id", [company, branch, float]);
}

function checkout(user: string, session: string, args: { lines: unknown[]; tenders: unknown[]; currency?: string; customer?: string | null; credit?: boolean; onAccount?: boolean; ref?: string }) {
  return committed<Result>(user, "select public.pos_checkout($1, $2, $3, $4, $5, $6, $7, $8) as r", [
    session,
    args.ref ?? randomUUID(),
    args.customer ?? null,
    args.currency ?? "USD",
    JSON.stringify(args.lines),
    JSON.stringify(args.tenders),
    args.credit ?? false,
    args.onAccount ?? false,
  ]);
}

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  cashier = await db.createUser();
  company = await createCompanyAs(db, owner, { plan: "business", modules: ["pos", "sales", "inventory"] });
  await addMember(db, company, cashier, "cashier");
  branch = (await admin<{ id: string }>("select id from public.branches where company_id = $1", [company])).id;
  await admin("insert into public.exchange_rates (company_id, currency, rate) values ($1, 'ZWG', 26.75)", [company]);
  const product = async (sku: string, name: string, cents: number, stock: boolean) => {
    const id = (await admin<{ id: string }>("insert into public.products (company_id, sku, name, is_stock_item, tax_code) values ($1, $2, $3, $4, 'exempt') returning id", [company, sku, name, stock])).id;
    await admin("insert into public.product_prices (company_id, product_id, currency, price_cents) values ($1, $2, 'USD', $3)", [company, id, cents]);
    return id;
  };
  cement = await product("CEM", "Cement", 1250, true);
  bread = await product("BRD", "Service fee", 100, false);
  const loc = (await admin<{ id: string }>("select id from public.stock_locations where branch_id = $1", [branch])).id;
  const mov = (await admin<{ id: string }>("insert into public.stock_movements (company_id, branch_id, movement_type, product_id, to_location_id, quantity, unit_cost) values ($1, $2, 'receipt', $3, $4, 100, 800) returning id", [company, branch, cement, loc])).id;
  await admin("update public.stock_movements set docstatus = 1 where id = $1", [mov]);
});

afterAll(() => db.close());

describe("till sales", () => {
  let session: string;
  beforeAll(async () => {
    session = await openTill(cashier, { USD: 2000 });
  });

  it("allows only one open till per cashier", async () => {
    await expect(openTill(cashier)).rejects.toThrow(/duplicate key|till_sessions_one_open/);
  });

  it("sells for cash and works out the change", async () => {
    const r = await checkout(cashier, session, {
      lines: [{ product_id: cement, quantity: 2 }],
      tenders: [{ method: "cash", currency: "USD", amount_cents: 3000 }],
    });
    expect(r.total_cents).toBe(2500);
    expect(r.change).toEqual([{ currency: "USD", cents: 500 }]);
    expect(r.number).toMatch(/^INV-HQ-/);
    const pay = await admin<{ amount_cents: string }>("select amount_cents from public.payments where till_session_id = $1", [session]);
    expect(pay.amount_cents).toBe("2500"); // recorded net of change
  });

  it("splits a sale across EcoCash (unconfirmed allowed only without Paynow) and ZiG cash", async () => {
    const r = await checkout(cashier, session, {
      lines: [{ product_id: cement, quantity: 1 }],
      tenders: [
        { method: "ecocash", currency: "USD", amount_cents: 1000, reference: "MP123" },
        { method: "cash", currency: "ZWG", amount_cents: 10000 },
      ],
    });
    // USD 2.50 left after EcoCash = ZiG 66.88; ZiG 100.00 given, change ZiG 33.12
    expect(r.change).toEqual([{ currency: "ZWG", cents: 3312 }]);
    const v = await db.asUser(owner, async (q) => (await q("select payment_status from public.sales_invoices_v where id = $1", [r.invoice_id])).rows[0]);
    expect(v.payment_status).toBe("paid");
  });

  it("is idempotent on the till's reference", async () => {
    const ref = randomUUID();
    const a = await checkout(cashier, session, { ref, lines: [{ product_id: bread, quantity: 1 }], tenders: [{ method: "cash", currency: "USD", amount_cents: 100 }] });
    const b = await checkout(cashier, session, { ref, lines: [{ product_id: bread, quantity: 1 }], tenders: [{ method: "cash", currency: "USD", amount_cents: 100 }] });
    expect(b).toMatchObject({ invoice_id: a.invoice_id, duplicate: true });
  });

  it("refuses short payment, card overpayment, discounts without permission and selling without stock", async () => {
    const sale = (tenders: unknown[], lines: unknown[] = [{ product_id: bread, quantity: 1 }]) => checkout(cashier, session, { lines, tenders });
    await expect(sale([{ method: "cash", currency: "USD", amount_cents: 50 }])).rejects.toThrow(/less than the total/);
    await expect(sale([{ method: "card", currency: "USD", amount_cents: 500 }])).rejects.toThrow(/cannot be more than the amount due/);
    await expect(sale([{ method: "cash", currency: "USD", amount_cents: 100 }], [{ product_id: bread, quantity: 1, discount_cents: 10 }])).rejects.toThrow(
      /not allowed to give discounts/,
    );
    await expect(sale([{ method: "cash", currency: "USD", amount_cents: 999999 }], [{ product_id: cement, quantity: 1000 }])).rejects.toThrow(/stock/);
  });

  it("puts a sale on a named customer's account only for staff allowed to give credit", async () => {
    const customer = (await admin<{ id: string }>("insert into public.customers (company_id, name) values ($1, 'Rudo') returning id", [company])).id;
    const args = { customer, onAccount: true, lines: [{ product_id: bread, quantity: 3 }], tenders: [{ method: "cash", currency: "USD", amount_cents: 100 }] };
    await expect(checkout(cashier, session, args)).rejects.toThrow(/not allowed to sell on account/);
    const ownerTill = await openTill(owner, {});
    const r = await checkout(owner, ownerTill, args);
    expect(Number(r.on_account_cents)).toBe(200);
    // change kept as the customer's credit
    const c = await checkout(owner, ownerTill, { customer, credit: true, lines: [{ product_id: bread, quantity: 1 }], tenders: [{ method: "cash", currency: "USD", amount_cents: 500 }] });
    expect(c.change).toEqual([]);
  });

  it("only lets the cashier use their own open till", async () => {
    await expect(checkout(owner, session, { lines: [{ product_id: bread, quantity: 1 }], tenders: [{ method: "cash", currency: "USD", amount_cents: 100 }] })).rejects.toThrow(
      /another cashier/,
    );
  });
});

describe("mobile money through Paynow", () => {
  it("needs a confirmed, unused payment request of the same amount", async () => {
    await admin("insert into public.payment_gateway_accounts (company_id, gateway, currency, integration_id, integration_key_enc) values ($1, 'paynow', 'USD', 'x', 'y')", [company]);
    const till = (await admin<{ id: string }>("select id from public.till_sessions where company_id = $1 and opened_by = $2 and docstatus = 0", [company, cashier])).id;
    const lines = [{ product_id: bread, quantity: 1 }];
    await expect(checkout(cashier, till, { lines, tenders: [{ method: "ecocash", currency: "USD", amount_cents: 100 }] })).rejects.toThrow(/confirmed through Paynow/);
    const req = (
      await admin<{ id: string }>(
        "insert into public.payment_requests (company_id, till_session_id, gateway, method, currency, amount_cents, phone, reference, created_by) values ($1, $2, 'paynow', 'ecocash', 'USD', 100, '0771', 'R-77', $3) returning id",
        [company, till, cashier],
      )
    ).id;
    const tender = [{ method: "ecocash", currency: "USD", amount_cents: 100, payment_request_id: req }];
    await expect(checkout(cashier, till, { lines, tenders: tender })).rejects.toThrow(/not been confirmed/);
    await admin("update public.payment_requests set status = 'paid', gateway_reference = 'PN-1' where id = $1", [req]);
    await checkout(cashier, till, { lines, tenders: tender });
    await expect(checkout(cashier, till, { lines, tenders: tender })).rejects.toThrow(/not been confirmed/); // used once only
    const p = await admin<{ gateway_reference: string }>("select gateway_reference from public.payments where gateway_reference = 'PN-1'");
    expect(p.gateway_reference).toBe("PN-1");
  });

  it("never shows the encrypted gateway key to users", async () => {
    await expect(db.asUser(owner, (q) => q("select integration_key_enc from public.payment_gateway_accounts"))).rejects.toThrow(/permission denied/);
  });
});

describe("cash-up", () => {
  it("compares counted cash with the float plus cash sales and posts the difference", async () => {
    const till = (await admin<{ id: string }>("select id from public.till_sessions where company_id = $1 and opened_by = $2 and docstatus = 0", [company, cashier])).id;
    const expected = await db.asUser(cashier, async (q) => (await q("select app.till_expected_cash($1) as e", [till])).rows[0].e);
    // float 20.00 + 25.00 + 1.00 cash sales; ZiG 66.88 kept from the split sale
    expect(expected).toEqual({ USD: 4600, ZWG: 6688 });
    await expect(db.asUser(owner, (q) => q("select public.close_till($1, $2)", [till, { USD: 4600 }]))).resolves.toBeTruthy();
    await committed(cashier, "select public.close_till($1, $2, 'Short by a dollar')", [till, { USD: 4500, ZWG: 6688 }]);
    await db.asUser(cashier, async (q) => {
      const s = (await q("select docstatus, counted_cash, expected_cash from public.till_sessions where id = $1", [till])).rows[0];
      expect(s).toMatchObject({ docstatus: 1, counted_cash: { USD: 4500, ZWG: 6688 } });
    });
    await db.asUser(owner, async (q) => {
      const shortage = (
        await q(
          `select l.debit_cents from public.journal_lines l join public.accounts a on a.id = l.account_id
           join public.journal_entries e on e.id = l.entry_id
           where e.source_id = $1 and a.system_key = 'cash_over_short'`,
          [till],
        )
      ).rows[0];
      expect(shortage.debit_cents).toBe("100");
    });
  });
});
