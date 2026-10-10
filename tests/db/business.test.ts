// Core business records (issue #25): customers, rates, products, stock, ledger,
// quotes, invoices, payments and website leads, end to end (§4.4 flows A–C).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

let db: Db;
let owner: string;
let cashier: string;
let storekeeper: string;
let company: string;
let hq: string;
let mainLoc: string;

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.admin.query(sql, params)).rows[0] as T;

const product = async (sku: string, opts: { price?: number; reorder?: number; stock?: boolean; online?: boolean } = {}) => {
  const p = await one<{ id: string }>(
    `insert into public.products (company_id, sku, name, reorder_level, is_stock_item, show_online)
     values ($1, $2, $2, $3, $4, $5) returning id`,
    [company, sku, opts.reorder ?? null, opts.stock ?? true, opts.online ?? true],
  );
  if (opts.price !== undefined) {
    await db.admin.query(
      "insert into public.product_prices (company_id, product_id, currency, price_cents) values ($1, $2, 'USD', $3)",
      [company, p.id, opts.price],
    );
  }
  return p.id;
};

const move = async (type: string, productId: string, qty: number, cost?: number, submit = true) => {
  const inbound = ["receipt", "return_in", "adjustment_in"].includes(type);
  const m = await one<{ id: string }>(
    `insert into public.stock_movements (company_id, branch_id, movement_type, product_id, from_location_id, to_location_id, quantity, unit_cost)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [company, hq, type, productId, inbound ? null : mainLoc, inbound ? mainLoc : null, qty, cost ?? null],
  );
  if (submit) await db.admin.query("update public.stock_movements set docstatus = 1 where id = $1", [m.id]);
  return m.id;
};

const level = async (productId: string, location = mainLoc) =>
  Number(
    (await one<{ q: string }>(
      "select coalesce(sum(quantity), 0) as q from public.stock_levels where product_id = $1 and location_id = $2",
      [productId, location],
    )).q,
  );

const balance = async (systemKey: string) =>
  Number(
    (await one<{ b: string }>(
      `select coalesce(sum(l.debit_cents - l.credit_cents), 0) as b
       from public.journal_lines l join public.accounts a on a.id = l.account_id
       where a.company_id = $1 and a.system_key = $2`,
      [company, systemKey],
    )).b,
  );

const customer = async (name = "Chipo", extra: { email?: string; phone?: string } = {}) =>
  (await one<{ id: string }>(
    "insert into public.customers (company_id, name, email, phone) values ($1, $2, $3, $4) returning id",
    [company, name, extra.email ?? null, extra.phone ?? null],
  )).id;

const invoice = async (customerId: string, lines: Array<{ product?: string; desc?: string; qty: number; price: number }>, currency = "USD") => {
  const inv = await one<{ id: string }>(
    "insert into public.sales_invoices (company_id, branch_id, customer_id, currency) values ($1, $2, $3, $4) returning id",
    [company, hq, customerId, currency],
  );
  for (const [i, l] of lines.entries()) {
    await db.admin.query(
      `insert into public.sales_invoice_lines (company_id, invoice_id, line_no, product_id, description, quantity, unit_price_cents)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [company, inv.id, i + 1, l.product ?? null, l.desc ?? null, l.qty, l.price],
    );
  }
  return inv.id;
};

const pay = async (customerId: string, amount: number, allocations: Array<[string, number]>, opts: { currency?: string; method?: string } = {}) => {
  const p = await one<{ id: string }>(
    `insert into public.payments (company_id, branch_id, customer_id, currency, amount_cents, method)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [company, hq, customerId, opts.currency ?? "USD", amount, opts.method ?? "cash"],
  );
  for (const [inv, amt] of allocations) {
    await db.admin.query(
      "insert into public.payment_allocations (company_id, payment_id, invoice_id, amount_cents) values ($1, $2, $3, $4)",
      [company, p.id, inv, amt],
    );
  }
  await db.admin.query("update public.payments set docstatus = 1 where id = $1", [p.id]);
  return p.id;
};

const invoiceView = (id: string) =>
  db.asUser(owner, async (q) => (await q("select * from public.sales_invoices_v where id = $1", [id])).rows[0]);

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  cashier = await db.createUser();
  storekeeper = await db.createUser();
  company = await createCompanyAs(db, owner, { slug: "mhofu", plan: "pro", modules: ["pos", "sales", "inventory"] });
  await addMember(db, company, cashier, "cashier");
  await addMember(db, company, storekeeper, "storekeeper");
  await db.admin.query("update public.companies set vat_registered = true where id = $1", [company]);
  hq = (await one<{ id: string }>("select id from public.branches where company_id = $1", [company])).id;
  mainLoc = (await one<{ id: string }>("select id from public.stock_locations where branch_id = $1 and is_default", [hq])).id;
});

afterAll(async () => {
  await db?.close();
});

describe("set-up for new companies", () => {
  it("creates a chart of accounts and a default stock location", async () => {
    const r = await one<{ accounts: number }>("select count(*)::int as accounts from public.accounts where company_id = $1", [company]);
    expect(r.accounts).toBeGreaterThanOrEqual(20);
    expect(mainLoc).toBeTruthy();
  });
});

describe("customers", () => {
  it("refuses duplicates by email (any case) or by phone in any format", async () => {
    await customer("Rudo", { email: "rudo@example.com", phone: "0771234567" });
    await expect(customer("Rudo M", { email: "RUDO@example.com" })).rejects.toThrow(/customers_email_unique/);
    await expect(customer("R", { phone: "+263 77 123 4567" })).rejects.toThrow(/customers_phone_unique/);
  });
});

describe("exchange rates", () => {
  it("keeps history, uses the latest rate and rejects a rate for the base currency", async () => {
    await db.admin.query(
      "insert into public.exchange_rates (company_id, currency, rate, effective_at) values ($1, 'ZWG', 25, now() - interval '2 days'), ($1, 'ZWG', 26.5, now() - interval '1 day')",
      [company],
    );
    expect(Number((await one<{ r: string }>("select app.rate_at($1, 'ZWG') as r", [company])).r)).toBe(26.5);
    expect(Number((await one<{ r: string }>("select app.rate_at($1, 'USD') as r", [company])).r)).toBe(1);
    await expect(
      db.admin.query("insert into public.exchange_rates (company_id, currency, rate) values ($1, 'USD', 2)", [company]),
    ).rejects.toThrow(/base currency/);
    await expect(db.admin.query("update public.exchange_rates set rate = 1")).rejects.toThrow(/cannot be changed/);
  });

  it("lets only rate managers set rates", async () => {
    await expect(
      db.asUser(cashier, (q) =>
        q("insert into public.exchange_rates (company_id, currency, rate, created_by) values ($1, 'ZAR', 0.05, $2)", [company, cashier]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("products and cost visibility", () => {
  it("hides average cost from cashiers, even through direct queries", async () => {
    const p = await product("COST-1");
    await expect(db.asUser(cashier, (q) => q("select avg_cost from public.products where id = $1", [p]))).rejects.toThrow(
      /permission denied/,
    );
    await move("receipt", p, 1, 900);
    const view = (u: string) =>
      db.asUser(u, async (q) => (await q("select avg_cost from public.products_v where id = $1", [p])).rows[0].avg_cost);
    expect(await view(cashier)).toBeNull();
    expect(Number(await view(owner))).toBe(900);
  });

  it("prices in other currencies by converting the base price", async () => {
    const p = await product("PRICE-1", { price: 1000 });
    const r = await one<{ c: string }>("select app.price_cents($1, $2, 'ZWG') as c", [company, p]);
    expect(Number(r.c)).toBe(26500);
  });
});

describe("stock", () => {
  it("keeps weighted-average cost and posts receipts and sales to the ledger", async () => {
    const p = await product("CEMENT", { reorder: 3 });
    const inv0 = await balance("inventory");
    await move("receipt", p, 10, 500);
    await move("receipt", p, 10, 700);
    expect(await level(p)).toBe(20);
    expect(Number((await one<{ c: string }>("select avg_cost as c from public.products where id = $1", [p])).c)).toBe(600);
    expect((await balance("inventory")) - inv0).toBe(12000);

    const cogs0 = await balance("cost_of_sales");
    await move("sale", p, 5);
    expect(await level(p)).toBe(15);
    expect((await balance("cost_of_sales")) - cogs0).toBe(3000);
  });

  it("never lets stock go negative unless the company allows it", async () => {
    const p = await product("NAILS");
    await move("receipt", p, 2, 100);
    await expect(move("issue", p, 5)).rejects.toThrow(/not enough stock/);
    await db.admin.query(
      "insert into public.company_features (company_id, feature_code, enabled) values ($1, 'inventory.negative', true)",
      [company],
    );
    await move("issue", p, 5);
    expect(await level(p)).toBe(-3);
    await db.admin.query("update public.company_features set enabled = false where company_id = $1 and feature_code = 'inventory.negative'", [company]);
  });

  it("reverses levels, cost and ledger when a movement is cancelled", async () => {
    const p = await product("PAINT");
    const inv0 = await balance("inventory");
    const m = await move("receipt", p, 4, 250);
    await db.admin.query("update public.stock_movements set docstatus = 2, cancel_reason = 'Wrong product' where id = $1", [m]);
    expect(await level(p)).toBe(0);
    expect(await balance("inventory")).toBe(inv0);
  });

  it("raises stock.low when stock falls to the reorder level", async () => {
    const p = await product("GLUE", { reorder: 5 });
    await move("receipt", p, 8, 100);
    await move("sale", p, 3);
    const r = await one<{ n: number }>(
      "select count(*)::int as n from public.events where event_type = 'stock.low' and aggregate_id = $1",
      [p],
    );
    expect(r.n).toBe(1);
  });

  it("refuses stock movements for service items", async () => {
    const p = await product("DELIVERY", { stock: false });
    await expect(move("receipt", p, 1, 100)).rejects.toThrow(/not a stock item/);
  });

  it("turns stock-take variances into adjustments, approved by someone else", async () => {
    const p = await product("BRICKS");
    await move("receipt", p, 15, 50);
    const take = await one<{ id: string }>(
      "insert into public.stock_takes (company_id, branch_id, location_id) values ($1, $2, $3) returning id",
      [company, hq, mainLoc],
    );
    await db.admin.query(
      "insert into public.stock_take_lines (company_id, stock_take_id, product_id, counted_qty) values ($1, $2, $3, 12)",
      [company, take.id, p],
    );
    await expect(
      db.asUser(storekeeper, (q) => q("update public.stock_takes set docstatus = 1 where id = $1", [take.id])),
    ).rejects.toThrow(/row-level security/);

    await db.admin.query("update public.stock_takes set docstatus = 1 where id = $1", [take.id]);
    expect(await level(p)).toBe(12);
    const line = await one<{ system_qty: string; variance_qty: string }>(
      "select system_qty, variance_qty from public.stock_take_lines where stock_take_id = $1",
      [take.id],
    );
    expect([Number(line.system_qty), Number(line.variance_qty)]).toEqual([15, -3]);
    await expect(
      db.asUser(storekeeper, (q) => q("update public.stock_take_lines set counted_qty = 20 where stock_take_id = $1", [take.id])),
    ).rejects.toThrow(/only be changed while the document is a draft/);
  });
});

describe("invoices", () => {
  it("computes VAT on inclusive prices, numbers, posts and takes stock on submission", async () => {
    const p = await product("TILE");
    await move("receipt", p, 10, 400);
    const c = await customer("Farai");
    const ar0 = await balance("accounts_receivable");
    const vat0 = await balance("vat_output");
    const inv = await invoice(c, [{ product: p, qty: 2, price: 1155 }]);

    const draft = await one<{ subtotal_cents: string; tax_cents: string; total_cents: string }>(
      "select subtotal_cents, tax_cents, total_cents from public.sales_invoices where id = $1",
      [inv],
    );
    // 15.5% VAT included in 23.10: net 20.00, VAT 3.10
    expect([draft.subtotal_cents, draft.tax_cents, draft.total_cents].map(Number)).toEqual([2000, 310, 2310]);

    await db.admin.query("update public.sales_invoices set docstatus = 1 where id = $1", [inv]);
    const sub = await one<{ number: string; exchange_rate: string }>("select number, exchange_rate from public.sales_invoices where id = $1", [inv]);
    expect(sub.number).toMatch(/^INV-HQ-\d{4}-0001$/);
    expect(Number(sub.exchange_rate)).toBe(1);
    expect((await balance("accounts_receivable")) - ar0).toBe(2310);
    expect((await balance("vat_output")) - vat0).toBe(-310);
    expect(await level(p)).toBe(8);

    await expect(db.admin.query("update public.sales_invoices set notes = 'x' where id = $1", [inv])).rejects.toThrow(/locked/);
    await expect(
      db.asUser(owner, (q) =>
        q(
          "insert into public.sales_invoice_lines (company_id, invoice_id, description, quantity, unit_price_cents) values ($1, $2, 'Extra', 1, 100)",
          [company, inv],
        ),
      ),
    ).rejects.toThrow(/while the document is a draft/);
  });

  it("refuses submission when there is not enough stock", async () => {
    const p = await product("RARE");
    const inv = await invoice(await customer("Tatenda"), [{ product: p, qty: 1, price: 100 }]);
    await expect(db.admin.query("update public.sales_invoices set docstatus = 1 where id = $1", [inv])).rejects.toThrow(
      /not enough stock/,
    );
  });

  it("refuses submitting an invoice without lines", async () => {
    const inv = await invoice(await customer("Empty"), []);
    await expect(db.admin.query("update public.sales_invoices set docstatus = 1 where id = $1", [inv])).rejects.toThrow(
      /at least one line/,
    );
  });

  it("only lets invoice submitters submit", async () => {
    const inv = await invoice(await customer("Perm"), [{ desc: "Consulting", qty: 1, price: 1000 }]);
    await expect(
      db.asUser(cashier, (q) => q("update public.sales_invoices set docstatus = 1 where id = $1", [inv])),
    ).resolves.toMatchObject({ rowCount: 0 });
  });
});

describe("payments", () => {
  it("tracks paid, partly paid and overpayment", async () => {
    const c = await customer("Nyasha");
    const inv = await invoice(c, [{ desc: "Design work", qty: 1, price: 10000 }]);
    await db.admin.query("update public.sales_invoices set docstatus = 1 where id = $1", [inv]);
    const cash0 = await balance("cash_usd");

    await pay(c, 4000, [[inv, 4000]]);
    expect(await invoiceView(inv)).toMatchObject({ payment_status: "partly_paid", paid_cents: "4000", balance_cents: "6000" });

    await expect(pay(c, 7000, [[inv, 7000]])).rejects.toThrow(/exceeds the balance/);

    await pay(c, 6000, [[inv, 6000]], { method: "ecocash" });
    expect(await invoiceView(inv)).toMatchObject({ payment_status: "paid", balance_cents: "0" });
    expect((await balance("cash_usd")) - cash0).toBe(4000);
  });

  it("keeps unallocated money as customer credit", async () => {
    const c = await customer("Kuda");
    const credit0 = await balance("customer_credit");
    await pay(c, 2500, []);
    expect((await balance("customer_credit")) - credit0).toBe(-2500);
  });

  it("posts the realised exchange gain when ZiG strengthens before payment", async () => {
    await db.admin.query(
      "insert into public.exchange_rates (company_id, currency, rate, effective_at) values ($1, 'ZWG', 25, now() - interval '1 second')",
      [company],
    );
    const c = await customer("Simba");
    const inv = await invoice(c, [{ desc: "Service", qty: 1, price: 25000 }], "ZWG"); // ZiG 250.00 = USD 10.00 at 25
    await db.admin.query("update public.sales_invoices set docstatus = 1 where id = $1", [inv]);
    await db.admin.query("insert into public.exchange_rates (company_id, currency, rate) values ($1, 'ZWG', 20)", [company]);

    const fx0 = await balance("fx_gain_loss");
    await pay(c, 25000, [[inv, 25000]], { currency: "ZWG" }); // ZiG 250.00 = USD 12.50 at 20
    expect((await balance("fx_gain_loss")) - fx0).toBe(-250); // credit = gain of USD 2.50
    expect(await invoiceView(inv)).toMatchObject({ payment_status: "paid" });
  });

  it("refuses cancelling a paid invoice until its payments are cancelled", async () => {
    const c = await customer("Ropa");
    const inv = await invoice(c, [{ desc: "Repair", qty: 1, price: 3000 }]);
    await db.admin.query("update public.sales_invoices set docstatus = 1 where id = $1", [inv]);
    const p = await pay(c, 3000, [[inv, 3000]]);
    await expect(
      db.admin.query("update public.sales_invoices set docstatus = 2, cancel_reason = 'Error' where id = $1", [inv]),
    ).rejects.toThrow(/cancel the payments/);
    await db.admin.query("update public.payments set docstatus = 2, cancel_reason = 'Error' where id = $1", [p]);
    await db.admin.query("update public.sales_invoices set docstatus = 2, cancel_reason = 'Error' where id = $1", [inv]);
    const net = await one<{ n: string }>(
      `select coalesce(sum(l.debit_cents - l.credit_cents), 0) as n
       from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
       join public.accounts a on a.id = l.account_id
       where e.source_id in ($1, $2) and a.system_key = 'accounts_receivable'`,
      [inv, p],
    );
    expect(Number(net.n)).toBe(0);
  });
});

describe("ledger", () => {
  it("always balances", async () => {
    const r = await one<{ d: string; c: string }>(
      "select sum(debit_cents) as d, sum(credit_cents) as c from public.journal_lines where company_id = $1",
      [company],
    );
    expect(Number(r.d)).toBeGreaterThan(0);
    expect(r.d).toBe(r.c);
  });

  it("rejects unbalanced manual entries at commit", async () => {
    const accounts = (await db.admin.query("select id from public.accounts where company_id = $1 order by code limit 2", [company])).rows;
    await db.admin.query("begin");
    await db.admin.query("set local role authenticated");
    await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [owner]);
    await db.admin.query("select public.post_manual_entry($1, current_date, 'Bad entry', $2)", [
      company,
      JSON.stringify([
        { account_id: accounts[0].id, debit: 100 },
        { account_id: accounts[1].id, credit: 90 },
      ]),
    ]);
    await expect(db.admin.query("commit")).rejects.toThrow(/does not balance/);
  });

  it("hides the trial balance from cashiers and never allows edits", async () => {
    const rows = await db.asUser(cashier, async (q) => (await q("select * from public.trial_balance")).rows);
    expect(rows).toEqual([]);
    await expect(db.admin.query("update public.journal_lines set debit_cents = 0")).rejects.toThrow(/cannot be changed/);
  });
});

describe("website enquiries", () => {
  const enquire = (args: unknown[]) =>
    db.admin
      .query("begin; set local role anon;")
      .then(() => db.admin.query("select public.submit_website_enquiry($1, $2, $3, $4, $5, $6) as r", args))
      .then(async (r) => {
        await db.admin.query("commit");
        return r.rows[0].r;
      })
      .catch(async (e) => {
        await db.admin.query("rollback");
        throw e;
      });

  it("creates a lead and matches the returning customer by phone", async () => {
    const r1 = await enquire(["mhofu.zimerp.co.zw", "Grace", null, "0772 000 111", "Do you deliver?", null]);
    expect(r1.reference).toMatch(/^[0-9A-F]{8}$/);
    await enquire(["MHOFU.zimerp.co.zw", "Grace M", "grace@example.com", "+263772000111", "Price list please", null]);
    const r = await one<{ customers: number; leads: number }>(
      `select count(distinct customer_id)::int as customers, count(*)::int as leads
       from public.leads where company_id = $1 and name like 'Grace%'`,
      [company],
    );
    expect(r).toEqual({ customers: 1, leads: 2 });
    expect(
      (await one<{ n: number }>("select count(*)::int as n from public.events where event_type = 'lead.created' and company_id = $1", [company])).n,
    ).toBeGreaterThanOrEqual(2);
  });

  it("turns store quote requests into draft quotes priced from the catalogue, then wins the lead on invoicing", async () => {
    const p = await product("ONLINE-1", { price: 2000 });
    await enquire(["mhofu.zimerp.co.zw", "Blessing", "b@example.com", null, null, JSON.stringify([{ product_id: p, quantity: 3 }])]);
    const lead = await one<{ status: string; quote_id: string }>(
      "select status, quote_id from public.leads where email = 'b@example.com'",
    );
    expect(lead.status).toBe("quoted");
    const quote = await one<{ total_cents: string }>("select total_cents from public.quotes where id = $1", [lead.quote_id]);
    expect(Number(quote.total_cents)).toBe(6000);

    await move("receipt", p, 5, 1000);
    await db.admin.query("update public.quotes set docstatus = 1 where id = $1", [lead.quote_id]);
    const inv = await db.asUser(owner, async (q) => {
      const id = (await q("select public.convert_quote_to_invoice($1) as id", [lead.quote_id])).rows[0].id;
      await q("update public.sales_invoices set docstatus = 1 where id = $1", [id]);
      return (await q("select status from public.leads where quote_id = $1", [lead.quote_id])).rows[0].status;
    });
    expect(inv).toBe("won");
  });

  it("rejects unknown sites, hidden products and missing contact details", async () => {
    await expect(enquire(["nope.example.com", "X", "x@example.com", null, null, null])).rejects.toThrow(/unknown site/);
    const hidden = await product("HIDDEN", { price: 100, online: false });
    await expect(
      enquire(["mhofu.zimerp.co.zw", "X", "x@example.com", null, null, JSON.stringify([{ product_id: hidden, quantity: 1 }])]),
    ).rejects.toThrow(/no longer available/);
    await expect(enquire(["mhofu.zimerp.co.zw", "X", null, null, null, null])).rejects.toThrow(/email address or phone/);
  });

  it("gives visitors no access to leads", async () => {
    await expect(db.admin.query("begin; set local role anon; select * from public.leads;")).rejects.toThrow(/permission denied/);
    await db.admin.query("rollback");
  });
});
