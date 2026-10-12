import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

// Administration (P3, P10, P12, P17): invitations, membership rules, custom
// roles and permission changes, company preferences, VAT settings and the
// private two-step table.

let db: Db;
let owner: string;
let manager: string;
let cashier: string;
let invitee: string;
let stranger: string;
let company: string;
let other: string;

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;

const roleId = async (code: string, c = company) =>
  (await db.admin.query<{ id: string }>("select id from public.roles where company_id = $1 and code = $2", [c, code])).rows[0].id;
const membership = async (user: string, c = company) =>
  (
    await db.admin.query(
      "select m.*, r.code as role_code from public.memberships m join public.roles r on r.id = m.role_id where m.company_id = $1 and m.user_id = $2",
      [c, user],
    )
  ).rows[0];

/** Runs as a signed-in user and commits (the harness's asUser rolls back). */
async function commitAs<T>(user: string, fn: (q: Q) => Promise<T>): Promise<T> {
  await db.admin.query("begin");
  try {
    await db.admin.query("set local role authenticated");
    await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    const result = await fn((sql, params) => db.admin.query(sql, params));
    await db.admin.query("commit");
    return result;
  } catch (e) {
    await db.admin.query("rollback");
    throw e;
  }
}

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser("owner@admin.test");
  manager = await db.createUser("manager@admin.test");
  cashier = await db.createUser("cashier@admin.test");
  invitee = await db.createUser("invitee@admin.test");
  stranger = await db.createUser("stranger@admin.test");
  company = await createCompanyAs(db, owner, { slug: "admin-co", plan: "business", modules: ["pos", "sales"] });
  other = await createCompanyAs(db, stranger, { slug: "other-co" });
  await addMember(db, company, manager, "manager");
  await addMember(db, company, cashier, "cashier");
});

afterAll(() => db.close());

describe("invitations", () => {
  it("lets an admin invite someone with a role and user type", async () => {
    const cashierRole = await roleId("cashier");
    await commitAs(owner, (q) => q("select public.invite_member($1, $2, $3, 'full')", [company, invitee, cashierRole]));
    expect(await membership(invitee)).toMatchObject({ status: "invited", user_type: "full", role_code: "cashier", invited_by: owner });
  });

  it("does not let invited people in until they accept", async () => {
    const seen = await db.asUser(invitee, (q) => q("select id from public.companies where id = $1", [company]));
    expect(seen.rowCount).toBe(0);
    const mine = await db.asUser(invitee, (q) => q("select * from public.my_membership('admin-co')"));
    expect(mine.rows[0]).toMatchObject({ company_name: "admin-co", role_name: "Cashier", status: "invited", user_type: "full" });
    const none = await db.asUser(stranger, (q) => q("select * from public.my_membership('admin-co')"));
    expect(none.rowCount).toBe(0);
  });

  it("refuses inviting the same person twice, non-admins inviting, and other companies' roles", async () => {
    const cashierRole = await roleId("cashier");
    const theirRole = await roleId("cashier", other);
    await expect(db.asUser(owner, (q) => q("select public.invite_member($1, $2, $3, 'full')", [company, invitee, cashierRole]))).rejects.toThrow(
      /already on your list/,
    );
    await expect(db.asUser(cashier, (q) => q("select public.invite_member($1, $2, $3, 'light')", [company, stranger, cashierRole]))).rejects.toThrow(
      /not allowed/,
    );
    await expect(db.asUser(owner, (q) => q("select public.invite_member($1, $2, $3, 'full')", [company, stranger, theirRole]))).rejects.toThrow(
      /choose a role/,
    );
  });

  it("counts invited full users towards the plan limit; light users do not count", async () => {
    // Business allows 5 full users: owner, manager, cashier and the invitee make 4.
    const extra = await db.createUser("extra@admin.test");
    const more = await db.createUser("more@admin.test");
    const cashierRole = await roleId("cashier");
    await commitAs(owner, (q) => q("select public.invite_member($1, $2, $3, 'full')", [company, extra, cashierRole]));
    await expect(db.asUser(owner, (q) => q("select public.invite_member($1, $2, $3, 'full')", [company, more, cashierRole]))).rejects.toThrow(
      /plan business allows 5 full users/,
    );
    await commitAs(owner, (q) => q("select public.invite_member($1, $2, $3, 'light')", [company, more, cashierRole]));
    // Make room again for later tests.
    await db.admin.query("update public.memberships set user_type = 'light' where company_id = $1 and user_id = $2", [company, extra]);
  });

  it("lets the invited person accept, and only their own invitation", async () => {
    await expect(db.asUser(stranger, (q) => q("select public.accept_invitation($1)", [company]))).rejects.toThrow(/no invitation/);
    await commitAs(invitee, (q) => q("select public.accept_invitation($1)", [company]));
    expect((await membership(invitee)).status).toBe("active");
    const seen = await db.asUser(invitee, (q) => q("select id from public.companies where id = $1", [company]));
    expect(seen.rowCount).toBe(1);
    await expect(db.asUser(invitee, (q) => q("select public.accept_invitation($1)", [company]))).rejects.toThrow(/no invitation/);
  });

  it("checks the plan again when an invitation is accepted", async () => {
    const late = await db.createUser("late@admin.test");
    await db.admin.query(
      `insert into public.memberships (company_id, user_id, role_id, user_type, status)
       select $1, $2, id, 'full', 'invited' from public.roles where company_id = $1 and code = 'cashier'`,
      [company, late],
    );
    // Fill the fifth seat while the invitation waits.
    const filler = await db.createUser("filler@admin.test");
    await addMember(db, company, filler, "cashier");
    const full = await db.admin.query("select count(*)::int as n from public.memberships where company_id = $1 and user_type = 'full' and status = 'active'", [company]);
    expect(full.rows[0].n).toBe(5);
    await expect(db.asUser(late, (q) => q("select public.accept_invitation($1)", [company]))).rejects.toThrow(/allows 5 full users/);
    await db.admin.query("update public.memberships set status = 'disabled' where company_id = $1 and user_id = any($2)", [company, [late, filler]]);
  });
});

describe("membership rules", () => {
  it("lets admins change role and type and disable (never delete)", async () => {
    const storekeeper = await roleId("storekeeper");
    await commitAs(owner, (q) =>
      q("update public.memberships set role_id = $3, user_type = 'light' where company_id = $1 and user_id = $2", [company, cashier, storekeeper]),
    );
    expect(await membership(cashier)).toMatchObject({ role_code: "storekeeper", user_type: "light" });
    await db.asUser(owner, async (q) => {
      expect((await q("update public.memberships set status = 'disabled' where company_id = $1 and user_id = $2", [company, cashier])).rowCount).toBe(1);
      await expect(q("delete from public.memberships where company_id = $1 and user_id = $2", [company, cashier])).rejects.toThrow(/permission denied/);
    });
    const byManager = await db.asUser(manager, (q) =>
      q("update public.memberships set status = 'disabled' where company_id = $1 and user_id = $2", [company, cashier]),
    );
    expect(byManager.rowCount).toBe(0);
  });

  it("takes all access away from disabled users", async () => {
    await db.admin.query("update public.memberships set status = 'disabled' where company_id = $1 and user_id = $2", [company, cashier]);
    const perms = await db.asUser(cashier, (q) => q("select public.my_permissions($1)", [company]));
    expect(perms.rowCount).toBe(0);
    await db.admin.query("update public.memberships set status = 'active' where company_id = $1 and user_id = $2", [company, cashier]);
  });

  it("keeps at least one owner", async () => {
    const managerRole = await roleId("manager");
    await expect(
      db.asUser(owner, (q) => q("update public.memberships set role_id = $3 where company_id = $1 and user_id = $2", [company, owner, managerRole])),
    ).rejects.toThrow(/at least one owner/);
    await expect(
      db.asUser(owner, (q) => q("update public.memberships set status = 'disabled' where company_id = $1 and user_id = $2", [company, owner])),
    ).rejects.toThrow(/at least one owner/);
  });

  it("lets an owner step down once there is another owner", async () => {
    const ownerRole = await roleId("owner");
    const managerRole = await roleId("manager");
    await db.asUser(owner, async (q) => {
      await q("update public.memberships set role_id = $3 where company_id = $1 and user_id = $2", [company, manager, ownerRole]);
      const r = await q("update public.memberships set role_id = $3 where company_id = $1 and user_id = $2", [company, owner, managerRole]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("only lets owners hand out the owner role", async () => {
    // A custom role with user management but not ownership.
    const cashierRole = await roleId("cashier");
    const ownerRole = await roleId("owner");
    const hr = await commitAs(owner, async (q) => (await q("select public.create_role($1, 'People admin', $2) as id", [company, cashierRole])).rows[0].id as string);
    await commitAs(owner, (q) => q("select public.set_role_permission($1, 'admin.users.manage', true)", [hr]));
    const hrUser = await db.createUser("hr@admin.test");
    await db.admin.query("insert into public.memberships (company_id, user_id, role_id, user_type) values ($1, $2, $3, 'light')", [company, hrUser, hr]);
    await db.admin.query("update public.permissions set light_ok = true where code = 'admin.users.manage'");
    try {
      await db.asUser(hrUser, async (q) => {
        await expect(q("update public.memberships set role_id = $3 where company_id = $1 and user_id = $2", [company, hrUser, ownerRole])).rejects.toThrow(
          /Only an owner/,
        );
      });
      await db.asUser(hrUser, async (q) => {
        await expect(q("insert into public.memberships (company_id, user_id, role_id) values ($1, $2, $3)", [company, stranger, ownerRole])).rejects.toThrow(
          /Only an owner/,
        );
      });
      await db.asUser(hrUser, async (q) => {
        await expect(q("select public.invite_member($1, $2, $3, 'light')", [company, stranger, ownerRole])).rejects.toThrow(/Only an owner/);
      });
      await db.asUser(hrUser, async (q) => {
        await expect(q("update public.memberships set status = 'disabled' where company_id = $1 and user_id = $2", [company, owner])).rejects.toThrow(
          /Only an owner/,
        );
      });
      await db.asUser(hrUser, async (q) => {
        // Other roles are fine.
        const r = await q("update public.memberships set role_id = $3 where company_id = $1 and user_id = $2", [company, cashier, cashierRole]);
        expect(r.rowCount).toBe(1);
      });
    } finally {
      await db.admin.query("update public.permissions set light_ok = false where code = 'admin.users.manage'");
    }
  });
});

describe("roles", () => {
  let custom: string;

  it("creates a custom role copied from another, audited", async () => {
    await expect(db.asUser(manager, (q) => q("select public.create_role($1, 'X', null)", [company]))).rejects.toThrow(/not allowed/);
    const cashierRole = await roleId("cashier");
    custom = await commitAs(owner, async (q) => (await q("select public.create_role($1, 'Senior cashier', $2) as id", [company, cashierRole])).rows[0].id as string);
    const codes = async (role: string) =>
      (await db.admin.query("select permission_code from public.role_permissions where role_id = $1 order by 1", [role])).rows.map((r) => r.permission_code);
    expect(await codes(custom)).toEqual(await codes(cashierRole));
    const role = (await db.admin.query("select code, is_system from public.roles where id = $1", [custom])).rows[0];
    expect(role).toEqual({ code: "senior_cashier", is_system: false });
    const audit = await db.admin.query("select * from public.audit_events where table_name = 'role_permissions' and record_id = $1", [custom]);
    expect(audit.rows[0]).toMatchObject({ action: "insert", actor_id: owner });
  });

  it("refuses duplicate role names and needs admin.roles.manage", async () => {
    await expect(db.asUser(owner, (q) => q("select public.create_role($1, 'senior CASHIER', null)", [company]))).rejects.toThrow(/already exists/);
    await expect(db.asUser(cashier, (q) => q("select public.create_role($1, 'Mine', null)", [company]))).rejects.toThrow(/not allowed/);
  });

  it("grants and revokes permissions through the function, with an audit row", async () => {
    await commitAs(owner, async (q) => {
      expect((await q("select public.set_role_permission($1, 'pos.refund', true) as c", [custom])).rows[0].c).toBe(true);
      expect((await q("select public.set_role_permission($1, 'pos.refund', true) as c", [custom])).rows[0].c).toBe(false);
      expect((await q("select public.set_role_permission($1, 'pos.sell', false) as c", [custom])).rows[0].c).toBe(true);
    });
    const perms = (await db.admin.query("select permission_code from public.role_permissions where role_id = $1", [custom])).rows.map((r) => r.permission_code);
    expect(perms).toContain("pos.refund");
    expect(perms).not.toContain("pos.sell");
    const audit = (
      await db.admin.query(
        "select before, after, actor_id from public.audit_events where table_name = 'role_permissions' and record_id = $1 and action = 'update' order by id",
        [custom],
      )
    ).rows;
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({
      actor_id: owner,
      before: { permission: "pos.sell", granted: true },
      after: { permission: "pos.sell", granted: false },
    });
  });

  it("refuses changing the owner role, other companies' roles, and users without the permission", async () => {
    const ownerRole = await roleId("owner");
    const theirs = await roleId("cashier", other);
    const cashierRole = await roleId("cashier");
    await expect(db.asUser(owner, (q) => q("select public.set_role_permission($1, 'pos.sell', false)", [ownerRole]))).rejects.toThrow(
      /always has every permission/,
    );
    await expect(db.asUser(owner, (q) => q("select public.set_role_permission($1, 'pos.sell', false)", [theirs]))).rejects.toThrow(/not allowed/);
    await expect(db.asUser(cashier, (q) => q("select public.set_role_permission($1, 'pos.sell', false)", [cashierRole]))).rejects.toThrow(/not allowed/);
    await expect(db.asUser(owner, (q) => q("select public.set_role_permission($1, 'nope', true)", [cashierRole]))).rejects.toThrow(/Unknown permission/);
  });

  it("archives custom roles only when nobody uses them; built-in roles stay", async () => {
    const cashierRole = await roleId("cashier");
    const managerRole = await roleId("manager");
    const used = await roleId("people_admin");
    await db.asUser(owner, async (q) => {
      expect((await q("update public.roles set archived_at = now() where id = $1", [custom])).rowCount).toBe(1);
    });
    await expect(db.asUser(owner, (q) => q("update public.roles set archived_at = now() where id = $1", [cashierRole]))).rejects.toThrow(/Built-in/);
    await expect(db.asUser(owner, (q) => q("update public.roles set code = 'boss' where id = $1", [managerRole]))).rejects.toThrow(/code cannot/);
    await expect(db.asUser(owner, (q) => q("update public.roles set archived_at = now() where id = $1", [used]))).rejects.toThrow(/Move everyone/);
  });

  it("lists restricted fields with the permission that unlocks them", async () => {
    const rows = await db.asUser(cashier, (q) =>
      q("select rf.doctype, rf.column_name, p.description from public.restricted_fields rf join public.permissions p on p.code = rf.permission_code"),
    );
    expect(rows.rows).toContainEqual({ doctype: "product", column_name: "avg_cost", description: "See cost prices and margins" });
  });
});

describe("company preferences", () => {
  it("lets company admins save preferences, hidden from everyone else", async () => {
    await commitAs(owner, (q) =>
      q(
        `insert into public.company_preferences (company_id, daily_summary_enabled, daily_summary_phones, daily_summary_hour)
         values ($1, true, '{0771234567}', 19)
         on conflict (company_id) do update set daily_summary_enabled = excluded.daily_summary_enabled`,
        [company],
      ),
    );
    expect((await db.asUser(owner, (q) => q("select * from public.company_preferences where company_id = $1", [company]))).rowCount).toBe(1);
    expect((await db.asUser(cashier, (q) => q("select * from public.company_preferences where company_id = $1", [company]))).rowCount).toBe(0);
    expect((await db.asUser(stranger, (q) => q("select * from public.company_preferences where company_id = $1", [company]))).rowCount).toBe(0);
    await expect(db.asUser(stranger, (q) => q("insert into public.company_preferences (company_id) values ($1)", [company]))).rejects.toThrow(
      /row-level security/,
    );
    const byCashier = await db.asUser(cashier, (q) => q("update public.company_preferences set daily_summary_hour = 3 where company_id = $1", [company]));
    expect(byCashier.rowCount).toBe(0);
    await expect(
      db.asUser(owner, (q) => q("update public.company_preferences set daily_summary_phones = '{1,2,3,4,5,6}' where company_id = $1", [company])),
    ).rejects.toThrow(/check constraint/);
    const audit = await db.admin.query("select 1 from public.audit_events where table_name = 'company_preferences' and company_id = $1", [company]);
    expect(audit.rowCount).toBe(1);
  });

  it("tells everyone whether two-step sign-in is required", async () => {
    await db.admin.query("update public.company_preferences set require_two_step_admins = true where company_id = $1", [company]);
    expect((await db.asUser(cashier, (q) => q("select app.requires_two_step($1) as r", [company]))).rows[0].r).toBe(true);
    expect((await db.asUser(stranger, (q) => q("select app.requires_two_step($1) as r", [other]))).rows[0].r).toBe(false);
  });

  it("keeps summary runs readable by admins only and unwritable by users", async () => {
    await db.admin.query("insert into public.daily_summary_runs (company_id, summary_date, status, body) values ($1, current_date, 'sent', 'Hi')", [company]);
    expect((await db.asUser(owner, (q) => q("select * from public.daily_summary_runs where company_id = $1", [company]))).rowCount).toBe(1);
    expect((await db.asUser(cashier, (q) => q("select * from public.daily_summary_runs where company_id = $1", [company]))).rowCount).toBe(0);
    await expect(
      db.asUser(owner, (q) => q("insert into public.daily_summary_runs (company_id, summary_date) values ($1, current_date + 1)", [company])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("company settings", () => {
  it("lets the tax permission change VAT settings without editing company details", async () => {
    const accountant = await db.createUser("accountant@admin.test");
    await addMember(db, company, accountant, "accountant", "light");
    // Light users cannot use core.settings.tax (not light_ok).
    await expect(db.asUser(accountant, (q) => q("select public.set_company_tax($1, true, '123', true)", [company]))).rejects.toThrow(
      /permission to change VAT/,
    );
    await db.asUser(owner, async (q) => {
      await expect(q("select public.set_company_tax($1, true, '', true)", [company])).rejects.toThrow(/VAT number/);
    });
    await db.asUser(owner, async (q) => {
      await q("select public.set_company_tax($1, true, ' 10012345 ', false)", [company]);
      const c = (await q("select vat_registered, vat_number, prices_include_tax from public.companies where id = $1", [company])).rows[0];
      expect(c).toEqual({ vat_registered: true, vat_number: "10012345", prices_include_tax: false });
    });
    await expect(db.asUser(stranger, (q) => q("select public.set_company_tax($1, false, null, true)", [company]))).rejects.toThrow(/permission/);
  });

  it("enforces the branch limit of the plan", async () => {
    await expect(
      db.asUser(owner, (q) => q("insert into public.branches (company_id, code, name) values ($1, 'BYO', 'Bulawayo')", [company])),
    ).rejects.toThrow(/plan business allows 1 branches/);
  });
});

describe("two-step sign-in storage", () => {
  it("is not readable or writable by signed-in users", async () => {
    await db.admin.query("insert into app.user_totp (user_id, secret_enc) values ($1, 'v1:x')", [owner]);
    await expect(db.asUser(owner, (q) => q("select * from app.user_totp"))).rejects.toThrow(/permission denied/);
    await expect(db.asUser(owner, (q) => q("update app.user_totp set enabled_at = now()"))).rejects.toThrow(/permission denied/);
  });
});
