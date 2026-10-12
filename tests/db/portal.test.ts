import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

// Customer portal (P19): a customer signed in on the company's website sees
// only their own submitted documents, through the portal functions.

let db: Db;
let owner: string;
let cashier: string;
let ownerB: string;
let company: string;
let companyB: string;
let starter: string;
let tendai: string; // customer 1's portal user
let rudo: string; // customer 2's portal user
let stranger: string; // signed in, no portal access
let cust1: string;
let cust2: string;
let custB: string;
let quote1: string;
let quote2: string;
let expiredQuote: string;
let draftQuote: string;
let invoice1: string;
let invoice2: string;

async function committed(user: string, sql: string, params: unknown[] = []) {
  await db.admin.query("begin");
  try {
    await db.admin.query("set local role authenticated");
    await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    const r = await db.admin.query(sql, params);
    await db.admin.query("commit");
    return r;
  } catch (e) {
    await db.admin.query("rollback");
    throw e;
  }
}

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[]) => (await db.admin.query(sql, params)).rows[0] as T;

async function customer(c: string, name: string, email: string) {
  return (await one<{ id: string }>("insert into public.customers (company_id, name, email) values ($1, $2, $3) returning id", [c, name, email])).id;
}

async function submittedQuote(c: string, cust: string, total: number, validUntil: string | null = null, submit = true) {
  const branch = (await one<{ id: string }>("select id from public.branches where company_id = $1", [c])).id;
  const id = (
    await one<{ id: string }>(
      "insert into public.quotes (company_id, branch_id, customer_id, currency, valid_until) values ($1, $2, $3, 'USD', $4) returning id",
      [c, branch, cust, validUntil],
    )
  ).id;
  await db.admin.query(
    "insert into public.quote_lines (company_id, quote_id, description, quantity, unit_price_cents) values ($1, $2, 'Delivery', 1, $3)",
    [c, id, total],
  );
  if (submit) await db.admin.query("update public.quotes set docstatus = 1 where id = $1", [id]);
  return id;
}

async function submittedInvoice(c: string, cust: string, total: number) {
  const branch = (await one<{ id: string }>("select id from public.branches where company_id = $1", [c])).id;
  const id = (
    await one<{ id: string }>(
      "insert into public.sales_invoices (company_id, branch_id, customer_id, currency) values ($1, $2, $3, 'USD') returning id",
      [c, branch, cust],
    )
  ).id;
  await db.admin.query(
    "insert into public.sales_invoice_lines (company_id, invoice_id, description, quantity, unit_price_cents) values ($1, $2, 'Building work', 1, $3)",
    [c, id, total],
  );
  await db.admin.query("update public.sales_invoices set docstatus = 1 where id = $1", [id]);
  return id;
}

async function payment(c: string, cust: string, invoice: string, amount: number) {
  const branch = (await one<{ id: string }>("select id from public.branches where company_id = $1", [c])).id;
  const id = (
    await one<{ id: string }>(
      "insert into public.payments (company_id, branch_id, customer_id, currency, amount_cents, method, reference) values ($1, $2, $3, 'USD', $4, 'ecocash', 'EC123') returning id",
      [c, branch, cust, amount],
    )
  ).id;
  await db.admin.query("insert into public.payment_allocations (company_id, payment_id, invoice_id, amount_cents) values ($1, $2, $3, $4)", [c, id, invoice, amount]);
  await db.admin.query("update public.payments set docstatus = 1 where id = $1", [id]);
  return id;
}

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser("owner@alpha.test");
  cashier = await db.createUser("cashier@alpha.test");
  ownerB = await db.createUser("owner@bravo.test");
  tendai = await db.createUser("tendai@customer.test");
  rudo = await db.createUser("rudo@customer.test");
  stranger = await db.createUser("stranger@customer.test");
  company = await createCompanyAs(db, owner, { name: "Alpha Hardware", slug: "alpha", plan: "growth", modules: ["pos", "sales", "portal", "website"] });
  companyB = await createCompanyAs(db, ownerB, { name: "Bravo Bakery", slug: "bravo", plan: "growth", modules: ["sales", "portal"] });
  starter = await createCompanyAs(db, ownerB, { name: "Small Shop", slug: "small", plan: "starter", modules: ["sales"] });
  await addMember(db, company, cashier, "cashier");

  cust1 = await customer(company, "Tendai Moyo", "tendai@customer.test");
  cust2 = await customer(company, "Rudo Banda", "rudo@customer.test");
  custB = await customer(companyB, "Tendai at Bravo", "tendai@customer.test");

  quote1 = await submittedQuote(company, cust1, 50000);
  expiredQuote = await submittedQuote(company, cust1, 1000, "2020-01-01");
  draftQuote = await submittedQuote(company, cust1, 777, null, false);
  quote2 = await submittedQuote(company, cust2, 99900);
  invoice1 = await submittedInvoice(company, cust1, 20000);
  invoice2 = await submittedInvoice(company, cust2, 30000);
  await payment(company, cust1, invoice1, 5000);
  await payment(company, cust2, invoice2, 30000);
  await submittedInvoice(companyB, custB, 4400);

  // Invitations by staff with portal.manage.
  await committed(owner, "insert into public.portal_users (company_id, customer_id, user_id) values ($1, $2, $3)", [company, cust1, tendai]);
  await committed(owner, "insert into public.portal_users (company_id, customer_id, user_id) values ($1, $2, $3)", [company, cust2, rudo]);
  await committed(ownerB, "insert into public.portal_users (company_id, customer_id, user_id) values ($1, $2, $3)", [companyB, custB, tendai]);
});

afterAll(() => db?.close());

describe("inviting customers", () => {
  it("needs portal.manage and the portal module", async () => {
    await expect(
      db.asUser(cashier, (q) => q("insert into public.portal_users (company_id, customer_id, user_id) values ($1, $2, $3)", [company, cust2, stranger])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.asUser(ownerB, (q) => q("insert into public.portal_users (company_id, customer_id, user_id) values ($1, $2, $3)", [company, cust2, stranger])),
    ).rejects.toThrow(/row-level security/);
    const smallCustomer = await customer(starter, "Starter customer", "s@customer.test");
    await expect(
      db.asUser(ownerB, (q) => q("insert into public.portal_users (company_id, customer_id, user_id) values ($1, $2, $3)", [starter, smallCustomer, stranger])),
    ).rejects.toThrow(/row-level security/);
    // Cannot create an already-active link, nor link another company's customer.
    await expect(
      db.asUser(owner, (q) => q("insert into public.portal_users (company_id, customer_id, user_id, status) values ($1, $2, $3, 'active')", [company, cust2, stranger])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.asUser(owner, (q) => q("insert into public.portal_users (company_id, customer_id, user_id) values ($1, $2, $3)", [company, custB, stranger])),
    ).rejects.toThrow(/foreign key/);
  });

  it("lets staff who can see customers see portal links, but not change who they belong to", async () => {
    const n = await db.asUser(cashier, async (q) => (await q("select count(*)::int as n from public.portal_users where company_id = $1", [company])).rows[0].n);
    expect(n).toBe(2);
    await expect(
      db.asUser(owner, (q) => q("update public.portal_users set customer_id = $2 where user_id = $1", [tendai, cust2])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("signing in", () => {
  it("gives invited customers nothing until they sign in, then activates them", async () => {
    expect(await db.asUser(tendai, async (q) => (await q("select public.portal_me('alpha') as me")).rows[0].me)).toBeNull();
    const me = await db.asUser(tendai, async (q) => {
      const signIn = (await q("select public.portal_sign_in('alpha') as r")).rows[0].r;
      return { signIn, me: (await q("select public.portal_me('alpha') as me")).rows[0].me };
    });
    expect(me.signIn).toEqual({ customer_name: "Tendai Moyo" });
    expect(me.me).toMatchObject({ company_name: "Alpha Hardware", customer_name: "Tendai Moyo", can_accept: true });
  });

  it("refuses people without portal access", async () => {
    const r = await db.asUser(stranger, async (q) => (await q("select public.portal_sign_in('alpha') as r")).rows[0].r);
    expect(r).toBeNull();
    await committed(tendai, "select public.portal_sign_in('alpha')");
    await committed(rudo, "select public.portal_sign_in('alpha')");
    await committed(tendai, "select public.portal_sign_in('bravo')");
    const status = await db.admin.query("select status from public.portal_users where user_id = $1 order by status", [tendai]);
    expect(status.rows.map((r) => r.status)).toEqual(["active", "active"]);
  });
});

describe("what a customer sees", () => {
  it("lists only their own submitted invoices, with balances", async () => {
    const rows = await db.asUser(tendai, async (q) => (await q("select * from public.portal_invoices('alpha')")).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: invoice1, total_cents: "20000", paid_cents: "5000", balance_cents: "15000" });
    const bravo = await db.asUser(tendai, async (q) => (await q("select * from public.portal_invoices('bravo')")).rows);
    expect(bravo).toHaveLength(1);
    expect(bravo[0].total_cents).toBe("4400");
  });

  it("lists only their own submitted quotes", async () => {
    const ids = await db.asUser(tendai, async (q) => (await q("select id from public.portal_quotes('alpha')")).rows.map((r) => r.id));
    expect(ids.sort()).toEqual([quote1, expiredQuote].sort());
    expect(ids).not.toContain(draftQuote);
    expect(ids).not.toContain(quote2);
  });

  it("lists their payments and a statement with a running balance", async () => {
    const pays = await db.asUser(tendai, async (q) => (await q("select * from public.portal_payments('alpha')")).rows);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ amount_cents: "5000", method: "ecocash" });
    const st = await db.asUser(tendai, async (q) => (await q("select * from public.portal_statement('alpha')")).rows);
    expect(st.map((r) => [r.kind, r.debit_cents, r.credit_cents, r.balance_cents])).toEqual([
      ["invoice", "20000", "0", "20000"],
      ["payment", "0", "5000", "15000"],
    ]);
  });

  it("opens their own documents with lines, and nobody else's", async () => {
    const doc = async (user: string, kind: string, id: string, slug = "alpha") =>
      db.asUser(user, async (q) => (await q("select public.portal_document($1, $2, $3) as d", [slug, kind, id])).rows[0].d);
    expect(await doc(tendai, "quote", quote1)).toMatchObject({ number: expect.stringMatching(/^QUO-/), total_cents: 50000, lines: [{ description: "Delivery" }] });
    expect(await doc(tendai, "invoice", invoice1)).toMatchObject({ balance_cents: 15000 });
    expect(await doc(tendai, "quote", quote2)).toBeNull();
    expect(await doc(tendai, "quote", draftQuote)).toBeNull();
    expect(await doc(tendai, "invoice", invoice2)).toBeNull();
    expect(await doc(tendai, "invoice", invoice1, "bravo")).toBeNull();
    expect(await doc(stranger, "invoice", invoice1)).toBeNull();
    expect(await doc(owner, "invoice", invoice1)).toBeNull();
  });

  it("gives portal users nothing through the tables themselves", async () => {
    const counts = await db.asUser(tendai, async (q) => [
      (await q("select count(*)::int as n from public.sales_invoices")).rows[0].n,
      (await q("select count(*)::int as n from public.customers")).rows[0].n,
      (await q("select count(*)::int as n from public.portal_users")).rows[0].n,
    ]);
    expect(counts).toEqual([0, 0, 0]);
  });

  it("gives anonymous visitors nothing", async () => {
    await db.admin.query("begin");
    try {
      await db.admin.query("set local role anon");
      await expect(db.admin.query("select * from public.portal_invoices('alpha')")).rejects.toThrow(/permission denied/);
    } finally {
      await db.admin.query("rollback");
    }
  });
});

describe("accepting a quote", () => {
  it("records the acceptance, writes the timeline and emits an event, leaving the quote locked", async () => {
    const before = await one<{ updated_at: Date; docstatus: number; total_cents: string }>("select updated_at, docstatus, total_cents from public.quotes where id = $1", [quote1]);
    await committed(tendai, "select public.portal_accept_quote('alpha', $1, 'Please deliver on Friday')", [quote1]);
    const after = await one("select updated_at, docstatus, total_cents from public.quotes where id = $1", [quote1]);
    expect(after).toEqual(before);
    const msg = await one<{ body: string; kind: string }>("select body, kind from public.record_messages where record_id = $1 and doctype = 'quote' order by created_at desc limit 1", [quote1]);
    expect(msg).toEqual({ kind: "system", body: "Accepted by Tendai Moyo in the customer portal: Please deliver on Friday" });
    const ev = await one<{ n: number }>("select count(*)::int as n from public.events where event_type = 'quote.accepted' and aggregate_id = $1", [quote1]);
    expect(ev.n).toBe(1);
    const listed = await db.asUser(tendai, async (q) => (await q("select accepted_at from public.portal_quotes('alpha') where id = $1", [quote1])).rows[0]);
    expect(listed.accepted_at).not.toBeNull();
    const staff = await db.asUser(owner, async (q) => (await q("select count(*)::int as n from public.portal_quote_acceptances where quote_id = $1", [quote1])).rows[0].n);
    expect(staff).toBe(1);
  });

  it("refuses accepting twice, expired quotes and other customers' quotes", async () => {
    await expect(db.asUser(tendai, (q) => q("select public.portal_accept_quote('alpha', $1)", [quote1]))).rejects.toThrow(/already been accepted/);
    await expect(db.asUser(tendai, (q) => q("select public.portal_accept_quote('alpha', $1)", [expiredQuote]))).rejects.toThrow(/expired/);
    await expect(db.asUser(tendai, (q) => q("select public.portal_accept_quote('alpha', $1)", [quote2]))).rejects.toThrow(/cannot be accepted/);
    await expect(db.asUser(tendai, (q) => q("select public.portal_accept_quote('alpha', $1)", [draftQuote]))).rejects.toThrow(/cannot be accepted/);
    await expect(db.asUser(stranger, (q) => q("select public.portal_accept_quote('alpha', $1)", [quote2]))).rejects.toThrow(/not allowed/);
    await expect(db.asUser(tendai, (q) => q("select public.portal_accept_quote('bravo', $1)", [quote2]))).rejects.toThrow(/cannot be accepted/);
  });
});

describe("switching access off", () => {
  it("shuts a disabled customer out", async () => {
    await committed(owner, "update public.portal_users set status = 'disabled' where company_id = $1 and user_id = $2", [company, rudo]);
    const r = await db.asUser(rudo, async (q) => ({
      signIn: (await q("select public.portal_sign_in('alpha') as r")).rows[0].r,
      invoices: (await q("select * from public.portal_invoices('alpha')")).rows,
    }));
    expect(r).toEqual({ signIn: null, invoices: [] });
  });

  it("shuts everyone out when the portal module is switched off", async () => {
    await db.admin.query("update public.company_modules set enabled = false where company_id = $1 and module_code = 'portal'", [company]);
    const r = await db.asUser(tendai, async (q) => ({
      me: (await q("select public.portal_me('alpha') as me")).rows[0].me,
      invoices: (await q("select * from public.portal_invoices('alpha')")).rows,
      bravo: (await q("select * from public.portal_invoices('bravo')")).rows.length,
    }));
    expect(r).toEqual({ me: null, invoices: [], bravo: 1 });
    await db.admin.query("update public.company_modules set enabled = true where company_id = $1 and module_code = 'portal'", [company]);
  });
});
