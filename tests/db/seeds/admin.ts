import type { Db } from "../harness";

// Administration and billing tables (supabase/migrations/20261012140000_admin.sql,
// 20261012141000_billing.sql) for the isolation suite.

export async function seed(db: Db, companyId: string): Promise<void> {
  await db.admin.query(
    `insert into public.company_preferences (company_id, daily_summary_enabled, daily_summary_phones)
     values ($1, true, '{0771234567}') on conflict (company_id) do nothing`,
    [companyId],
  );
  await db.admin.query(
    "insert into public.daily_summary_runs (company_id, summary_date, status, body) values ($1, current_date, 'sent', 'Summary')",
    [companyId],
  );
  await db.admin.query(
    `insert into public.subscription_invoices (company_id, number, period_start, period_end, plan_code, description, amount_cents, due_on)
     values ($1::uuid, 'ZIM-TEST-' || left($1::text, 8), date_trunc('month', current_date), date_trunc('month', current_date) + interval '1 month - 1 day',
             'business', 'Business plan', 2900, current_date + 7)`,
    [companyId],
  );
}
