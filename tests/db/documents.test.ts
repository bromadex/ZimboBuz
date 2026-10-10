// Shared document model (issue #26): lifecycle and locking, numbering, offline
// number blocks, activity panel, connections and restricted fields.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompanyAs, createTestDb, type Db } from "./harness";

let db: Db;
let owner: string;
let cashier: string;
let storekeeper: string;
let company: string;
let otherCompany: string;
let hq: string;

beforeAll(async () => {
  db = await createTestDb();
  owner = await db.createUser();
  cashier = await db.createUser();
  storekeeper = await db.createUser();
  company = await createCompanyAs(db, owner, { plan: "pro", modules: ["pos", "sales", "inventory"] });
  otherCompany = await createCompanyAs(db, await db.createUser(), { plan: "pro", modules: ["sales"] });
  await addMember(db, company, cashier, "cashier");
  await addMember(db, company, storekeeper, "storekeeper");
  hq = (await db.admin.query("select id from public.branches where company_id = $1 and code = 'HQ'", [company]))
    .rows[0].id;

  // A stand-in submittable document table, set up the way real migrations will.
  await db.admin.query(`
    create table public.test_documents (
      id           uuid primary key default gen_random_uuid(),
      company_id   uuid not null references public.companies(id),
      customer_id  uuid,
      title        text not null,
      amount_cents bigint not null default 0,
      updated_at   timestamptz not null default now()
    );
    select app.enable_document_lifecycle('public.test_documents', 'quote');
    alter table public.test_documents enable row level security;
    create policy r on public.test_documents for select to authenticated using (app.can(company_id, 'sales.view'));
    create policy w on public.test_documents for insert to authenticated with check (app.can(company_id, 'sales.quote.create'));
    create policy u on public.test_documents for update to authenticated
      using (app.can(company_id, 'sales.quote.create')) with check (app.can(company_id, 'sales.quote.create'));
    grant select, insert, update on public.test_documents to authenticated;
  `);
});

afterAll(async () => {
  await db?.close();
});

const nextNumber = (branch = hq, on = "2026-10-11") =>
  db.admin
    .query<{ n: string }>("select app.next_document_number($1, 'quote', $2, $3::date) as n", [company, branch, on])
    .then((r) => r.rows[0].n);

describe("naming series", () => {
  it("numbers documents per type, branch and year", async () => {
    expect(await nextNumber()).toBe("QUO-HQ-2026-0001");
    expect(await nextNumber()).toBe("QUO-HQ-2026-0002");
    expect(await nextNumber(hq, "2027-01-02")).toBe("QUO-HQ-2027-0001");

    const byo = (
      await db.admin.query(
        "insert into public.branches (company_id, code, name) values ($1, 'BYO', 'Bulawayo') returning id",
        [company],
      )
    ).rows[0].id;
    expect(await nextNumber(byo)).toBe("QUO-BYO-2026-0001");
  });

  it("never hands out the same number twice under concurrency", async () => {
    const url = (db.admin as unknown as { connectionParameters: pg.ClientConfig }).connectionParameters;
    const numbers = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const c = new pg.Client(url);
        await c.connect();
        try {
          return (await c.query("select app.next_document_number($1, 'quote', $2) as n", [company, hq])).rows[0].n;
        } finally {
          await c.end();
        }
      }),
    );
    expect(new Set(numbers).size).toBe(20);
  });

  it("refuses document types that are not numbered", async () => {
    await expect(
      db.admin.query("select app.next_document_number($1, 'customer', $2)", [company, hq]),
    ).rejects.toThrow(/not numbered/);
  });

  it("gives offline devices non-overlapping blocks that later numbers skip", async () => {
    const block = (device: string, user = owner) =>
      db.asUser(user, async (q) =>
        (
          await q<{ prefix: string; branch_code: string; first_value: string; last_value: string }>(
            "select * from public.allocate_number_block($1, 'quote', $2, $3, 50)",
            [company, hq, device],
          )
        ).rows[0],
      );
    // asUser rolls back, so allocate inside a committed transaction instead.
    await db.admin.query("begin");
    await db.admin.query("set local role authenticated");
    await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [owner]);
    const a = (await db.admin.query("select * from public.allocate_number_block($1, 'quote', $2, 'till-1', 50)", [company, hq])).rows[0];
    const b = (await db.admin.query("select * from public.allocate_number_block($1, 'quote', $2, 'till-2', 50)", [company, hq])).rows[0];
    await db.admin.query("commit");

    expect(a.prefix).toBe("QUO");
    expect(Number(b.first_value)).toBe(Number(a.last_value) + 1);
    const next = await nextNumber(hq, new Date().toISOString().slice(0, 10));
    expect(Number(next.slice(-4))).toBe(Number(b.last_value) + 1);

    await expect(block("till-3", await db.createUser())).rejects.toThrow(/not allowed/);
    // Storekeepers can't create quotes, so they can't reserve quote numbers either.
    await expect(block("till-4", storekeeper)).rejects.toThrow(/not allowed/);
  });
});

describe("document lifecycle", () => {
  const asOwner = <T,>(fn: Parameters<Db["asUser"]>[1]) => db.asUser(owner, fn) as Promise<T>;

  it("allows editing drafts freely", async () => {
    await asOwner(async (q) => {
      const { rows } = await q("insert into public.test_documents (company_id, title) values ($1, 'Draft') returning id", [company]);
      const r = await q("update public.test_documents set title = 'Edited', amount_cents = 500 where id = $1", [rows[0].id]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("refuses creating documents that are already submitted", async () => {
    await expect(
      asOwner((q) => q("insert into public.test_documents (company_id, title, docstatus) values ($1, 'X', 1)", [company])),
    ).rejects.toThrow(/created as drafts/);
  });

  it("locks submitted documents, records the timeline and emits events", async () => {
    await asOwner(async (q) => {
      const id = (await q("insert into public.test_documents (company_id, title) values ($1, 'Q') returning id", [company])).rows[0].id;
      await q("update public.test_documents set docstatus = 1 where id = $1", [id]);

      const doc = (await q("select submitted_at, submitted_by from public.test_documents where id = $1", [id])).rows[0];
      expect(doc.submitted_by).toBe(owner);
      expect(doc.submitted_at).not.toBeNull();

      const timeline = (await q("select kind, body from public.record_messages where record_id = $1", [id])).rows;
      expect(timeline).toEqual([{ kind: "system", body: "Submitted" }]);

      const events = (
        await q(
          `select e.event_type, array_agg(d.subscriber order by d.subscriber) as subs
           from public.events e join public.event_deliveries d on d.event_id = e.id
           where e.aggregate_id = $1 group by e.event_type`,
          [id.toString()],
        )
      ).rows;
      expect(events).toEqual([{ event_type: "document.submitted", subs: ["webhooks"] }]);

      await expect(q("update public.test_documents set amount_cents = 1 where id = $1", [id])).rejects.toThrow(/locked/);
    });
  });

  it("requires a reason to cancel, then freezes the document", async () => {
    await asOwner(async (q) => {
      const id = (await q("insert into public.test_documents (company_id, title) values ($1, 'Q') returning id", [company])).rows[0].id;
      await q("update public.test_documents set docstatus = 1 where id = $1", [id]);
      await q("savepoint s");
      await expect(q("update public.test_documents set docstatus = 2 where id = $1", [id])).rejects.toThrow(/reason is required/);
      await q("rollback to savepoint s");
      await q("update public.test_documents set docstatus = 2, cancel_reason = 'Customer changed order' where id = $1", [id]);
      const doc = (await q("select cancelled_by from public.test_documents where id = $1", [id])).rows[0];
      expect(doc.cancelled_by).toBe(owner);
      await expect(q("update public.test_documents set docstatus = 1 where id = $1", [id])).rejects.toThrow(/cannot be changed/);
    });
  });

  it("refuses submitted-to-draft and draft-to-cancelled shortcuts", async () => {
    await asOwner(async (q) => {
      const id = (await q("insert into public.test_documents (company_id, title) values ($1, 'Q') returning id", [company])).rows[0].id;
      await q("savepoint s");
      await expect(q("update public.test_documents set docstatus = 2, cancel_reason = 'x' where id = $1", [id])).rejects.toThrow(
        /archive them instead/,
      );
      await q("rollback to savepoint s");
      await q("update public.test_documents set docstatus = 1 where id = $1", [id]);
      await expect(q("update public.test_documents set docstatus = 0 where id = $1", [id])).rejects.toThrow(/locked/);
    });
  });

  it("supports amending: a new draft linked to the cancelled original", async () => {
    await asOwner(async (q) => {
      const id = (await q("insert into public.test_documents (company_id, title) values ($1, 'Q') returning id", [company])).rows[0].id;
      await q("update public.test_documents set docstatus = 1 where id = $1", [id]);
      await q("update public.test_documents set docstatus = 2, cancel_reason = 'Wrong price' where id = $1", [id]);
      const amended = await q(
        "insert into public.test_documents (company_id, title, amended_from) values ($1, 'Q (amended)', $2) returning docstatus",
        [company, id],
      );
      expect(amended.rows[0].docstatus).toBe(0);
    });
  });
});

describe("activity panel", () => {
  const customer = randomUUID();

  it("lets viewers post notes but not system lines", async () => {
    await db.asUser(owner, async (q) => {
      await q(
        "insert into public.record_messages (company_id, doctype, record_id, kind, body, author_id) values ($1, 'customer', $2, 'note', 'Prefers WhatsApp', $3)",
        [company, customer, owner],
      );
      await expect(
        q(
          "insert into public.record_messages (company_id, doctype, record_id, kind, body, author_id) values ($1, 'customer', $2, 'system', 'Fake', $3)",
          [company, customer, owner],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("hides a record's timeline from users who cannot view that record type", async () => {
    await db.admin.query(
      "insert into public.record_messages (company_id, doctype, record_id, kind, body, author_id) values ($1, 'customer', $2, 'note', 'Secret', $3)",
      [company, customer, owner],
    );
    const seen = (user: string) =>
      db.asUser(user, async (q) => (await q("select count(*)::int as n from public.record_messages where record_id = $1", [customer])).rows[0].n);
    expect(await seen(owner)).toBe(1);
    expect(await seen(storekeeper)).toBe(0);
  });

  it("keeps messages permanent", async () => {
    await expect(db.admin.query("delete from public.record_messages")).rejects.toThrow(/cannot be changed/);
  });

  it("schedules activities only for colleagues and lets the assignee complete them", async () => {
    await db.asUser(owner, async (q) => {
      const stranger = await db.createUser();
      await expect(
        q(
          "insert into public.record_activities (company_id, doctype, record_id, activity_type, summary, due_on, assigned_to) values ($1, 'customer', $2, 'call', 'Follow up', current_date, $3)",
          [company, customer, stranger],
        ),
      ).rejects.toThrow(/row-level security/);
    });

    const id = (
      await db.admin.query(
        "insert into public.record_activities (company_id, doctype, record_id, activity_type, summary, due_on, assigned_to, created_by) values ($1, 'customer', $2, 'call', 'Call about balance', current_date, $3, $4) returning id",
        [company, customer, cashier, owner],
      )
    ).rows[0].id;

    await db.asUser(cashier, async (q) => {
      await q("update public.record_activities set status = 'done' where id = $1", [id]);
      expect((await q("select done_at from public.record_activities where id = $1", [id])).rows[0].done_at).not.toBeNull();
      await expect(
        q("update public.record_activities set record_id = gen_random_uuid() where id = $1", [id]),
      ).rejects.toThrow(/cannot be moved/);
    });
  });

  it("raises activity.due once for due activities", async () => {
    await db.admin.query(
      "insert into public.record_activities (company_id, doctype, record_id, activity_type, summary, due_on, assigned_to, created_by) values ($1, 'customer', $2, 'todo', 'Send statement', current_date - 1, $3, $3)",
      [company, customer, owner],
    );
    const run = () => db.asService(async (q) => (await q("select app.emit_due_activities() as n")).rows[0].n as number);
    expect(await run()).toBeGreaterThanOrEqual(1);
    expect(await run()).toBe(0);
    const { rows } = await db.admin.query(
      `select d.subscriber from public.events e join public.event_deliveries d on d.event_id = e.id
       where e.event_type = 'activity.due' and e.payload->>'summary' = 'Send statement'`,
    );
    expect(rows.map((r) => r.subscriber)).toEqual(["notifications"]);
  });
});

describe("connections", () => {
  it("counts linked records the user may see, skipping tables not built yet", async () => {
    const customer = (
      await db.admin.query("insert into public.customers (company_id, name) values ($1, 'Tendai') returning id", [company])
    ).rows[0].id;
    for (let i = 0; i < 2; i++) {
      await db.admin.query(
        "insert into public.quotes (company_id, branch_id, customer_id, currency) values ($1, $2, $3, 'USD')",
        [company, hq, customer],
      );
    }
    const links = await db.asUser(owner, async (q) =>
      (await q("select doctype, label, record_count::int as n from public.record_connections($1, 'customer', $2)", [company, customer])).rows,
    );
    expect(links).toContainEqual({ doctype: "quote", label: "Quotes", n: 2 });
    expect(links).toContainEqual({ doctype: "sales_invoice", label: "Invoices", n: 0 });
    // customers -> pos_sales is registered, but that table is not built yet
    expect(links.find((l) => l.doctype === "pos_sale")).toBeUndefined();

    const strangerView = await db.asUser(await db.createUser(), async (q) =>
      (await q("select record_count::int as n from public.record_connections($1, 'customer', $2) where doctype = 'quote'", [company, customer])).rows,
    );
    expect(strangerView).toEqual([{ n: 0 }]);
  });
});

describe("restricted fields", () => {
  const sees = (user: string, doctype: string, column: string) =>
    db.asUser(user, async (q) => (await q("select app.can_see_field($1, $2, $3) as ok", [company, doctype, column])).rows[0].ok);

  it("hides cost prices from cashiers but not from owners", async () => {
    expect(await sees(owner, "product", "avg_cost")).toBe(true);
    expect(await sees(cashier, "product", "avg_cost")).toBe(false);
  });

  it("shows unrestricted fields to members only", async () => {
    expect(await sees(cashier, "product", "name")).toBe(true);
    expect(await sees(await db.createUser(), "product", "name")).toBe(false);
  });
});
