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
  await seedTillChange(db, company, branch, user);
}

// till_change (20261014090000): a change-in-another-currency record.
export async function seedTillChange(db: Db, company: string, branch: string, user: string) {
  const session = (await db.admin.query("select id from public.till_sessions where company_id = $1 limit 1", [company])).rows[0].id;
  const customer = (await db.admin.query("insert into public.customers (company_id, name) values ($1, 'Till change') returning id", [company])).rows[0].id;
  const invoice = (
    await db.admin.query("insert into public.sales_invoices (company_id, branch_id, customer_id, currency) values ($1, $2, $3, 'USD') returning id", [company, branch, customer])
  ).rows[0].id;
  await db.admin.query(
    `insert into public.till_change (company_id, till_session_id, invoice_id, kept_currency, kept_cents, change_currency, change_cents)
     values ($1, $2, $3, 'USD', 100, 'ZWG', 2675)`,
    [company, session, invoice],
  );
  void user;
}
