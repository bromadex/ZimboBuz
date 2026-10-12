import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompanyAs, createTestDb, type Db } from "./harness";

// Online store checkout (20261012115000_web_orders).

let db: Db;
let company: string;
let cement: string;
let hidden: string;

const admin = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows[0] as T;

async function asAnon<T>(sql: string, params: unknown[]): Promise<T> {
  await db.admin.query("begin");
  try {
    await db.admin.query("set local role anon");
    const row = (await db.admin.query(sql, params)).rows[0];
    await db.admin.query("commit");
    return Object.values(row)[0] as T;
  } catch (e) {
    await db.admin.query("rollback");
    throw e;
  }
}

const order = (items: unknown, email = "buyer@test.local") =>
  asAnon<{ order_id: string; total_cents: number; reference: string }>("select public.create_web_order('shop', 'Buyer', $1, '0771234567', 'USD', $2)", [email, JSON.stringify(items)]);

beforeAll(async () => {
  db = await createTestDb();
  const owner = await db.createUser();
  company = await createCompanyAs(db, owner, { slug: "shop", plan: "business", modules: ["pos", "sales", "website"] });
  const branch = (await admin<{ id: string }>("select id from public.branches where company_id = $1", [company])).id;
  const product = async (sku: string, online: boolean) => {
    const id = (await admin<{ id: string }>("insert into public.products (company_id, sku, name, show_online, tax_code) values ($1, $2, $2, $3, 'exempt') returning id", [company, sku, online])).id;
    await admin("insert into public.product_prices (company_id, product_id, currency, price_cents) values ($1, $2, 'USD', 1250)", [company, id]);
    return id;
  };
  cement = await product("CEM", true);
  hidden = await product("HID", false);
  const loc = (await admin<{ id: string }>("select id from public.stock_locations where branch_id = $1", [branch])).id;
  const mov = (await admin<{ id: string }>("insert into public.stock_movements (company_id, branch_id, movement_type, product_id, to_location_id, quantity, unit_cost) values ($1, $2, 'receipt', $3, $4, 3, 800) returning id", [company, branch, cement, loc])).id;
  await admin("update public.stock_movements set docstatus = 1 where id = $1", [mov]);
});

afterAll(() => db.close());

describe("online orders", () => {
  it("prices the basket from the catalogue as a draft invoice", async () => {
    const o = await order([{ product_id: cement, quantity: 2 }]);
    expect(Number(o.total_cents)).toBe(2500);
    const inv = await admin<{ docstatus: number }>("select i.docstatus from public.web_orders w join public.sales_invoices i on i.id = w.invoice_id where w.id = $1", [o.order_id]);
    expect(inv.docstatus).toBe(0);
  });

  it("refuses hidden products, empty baskets and shops without online checkout", async () => {
    await expect(order([{ product_id: hidden, quantity: 1 }])).rejects.toThrow(/no longer available/);
    await expect(order([])).rejects.toThrow(/basket is empty/);
    await expect(order([{ product_id: cement, quantity: 1 }], "not-an-email")).rejects.toThrow(/valid email/);
    await admin("insert into public.company_features (company_id, feature_code, enabled) values ($1, 'website.buy', false)", [company]);
    await expect(order([{ product_id: cement, quantity: 1 }])).rejects.toThrow(/does not take online payments/);
    await admin("update public.company_features set enabled = true where company_id = $1 and feature_code = 'website.buy'", [company]);
  });

  it("submits the invoice and records the payment once paid, only once", async () => {
    const o = await order([{ product_id: cement, quantity: 1 }]);
    expect((await admin<{ s: string }>("select app.complete_web_order($1, 'PN-9') as s", [o.order_id])).s).toBe("paid");
    expect((await admin<{ s: string }>("select app.complete_web_order($1, 'PN-9') as s", [o.order_id])).s).toBe("paid");
    const r = await admin<{ docstatus: number; paid: string; n: string }>(
      `select i.docstatus, app.invoice_paid_cents(i.id) as paid,
              (select count(*) from public.payments p where p.gateway_reference = 'PN-9') as n
       from public.web_orders w join public.sales_invoices i on i.id = w.invoice_id where w.id = $1`,
      [o.order_id],
    );
    expect(r).toEqual({ docstatus: 1, paid: "1250", n: "1" });
  });

  it("keeps the money as credit and flags the order when stock ran out", async () => {
    const o = await order([{ product_id: cement, quantity: 5 }]);
    expect((await admin<{ s: string }>("select app.complete_web_order($1, 'PN-10') as s", [o.order_id])).s).toBe("needs_attention");
    const w = await admin<{ problem: string }>("select problem from public.web_orders where id = $1", [o.order_id]);
    expect(w.problem).toMatch(/stock/);
  });

  it("is not readable by visitors", async () => {
    await expect(asAnon("select count(*) from public.web_orders", [])).rejects.toThrow(/permission denied/);
  });
});
