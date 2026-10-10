import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const SHIM = join(ROOT, "supabase", "tests", "supabase_shim.sql");

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres@localhost:54329/postgres";

export type Db = {
  /** Superuser client: bypasses RLS, used to arrange test data. */
  admin: pg.Client;
  /** Run `fn` as a signed-in user (role `authenticated`), rolled back afterwards. */
  asUser<T>(userId: string, fn: (q: Query) => Promise<T>): Promise<T>;
  /** Run `fn` as the background worker role (`service_role`) and commit. */
  asService<T>(fn: (q: Query) => Promise<T>): Promise<T>;
  /** Create an auth user and return its id. */
  createUser(email?: string): Promise<string>;
  close(): Promise<void>;
};

export type Query = <R extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
) => Promise<pg.QueryResult<R>>;

/** Creates a fresh database, applies the shim and every migration in order. */
export async function createTestDb(): Promise<Db> {
  const name = `zimerp_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const bootstrap = new pg.Client({ connectionString: adminUrl });
  await bootstrap.connect();
  await bootstrap.query(`create database ${name}`);
  await bootstrap.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();

  await admin.query(readFileSync(SHIM, "utf8"));
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await admin.query(readFileSync(join(MIGRATIONS, file), "utf8"));
  }

  return {
    admin,
    async asUser(userId, fn) {
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      try {
        await client.query("begin");
        await client.query("set local role authenticated");
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
        return await fn((sql, params) => client.query(sql, params));
      } finally {
        await client.query("rollback").catch(() => {});
        await client.end();
      }
    },
    async asService(fn) {
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      try {
        await client.query("begin");
        await client.query("set local role service_role");
        const result = await fn((sql, params) => client.query(sql, params));
        await client.query("commit");
        return result;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        await client.end();
      }
    },
    async createUser(email) {
      const id = randomUUID();
      await admin.query("insert into auth.users (id, email) values ($1, $2)", [
        id,
        email ?? `${id}@test.local`,
      ]);
      return id;
    },
    async close() {
      await admin.end();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${name} with (force)`);
      await cleanup.end();
    },
  };
}

/**
 * Signs `userId` up as owner of a new company (committed, so later
 * transactions can see it) and returns the company id.
 */
export async function createCompanyAs(
  db: Db,
  userId: string,
  opts: { name?: string; slug?: string; plan?: string; modules?: string[] } = {},
): Promise<string> {
  const slug = opts.slug ?? `co-${randomUUID().slice(0, 8)}`;
  await db.admin.query("begin");
  try {
    await db.admin.query("set local role authenticated");
    await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const { rows } = await db.admin.query<{ id: string }>(
      "select public.create_company($1, $2, $3, $4) as id",
      [opts.name ?? slug, slug, opts.plan ?? "business", opts.modules ?? ["pos", "sales", "inventory"]],
    );
    await db.admin.query("commit");
    return rows[0].id;
  } catch (e) {
    await db.admin.query("rollback");
    throw e;
  }
}

/** Adds an existing user to a company with a system role (as superuser). */
export async function addMember(
  db: Db,
  companyId: string,
  userId: string,
  roleCode: string,
  userType: "full" | "light" = "full",
): Promise<void> {
  await db.admin.query(
    `insert into public.memberships (company_id, user_id, role_id, user_type)
     select $1, $2, r.id, $4 from public.roles r where r.company_id = $1 and r.code = $3`,
    [companyId, userId, roleCode, userType],
  );
}
