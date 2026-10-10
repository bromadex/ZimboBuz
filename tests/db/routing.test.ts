// Domain routing support (issue #23): public site lookup and reserved names.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompanyAs, createTestDb, type Db } from "./harness";

let db: Db;
let company: string;

const resolve = async (host: string) => {
  await db.admin.query("begin; set local role anon;");
  try {
    return (await db.admin.query("select * from public.resolve_site($1)", [host])).rows;
  } finally {
    await db.admin.query("rollback");
  }
};

beforeAll(async () => {
  db = await createTestDb();
  company = await createCompanyAs(db, await db.createUser(), { name: "Mhofu Hardware", slug: "mhofu" });
});

afterAll(async () => {
  await db?.close();
});

describe("resolve_site", () => {
  it("finds a company's platform subdomain for anonymous visitors", async () => {
    expect(await resolve("Mhofu.zimerp.co.zw.")).toEqual([{ company_slug: "mhofu", kind: "website", company_name: "Mhofu Hardware" }]);
  });

  it("ignores unverified and archived domains", async () => {
    await db.admin.query(
      "insert into public.company_domains (company_id, hostname, kind) values ($1, 'erp.mhofu.co.zw', 'erp')",
      [company],
    );
    expect(await resolve("erp.mhofu.co.zw")).toEqual([]);
    await db.admin.query("update public.company_domains set verified_at = now() where hostname = 'erp.mhofu.co.zw'");
    expect(await resolve("erp.mhofu.co.zw")).toEqual([{ company_slug: "mhofu", kind: "erp", company_name: "Mhofu Hardware" }]);
    await db.admin.query("update public.company_domains set archived_at = now() where hostname = 'erp.mhofu.co.zw'");
    expect(await resolve("erp.mhofu.co.zw")).toEqual([]);
  });

  it("stops resolving suspended companies", async () => {
    await db.admin.query("update public.companies set status = 'suspended' where id = $1", [company]);
    expect(await resolve("mhofu.zimerp.co.zw")).toEqual([]);
    await db.admin.query("update public.companies set status = 'active' where id = $1", [company]);
  });
});

describe("reserved names", () => {
  it("refuses company addresses that belong to ZimERP", async () => {
    for (const slug of ["www", "api", "admin", "erp"]) {
      await expect(createCompanyAs(db, await db.createUser(), { slug })).rejects.toThrow(/companies_slug_not_reserved/);
    }
  });
});
