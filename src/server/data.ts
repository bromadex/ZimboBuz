import "server-only";
import type pg from "pg";
import { getPool } from "./db";

// Database access on behalf of a signed-in user. Every query runs inside a
// transaction as the `authenticated` role with the user's id as the JWT
// subject, exactly as Supabase does, so row-level security and app.can()
// apply. Works on Supabase, Azure PostgreSQL and on-premise installs.

export type Query = <R extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
) => Promise<pg.QueryResult<R>>;

export async function withUser<T>(userId: string, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await fn((sql, params) => client.query(sql, params));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Plain-English message for errors raised by database rules. */
export function friendlyError(error: unknown): string {
  const e = error as { code?: string; message?: string; constraint?: string };
  if (e?.code === "23505") {
    if (e.constraint?.includes("email")) return "Someone with that email address already exists.";
    if (e.constraint?.includes("phone")) return "Someone with that phone number already exists.";
    if (e.constraint?.includes("slug")) return "That web address is already taken. Please choose another.";
    if (e.constraint?.includes("sku")) return "A product with that code already exists.";
    return "That already exists.";
  }
  if (e?.code === "42501") return "You do not have permission to do that.";
  if (e?.code === "23514" || e?.code === "P0001" || e?.code === "22023" || e?.code === "P0002") {
    if (e.constraint === "companies_slug_not_reserved") return "That web address is reserved. Please choose another.";
    if (e.constraint?.startsWith("companies_slug")) return "Web addresses use lower-case letters, numbers and hyphens only.";
    const limit = /^plan (\w+) allows (\d+) (modules|branches|full users)$/.exec(e.message ?? "");
    if (limit) {
      const plan = limit[1].charAt(0).toUpperCase() + limit[1].slice(1);
      const singular: Record<string, string> = { modules: "module", branches: "branch", "full users": "full user" };
      const what = limit[2] === "1" ? singular[limit[3]] : limit[3];
      return `The ${plan} plan allows up to ${limit[2]} ${what}. Switch something off or upgrade your plan.`;
    }
    const missing = /^module (\w+) is not available on plan (\w+)$/.exec(e.message ?? "");
    if (missing) return "That module is not included in your plan. Upgrade your plan to use it.";
    if (e.message?.startsWith("no exchange rate set for")) return `Set an exchange rate for ${e.message.slice(25)} first.`;
    if (e.message === "the base currency always has rate 1") return "Your base currency always has a rate of 1.";
    return e.message ?? "That is not allowed.";
  }
  if (e?.code === "22P02" || e?.code === "22003") return "Please check the numbers you entered.";
  if (e?.message?.includes("row-level security")) return "You do not have permission to do that.";
  return "Something went wrong. Please try again.";
}
