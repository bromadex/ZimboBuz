import "server-only";
import { getPool } from "./db";

// Names for user ids. auth.users is not readable by signed-in users (as on
// Supabase), so the server looks them up; callers only pass ids they already
// received through row-level security.

export async function userEmails(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const { rows } = await getPool().query<{ id: string; email: string }>(
    "select id, email from auth.users where id = any($1::uuid[])",
    [unique],
  );
  return new Map(rows.map((r) => [r.id, r.email]));
}

/** Active colleagues in a company (for assigning activities). */
export async function companyMembers(companyId: string): Promise<Array<{ id: string; email: string }>> {
  const { rows } = await getPool().query<{ id: string; email: string }>(
    `select u.id, u.email from public.memberships m join auth.users u on u.id = m.user_id
     where m.company_id = $1 and m.status = 'active' order by u.email`,
    [companyId],
  );
  return rows;
}
