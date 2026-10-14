import type { Db } from "../harness";

// Rows for portal invoice payments (20261014110000_portal_invoice_payments).
export async function seed(db: Db, company: string, branch: string) {
  const q = async (sql: string, params: unknown[]) => (await db.admin.query(sql, params)).rows[0];
  const customer = (await q("insert into public.customers (company_id, name) values ($1, 'Portal payer') returning id", [company])).id;
  const invoice = (
    await q("insert into public.sales_invoices (company_id, branch_id, customer_id, currency) values ($1, $2, $3, 'USD') returning id", [company, branch, customer])
  ).id;
  await q(
    "insert into public.invoice_payment_links (company_id, invoice_id, customer_id, currency, amount_cents, reference) values ($1, $2, $3, 'USD', 100, 'INV-PAY-SEED')",
    [company, invoice, customer],
  );
}
