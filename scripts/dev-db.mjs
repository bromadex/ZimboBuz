// Prepares a local development database: the Supabase stand-in (auth schema
// and roles) and every migration not yet applied. Safe to run repeatedly.
//
//   DATABASE_URL=postgres://postgres@localhost:54329/zimerp_dev npm run db:dev
//
// Not for Supabase or production: those apply migrations with the Supabase CLI.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const root = join(import.meta.dirname, "..");
const url = new URL(process.env.DATABASE_URL ?? "postgres://postgres@localhost:54329/zimerp_dev");
const name = url.pathname.slice(1);
if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unexpected database name "${name}"`);

const server = new URL(url);
server.pathname = "/postgres";
const bootstrap = new pg.Client({ connectionString: server.toString() });
await bootstrap.connect();
const exists = await bootstrap.query("select 1 from pg_database where datname = $1", [name]);
if (!exists.rowCount) {
  await bootstrap.query(`create database ${name}`);
  console.log(`created database ${name}`);
}
await bootstrap.end();

const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
await db.query(readFileSync(join(root, "supabase", "tests", "supabase_shim.sql"), "utf8"));
await db.query(`create schema if not exists zimerp_dev;
                create table if not exists zimerp_dev.applied_migrations (file text primary key, applied_at timestamptz not null default now())`);
const applied = new Set((await db.query("select file from zimerp_dev.applied_migrations")).rows.map((r) => r.file));
const dir = join(root, "supabase", "migrations");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  await db.query("begin");
  try {
    await db.query(readFileSync(join(dir, file), "utf8"));
    await db.query("insert into zimerp_dev.applied_migrations (file) values ($1)", [file]);
    await db.query("commit");
    console.log(`applied ${file}`);
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
await db.end();
console.log("development database is up to date");
