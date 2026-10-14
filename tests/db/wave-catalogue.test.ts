import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompanyAs, createTestDb, type Db } from "./harness";

// Waves 3 and 4 catalogue (20261015090000_wave3_4_catalogue).

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

describe("wave 3 and 4 catalogue", () => {
  it("gives every new module a view and manage permission and a plan", async () => {
    const { rows } = await db.admin.query(
      `select m.code from public.modules m
       where m.sort_order >= 10
         and (not exists (select 1 from public.permissions where code = m.code || '.view')
              or not exists (select 1 from public.permissions where code = m.code || '.manage')
              or not exists (select 1 from public.plan_modules where module_code = m.code))`,
    );
    expect(rows).toEqual([]);
    const starter = await db.admin.query("select count(*)::int as n from public.plan_modules pm join public.modules m on m.code = pm.module_code where pm.plan_code = 'starter' and m.sort_order >= 10");
    expect(starter.rows[0].n).toBe(0);
  });

  it("lets owners, not managers, manage Studio and the API", async () => {
    const owner = await db.createUser();
    const company = await createCompanyAs(db, owner, { slug: "wave-co", plan: "pro", modules: ["sales"] });
    const perms = async (role: string) =>
      (
        await db.admin.query<{ permission_code: string }>(
          "select rp.permission_code from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.company_id = $1 and r.code = $2",
          [company, role],
        )
      ).rows.map((r) => r.permission_code);
    expect(await perms("owner")).toEqual(expect.arrayContaining(["studio.manage", "api.manage", "crm.manage", "mining.view"]));
    const manager = await perms("manager");
    expect(manager).toEqual(expect.arrayContaining(["crm.manage", "studio.view"]));
    expect(manager).not.toContain("studio.manage");
    expect(manager).not.toContain("api.manage");
  });

  it("only suggests modules that exist", async () => {
    const { rows } = await db.admin.query(
      "select i.code, m from public.industries i, unnest(i.suggested_modules) m where not exists (select 1 from public.modules where code = m)",
    );
    expect(rows).toEqual([]);
  });
});
