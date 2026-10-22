import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

// Main addresses, domain orders and the footer badge (20261014170000_domains_primary).

let db: Db;
let owner: string;
let company: string;

const resolve = async (host: string) => (await db.admin.query("select * from public.resolve_site($1)", [host])).rows[0];
const domain = (host: string, extra = "") =>
  db.admin.query(`insert into public.company_domains (company_id, hostname, kind, verified_at${extra ? ", is_primary" : ""}) values ($1, $2, $3, now()${extra ? ", true" : ""})`, [
    company,
    host,
    host.startsWith("erp.") ? "erp" : "website",
  ]);

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  company = await createCompanyAs(db, owner, { slug: "mhofu", plan: "business", modules: ["sales", "website"] });
});

afterAll(() => db.close());

describe("main addresses", () => {
  it("starts with the ZimERP address as the main website address", async () => {
    expect(await resolve("mhofu.zimerp.co.zw")).toMatchObject({ company_slug: "mhofu", site_host: "mhofu.zimerp.co.zw", erp_host: null });
  });

  it("keeps one main address per area and reports it for every connected name", async () => {
    await domain("mhofu.co.zw");
    await domain("www.mhofu.co.zw", "primary");
    await domain("erp.mhofu.co.zw", "primary");
    const { rows } = await db.admin.query("select hostname from public.company_domains where company_id = $1 and is_primary order by hostname", [company]);
    expect(rows.map((r) => r.hostname)).toEqual(["erp.mhofu.co.zw", "www.mhofu.co.zw"]);
    for (const host of ["mhofu.zimerp.co.zw", "mhofu.co.zw", "www.mhofu.co.zw"]) {
      expect(await resolve(host)).toMatchObject({ site_host: "www.mhofu.co.zw", erp_host: "erp.mhofu.co.zw" });
    }
  });

  it("hands the main address back to the ZimERP address when the main domain is removed", async () => {
    await db.admin.query("update public.company_domains set archived_at = now() where hostname = 'www.mhofu.co.zw'");
    expect((await resolve("mhofu.co.zw")).site_host).toBe("mhofu.zimerp.co.zw");
  });
});

describe("domain orders", () => {
  it("prices orders from the catalogue and refuses what cannot be ordered", async () => {
    const id = await db.asUser(owner, async (q) => {
      const r = (await q("select public.request_domain($1, 'Grace-Church.org.zw', 2) as id", [company])).rows[0].id;
      const o = (await q("select hostname, years, price_cents, status from public.domain_orders where id = $1", [r])).rows[0];
      expect(o).toMatchObject({ hostname: "grace-church.org.zw", years: 2, price_cents: "5000", status: "requested" });
      await expect(q("select public.request_domain($1, 'grace-church.org.zw')", [company])).rejects.toThrow(/already been ordered/);
      return r;
    });
    expect(id).toBeTruthy();
    const refused = (sql: string, error: RegExp) => db.asUser(owner, (q) => expect(q(sql, [company])).rejects.toThrow(error));
    await refused("select public.request_domain($1, 'shop.xyz')", /cannot register domains ending in .xyz/);
    await refused("select public.request_domain($1, 'mhofu.co.zw')", /already connected/);
    await refused("insert into public.domain_orders (company_id, hostname, price_cents) values ($1, 'cheap.co.zw', 1)", /permission denied/);
  });

  it("only lets domain managers order", async () => {
    const cashier = await db.createUser();
    await addMember(db, company, cashier, "cashier");
    await db.asUser(cashier, (q) => expect(q("select public.request_domain($1, 'new-shop.co.zw')", [company])).rejects.toThrow(/not allowed/));
  });

  it("connects both names when ZimERP completes the order", async () => {
    const id = (
      await db.admin.query("insert into public.domain_orders (company_id, hostname, price_cents) values ($1, 'mhofu-hardware.com', 1800) returning id", [company])
    ).rows[0].id;
    expect((await db.admin.query("select app.complete_domain_order($1, true, 'REF-1') as s", [id])).rows[0].s).toBe("registered");
    const { rows } = await db.admin.query("select hostname from public.company_domains where hostname like '%mhofu-hardware.com' order by hostname", []);
    expect(rows.map((r) => r.hostname)).toEqual(["mhofu-hardware.com", "www.mhofu-hardware.com"]);
    expect((await db.admin.query("select app.complete_domain_order($1, false) as s", [id])).rows[0].s).toBe("registered");
  });
});

describe("Website by ZimERP", () => {
  it("can be hidden only on plans that allow it", async () => {
    await db.admin.query("insert into public.site_settings (company_id) values ($1)", [company]);
    await db.asUser(owner, (q) =>
      expect(q("update public.site_settings set show_platform_badge = false where company_id = $1", [company])).rejects.toThrow(/Growth plan/),
    );
    await db.admin.query("update public.companies set plan_code = 'growth' where id = $1", [company]);
    await db.admin.query("update public.site_settings set show_platform_badge = false where company_id = $1", [company]);
    expect((await db.admin.query("select public.site_platform_badge('mhofu') as v")).rows[0].v).toBe(false);
    // Back on a plan that does not allow it, the badge shows again.
    await db.admin.query("update public.companies set plan_code = 'business' where id = $1", [company]);
    expect((await db.admin.query("select public.site_platform_badge('mhofu') as v")).rows[0].v).toBe(true);
  });
});
