import pg from "pg";

// Server-side PostgreSQL access for trusted jobs (event workers, schedulers).
// Request handlers acting for a user go through Supabase with the user's
// session so row-level security applies; this pool bypasses it and must only
// be used by code that does its own company scoping.

export type Queryable = Pick<pg.Pool, "query">;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({ connectionString, max: 5 });
  }
  return pool;
}
