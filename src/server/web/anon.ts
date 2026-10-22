import "server-only";
import type { Query } from "../data";
import { getPool } from "../db";

// Database access for anonymous website visitors: queries run as the `anon`
// role, exactly as on Supabase, so only the functions granted to anon (the
// public site_* functions and submit_website_enquiry) can be used.

export async function withAnon<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local role anon");
    await client.query("select set_config('request.jwt.claim.sub', '', true)");
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
