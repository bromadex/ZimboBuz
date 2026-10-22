// Offline sync, server side (issue #24): device register, exactly-once
// application of queued operations, permissions and rules enforced, remote wipe.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

let db: Db;
let owner: string;
let cashier: string;
let company: string;
let other: string;
let hq: string;
const till = "till-0001-abcdef";

type Outcome = { status: string; result: { id?: string; number?: string } | null; error: string | null; duplicate: boolean };

/** Runs as `user` and commits, like a device sync request. */
const asUserCommit = async <T,>(user: string, sql: string, params: unknown[]): Promise<T> => {
  await db.admin.query("begin");
  try {
    await db.admin.query("set local role authenticated");
    await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    const r = (await db.admin.query(sql, params)).rows[0];
    await db.admin.query("commit");
    return r as T;
  } catch (e) {
    await db.admin.query("rollback");
    throw e;
  }
};

const apply = (user: string, op: { id?: string; type: string; target: string; payload: unknown; device?: string; company?: string }) =>
  asUserCommit<{ r: Outcome }>(user, "select public.apply_offline_operation($1, $2, $3, $4, $5, $6) as r", [
    op.company ?? company,
    op.device ?? till,
    op.id ?? randomUUID(),
    op.type,
    op.target,
    JSON.stringify(op.payload),
  ]).then((x) => x.r);

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  cashier = await db.createUser();
  company = await createCompanyAs(db, owner, { plan: "pro", modules: ["pos", "sales", "inventory"] });
  other = await createCompanyAs(db, await db.createUser(), { plan: "pro", modules: ["pos"] });
  await addMember(db, company, cashier, "cashier");
  hq = (await db.admin.query("select id from public.branches where company_id = $1", [company])).rows[0].id;
  await asUserCommit(cashier, "select public.register_device($1, $2, $3, 'Front till', 'android')", [company, hq, till]);
});

afterAll(async () => {
  await db?.close();
});

describe("devices", () => {
  it("reports each device's sync status", async () => {
    const status = (user: string, device: string) =>
      asUserCommit<{ s: string }>(user, "select public.device_status($1, $2) as s", [company, device]).then((r) => r.s);
    expect(await status(cashier, till)).toBe("ok");
    expect(await status(cashier, "unknown-device-1")).toBe("unregistered");
    expect(await status(await db.createUser(), till)).toBe("denied");
  });
});

describe("applying queued operations", () => {
  it("applies an operation exactly once, even when the upload is retried", async () => {
    const opId = randomUUID();
    const payload = { name: "Walk-in Tafadzwa", phone: "0712 345 678" };
    const first = await apply(cashier, { id: opId, type: "insert", target: "customers", payload });
    const again = await apply(cashier, { id: opId, type: "insert", target: "customers", payload });
    expect(first.status).toBe("applied");
    expect(again).toMatchObject({ status: "applied", duplicate: true, result: first.result });
    const { rows } = await db.admin.query("select count(*)::int as n from public.customers where name = 'Walk-in Tafadzwa'");
    expect(rows[0].n).toBe(1);
  });

  it("always writes into the device's company, whatever the payload says", async () => {
    const r = await apply(cashier, { type: "insert", target: "customers", payload: { name: "Sneaky", company_id: other } });
    const { rows } = await db.admin.query("select company_id from public.customers where id = $1", [r.result?.id]);
    expect(rows[0].company_id).toBe(company);
  });

  it("records refusals from permissions with the reason, without failing the sync", async () => {
    const loc = (await db.admin.query("select id from public.stock_locations where branch_id = $1", [hq])).rows[0].id;
    const prod = (await db.admin.query("insert into public.products (company_id, sku, name) values ($1, 'X1', 'X') returning id", [company])).rows[0].id;
    const r = await apply(cashier, {
      type: "insert",
      target: "stock_movements",
      payload: { branch_id: hq, movement_type: "receipt", product_id: prod, to_location_id: loc, quantity: 5, unit_cost: 100 },
    });
    expect(r.status).toBe("rejected");
    expect(r.error).toMatch(/row-level security/);
    const { rows } = await db.admin.query("select status, error from public.offline_operations where status = 'rejected'");
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("creates and submits documents offline, and reports business-rule refusals", async () => {
    const cust = (await apply(owner, { type: "insert", target: "customers", payload: { name: "Offline buyer" } })).result!.id;
    await asUserCommit(owner, "select public.register_device($1, $2, 'owner-phone-01', 'Owner phone', 'ios')", [company, hq]);
    const ownerOp = (type: string, target: string, payload: unknown) =>
      apply(owner, { type, target, payload, device: "owner-phone-01" });

    const inv = (await ownerOp("insert", "sales_invoices", { branch_id: hq, customer_id: cust, currency: "USD" })).result!.id!;
    await ownerOp("insert", "sales_invoice_lines", { invoice_id: inv, description: "Labour", quantity: 1, unit_price_cents: 5000 });
    const submitted = await ownerOp("submit", "sales_invoices", { id: inv });
    expect(submitted.status).toBe("applied");
    expect(submitted.result?.number).toMatch(/^INV-HQ-/);

    const prod = (await db.admin.query("insert into public.products (company_id, sku, name) values ($1, 'OUT', 'Out of stock') returning id", [company])).rows[0].id;
    const inv2 = (await ownerOp("insert", "sales_invoices", { branch_id: hq, customer_id: cust, currency: "USD" })).result!.id!;
    await ownerOp("insert", "sales_invoice_lines", { invoice_id: inv2, product_id: prod, quantity: 1, unit_price_cents: 100 });
    const refused = await ownerOp("submit", "sales_invoices", { id: inv2 });
    expect(refused).toMatchObject({ status: "rejected" });
    expect(refused.error).toMatch(/not enough stock/);
  });

  it("refuses targets that are not allowed offline", async () => {
    const r = await apply(cashier, { type: "insert", target: "companies", payload: { name: "x" } });
    expect(r).toMatchObject({ status: "rejected" });
    expect(r.error).toMatch(/not supported/);
  });

  it("refuses unregistered devices and other companies", async () => {
    await expect(apply(cashier, { type: "insert", target: "customers", payload: { name: "A" }, device: "not-registered" })).rejects.toThrow(
      /cannot sync/,
    );
    await expect(apply(cashier, { type: "insert", target: "customers", payload: { name: "A" }, company: other })).rejects.toThrow(
      /cannot sync/,
    );
  });

  it("does not let clients write the outcome log themselves", async () => {
    await expect(
      asUserCommit(cashier, "select public.log_offline_operation($1, $2, 'forged-op-1', 'insert', 'customers', '{}', 'applied', null, null)", [
        company,
        till,
      ]),
    ).rejects.toThrow(/not allowed/);
    await expect(db.admin.query("update public.offline_operations set status = 'applied'")).rejects.toThrow(/cannot be changed/);
  });
});

describe("lost devices", () => {
  it("lets admins revoke and wipe a device, which then cannot sync", async () => {
    const device = (await db.admin.query("select id from public.devices where device_id = $1", [till])).rows[0].id;
    await expect(asUserCommit(cashier, "select public.revoke_device($1)", [device])).rejects.toThrow(/not allowed/);
    await asUserCommit(owner, "select public.revoke_device($1)", [device]);
    expect((await asUserCommit<{ s: string }>(cashier, "select public.device_status($1, $2) as s", [company, till])).s).toBe("wipe");
    await expect(apply(cashier, { type: "insert", target: "customers", payload: { name: "B" } })).rejects.toThrow(/cannot sync/);
    await expect(
      asUserCommit(cashier, "select public.register_device($1, $2, $3, 'Again', 'android')", [company, hq, till]),
    ).rejects.toThrow(/revoked/);
  });
});
