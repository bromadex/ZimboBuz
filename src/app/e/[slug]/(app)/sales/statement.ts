import "server-only";
import type { CompanyContext } from "@/server/company";
import { withUser } from "@/server/data";
import { todayIso } from "@/lib/format";

export interface StatementLine {
  entry_date: string | null;
  kind: "opening" | "invoice" | "payment" | "advance";
  reference: string | null;
  document_id: string | null;
  debit_cents: string;
  credit_cents: string;
  balance_cents: string;
}

/** Reads ?currency=&from=&to= and loads the statement (defaults: customer's currency, last 3 months). */
export async function loadStatement(ctx: CompanyContext, customerId: string, sp: Record<string, string | string[] | undefined>) {
  const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const to = iso(sp.to) ?? todayIso();
  const from = iso(sp.from) ?? (() => {
    const d = new Date(`${to}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 3);
    return d.toISOString().slice(0, 10);
  })();
  return withUser(ctx.userId, async (q) => {
    const customer = (
      await q<{ id: string; name: string; company_name: string | null; email: string | null; phone: string | null; currency: string }>(
        "select id, name, company_name, email, phone, currency from public.customers where company_id = $1 and id = $2",
        [ctx.company.id, customerId],
      )
    ).rows[0];
    if (!customer) return null;
    const currency = typeof sp.currency === "string" && ["USD", "ZWG", "ZAR"].includes(sp.currency) ? sp.currency : customer.currency.trim();
    const lines = (
      await q<StatementLine>(
        `select to_char(entry_date, 'YYYY-MM-DD') as entry_date, kind, reference, document_id, debit_cents, credit_cents, balance_cents
         from public.customer_statement($1, $2, $3, $4, $5)`,
        [ctx.company.id, customerId, currency, from, to],
      )
    ).rows;
    return { customer, currency, from, to, lines };
  });
}

export const KIND_LABEL: Record<string, string> = { opening: "Balance brought forward", invoice: "Invoice", payment: "Payment", advance: "Paid in advance" };
