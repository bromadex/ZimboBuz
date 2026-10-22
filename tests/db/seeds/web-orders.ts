import type { Db } from "../harness";

// Rows for online orders (20261012115000_web_orders).
export async function seed(db: Db, company: string, branch: string) {
  const customer = (await db.admin.query("insert into public.customers (company_id, name) values ($1, 'Web buyer') returning id", [company])).rows[0].id;
  const invoice = (
    await db.admin.query("insert into public.sales_invoices (company_id, branch_id, customer_id, currency) values ($1, $2, $3, 'USD') returning id", [company, branch, customer])
  ).rows[0].id;
  await db.admin.query(
    "insert into public.web_orders (company_id, customer_id, invoice_id, currency, total_cents, reference) values ($1, $2, $3, 'USD', 100, 'WEB-SEED')",
    [company, customer, invoice],
  );
}
