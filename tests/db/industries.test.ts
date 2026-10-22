import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

// Industries (20261014150000_industries): the catalogue, sign-up presets and
// changing the industry later.

let db: Db;
let owner: string;

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
});

afterAll(() => db.close());

describe("industries", () => {
  it("lists industries to every signed-in user, with suggested modules that exist", async () => {
    const stranger = await db.createUser();
    const { rows } = await db.asUser(stranger, (q) => q<{ code: string; suggested_modules: string[] }>("select code, suggested_modules from public.industries order by sort_order"));
    expect(rows.map((r) => r.code)).toEqual(expect.arrayContaining(["retail", "church", "ngo", "school", "professional", "other"]));
    const modules = (await db.admin.query<{ code: string }>("select code from public.modules")).rows.map((r) => r.code);
    for (const r of rows) for (const m of r.suggested_modules) expect(modules).toContain(m);
  });

  it("only suggests features that exist", async () => {
    const { rows } = await db.admin.query(
      "select i.code, f.key from public.industries i, jsonb_each(i.suggested_features) f where not exists (select 1 from public.features where code = f.key)",
    );
    expect(rows).toEqual([]);
  });

  it("records the industry, applies its features and adds starter items when asked", async () => {
    const company = await createCompanyAs(db, owner, { slug: "grace-church", plan: "growth", modules: ["sales", "website"], industry: "church", sampleItems: true });
    const c = (await db.admin.query("select industry_code from public.companies where id = $1", [company])).rows[0];
    expect(c.industry_code).toBe("church");
    expect((await db.admin.query("select app.feature_on($1, 'sales.quotes') as on", [company])).rows[0].on).toBe(false);
    const items = (await db.admin.query("select sku, tax_code, is_stock_item, show_online from public.products where company_id = $1 order by sku", [company])).rows;
    expect(items.map((i) => i.sku)).toEqual(["BUILDING", "OFFERING", "TITHE"]);
    expect(items.every((i) => i.tax_code === "exempt" && !i.is_stock_item && !i.show_online)).toBe(true);
    expect((await db.admin.query("select app.feature_on($1, 'website.add_to_quote') as on", [company])).rows[0].on).toBe(false);
    const terms = await db.asUser(owner, (q) => q("select public.company_terms($1) as t", [company]));
    expect(terms.rows[0].t.customers).toBe("Members");
  });

  it("adds no starter items unless asked, and refuses unknown industries", async () => {
    const company = await createCompanyAs(db, owner, { slug: "salon-x", industry: "salon" });
    expect((await db.admin.query("select count(*)::int as n from public.products where company_id = $1", [company])).rows[0].n).toBe(0);
    await expect(createCompanyAs(db, owner, { slug: "nope", industry: "space_travel" })).rejects.toThrow(/unknown industry/);
  });

  it("lets company admins change the industry, but not other staff", async () => {
    const company = await createCompanyAs(db, owner, { slug: "shop-y", industry: "retail" });
    const cashier = await db.createUser();
    await addMember(db, company, cashier, "cashier");
    const change = (user: string) =>
      db.asUser(user, async (q) => (await q("update public.companies set industry_code = 'hardware' where id = $1 returning industry_code", [company])).rowCount);
    expect(await change(cashier)).toBe(0);
    expect(await change(owner)).toBe(1);
  });

  it("makes starter items stock items only when the company has inventory", async () => {
    const without = await createCompanyAs(db, owner, { slug: "hw-no-stock", plan: "business", modules: ["pos", "sales"], industry: "hardware", sampleItems: true });
    const withInv = await createCompanyAs(db, owner, { slug: "hw-stock", plan: "business", modules: ["pos", "inventory"], industry: "hardware", sampleItems: true });
    const stock = async (company: string) =>
      (await db.admin.query("select bool_or(is_stock_item) as any from public.products where company_id = $1", [company])).rows[0].any;
    expect(await stock(without)).toBe(false);
    expect(await stock(withInv)).toBe(true);
  });
});
