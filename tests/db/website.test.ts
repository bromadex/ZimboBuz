import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db, type Query } from "./harness";

// Company website and store (P9): staff edit drafts and publish; anonymous
// visitors read only published content of a live site through the public
// functions, never drafts, cost prices or another company's data.

let db: Db;
let owner: string;
let cashier: string;
let editor: string;
let ownerB: string;
let company: string;
let companyB: string;
let shown: string;
let hidden: string;
let archived: string;
let productB: string;

/** Runs `fn` as an anonymous visitor (role anon), rolled back afterwards. */
async function asAnon<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  await db.admin.query("begin");
  try {
    await db.admin.query("set local role anon");
    return await fn((sql, params) => db.admin.query(sql, params));
  } finally {
    await db.admin.query("rollback");
  }
}

const bundle = async (slug: string) =>
  asAnon(async (q) => (await q<{ b: Record<string, unknown> | null }>("select public.site_bundle($1) as b", [slug])).rows[0].b);
const page = async (slug: string, p: string) =>
  asAnon(async (q) => (await q<{ p: Record<string, unknown> | null }>("select public.site_page($1, $2) as p", [slug, p])).rows[0].p);
const products = async (slug: string, search: string | null = null, limit = 24, offset = 0, ids: string[] | null = null) =>
  asAnon(async (q) => (await q("select * from public.site_products($1, $2, $3, $4, $5)", [slug, search, limit, offset, ids])).rows);

async function committedAs(user: string, sql: string, params: unknown[] = []) {
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

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser("owner@alpha.test");
  cashier = await db.createUser("cashier@alpha.test");
  editor = await db.createUser("editor@alpha.test");
  ownerB = await db.createUser("owner@bravo.test");
  company = await createCompanyAs(db, owner, { name: "Alpha Hardware", slug: "alpha", plan: "business", modules: ["pos", "sales", "website"] });
  companyB = await createCompanyAs(db, ownerB, { name: "Bravo Bakery", slug: "bravo", plan: "business", modules: ["pos", "website"] });
  await addMember(db, company, cashier, "cashier");
  // A role that may edit the website but not publish it.
  const role = (
    await db.admin.query<{ id: string }>(
      "insert into public.roles (company_id, code, name) values ($1, 'web_editor', 'Web editor') returning id",
      [company],
    )
  ).rows[0].id;
  await db.admin.query(
    `insert into public.role_permissions (company_id, role_id, permission_code)
     values ($1, $2, 'website.view'), ($1, $2, 'website.edit')`,
    [company, role],
  );
  await db.admin.query("insert into public.memberships (company_id, user_id, role_id) values ($1, $2, $3)", [company, editor, role]);

  const product = async (c: string, sku: string, name: string, opts: { online?: boolean; archived?: boolean; price?: number } = {}) => {
    const id = (
      await db.admin.query<{ id: string }>(
        `insert into public.products (company_id, sku, name, description, show_online, archived_at, avg_cost)
         values ($1, $2, $3, $4, $5, $6, 777) returning id`,
        [c, sku, name, `${name} description`, opts.online ?? true, opts.archived ? new Date() : null],
      )
    ).rows[0].id;
    if (opts.price !== undefined) {
      await db.admin.query("insert into public.product_prices (company_id, product_id, currency, price_cents) values ($1, $2, 'USD', $3)", [c, id, opts.price]);
    }
    return id;
  };
  shown = await product(company, "CEM", "Cement 50kg", { price: 1250 });
  await product(company, "SAND", "Building sand", { price: 900 });
  await product(company, "NAIL", "Nails 1kg");
  hidden = await product(company, "SECRET", "Secret stock", { online: false, price: 100 });
  archived = await product(company, "OLD", "Old cement", { archived: true, price: 100 });
  productB = await product(companyB, "BREAD", "Bread loaf", { price: 120 });

  await committedAs(owner, "select public.ensure_site($1)", [company]);
  await committedAs(ownerB, "select public.ensure_site($1)", [companyB]);
});

afterAll(() => db?.close());

describe("setting up a site", () => {
  it("creates settings and a published home and contact page once", async () => {
    const pages = await db.admin.query<{ slug: string; published_at: Date | null; blocks: unknown[] }>(
      "select slug, published_at, blocks from public.site_pages where company_id = $1 order by nav_order",
      [company],
    );
    expect(pages.rows.map((p) => p.slug)).toEqual(["home", "contact"]);
    expect(pages.rows.every((p) => p.published_at && p.blocks.length > 0)).toBe(true);
    await committedAs(owner, "select public.ensure_site($1)", [company]);
    const again = await db.admin.query("select count(*)::int as n from public.site_pages where company_id = $1", [company]);
    expect(again.rows[0].n).toBe(2);
    const settings = await db.admin.query("select template, published from public.site_settings where company_id = $1", [company]);
    expect(settings.rows[0]).toEqual({ template: "classic", published: false });
  });

  it("needs website.edit", async () => {
    await expect(db.asUser(cashier, (q) => q("select public.ensure_site($1)", [company]))).rejects.toThrow(/not allowed/);
    await expect(db.asUser(ownerB, (q) => q("select public.ensure_site($1)", [company]))).rejects.toThrow(/not allowed/);
  });

  it("lets only website roles read site settings and pages", async () => {
    const counts = async (user: string) =>
      db.asUser(user, async (q) => [
        (await q("select count(*)::int as n from public.site_pages where company_id = $1", [company])).rows[0].n,
        (await q("select count(*)::int as n from public.site_settings where company_id = $1", [company])).rows[0].n,
      ]);
    expect(await counts(owner)).toEqual([2, 1]);
    expect(await counts(editor)).toEqual([2, 1]);
    expect(await counts(cashier)).toEqual([0, 0]);
    expect(await counts(ownerB)).toEqual([0, 0]);
  });

  it("rejects malformed blocks and reserved page addresses", async () => {
    await expect(
      db.asUser(owner, (q) =>
        q(`insert into public.site_pages (company_id, slug, title, blocks) values ($1, 'about', 'About', '[{"id":"x","type":"script"}]')`, [company]),
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.asUser(owner, (q) => q("insert into public.site_pages (company_id, slug, title) values ($1, 'shop', 'Shop')", [company])),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.asUser(owner, (q) => q("insert into public.site_pages (company_id, slug, title) values ($1, 'contact', 'Again')", [company])),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("before the site is live", () => {
  it("shows anonymous visitors only the name and brand kit", async () => {
    const b = await bundle("alpha");
    expect(b).toMatchObject({ live: false, company: { name: "Alpha Hardware" }, menu: [], settings: { template: "classic" } });
    expect((b!.settings as Record<string, unknown>).tagline).toBeUndefined();
    expect(await page("alpha", "home")).toBeNull();
    expect(await products("alpha")).toEqual([]);
  });

  it("returns nothing for unknown companies", async () => {
    expect(await bundle("nobody")).toBeNull();
    expect(await page("nobody", "home")).toBeNull();
  });

  it("can only be put live by publishers", async () => {
    await expect(db.asUser(editor, (q) => q("select public.set_site_published($1, true)", [company]))).rejects.toThrow(/not allowed/);
    await expect(db.asUser(ownerB, (q) => q("select public.set_site_published($1, true)", [company]))).rejects.toThrow(/not allowed/);
    await committedAs(owner, "update public.site_settings set tagline = 'Everything for building' where company_id = $1", [company]);
    await committedAs(owner, "select public.set_site_published($1, true)", [company]);
    await committedAs(ownerB, "select public.set_site_published($1, true)", [companyB]);
  });
});

describe("a live site", () => {
  it("serves settings, menu and published pages", async () => {
    const b = await bundle("alpha");
    expect(b).toMatchObject({
      live: true,
      settings: { tagline: "Everything for building", template: "classic" },
      menu: [{ slug: "home", title: "Home" }, { slug: "contact", title: "Contact us" }],
      features: { add_to_quote: true, buy: true, portal: false },
    });
    const home = await page("alpha", "home");
    expect(home).toMatchObject({ slug: "home", title: "Home" });
    expect(JSON.stringify(home)).toContain("Alpha Hardware");
  });

  it("never shows drafts until they are published", async () => {
    await committedAs(
      editor,
      `update public.site_pages set title = 'Welcome', blocks = '[{"id":"n1","type":"text","heading":"Draft news","body":"Not yet"}]'
       where company_id = $1 and slug = 'home'`,
      [company],
    );
    const before = await page("alpha", "home");
    expect(JSON.stringify(before)).not.toContain("Draft news");
    expect(before).toMatchObject({ title: "Home" });

    await expect(db.asUser(editor, (q) => q("select public.publish_site_page(id) from public.site_pages where company_id = $1 and slug = 'home'", [company]))).rejects.toThrow(/not allowed/);
    await expect(
      db.asUser(owner, (q) => q("update public.site_pages set published_blocks = blocks where company_id = $1", [company])),
    ).rejects.toThrow(/permission denied/);

    await committedAs(owner, "select public.publish_site_page(id) from public.site_pages where company_id = $1 and slug = 'home'", [company]);
    const after = await page("alpha", "home");
    expect(JSON.stringify(after)).toContain("Draft news");
    expect(after).toMatchObject({ title: "Welcome" });
  });

  it("hides pages that were never published or are archived", async () => {
    await committedAs(
      owner,
      `insert into public.site_pages (company_id, slug, title, blocks) values ($1, 'about', 'About us', '[{"id":"a1","type":"text","heading":"Secret plan","body":"x"}]')`,
      [company],
    );
    expect(await page("alpha", "about")).toBeNull();
    expect(((await bundle("alpha"))!.menu as Array<{ slug: string }>).map((m) => m.slug)).not.toContain("about");

    await committedAs(owner, "select public.publish_site_page(id) from public.site_pages where company_id = $1 and slug = 'about'", [company]);
    expect(await page("alpha", "about")).toMatchObject({ title: "About us" });
    await committedAs(owner, "update public.site_pages set archived_at = now() where company_id = $1 and slug = 'about'", [company]);
    expect(await page("alpha", "about")).toBeNull();
  });

  it("lists only products shown online, priced in the base currency, without cost", async () => {
    const rows = await products("alpha");
    expect(rows.map((r) => r.name)).toEqual(["Building sand", "Cement 50kg", "Nails 1kg"]);
    expect(rows[1]).toMatchObject({ price_cents: "1250", currency: "USD", total: "3" });
    expect(rows[2].price_cents).toBeNull();
    expect(Object.keys(rows[0])).not.toContain("avg_cost");
    expect(JSON.stringify(rows)).not.toContain("777");
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(hidden);
    expect(ids).not.toContain(archived);
    expect(ids).not.toContain(productB);
  });

  it("searches, pages and picks products", async () => {
    expect((await products("alpha", "cement")).map((r) => r.name)).toEqual(["Cement 50kg"]);
    expect((await products("alpha", "%")).length).toBe(0);
    const pageTwo = await products("alpha", null, 2, 2);
    expect(pageTwo.map((r) => r.name)).toEqual(["Nails 1kg"]);
    expect(pageTwo[0].total).toBe("3");
    const picked = await products("alpha", null, 10, 0, [shown, hidden, productB]);
    expect(picked.map((r) => r.id)).toEqual([shown]);
  });

  it("returns one product only when it is shown online by that company", async () => {
    const one = async (slug: string, id: string) =>
      asAnon(async (q) => (await q("select public.site_product($1, $2) as p", [slug, id])).rows[0].p);
    expect(await one("alpha", shown)).toMatchObject({ name: "Cement 50kg", price_cents: 1250, currency: "USD" });
    expect(JSON.stringify(await one("alpha", shown))).not.toContain("777");
    expect(await one("alpha", hidden)).toBeNull();
    expect(await one("alpha", archived)).toBeNull();
    expect(await one("alpha", productB)).toBeNull();
    expect(await one("bravo", productB)).toMatchObject({ name: "Bread loaf" });
  });

  it("keeps each company's pages apart", async () => {
    expect(JSON.stringify(await page("bravo", "home"))).toContain("Bravo Bakery");
    expect(JSON.stringify(await page("bravo", "home"))).not.toContain("Draft news");
    expect((await products("bravo")).map((r) => r.name)).toEqual(["Bread loaf"]);
  });

  it("goes dark when the website module is switched off or the company is suspended", async () => {
    await db.admin.query("update public.company_modules set enabled = false where company_id = $1 and module_code = 'website'", [company]);
    expect((await bundle("alpha"))!.live).toBe(false);
    expect(await page("alpha", "home")).toBeNull();
    expect(await products("alpha")).toEqual([]);
    await db.admin.query("update public.company_modules set enabled = true where company_id = $1 and module_code = 'website'", [company]);

    await db.admin.query("update public.companies set status = 'suspended' where id = $1", [companyB]);
    expect(await bundle("bravo")).toBeNull();
    expect(await products("bravo")).toEqual([]);
    await db.admin.query("update public.companies set status = 'active' where id = $1", [companyB]);
  });

  it("can be taken offline again", async () => {
    await committedAs(ownerB, "select public.set_site_published($1, false)", [companyB]);
    expect((await bundle("bravo"))!.live).toBe(false);
    expect(await page("bravo", "home")).toBeNull();
    await committedAs(ownerB, "select public.set_site_published($1, true)", [companyB]);
  });
});

describe("anonymous visitors", () => {
  it("cannot read website tables or call staff functions", async () => {
    for (const sql of [
      "select * from public.site_pages",
      "select * from public.site_settings",
      "select * from public.site_assets",
      "select * from public.products",
    ]) {
      await expect(asAnon((q) => q(sql))).rejects.toThrow(/permission denied/);
    }
    await expect(asAnon((q) => q("select public.ensure_site($1)", [company]))).rejects.toThrow(/permission denied/);
    await expect(asAnon((q) => q("select public.set_site_published($1, true)", [company]))).rejects.toThrow(/permission denied/);
    await expect(asAnon((q) => q("select public.publish_site_page($1)", [company]))).rejects.toThrow(/permission denied/);
  });
});

describe("uploaded files", () => {
  it("serves only registered, unarchived files", async () => {
    const key = `${company}/site/photo.png`;
    await db.asUser(owner, async (q) => {
      await q(
        "insert into public.site_assets (company_id, storage_key, kind, content_type, size_bytes, created_by) values ($1, $2, 'image', 'image/png', 100, auth.uid())",
        [company, key],
      );
    });
    await db.admin.query(
      "insert into public.site_assets (company_id, storage_key, kind, content_type, size_bytes) values ($1, $2, 'image', 'image/png', 100)",
      [company, key],
    );
    const asset = async (k: string) => asAnon(async (q) => (await q("select * from public.public_asset($1)", [k])).rows);
    expect(await asset(key)).toEqual([{ content_type: "image/png", size_bytes: 100 }]);
    expect(await asset(`${company}/site/unknown.png`)).toEqual([]);
    await db.admin.query("update public.site_assets set archived_at = now() where storage_key = $1", [key]);
    expect(await asset(key)).toEqual([]);
  });

  it("keeps keys under the company and checks who may upload what", async () => {
    await expect(
      db.asUser(owner, (q) =>
        q("insert into public.site_assets (company_id, storage_key, kind, content_type, size_bytes, created_by) values ($1, $2, 'image', 'image/png', 1, auth.uid())", [company, `${companyB}/x.png`]),
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.asUser(editor, (q) =>
        q("insert into public.site_assets (company_id, storage_key, kind, content_type, size_bytes, created_by) values ($1, $2, 'logo', 'image/png', 1, auth.uid())", [company, `${company}/branding/l.png`]),
      ),
    ).rejects.toThrow(/row-level security/);
    await db.asUser(editor, (q) =>
      q("insert into public.site_assets (company_id, storage_key, kind, content_type, size_bytes, created_by) values ($1, $2, 'image', 'image/webp', 1, auth.uid())", [company, `${company}/site/e.webp`]),
    );
    await expect(
      db.asUser(ownerB, (q) =>
        q("insert into public.site_assets (company_id, storage_key, kind, content_type, size_bytes, created_by) values ($1, $2, 'image', 'image/png', 1, auth.uid())", [company, `${company}/site/b.png`]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("custom domains", () => {
  it("lets admins add and archive domains but not mark them verified", async () => {
    await db.asUser(owner, async (q) => {
      await q("insert into public.company_domains (company_id, hostname, kind) values ($1, 'www.alpha.co.zw', 'website')", [company]);
      await expect(q("update public.company_domains set verified_at = now() where hostname = 'www.alpha.co.zw'")).rejects.toThrow(/permission denied/);
    });
    await db.asUser(owner, async (q) => {
      await q("insert into public.company_domains (company_id, hostname, kind) values ($1, 'shop.alpha.co.zw', 'website')", [company]);
      const r = await q("update public.company_domains set archived_at = now() where hostname = 'shop.alpha.co.zw'");
      expect(r.rowCount).toBe(1);
    });
    await expect(
      db.asUser(owner, (q) => q("insert into public.company_domains (company_id, hostname, kind, verified_at) values ($1, 'x.alpha.co.zw', 'website', now())", [company])),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses ZimERP addresses", async () => {
    await expect(
      db.asUser(owner, (q) => q("insert into public.company_domains (company_id, hostname, kind) values ($1, 'other.zimerp.co.zw', 'website')", [company])),
    ).rejects.toThrow(/ZimERP addresses/);
    await expect(
      db.asUser(owner, (q) => q("update public.company_domains set archived_at = now() where hostname = 'alpha.zimerp.co.zw'")),
    ).rejects.toThrow(/cannot be removed/);
  });
});
