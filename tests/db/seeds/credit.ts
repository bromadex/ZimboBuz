import type { Db } from "../harness";

// Rows for credit notes and refunds (20261014100000_credit_notes_refunds).
export async function seed(db: Db, company: string, branch: string) {
  const q = async (sql: string, params: unknown[]) => (await db.admin.query(sql, params)).rows[0];
  const customer = (await q("insert into public.customers (company_id, name) values ($1, 'Credit seed') returning id", [company])).id;
  const invoice = (
    await q("insert into public.sales_invoices (company_id, branch_id, customer_id, currency) values ($1, $2, $3, 'USD') returning id", [company, branch, customer])
  ).id;
  const line = (
    await q("insert into public.sales_invoice_lines (company_id, invoice_id, description, quantity, unit_price_cents) values ($1, $2, 'Work', 1, 1000) returning id", [company, invoice])
  ).id;
  const note = (
    await q(
      `insert into public.credit_notes (company_id, branch_id, customer_id, invoice_id, currency, exchange_rate, tax_date, reason)
       values ($1, $2, $3, $4, 'USD', 1, current_date, 'Seed') returning id`,
      [company, branch, customer, invoice],
    )
  ).id;
  await q(
    "insert into public.credit_note_lines (company_id, credit_note_id, invoice_line_id, description, quantity, unit_price_cents) values ($1, $2, $3, 'Work', 1, 1000)",
    [company, note, line],
  );
  await q("insert into public.refunds (company_id, branch_id, customer_id, currency, amount_cents, method) values ($1, $2, $3, 'USD', 100, 'cash')", [
    company,
    branch,
    customer,
  ]);
}
