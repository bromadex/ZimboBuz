import type { Db } from "../harness";

// Rows for the point-of-sale tables (20261012110000_point_of_sale).
export async function seed(db: Db, company: string, branch: string, user: string) {
  const session = (
    await db.admin.query(
      `insert into public.till_sessions (company_id, branch_id, opened_by, opening_float) values ($1, $2, $3, '{"USD": 1000}') returning id`,
      [company, branch, user],
    )
  ).rows[0].id;
  await db.admin.query(
    `insert into public.payment_gateway_accounts (company_id, gateway, currency, integration_id, integration_key_enc)
     values ($1, 'paynow', 'USD', '1234', 'encrypted')`,
    [company],
  );
  await db.admin.query(
    `insert into public.payment_requests (company_id, till_session_id, gateway, method, currency, amount_cents, phone, reference, created_by)
     values ($1, $2, 'paynow', 'ecocash', 'USD', 500, '0771234567', 'REQ-1', $3)`,
    [company, session, user],
  );
}
