// The can() access rule, plan limits and audit trail (issue #19).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

let db: Db;
let owner: string;
let company: string;

const can = (userId: string, companyId: string, permission: string) =>
  db.asUser(userId, async (q) => {
    const { rows } = await q<{ ok: boolean }>("select app.can($1, $2) as ok", [companyId, permission]);
    return rows[0].ok;
  });

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  company = await createCompanyAs(db, owner, { plan: "business", modules: ["pos", "sales"] });
});

afterAll(async () => {
  await db?.close();
});

describe("company creation", () => {
  it("sets up roles, head office, branding, owner membership and a subdomain", async () => {
    const { rows } = await db.admin.query(
      `select
         (select count(*)::int from public.roles where company_id = $1) as roles,
         (select count(*)::int from public.branches where company_id = $1 and is_head_office) as hq,
         (select count(*)::int from public.company_branding where company_id = $1) as branding,
         (select r.code from public.memberships m join public.roles r on r.id = m.role_id
            where m.company_id = $1 and m.user_id = $2) as role,
         (select count(*)::int from public.company_domains where company_id = $1 and hostname like '%.zimerp.co.zw') as domains`,
      [company, owner],
    );
    expect(rows[0]).toEqual({ roles: 5, hq: 1, branding: 1, role: "owner", domains: 1 });
  });

  it("requires a signed-in user", async () => {
    await expect(
      db.asUser("", (q) => q("select public.create_company('X', 'xco')")),
    ).rejects.toThrow(/sign in required/);
  });
});

describe("can(): roles", () => {
  it("lets the owner do everything in enabled modules", async () => {
    expect(await can(owner, company, "pos.refund")).toBe(true);
    expect(await can(owner, company, "admin.roles.manage")).toBe(true);
  });

  it("limits a cashier to selling", async () => {
    const cashier = await db.createUser();
    await addMember(db, company, cashier, "cashier");
    expect(await can(cashier, company, "pos.sell")).toBe(true);
    expect(await can(cashier, company, "pos.refund")).toBe(false);
    expect(await can(cashier, company, "pos.void")).toBe(false);
    expect(await can(cashier, company, "core.products.view_cost")).toBe(false);
    expect(await can(cashier, company, "core.products.edit")).toBe(false);
  });

  it("gives light users only light permissions", async () => {
    const light = await db.createUser();
    await addMember(db, company, light, "cashier", "light");
    expect(await can(light, company, "pos.view")).toBe(true);
    expect(await can(light, company, "pos.sell")).toBe(false);
  });

  it("gives non-members nothing", async () => {
    const stranger = await db.createUser();
    expect(await can(stranger, company, "pos.view")).toBe(false);
  });

  it("lists the user's permissions for the interface", async () => {
    const cashier = await db.createUser();
    await addMember(db, company, cashier, "cashier");
    const perms = await db.asUser(cashier, async (q) =>
      (await q<{ code: string }>("select public.my_permissions($1) as code", [company])).rows.map((r) => r.code),
    );
    expect(perms).toContain("pos.sell");
    expect(perms).not.toContain("pos.refund");
  });
});

describe("can(): modules and feature switches", () => {
  it("denies permissions of modules the company has not switched on", async () => {
    expect(await can(owner, company, "inventory.view")).toBe(false);
  });

  it("allows them once an admin switches the module on", async () => {
    const co = await createCompanyAs(db, owner, { plan: "business", modules: ["pos"] });
    expect(await can(owner, co, "sales.view")).toBe(false);
    const allowed = await db.asUser(owner, async (q) => {
      await q("insert into public.company_modules (company_id, module_code) values ($1, 'sales')", [co]);
      return (await q<{ ok: boolean }>("select app.can($1, 'sales.view') as ok", [co])).rows[0].ok;
    });
    expect(allowed).toBe(true);
  });

  it("denies a permission when its feature is switched off", async () => {
    expect(await can(owner, company, "pos.discount")).toBe(true);
    const after = await db.asUser(owner, async (q) => {
      await q(
        "insert into public.company_features (company_id, feature_code, enabled) values ($1, 'pos.discounts', false)",
        [company],
      );
      return (await q<{ ok: boolean }>("select app.can($1, 'pos.discount') as ok", [company])).rows[0].ok;
    });
    expect(after).toBe(false);
  });

  it("does not let a cashier change feature switches", async () => {
    const cashier = await db.createUser();
    await addMember(db, company, cashier, "cashier");
    await expect(
      db.asUser(cashier, (q) =>
        q("insert into public.company_features (company_id, feature_code, enabled) values ($1, 'pos.discounts', false)", [company]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("plan limits", () => {
  it("refuses modules the plan does not include", async () => {
    const co = await createCompanyAs(db, owner, { plan: "starter", modules: ["pos"] });
    await expect(
      db.admin.query("insert into public.company_modules (company_id, module_code) values ($1, 'inventory')", [co]),
    ).rejects.toThrow(/not available on plan starter/);
  });

  it("refuses more modules than the plan allows, not counting the website", async () => {
    const co = await createCompanyAs(db, owner, { plan: "business", modules: ["pos", "sales", "inventory"] });
    await expect(
      db.admin.query("insert into public.company_modules (company_id, module_code) values ($1, 'portal')", [co]),
    ).rejects.toThrow(/allows 3 modules/);
    await db.admin.query("insert into public.company_modules (company_id, module_code) values ($1, 'website')", [co]);
  });

  it("refuses more full users than the plan allows, but not light users", async () => {
    const co = await createCompanyAs(db, owner, { plan: "business", modules: ["pos"] });
    for (let i = 0; i < 4; i++) await addMember(db, co, await db.createUser(), "cashier");
    await expect(addMember(db, co, await db.createUser(), "cashier")).rejects.toThrow(/allows 5 full users/);
    await addMember(db, co, await db.createUser(), "cashier", "light");
  });

  it("refuses more branches than the plan allows", async () => {
    await expect(
      db.asUser(owner, (q) =>
        q("insert into public.branches (company_id, code, name) values ($1, 'BYO', 'Bulawayo')", [company]),
      ),
    ).rejects.toThrow(/allows 1 branches/);
  });
});

describe("company status", () => {
  it("allows only viewing and exporting in read-only mode", async () => {
    const co = await createCompanyAs(db, owner, { plan: "business", modules: ["pos"] });
    await db.admin.query("update public.companies set status = 'read_only' where id = $1", [co]);
    expect(await can(owner, co, "pos.view")).toBe(true);
    expect(await can(owner, co, "reports.export")).toBe(true);
    expect(await can(owner, co, "pos.sell")).toBe(false);
  });

  it("allows nothing when suspended", async () => {
    const co = await createCompanyAs(db, owner, { plan: "business", modules: ["pos"] });
    await db.admin.query("update public.companies set status = 'suspended' where id = $1", [co]);
    expect(await can(owner, co, "pos.view")).toBe(false);
  });
});

describe("audit trail", () => {
  it("records who changed what, with before and after values", async () => {
    const events = await db.asUser(owner, async (q) => {
      await q("update public.companies set name = 'Renamed Ltd' where id = $1", [company]);
      return (
        await q<{ actor_id: string; before: { name: string }; after: { name: string } }>(
          `select actor_id, before, after from public.audit_events
           where company_id = $1 and table_name = 'companies' and action = 'update'`,
          [company],
        )
      ).rows;
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_id).toBe(owner);
    expect(events[0].after.name).toBe("Renamed Ltd");
    expect(events[0].before.name).not.toBe("Renamed Ltd");
  });

  it("hides the audit log from users without permission", async () => {
    const cashier = await db.createUser();
    await addMember(db, company, cashier, "cashier");
    const n = await db.asUser(cashier, async (q) =>
      (await q("select count(*)::int as n from public.audit_events where company_id = $1", [company])).rows[0].n,
    );
    expect(n).toBe(0);
  });

  it("cannot be altered, even by the database owner", async () => {
    await expect(db.admin.query("update public.audit_events set action = 'insert'")).rejects.toThrow(
      /cannot be changed or deleted/,
    );
    await expect(db.admin.query("delete from public.audit_events")).rejects.toThrow(
      /cannot be changed or deleted/,
    );
  });
});
