import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

// The statements the first ERP screens run (src/app/e/[slug]), checked as the
// signed-in user so row-level security decides, as it does in the app.

let db: Db;
let owner: string;
let cashier: string;
let stranger: string;
let company: string;

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser("owner@mhofu.test");
  cashier = await db.createUser("cashier@mhofu.test");
  stranger = await db.createUser("stranger@other.test");
  company = await createCompanyAs(db, owner, { slug: "mhofu", plan: "business", modules: ["pos", "sales"] });
  await addMember(db, company, cashier, "cashier");
});

afterAll(() => db.close());

const contextSql = `
  select c.id, c.plan_code, r.name as role_name, b.primary_color
  from public.companies c
  join public.plans pl on pl.code = c.plan_code
  join public.memberships m on m.company_id = c.id and m.user_id = auth.uid()
  join public.roles r on r.id = m.role_id
  left join public.company_branding b on b.company_id = c.id
  where c.slug = $1 and c.archived_at is null`;

describe("ERP screens", () => {
  it("loads the company context for members only", async () => {
    const mine = await db.asUser(owner, (q) => q(contextSql, ["mhofu"]));
    expect(mine.rows[0]).toMatchObject({ id: company, role_name: "Owner", primary_color: "#0b6e4f" });
    const theirs = await db.asUser(stranger, (q) => q(contextSql, ["mhofu"]));
    expect(theirs.rowCount).toBe(0);
  });

  it("filters navigation by permission", async () => {
    const perms = async (user: string) =>
      new Set((await db.asUser(user, (q) => q<{ code: string }>("select public.my_permissions($1) as code", [company]))).rows.map((r) => r.code));
    const o = await perms(owner);
    const c = await perms(cashier);
    expect(o.has("admin.modules.manage") && o.has("core.products.create")).toBe(true);
    expect(c.has("core.products.view")).toBe(true);
    expect(c.has("core.products.create") || c.has("admin.modules.manage") || c.has("core.rates.manage")).toBe(false);
  });

  it("adds a product with its base price and lists it", async () => {
    await db.asUser(owner, async (q) => {
      const { rows } = await q<{ id: string }>(
        `insert into public.products (company_id, sku, barcode, name, unit, tax_code, is_stock_item)
         values ($1, 'CEM-50', null, 'Cement 50kg', 'each', 'standard', true) returning id`,
        [company],
      );
      await q(
        `insert into public.product_prices (company_id, product_id, currency, price_cents)
         select $1, $2, base_currency, 1250 from public.companies where id = $1`,
        [company, rows[0].id],
      );
      const list = await q(
        `select p.name, p.avg_cost, pp.price_cents from public.products_v p
         left join public.product_prices pp on pp.product_id = p.id and pp.currency = 'USD'
         where p.company_id = $1 and p.archived_at is null`,
        [company],
      );
      expect(list.rows).toEqual([{ name: "Cement 50kg", avg_cost: "0.0000", price_cents: "1250" }]);
    });
  });

  it("refuses a cashier adding products, and archiving changes nothing for them", async () => {
    await expect(
      db.asUser(cashier, (q) =>
        q("insert into public.products (company_id, sku, name) values ($1, 'X', 'X')", [company]),
      ),
    ).rejects.toThrow(/row-level security/);
    const archived = await db.asUser(cashier, (q) =>
      q("update public.customers set archived_at = now() where company_id = $1 and archived_at is null", [company]),
    );
    expect(archived.rowCount).toBe(0); // the screen reports this as "no permission"
  });

  it("switches modules and features with an upsert, within the plan limit", async () => {
    await db.asUser(owner, async (q) => {
      const upsertModule = (code: string, on: boolean) =>
        q(
          `insert into public.company_modules (company_id, module_code, enabled) values ($1, $2, $3)
           on conflict (company_id, module_code) do update set enabled = excluded.enabled`,
          [company, code, on],
        );
      await upsertModule("inventory", true); // third module on Business
      await q(
        `insert into public.company_features (company_id, feature_code, enabled) values ($1, 'sales.quotes', false)
         on conflict (company_id, feature_code) do update set enabled = excluded.enabled`,
        [company],
      );
      expect((await q("select app.can($1, 'sales.quote.create') as ok", [company])).rows[0].ok).toBe(false);
      await expect(upsertModule("portal", true)).rejects.toThrow(/plan business allows 3 modules/);
    });
    await expect(
      db.asUser(cashier, (q) =>
        q(
          `insert into public.company_modules (company_id, module_code, enabled) values ($1, 'pos', false)
           on conflict (company_id, module_code) do update set enabled = excluded.enabled`,
          [company],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("records exchange rates set by the owner only", async () => {
    await db.asUser(owner, async (q) => {
      await q("insert into public.exchange_rates (company_id, currency, rate) values ($1, 'ZWG', '26.75')", [company]);
      expect(Number((await q("select app.rate_at($1, 'ZWG') as r", [company])).rows[0].r)).toBe(26.75);
    });
    await expect(
      db.asUser(cashier, (q) => q("insert into public.exchange_rates (company_id, currency, rate) values ($1, 'ZAR', 18)", [company])),
    ).rejects.toThrow(/row-level security/);
  });

  it("saves the brand kit for admins only", async () => {
    const save = (user: string) =>
      db.asUser(user, (q) =>
        q(
          `update public.company_branding set primary_color = '#1d4ed8', font_pair = 'classic' where company_id = $1`,
          [company],
        ),
      );
    expect((await save(owner)).rowCount).toBe(1);
    expect((await save(cashier)).rowCount).toBe(0);
  });
});
