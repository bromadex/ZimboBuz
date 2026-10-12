// Inventory screens (P7) and the data import tool (P18): price overrides,
// sending a stock take for approval, guarding stock locations, and importing
// products (with opening stock) and customers as the signed-in user.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { checkCustomers, checkProducts } from "@/lib/import";
import { existingCustomers, existingProducts, importCustomers, importProducts } from "@/server/inventory/import-run";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

let db: Db;
let owner: string;
let storekeeper: string;
let cashier: string;
let outsider: string;
let company: string;
let hq: string;
let mainLoc: string;

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.admin.query(sql, params)).rows[0] as T;

const product = async (sku: string, price = 1000) => {
  const p = await one<{ id: string }>("insert into public.products (company_id, sku, name) values ($1, $2, $2) returning id", [company, sku]);
  await db.admin.query("insert into public.product_prices (company_id, product_id, currency, price_cents) values ($1, $2, 'USD', $3)", [company, p.id, price]);
  return p.id;
};

const receive = async (productId: string, qty: number, location = mainLoc) => {
  const m = await one<{ id: string }>(
    `insert into public.stock_movements (company_id, branch_id, movement_type, product_id, to_location_id, quantity, unit_cost)
     values ($1, $2, 'receipt', $3, $4, $5, 100) returning id`,
    [company, hq, productId, location, qty],
  );
  await db.admin.query("update public.stock_movements set docstatus = 1 where id = $1", [m.id]);
};

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser("owner@inv.test");
  storekeeper = await db.createUser("store@inv.test");
  cashier = await db.createUser("till@inv.test");
  outsider = await db.createUser("other@inv.test");
  company = await createCompanyAs(db, owner);
  await createCompanyAs(db, outsider);
  await addMember(db, company, storekeeper, "storekeeper");
  await addMember(db, company, cashier, "cashier");
  hq = (await one<{ id: string }>("select id from public.branches where company_id = $1", [company])).id;
  mainLoc = (await one<{ id: string }>("select id from public.stock_locations where branch_id = $1 and is_default", [hq])).id;
  await db.admin.query("insert into public.exchange_rates (company_id, currency, rate) values ($1, 'ZWG', 26.5)", [company]);
});

afterAll(async () => {
  await db?.close();
});

describe("price overrides", () => {
  it("removes an override so the price is converted again", async () => {
    const p = await product("PRICE-1", 1000);
    await db.admin.query("insert into public.product_prices (company_id, product_id, currency, price_cents) values ($1, $2, 'ZWG', 30000)", [company, p]);
    const price = await db.asUser(owner, async (q) => {
      const before = (await q<{ c: string }>("select app.price_cents($1, $2, 'ZWG') as c", [company, p])).rows[0].c;
      await q("select public.remove_product_price($1, 'ZWG')", [p]);
      const after = (await q<{ c: string }>("select app.price_cents($1, $2, 'ZWG') as c", [company, p])).rows[0].c;
      const note = (await q<{ body: string }>("select body from public.record_messages where record_id = $1", [p])).rows[0]?.body;
      return { before, after, note };
    });
    expect(price).toEqual({ before: "30000", after: "26500", note: expect.stringContaining("Price in ZiG removed") });
  });

  it("keeps the base price and refuses people without product editing rights", async () => {
    const p = await product("PRICE-2");
    await expect(db.asUser(owner, (q) => q("select public.remove_product_price($1, 'USD')", [p]))).rejects.toThrow(/base currency cannot be removed/);
    await expect(db.asUser(storekeeper, (q) => q("select public.remove_product_price($1, 'ZWG')", [p]))).rejects.toThrow(/not allowed/);
    await expect(db.asUser(outsider, (q) => q("select public.remove_product_price($1, 'ZWG')", [p]))).rejects.toThrow(/not allowed/);
    // Still no way to delete prices directly.
    await expect(db.asUser(owner, (q) => q("delete from public.product_prices where product_id = $1", [p]))).rejects.toThrow(/permission denied/);
  });
});

describe("stock takes sent for approval", () => {
  it("lets the counter send a count for approval, and an approver submit it", async () => {
    const p = await product("TAKE-1");
    await receive(p, 10);
    const take = await one<{ id: string }>(
      "insert into public.stock_takes (company_id, branch_id, location_id) values ($1, $2, $3) returning id",
      [company, hq, mainLoc],
    );
    // Nothing counted yet.
    await expect(db.asUser(storekeeper, (q) => q("select public.send_stock_take_for_approval($1)", [take.id]))).rejects.toThrow(/at least one/);
    await db.admin.query("insert into public.stock_take_lines (company_id, stock_take_id, product_id, counted_qty) values ($1, $2, $3, 8)", [company, take.id, p]);
    // The counter cannot fake who sent it, nor submit it.
    await expect(
      db.asUser(storekeeper, (q) => q("update public.stock_takes set sent_for_approval_at = now() where id = $1", [take.id])),
    ).rejects.toThrow(/permission denied/);
    await expect(db.asUser(storekeeper, (q) => q("update public.stock_takes set docstatus = 1 where id = $1", [take.id]))).rejects.toThrow(
      /row-level security/,
    );
    await expect(db.asUser(cashier, (q) => q("select public.send_stock_take_for_approval($1)", [take.id]))).rejects.toThrow(/not allowed/);

    // Commit the hand-over as the storekeeper.
    await db.admin.query("begin");
    await db.admin.query("set local role authenticated");
    await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [storekeeper]);
    await db.admin.query("select public.send_stock_take_for_approval($1)", [take.id]);
    await db.admin.query("commit");
    const sent = await one<{ by: string; at: Date | null }>("select sent_for_approval_by as by, sent_for_approval_at as at from public.stock_takes where id = $1", [take.id]);
    expect(sent.by).toBe(storekeeper);
    expect(sent.at).not.toBeNull();

    // The owner approves: variance becomes an adjustment.
    const result = await db.asUser(owner, async (q) => {
      await q("update public.stock_takes set docstatus = 1 where id = $1", [take.id]);
      const line = (await q<{ system_qty: string; variance_qty: string }>("select system_qty, variance_qty from public.stock_take_lines where stock_take_id = $1", [take.id])).rows[0];
      const level = (await q<{ quantity: string }>("select quantity from public.stock_levels where product_id = $1 and location_id = $2", [p, mainLoc])).rows[0];
      return { line, level: level.quantity };
    });
    expect(result).toEqual({ line: { system_qty: "10.000", variance_qty: "-2.000" }, level: "8.000" });
  });

  it("still lets counters change notes on a draft", async () => {
    const take = await one<{ id: string }>(
      "insert into public.stock_takes (company_id, branch_id, location_id) values ($1, $2, $3) returning id",
      [company, hq, mainLoc],
    );
    const n = await db.asUser(storekeeper, async (q) => (await q("update public.stock_takes set notes = 'Back store' where id = $1", [take.id])).rowCount);
    expect(n).toBe(1);
  });

  it("lets a draft be put away, and then not sent for approval", async () => {
    const p = await product("TAKE-2");
    const take = await one<{ id: string }>(
      "insert into public.stock_takes (company_id, branch_id, location_id) values ($1, $2, $3) returning id",
      [company, hq, mainLoc],
    );
    await db.admin.query("insert into public.stock_take_lines (company_id, stock_take_id, product_id, counted_qty) values ($1, $2, $3, 1)", [company, take.id, p]);
    await expect(
      db.asUser(storekeeper, async (q) => {
        await q("update public.stock_takes set archived_at = now() where id = $1", [take.id]);
        await q("select public.send_stock_take_for_approval($1)", [take.id]);
      }),
    ).rejects.toThrow(/has been put away/);
  });
});

describe("stock adjustments", () => {
  it("values a positive adjustment without a cost at the average cost", async () => {
    const p = await product("ADJ-1");
    await receive(p, 4); // at 100 cents each
    const cost = await db.asUser(storekeeper, async (q) => {
      const m = (
        await q<{ id: string; unit_cost: string }>(
          `insert into public.stock_movements (company_id, branch_id, movement_type, product_id, to_location_id, quantity)
           values ($1, $2, 'adjustment_in', $3, $4, 1) returning id, unit_cost`,
          [company, hq, p, mainLoc],
        )
      ).rows[0];
      await q("update public.stock_movements set docstatus = 1 where id = $1", [m.id]);
      return m.unit_cost;
    });
    expect(cost).toBe("100.0000");
  });
});

describe("stock locations", () => {
  it("keeps the main location and locations holding stock from being archived", async () => {
    const extra = await one<{ id: string }>(
      "insert into public.stock_locations (company_id, branch_id, code, name) values ($1, $2, 'YARD', 'Yard') returning id",
      [company, hq],
    );
    const p = await product("LOC-1");
    await receive(p, 3, extra.id);
    await expect(db.asUser(owner, (q) => q("update public.stock_locations set archived_at = now() where id = $1", [mainLoc]))).rejects.toThrow(
      /main location of a branch cannot be archived/,
    );
    await expect(db.asUser(owner, (q) => q("update public.stock_locations set archived_at = now() where id = $1", [extra.id]))).rejects.toThrow(
      /still holds stock/,
    );
    // Once empty it can be archived; storekeepers cannot manage locations at all.
    const issue = await one<{ id: string }>(
      `insert into public.stock_movements (company_id, branch_id, movement_type, product_id, from_location_id, quantity)
       values ($1, $2, 'issue', $3, $4, 3) returning id`,
      [company, hq, p, extra.id],
    );
    await db.admin.query("update public.stock_movements set docstatus = 1 where id = $1", [issue.id]);
    const n = await db.asUser(storekeeper, async (q) => (await q("update public.stock_locations set archived_at = now() where id = $1", [extra.id])).rowCount);
    expect(n).toBe(0);
    const m = await db.asUser(owner, async (q) => (await q("update public.stock_locations set archived_at = now() where id = $1", [extra.id])).rowCount);
    expect(m).toBe(1);
  });
});

describe("importing", () => {
  const productCsv = [
    "code,name,price (USD),unit,vat type,barcode,reorder level,opening quantity,unit cost (USD)",
    "IMP-1,Cement 50kg,12.50,bag,standard,600100,20,100,9.80",
    "IMP-2,Delivery,5,each,exempt,,,,",
    "IMP-3,River sand,30,tonne,zero rated,,,2.5,20",
  ].join("\r\n");

  it("imports products with prices and opening stock in one go", async () => {
    const result = await db.asUser(owner, async (q) => {
      const check = checkProducts(parseCsv(productCsv), await existingProducts(q, company), "USD");
      expect(check.errorRows).toBe(0);
      const counts = await importProducts(q, company, "USD", check.rows.map((r) => r.value!), mainLoc);
      const rows = (
        await q<{ sku: string; tax_code: string; price: string; avg_cost: string; qty: string | null; reorder: string | null }>(
          `select p.sku, p.tax_code, pp.price_cents as price, pv.avg_cost, s.quantity as qty, p.reorder_level as reorder
           from public.products p
           join public.products_v pv on pv.id = p.id
           join public.product_prices pp on pp.product_id = p.id and pp.currency = 'USD'
           left join public.stock_levels s on s.product_id = p.id and s.location_id = $2
           where p.company_id = $1 and p.sku like 'IMP-%' order by p.sku`,
          [company, mainLoc],
        )
      ).rows;
      const movements = (
        await q<{ docstatus: number; number: string; notes: string }>(
          "select docstatus, number, notes from public.stock_movements m join public.products p on p.id = m.product_id where p.sku like 'IMP-%'",
        )
      ).rows;
      // Checking again now finds every code as a duplicate.
      const again = checkProducts(parseCsv(productCsv), await existingProducts(q, company), "USD");
      return { counts, rows, movements, againErrors: again.errorRows };
    });
    expect(result.counts).toEqual({ products: 3, openingMovements: 2 });
    expect(result.rows).toEqual([
      { sku: "IMP-1", tax_code: "standard", price: "1250", avg_cost: "980.0000", qty: "100.000", reorder: "20.000" },
      { sku: "IMP-2", tax_code: "exempt", price: "500", avg_cost: "0.0000", qty: null, reorder: null },
      { sku: "IMP-3", tax_code: "zero_rated", price: "3000", avg_cost: "2000.0000", qty: "2.500", reorder: null },
    ]);
    expect(result.movements).toHaveLength(2);
    expect(result.movements.every((m) => m.docstatus === 1 && /^STM-/.test(m.number) && m.notes === "Opening stock (imported)")).toBe(true);
    expect(result.againErrors).toBe(3);
  });

  it("saves nothing when any row fails", async () => {
    await product("TAKEN");
    await db.admin.query("update public.products set barcode = '777' where company_id = $1 and sku = 'TAKEN'", [company]);
    const count = async () => Number((await one<{ n: string }>("select count(*) as n from public.products where company_id = $1", [company])).n);
    const before = await count();
    // The second row's barcode clashes (as if someone added it after the preview).
    const rows = checkProducts(parseCsv("code,name,price\nNEW-1,One,1\nNEW-2,Two,2"), { skus: new Set(), barcodes: new Set() }, "USD").rows.map((r) => r.value!);
    rows[1].barcode = "777";
    await db.admin.query("begin");
    await db.admin.query("set local role authenticated");
    await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [owner]);
    await expect(importProducts((sql, p) => db.admin.query(sql, p), company, "USD", rows, mainLoc)).rejects.toThrow(/products_barcode_unique/);
    await db.admin.query("rollback");
    expect(await count()).toBe(before);
  });

  it("needs the right permissions", async () => {
    const rows = checkProducts(parseCsv("code,name,price,opening quantity,unit cost\nPERM-1,One,1,5,1"), { skus: new Set(), barcodes: new Set() }, "USD").rows.map(
      (r) => r.value!,
    );
    // Storekeepers can move stock but not create products.
    await expect(db.asUser(storekeeper, (q) => importProducts(q, company, "USD", rows, mainLoc))).rejects.toThrow(/row-level security/);
    // Cashiers can add customers but not products.
    await expect(db.asUser(cashier, (q) => importProducts(q, company, "USD", rows, mainLoc))).rejects.toThrow(/row-level security/);
    // Another company's location cannot receive the opening stock.
    const otherLoc = (await one<{ id: string }>("select l.id from public.stock_locations l where l.company_id <> $1 limit 1", [company])).id;
    await expect(db.asUser(owner, (q) => importProducts(q, company, "USD", rows, otherLoc))).rejects.toThrow(/location for opening stock was not found/);
  });

  it("imports customers and finds duplicates of existing ones", async () => {
    await db.admin.query("insert into public.customers (company_id, name, phone, email) values ($1, 'Existing', '0771111111', 'old@x.co')", [company]);
    const csv = "name,business name,phone,whatsapp,email,currency\nTendai,,0772222222,,t@x.co,ZiG\n,Builders Ltd,,,,\nCopy,,+263 77 111 1111,,,\n";
    const result = await db.asUser(cashier, async (q) => {
      const check = checkCustomers(parseCsv(csv), await existingCustomers(q, company), "USD");
      const ok = check.rows.filter((r) => r.value).map((r) => r.value!);
      const n = await importCustomers(q, company, ok);
      const saved = (
        await q<{ name: string; company_name: string | null; currency: string; email: string | null }>(
          "select name, company_name, currency, email from public.customers where company_id = $1 and name <> 'Existing' order by name",
          [company],
        )
      ).rows;
      return { errors: check.rows.map((r) => r.errors), n, saved };
    });
    expect(result.errors).toEqual([[], [], ["A customer with the phone number +263 77 111 1111 already exists."]]);
    expect(result.n).toBe(2);
    expect(result.saved).toEqual([
      { name: "Builders Ltd", company_name: "Builders Ltd", currency: "USD", email: null },
      { name: "Tendai", company_name: null, currency: "ZWG", email: "t@x.co" },
    ]);
    // Storekeepers cannot add customers.
    await expect(
      db.asUser(storekeeper, (q) => importCustomers(q, company, [{ name: "X", companyName: null, phone: null, whatsapp: null, email: null, currency: "USD" }])),
    ).rejects.toThrow(/row-level security/);
  });
});
