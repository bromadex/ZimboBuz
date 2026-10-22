import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

// Product pictures (20261014120000_product_pictures).

let db: Db;
let owner: string;
let storekeeper: string;
let company: string;
let product: string;

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  storekeeper = await db.createUser();
  company = await createCompanyAs(db, owner, { slug: "pics", plan: "business", modules: ["sales", "inventory", "website"] });
  await addMember(db, company, storekeeper, "storekeeper");
  product = (await db.admin.query("insert into public.products (company_id, sku, name) values ($1, 'P1', 'Paint') returning id", [company])).rows[0].id;
});

afterAll(() => db.close());

describe("product pictures", () => {
  it("lets product editors register a picture and set it, but not storekeepers", async () => {
    const key = `${company}/products/abc.png`;
    const register = (user: string) =>
      db.asUser(user, (q) =>
        q("insert into public.site_assets (company_id, storage_key, kind, content_type, size_bytes, created_by) values ($1, $2, 'product', 'image/png', 10, auth.uid())", [company, key]),
      );
    await expect(register(storekeeper)).rejects.toThrow(/row-level security/);
    await db.asUser(owner, async (q) => {
      await q("insert into public.site_assets (company_id, storage_key, kind, content_type, size_bytes, created_by) values ($1, $2, 'product', 'image/png', 10, auth.uid())", [company, key]);
      await q("update public.products set image_key = $2 where id = $1", [product, key]);
      expect((await q("select image_key from public.products_v where id = $1", [product])).rows[0].image_key).toBe(key);
    });
  });

  it("refuses picture paths outside the company's product folder", async () => {
    await expect(db.admin.query("update public.products set image_key = 'someone-else/products/x.png' where id = $1", [product])).rejects.toThrow(/check/);
  });

  it("shows the picture on the public store", async () => {
    const key = `${company}/products/def.png`;
    await db.admin.query("update public.products set image_key = $2 where id = $1", [product, key]);
    // make the site live as the owner (committed), then read as a visitor
    for (const sql of ["select public.ensure_site($1)", "select public.set_site_published($1, true)"]) {
      await db.admin.query("begin");
      await db.admin.query("set local role authenticated");
      await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [owner]);
      await db.admin.query(sql, [company]);
      await db.admin.query("commit");
    }
    await db.admin.query("begin");
    await db.admin.query("set local role anon");
    const rows = (await db.admin.query("select image_key from public.site_products('pics')")).rows;
    const one = (await db.admin.query("select public.site_product('pics', $1) as p", [product])).rows[0].p;
    await db.admin.query("commit");
    expect(rows.map((r) => r.image_key)).toEqual([key]);
    expect(one.image_key).toBe(key);
  });
});
