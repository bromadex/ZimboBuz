import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanBlocks, RESERVED_PAGE_SLUGS } from "../../src/lib/site/blocks";
import { TEMPLATE_CODES } from "../../src/lib/site/theme";
import { createCompanyAs, createTestDb, type Db } from "./harness";

// Website templates for every industry (20261014160000_site_templates): nine
// templates, the new block types and industry starter pages.

let db: Db;
let owner: string;

type PageRow = { slug: string; title: string; nav_order: number; blocks: Array<Record<string, unknown>>; published_blocks: unknown; published_at: Date | null };

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

async function siteFor(industry: string | undefined, slug: string) {
  const company = await createCompanyAs(db, owner, { slug, plan: "business", modules: ["sales", "website"], industry });
  await committedAs(owner, "select public.ensure_site($1)", [company]);
  const template = (await db.admin.query<{ template: string }>("select template from public.site_settings where company_id = $1", [company])).rows[0].template;
  const pages = (
    await db.admin.query<PageRow>(
      "select slug, title, nav_order, blocks, published_blocks, published_at from public.site_pages where company_id = $1 order by nav_order",
      [company],
    )
  ).rows;
  return { company, template, pages };
}

/** Checks a page's blocks the way the site renders them. */
function expectGoodPage(page: PageRow) {
  expect(RESERVED_PAGE_SLUGS.has(page.slug)).toBe(false);
  const ids = page.blocks.map((b) => String(b.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9_-]{1,40}$/);
  // Nothing is dropped or renamed when cleaned for the website.
  const cleaned = cleanBlocks(page.blocks);
  expect(cleaned.map((b) => [b.id, b.type])).toEqual(page.blocks.map((b) => [b.id, b.type]));
  expect(JSON.stringify(page.blocks)).not.toContain("{company}");
}

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser("owner@templates.test");
});

afterAll(() => db?.close());

describe("templates", () => {
  it("accepts the nine templates and refuses others", async () => {
    const { company } = await siteFor(undefined, "plain-co");
    for (const t of TEMPLATE_CODES) {
      await db.asUser(owner, (q) => q("update public.site_settings set template = $2 where company_id = $1", [company, t]));
    }
    await expect(
      db.asUser(owner, (q) => q("update public.site_settings set template = 'fancy' where company_id = $1", [company])),
    ).rejects.toThrow(/site_settings_template_check/);
  });

  it("has a template for every industry", async () => {
    const { rows } = await db.admin.query<{ code: string; website_template: string }>("select code, website_template from public.industries");
    for (const r of rows) expect(TEMPLATE_CODES).toContain(r.website_template);
  });

  it("switching template keeps the pages as they are", async () => {
    const { company, pages } = await siteFor("ngo", "switch-ngo");
    await committedAs(owner, "update public.site_settings set template = 'bold' where company_id = $1", [company]);
    await committedAs(owner, "select public.ensure_site($1)", [company]);
    const after = await db.admin.query("select slug, blocks from public.site_pages where company_id = $1 order by nav_order", [company]);
    expect(after.rows).toEqual(pages.map((p) => ({ slug: p.slug, blocks: p.blocks })));
    const t = await db.admin.query("select template from public.site_settings where company_id = $1", [company]);
    expect(t.rows[0].template).toBe("bold");
  });
});

describe("new blocks", () => {
  it("are valid page blocks", async () => {
    const valid = async (blocks: unknown) =>
      (await db.admin.query<{ ok: boolean }>("select app.valid_site_blocks($1::jsonb) as ok", [JSON.stringify(blocks)])).rows[0].ok;
    for (const type of ["price_list", "events", "team", "faq", "stats", "donate", "hero"]) {
      expect(await valid([{ id: "a", type }])).toBe(true);
    }
    expect(await valid([{ id: "a", type: "map" }])).toBe(false);
    expect(await valid([{ type: "faq" }])).toBe(false);
  });

  it("can be saved on a page by a website editor", async () => {
    const { company } = await siteFor(undefined, "blocks-co");
    const blocks = [
      { id: "s", type: "stats", items: [{ value: "500", label: "learners" }] },
      { id: "f", type: "faq", items: [{ question: "Q?", answer: "A." }] },
    ];
    await db.asUser(owner, async (q) => {
      await q("insert into public.site_pages (company_id, slug, title, blocks) values ($1, 'facts', 'Facts', $2)", [company, JSON.stringify(blocks)]);
      await expect(
        q("insert into public.site_pages (company_id, slug, title, blocks) values ($1, 'bad', 'Bad', $2)", [company, JSON.stringify([{ id: "x", type: "script" }])]),
      ).rejects.toThrow(/check/);
    });
  });
});

describe("starter pages", () => {
  it("gives a church the ministry template and church pages, already published", async () => {
    const { template, pages } = await siteFor("church", "grace-church");
    expect(template).toBe("ministry");
    expect(pages.map((p) => p.slug)).toEqual(["home", "about", "give", "contact"]);
    for (const p of pages) {
      expect(p.published_at).not.toBeNull();
      expect(p.published_blocks).toEqual(p.blocks);
      expectGoodPage(p);
    }
    const ok = await db.admin.query<{ ok: boolean }>(
      "select bool_and(app.valid_site_blocks(blocks) and app.valid_site_blocks(published_blocks)) as ok from public.site_pages p join public.companies c on c.id = p.company_id where c.slug = 'grace-church'",
    );
    expect(ok.rows[0].ok).toBe(true);
    const home = pages[0];
    expect(home.blocks[0]).toMatchObject({ type: "hero", heading: "Welcome home", eyebrow: "grace-church" });
    expect(home.blocks.map((b) => b.type)).toEqual(expect.arrayContaining(["events", "donate"]));
  });

  it("keeps the shop home page for a retail company", async () => {
    const { template, pages } = await siteFor("retail", "corner-shop");
    expect(template).toBe("bold");
    expect(pages.map((p) => p.slug)).toEqual(["home", "contact"]);
    expect(pages[0].blocks.map((b) => b.type)).toEqual(["hero", "featured_products", "text", "cta"]);
    expect(pages[0].blocks[0]).toMatchObject({ heading: "corner-shop", button_link: "/shop" });
  });

  it("gives a company without an industry the classic template and shop home page", async () => {
    const { template, pages } = await siteFor(undefined, "no-industry");
    expect(template).toBe("classic");
    expect(pages.map((p) => p.slug)).toEqual(["home", "contact"]);
  });

  it("gives schools, NGOs, consultants and restaurants their own pages", async () => {
    const school = await siteFor("school", "hill-school");
    expect(school.template).toBe("academy");
    expect(school.pages.map((p) => p.slug)).toEqual(["home", "admissions", "fees", "contact"]);
    expect(school.pages.find((p) => p.slug === "fees")?.blocks.map((b) => b.type)).toContain("price_list");
    expect(school.pages.find((p) => p.slug === "admissions")?.blocks.map((b) => b.type)).toContain("faq");

    const ngo = await siteFor("ngo", "hope-trust");
    expect(ngo.template).toBe("cause");
    expect(ngo.pages.map((p) => p.slug)).toEqual(["home", "our-work", "donate", "contact"]);
    expect(ngo.pages[0].blocks.map((b) => b.type)).toEqual(expect.arrayContaining(["stats", "cta"]));

    const pro = await siteFor("professional", "moyo-advisory");
    expect(pro.template).toBe("consult");
    expect(pro.pages.map((p) => p.slug)).toEqual(["home", "services", "team", "contact"]);

    const food = await siteFor("restaurant", "mai-tendai-eats");
    expect(food.template).toBe("menu");
    expect(food.pages.map((p) => p.slug)).toEqual(["home", "contact"]);
    expect(food.pages[0].blocks.map((b) => b.type)).toContain("price_list");
  });

  it("are well formed for every industry, with company names safely written in", async () => {
    const { rows } = await db.admin.query<{ code: string }>("select code from public.industries union all select null");
    for (const { code } of rows) {
      const pages = (
        await db.admin.query<{ p: PageRow[] }>("select app.site_starter_pages($1, $2) as p", [code, 'Chido\'s "Best" Shop \\ Co'])
      ).rows[0].p;
      expect(pages[0].slug).toBe("home");
      expect(pages.at(-1)?.slug).toBe("contact");
      expect(new Set(pages.map((p) => p.slug)).size).toBe(pages.length);
      for (const p of pages) {
        const ok = (await db.admin.query<{ ok: boolean }>("select app.valid_site_blocks($1::jsonb) as ok", [JSON.stringify(p.blocks)])).rows[0].ok;
        expect(ok).toBe(true);
        expect(p.blocks.length).toBeGreaterThan(0);
        expectGoodPage(p);
      }
      expect(JSON.stringify(pages)).toContain('Chido\'s \\"Best\\" Shop \\\\ Co');
    }
  });

  it("cannot be called by visitors or other users", async () => {
    await expect(
      db.asUser(owner, (q) => q("select app.site_starter_pages('church', 'x')")),
    ).rejects.toThrow(/permission denied/);
  });
});
