import "server-only";
import type { CompanyContext } from "@/server/company";
import { withUser, type Query } from "@/server/data";

// Loading quotes and invoices for the sales screens.

export interface DocHeader {
  id: string;
  number: string | null;
  docstatus: number;
  customer_id: string;
  customer_name: string;
  currency: string;
  doc_date: string;
  second_date: string | null; // valid until / due date
  notes: string | null;
  subtotal_cents: string;
  tax_cents: string;
  total_cents: string;
  cancel_reason: string | null;
  amended_from: string | null;
  exchange_rate: string | null;
  quote_id: string | null;
  lead_id: string | null;
  paid_cents: string | null;
  balance_cents: string | null;
  payment_status: string | null;
  submitted_at: Date | null;
  branch_name: string;
}

export interface DocLine {
  id: string;
  line_no: number;
  product_id: string | null;
  sku: string | null;
  description: string;
  quantity: string;
  unit_price_cents: string;
  discount_cents: string;
  tax_code: string;
  tax_rate_bp: number;
  net_cents: string;
  tax_cents: string;
  total_cents: string;
}

export async function loadDocument(q: Query, ctx: CompanyContext, kind: "quote" | "invoice", id: string) {
  const header =
    kind === "quote"
      ? (
          await q<DocHeader>(
            `select d.id, d.number, d.docstatus, d.customer_id, c.name as customer_name, d.currency,
                    to_char(d.quote_date, 'YYYY-MM-DD') as doc_date, to_char(d.valid_until, 'YYYY-MM-DD') as second_date,
                    d.notes, d.subtotal_cents, d.tax_cents, d.total_cents, d.cancel_reason, d.amended_from,
                    null as exchange_rate, null as quote_id, d.lead_id, null as paid_cents, null as balance_cents,
                    null as payment_status, d.submitted_at, b.name as branch_name
             from public.quotes d join public.customers c on c.id = d.customer_id join public.branches b on b.id = d.branch_id
             where d.company_id = $1 and d.id = $2`,
            [ctx.company.id, id],
          )
        ).rows[0]
      : (
          await q<DocHeader>(
            `select d.id, d.number, d.docstatus, d.customer_id, c.name as customer_name, d.currency,
                    to_char(d.invoice_date, 'YYYY-MM-DD') as doc_date, to_char(d.due_date, 'YYYY-MM-DD') as second_date,
                    d.notes, d.subtotal_cents, d.tax_cents, d.total_cents, d.cancel_reason, d.amended_from,
                    d.exchange_rate, d.quote_id, null as lead_id, d.paid_cents, d.balance_cents, d.payment_status,
                    d.submitted_at, b.name as branch_name
             from public.sales_invoices_v d join public.customers c on c.id = d.customer_id join public.branches b on b.id = d.branch_id
             where d.company_id = $1 and d.id = $2`,
            [ctx.company.id, id],
          )
        ).rows[0];
  if (!header) return null;
  const linesTable = kind === "quote" ? "quote_lines" : "sales_invoice_lines";
  const parent = kind === "quote" ? "quote_id" : "invoice_id";
  const lines = (
    await q<DocLine>(
      `select l.id, l.line_no, l.product_id, p.sku, l.description, l.quantity, l.unit_price_cents, l.discount_cents,
              l.tax_code, l.tax_rate_bp, l.net_cents, l.tax_cents, l.total_cents
       from public.${linesTable} l left join public.products p on p.id = l.product_id
       where l.${parent} = $1 order by l.line_no, l.id`,
      [id],
    )
  ).rows;
  return { header, lines };
}

export async function loadPickers(ctx: CompanyContext) {
  return withUser(ctx.userId, async (q) => {
    const customers = ctx.permissions.has("core.customers.view")
      ? (
          await q<{ id: string; name: string; currency: string }>(
            "select id, name, currency from public.customers where company_id = $1 and archived_at is null order by name limit 2000",
            [ctx.company.id],
          )
        ).rows
      : [];
    const products = (
      await q<{ id: string; sku: string; name: string }>(
        "select id, sku, name from public.products where company_id = $1 and archived_at is null order by name limit 2000",
        [ctx.company.id],
      )
    ).rows;
    const branches = (
      await q<{ id: string; name: string }>(
        "select id, name from public.branches where company_id = $1 and archived_at is null order by is_head_office desc, name",
        [ctx.company.id],
      )
    ).rows;
    return { customers, products, branches };
  });
}
