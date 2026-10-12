import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

// ZimERP subscription billing (P11): monthly invoices, the overdue path
// (grace → read-only → suspended), payment back to active, and plan changes.

let db: Db;
let owner: string;
let cashier: string;
let stranger: string;
let company: string;
let free: string;

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;

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

const status = async (c = company) => (await db.admin.query("select status, plan_code from public.companies where id = $1", [c])).rows[0];
const invoices = async (c = company) =>
  (await db.admin.query("select * from public.subscription_invoices where company_id = $1 order by created_at, number", [c])).rows;

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser("owner@billing.test");
  cashier = await db.createUser("cashier@billing.test");
  stranger = await db.createUser("stranger@billing.test");
  company = await createCompanyAs(db, owner, { slug: "pay-co", plan: "business", modules: ["pos", "sales", "inventory"] });
  free = await createCompanyAs(db, stranger, { slug: "free-co", plan: "starter", modules: ["pos"] });
  await addMember(db, company, cashier, "cashier");
});

afterAll(() => db.close());

describe("monthly invoices", () => {
  it("issues one invoice per paying company per month, none for Starter", async () => {
    const n = await db.asService((q) => q("select app.issue_subscription_invoices('2026-11-03') as n"));
    expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
    const again = await db.asService((q) => q("select app.issue_subscription_invoices('2026-11-20') as n"));
    expect(again.rows[0].n).toBe(0);
    const list = await invoices();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: "monthly",
      plan_code: "business",
      amount_cents: 2900,
      currency: "USD",
      status: "due",
      description: "Business plan, November 2026",
    });
    expect(list[0].number).toMatch(/^ZIM-2026-\d{5}$/);
    expect(list[0].due_on.toISOString().slice(0, 10)).toBe("2026-11-08");
    expect(await invoices(free)).toHaveLength(0);
  });

  it("shows invoices only to people who manage billing in that company", async () => {
    expect((await db.asUser(owner, (q) => q("select * from public.subscription_invoices"))).rowCount).toBe(1);
    expect((await db.asUser(cashier, (q) => q("select * from public.subscription_invoices"))).rowCount).toBe(0);
    expect((await db.asUser(stranger, (q) => q("select * from public.subscription_invoices"))).rowCount).toBe(0);
  });

  it("never lets a company change its invoices, plan or status itself", async () => {
    await expect(db.asUser(owner, (q) => q("update public.subscription_invoices set status = 'paid', paid_at = now()"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.asUser(owner, (q) =>
        q(
          "insert into public.subscription_invoices (company_id, number, period_start, period_end, plan_code, description, amount_cents, due_on) values ($1, 'X', current_date, current_date, 'business', 'x', 1, current_date)",
          [company],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(db.asUser(owner, (q) => q("update public.companies set status = 'active' where id = $1", [company]))).rejects.toThrow(/permission denied/);
    await expect(db.asUser(owner, (q) => q("update public.companies set plan_code = 'enterprise' where id = $1", [company]))).rejects.toThrow(
      /permission denied/,
    );
    for (const sql of [
      "select app.mark_subscription_paid($1, 'x', 'y', 999999)",
      "select app.refresh_billing_status((select company_id from public.subscription_invoices where id = $1))",
    ]) {
      const id = (await invoices())[0].id;
      await expect(db.asUser(owner, (q) => q(sql, [id]))).rejects.toThrow(/permission denied/);
    }
    await expect(db.asUser(owner, (q) => q("select app.issue_subscription_invoices()"))).rejects.toThrow(/permission denied/);
  });
});

describe("overdue path", () => {
  const run = (on: string) => db.asService((q) => q("select app.update_billing_statuses($1)", [on]));

  it("stays active until a week after the due date, then grace, read-only and suspended", async () => {
    await run("2026-11-14");
    expect((await status()).status).toBe("active");
    await run("2026-11-15");
    expect((await status()).status).toBe("grace");
    expect((await status(free)).status).toBe("active");
    await run("2026-11-21");
    expect((await status()).status).toBe("grace");
    await run("2026-11-22");
    expect((await status()).status).toBe("read_only");
  });

  it("lets a read-only company view, export and see its bill, but not make changes", async () => {
    const perms = (await db.asUser(owner, (q) => q("select public.my_permissions($1) as code", [company]))).rows.map((r) => r.code);
    expect(perms).toContain("reports.export");
    expect(perms).toContain("core.products.view");
    expect(perms).not.toContain("core.products.create");
    expect(perms).not.toContain("admin.billing.manage");
    expect((await db.asUser(owner, (q) => q("select * from public.subscription_invoices"))).rowCount).toBe(1);
    await expect(
      db.asUser(owner, (q) => q("insert into public.customers (company_id, name) values ($1, 'New')", [company])),
    ).rejects.toThrow(/row-level security/);
  });

  it("suspends after 60 days and still lets the owner see what is owed", async () => {
    await run("2027-01-07");
    expect((await status()).status).toBe("suspended");
    expect((await db.asUser(owner, (q) => q("select public.my_permissions($1)", [company]))).rowCount).toBe(0);
    expect((await db.asUser(owner, (q) => q("select app.billing_admin($1) as ok", [company]))).rows[0].ok).toBe(true);
    expect((await db.asUser(cashier, (q) => q("select app.billing_admin($1) as ok", [company]))).rows[0].ok).toBe(false);
  });

  it("returns the company to active once everything overdue is paid, and ignores repeated notices", async () => {
    const [inv] = await invoices();
    await expect(db.asService((q) => q("select app.mark_subscription_paid($1, 'paynow', 'P1', 100)", [inv.id]))).rejects.toThrow(/does not match/);
    const first = await db.asService((q) => q("select app.mark_subscription_paid($1, 'paynow', 'P1', 2900) as changed", [inv.id]));
    expect(first.rows[0].changed).toBe(true);
    expect((await status()).status).toBe("active");
    const second = await db.asService((q) => q("select app.mark_subscription_paid($1, 'paynow', 'P1', 2900) as changed", [inv.id]));
    expect(second.rows[0].changed).toBe(false);
    expect((await invoices())[0]).toMatchObject({ status: "paid", gateway: "paynow", gateway_reference: "P1" });
    const audit = await db.admin.query(
      "select after->>'status' as s from public.audit_events where table_name = 'companies' and record_id = $1 order by id",
      [company],
    );
    expect(audit.rows.map((r) => r.s)).toEqual(expect.arrayContaining(["grace", "read_only", "suspended", "active"]));
  });

  it("goes by the oldest unpaid invoice", async () => {
    await db.asService((q) => q("select app.issue_subscription_invoices('2026-12-01')"));
    await db.asService((q) => q("select app.issue_subscription_invoices('2027-01-01')"));
    await run("2027-01-10"); // December invoice due 8 Dec: 33 days overdue
    expect((await status()).status).toBe("read_only");
    const dec = (await invoices()).find((i) => i.description.includes("December"))!;
    await db.asService((q) => q("select app.mark_subscription_paid($1, 'paynow', 'P2', 2900)", [dec.id]));
    expect((await status()).status).toBe("active"); // paying re-checks as of today, before January's due date
  });
});

describe("changing plan", () => {
  it("refuses people who do not manage billing", async () => {
    await expect(db.asUser(cashier, (q) => q("select public.change_plan($1, 'pro')", [company]))).rejects.toThrow(/not allowed/);
    await expect(db.asUser(stranger, (q) => q("select public.change_plan($1, 'pro')", [company]))).rejects.toThrow(/not allowed/);
  });

  it("upgrades straight away with an invoice for the difference for the rest of the month", async () => {
    const before = (await invoices()).length;
    await commitAs(owner, (q) => q("select public.change_plan($1, 'growth')", [company]));
    expect((await status()).plan_code).toBe("growth");
    const list = await invoices();
    expect(list).toHaveLength(before + 1);
    const up = list.find((i) => i.kind === "upgrade")!;
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const left = daysInMonth - today.getDate() + 1;
    expect(up).toMatchObject({ plan_code: "growth", status: "due" });
    expect(Math.abs(up.amount_cents - Math.round(((7900 - 2900) * left) / daysInMonth))).toBeLessThanOrEqual(1);
    expect(up.description).toMatch(/^Upgrade from Business to Growth/);
    await expect(db.asUser(owner, (q) => q("select public.change_plan($1, 'growth')", [company]))).rejects.toThrow(/already on the Growth plan/);
  });

  it("refuses a downgrade the company does not fit, in plain English", async () => {
    // Starter: 1 full user (they have 2), 1 module (they have 3), no inventory.
    await expect(db.asUser(owner, (q) => q("select public.change_plan($1, 'starter')", [company]))).rejects.toThrow(
      "The Starter plan allows 1 full user, and you have 2. Disable some users or make them light users first.",
    );
    await db.admin.query("update public.memberships set user_type = 'light' where company_id = $1 and user_id = $2", [company, cashier]);
    await expect(db.asUser(owner, (q) => q("select public.change_plan($1, 'starter')", [company]))).rejects.toThrow(
      "The Starter plan does not include Inventory. Switch it off in Modules and features first.",
    );
    await db.admin.query("update public.company_modules set enabled = false where company_id = $1 and module_code = 'inventory'", [company]);
    await expect(db.asUser(owner, (q) => q("select public.change_plan($1, 'starter')", [company]))).rejects.toThrow(
      "The Starter plan allows 1 module, and you have 2 switched on. Switch some off first.",
    );
    await db.admin.query("insert into public.branches (company_id, code, name) values ($1, 'BYO', 'Bulawayo')", [company]);
    await db.admin.query("update public.company_modules set enabled = false where company_id = $1 and module_code = 'sales'", [company]);
    await expect(db.asUser(owner, (q) => q("select public.change_plan($1, 'starter')", [company]))).rejects.toThrow(
      "The Starter plan allows 1 branch, and you have 2. Archive some branches first.",
    );
    await db.admin.query("update public.branches set archived_at = now() where company_id = $1 and code = 'BYO'", [company]);
  });

  it("downgrades once the company fits, with no new invoice", async () => {
    const before = (await invoices()).length;
    await commitAs(owner, (q) => q("select public.change_plan($1, 'starter')", [company]));
    expect((await status()).plan_code).toBe("starter");
    expect(await invoices()).toHaveLength(before);
  });

  it("is still possible when the company is read-only", async () => {
    await db.admin.query("update public.companies set status = 'read_only' where id = $1", [company]);
    await commitAs(owner, (q) => q("select public.change_plan($1, 'business')", [company]));
    expect((await status()).plan_code).toBe("business");
  });
});
