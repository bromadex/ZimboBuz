// Company isolation suite (issue #20). Proves that one company can never read or
// change another company's data, and that every table is covered automatically.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompanyAs, createTestDb, type Db } from "./harness";

/** Global tables shared by every company (read-only catalogue). */
const CATALOGUE = new Set([
  "plans",
  "modules",
  "plan_modules",
  "features",
  "permissions",
  "role_templates",
  "event_types",
  "event_subscribers",
  "doctypes",
  "doctype_links",
  "restricted_fields",
  "tax_rates",
  "account_templates",
  "offline_targets",
]);

let db: Db;
let userA: string;
let userB: string;
let companyA: string;
let companyB: string;
let companyTables: string[];

beforeAll(async () => {
  db = await createTestDb();
  userA = await db.createUser("a@test.local");
  userB = await db.createUser("b@test.local");
  companyA = await createCompanyAs(db, userA, { slug: "alpha" });
  companyB = await createCompanyAs(db, userB, { slug: "bravo" });
  // Give every company-scoped table at least one row per company.
  for (const [c, u] of [
    [companyA, userA],
    [companyB, userB],
  ]) {
    await db.admin.query(
      "insert into public.company_features (company_id, feature_code, enabled) values ($1, 'pos.discounts', true)",
      [c],
    );
    await db.admin.query("select app.emit_event($1, 'lead.created', 'customer', 'x', '{}')", [c]);
    const hq = (await db.admin.query("select id from public.branches where company_id = $1", [c])).rows[0].id;
    await db.admin.query("select app.next_document_number($1, 'quote', $2)", [c, hq]);
    await db.admin.query(
      `insert into public.device_number_blocks (company_id, device_id, doctype, branch_id, year, first_value, last_value)
       values ($1, 'till-1', 'quote', $2, 2026, 100, 199)`,
      [c, hq],
    );
    const rec = randomUUID();
    await db.admin.query(
      "insert into public.record_messages (company_id, doctype, record_id, kind, body, author_id) values ($1, 'customer', $2, 'note', 'Hello', $3)",
      [c, rec, u],
    );
    await db.admin.query(
      "insert into public.record_followers (company_id, doctype, record_id, user_id) values ($1, 'customer', $2, $3)",
      [c, rec, u],
    );
    await db.admin.query(
      `insert into public.record_activities (company_id, doctype, record_id, activity_type, summary, due_on, assigned_to, created_by)
       values ($1, 'customer', $2, 'call', 'Call back', current_date, $3, $3)`,
      [c, rec, u],
    );
    await seedBusiness(c, hq);
  }
  const { rows } = await db.admin.query<{ table_name: string }>(
    `select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'company_id' order by table_name`,
  );
  companyTables = rows.map((r) => r.table_name);
});

/** One small flow per company so every business table has rows to protect. */
async function seedBusiness(c: string, hq: string) {
  const q = async (sql: string, params: unknown[]) => (await db.admin.query(sql, params)).rows[0];
  const loc = (await q("select id from public.stock_locations where branch_id = $1", [hq])).id;
  await q("insert into public.exchange_rates (company_id, currency, rate) values ($1, 'ZWG', 26)", [c]);
  await q("insert into public.suppliers (company_id, name) values ($1, 'Supplier')", [c]);
  const cust = (await q("insert into public.customers (company_id, name) values ($1, 'Customer') returning id", [c])).id;
  const prod = (await q("insert into public.products (company_id, sku, name) values ($1, 'SKU1', 'Item') returning id", [c])).id;
  await q("insert into public.product_prices (company_id, product_id, currency, price_cents) values ($1, $2, 'USD', 500)", [c, prod]);
  const mov = (
    await q(
      "insert into public.stock_movements (company_id, branch_id, movement_type, product_id, to_location_id, quantity, unit_cost) values ($1, $2, 'receipt', $3, $4, 10, 100) returning id",
      [c, hq, prod, loc],
    )
  ).id;
  await q("update public.stock_movements set docstatus = 1 where id = $1", [mov]);
  const take = (await q("insert into public.stock_takes (company_id, branch_id, location_id) values ($1, $2, $3) returning id", [c, hq, loc])).id;
  await q("insert into public.stock_take_lines (company_id, stock_take_id, product_id, counted_qty) values ($1, $2, $3, 10)", [c, take, prod]);
  const quote = (await q("insert into public.quotes (company_id, branch_id, customer_id, currency) values ($1, $2, $3, 'USD') returning id", [c, hq, cust])).id;
  await q("insert into public.quote_lines (company_id, quote_id, product_id, quantity, unit_price_cents) values ($1, $2, $3, 1, 500)", [c, quote, prod]);
  const inv = (await q("insert into public.sales_invoices (company_id, branch_id, customer_id, currency) values ($1, $2, $3, 'USD') returning id", [c, hq, cust])).id;
  await q("insert into public.sales_invoice_lines (company_id, invoice_id, product_id, quantity, unit_price_cents) values ($1, $2, $3, 1, 500)", [c, inv, prod]);
  await q("update public.sales_invoices set docstatus = 1 where id = $1", [inv]);
  const pay = (await q("insert into public.payments (company_id, branch_id, customer_id, currency, amount_cents, method) values ($1, $2, $3, 'USD', 500, 'cash') returning id", [c, hq, cust])).id;
  await q("insert into public.payment_allocations (company_id, payment_id, invoice_id, amount_cents) values ($1, $2, $3, 500)", [c, pay, inv]);
  await q("update public.payments set docstatus = 1 where id = $1", [pay]);
  await q("insert into public.leads (company_id, customer_id, source, name) values ($1, $2, 'manual', 'Lead')", [c, cust]);
  const owner = (await q("select user_id from public.memberships where company_id = $1", [c])).user_id;
  await q(
    "insert into public.devices (company_id, branch_id, device_id, name, platform, registered_by) values ($1, $2, 'device-0001', 'Till', 'web', $3)",
    [c, hq, owner],
  );
  await q(
    "insert into public.offline_operations (company_id, device_id, client_op_id, op_type, target, payload, status, user_id) values ($1, 'device-0001', 'op-00000001', 'insert', 'customers', '{}', 'applied', $2)",
    [c, owner],
  );
}

afterAll(async () => {
  await db?.close();
});

describe("schema coverage", () => {
  it("has row-level security enabled on every public table", async () => {
    const { rows } = await db.admin.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("scopes every public table by company, unless it is catalogue", async () => {
    const { rows } = await db.admin.query<{ table_name: string }>(
      `select t.table_name from information_schema.tables t
       where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
         and t.table_name <> 'companies'
         and not exists (select 1 from information_schema.columns c
                         where c.table_schema = 'public' and c.table_name = t.table_name
                           and c.column_name = 'company_id')`,
    );
    const unscoped = rows.map((r) => r.table_name).filter((t) => !CATALOGUE.has(t));
    expect(unscoped).toEqual([]);
  });

  it("grants DELETE on no public table", async () => {
    const { rows } = await db.admin.query<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants
       where table_schema = 'public' and privilege_type = 'DELETE'
         and grantee in ('anon','authenticated')`,
    );
    expect(rows).toEqual([]);
  });
});

describe("reading", () => {
  it("shows each user only their own company", async () => {
    const ids = await db.asUser(userA, async (q) =>
      (await q<{ id: string }>("select id from public.companies")).rows.map((r) => r.id),
    );
    expect(ids).toEqual([companyA]);
  });

  it("returns no rows of another company from any company-scoped table", async () => {
    expect(companyTables.length).toBeGreaterThan(5);
    for (const table of companyTables) {
      const [own, other] = await db.asUser(userA, async (q) => {
        const mine = await q(`select count(*)::int as n from public.${table} where company_id = $1`, [companyA]);
        const theirs = await q(`select count(*)::int as n from public.${table} where company_id = $1`, [companyB]);
        return [mine.rows[0].n as number, theirs.rows[0].n as number];
      });
      expect({ table, other }).toEqual({ table, other: 0 });
      expect({ table, ownVisible: own > 0 }).toEqual({ table, ownVisible: true });
    }
  });

  it("gives signed-out visitors nothing", async () => {
    await expect(
      db.admin.query("begin; set local role anon; select * from public.companies;"),
    ).rejects.toThrow(/permission denied/);
    await db.admin.query("rollback");
  });
});

describe("writing", () => {
  const crossCompanyInserts: Array<[string, string]> = [
    ["branches", "insert into public.branches (company_id, code, name) values ($1, 'X1', 'Sneaky')"],
    ["company_domains", "insert into public.company_domains (company_id, hostname, kind) values ($1, 'sneaky.example.com', 'website')"],
    ["company_features", "insert into public.company_features (company_id, feature_code, enabled) values ($1, 'pos.split_tender', false)"],
    ["company_modules", "insert into public.company_modules (company_id, module_code) values ($1, 'website')"],
    ["roles", "insert into public.roles (company_id, code, name) values ($1, 'sneaky', 'Sneaky')"],
  ];

  for (const [table, sql] of crossCompanyInserts) {
    it(`refuses inserting into another company's ${table}`, async () => {
      await expect(db.asUser(userA, (q) => q(sql, [companyB]))).rejects.toThrow(
        /row-level security/,
      );
    });
  }

  it("refuses joining another company", async () => {
    const { rows } = await db.admin.query<{ id: string }>(
      "select id from public.roles where company_id = $1 and code = 'owner'",
      [companyB],
    );
    await expect(
      db.asUser(userA, (q) =>
        q("insert into public.memberships (company_id, user_id, role_id) values ($1, $2, $3)", [
          companyB,
          userA,
          rows[0].id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("updates no rows of another company", async () => {
    const counts = await db.asUser(userA, async (q) => [
      (await q("update public.companies set name = 'hacked' where id = $1", [companyB])).rowCount,
      (await q("update public.branches set name = 'hacked' where company_id = $1", [companyB])).rowCount,
      (await q("update public.company_branding set primary_color = '#000000' where company_id = $1", [companyB])).rowCount,
    ]);
    expect(counts).toEqual([0, 0, 0]);
    const { rows } = await db.admin.query("select name from public.companies where id = $1", [companyB]);
    expect(rows[0].name).not.toBe("hacked");
  });

  it("refuses deleting anything, even in the user's own company", async () => {
    await expect(
      db.asUser(userA, (q) => q("delete from public.branches where company_id = $1", [companyA])),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses changing the catalogue", async () => {
    await expect(
      db.asUser(userA, (q) => q("update public.plans set price_usd_cents = 0")),
    ).rejects.toThrow(/permission denied/);
  });
});
