import type { Query } from "./data";

// P10 reports. Each report is one query run as the signed-in user (so
// row-level security and hidden fields apply exactly as on screen), shown as
// a table and exported as CSV from the same definition, so the two always
// match. Money is kept in minor units with its currency.

export type CellKind = "text" | "date" | "count" | "quantity" | "money" | "percent";

export interface ReportColumn {
  key: string;
  label: string;
  kind: CellKind;
}

export type ReportRow = Record<string, string | number | null>;

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
}

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  /** Permissions needed besides reports.view (all of them). */
  needs: string[];
  /** "range": from and to; "asAt": one date; "none": current position. */
  dates: "range" | "asAt" | "none";
  columns: ReportColumn[];
  /** Money columns are summed per currency in a totals row. */
  totals: boolean;
  run(q: Query, companyId: string, range: DateRange, baseCurrency: string): Promise<ReportRow[]>;
}

const money = (key: string, label: string): ReportColumn => ({ key, label, kind: "money" });
const currency: ReportColumn = { key: "currency", label: "Currency", kind: "text" };

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  ecocash: "EcoCash",
  onemoney: "OneMoney",
  innbucks: "InnBucks",
  card: "Card",
  bank_transfer: "Bank transfer",
  zipit: "ZIPIT",
  store_credit: "Store credit",
  other: "Other",
};
const TAX_LABEL: Record<string, string> = { standard: "Standard", zero_rated: "Zero-rated", exempt: "Exempt" };

export const REPORTS: ReportDef[] = [
  {
    key: "sales-by-day",
    title: "Sales by day",
    description: "Submitted invoices per day and currency, before and after VAT.",
    needs: ["sales.view"],
    dates: "range",
    totals: true,
    columns: [
      { key: "day", label: "Date", kind: "date" },
      currency,
      { key: "invoices", label: "Invoices", kind: "count" },
      money("net", "Before VAT"),
      money("tax", "VAT"),
      money("total", "Total"),
    ],
    run: async (q, companyId, r) =>
      (
        await q<ReportRow>(
          `select invoice_date::text as day, trim(currency) as currency, count(*)::int as invoices,
                  sum(subtotal_cents)::text as net, sum(tax_cents)::text as tax, sum(total_cents)::text as total
           from public.sales_invoices
           where company_id = $1 and docstatus = 1 and invoice_date between $2::date and $3::date
           group by 1, 2 order by 1, 2`,
          [companyId, r.from, r.to],
        )
      ).rows,
  },
  {
    key: "sales-by-product",
    title: "Sales by product",
    description: "What sold, how many and for how much, on submitted invoices.",
    needs: ["sales.view"],
    dates: "range",
    totals: true,
    columns: [
      { key: "sku", label: "Code", kind: "text" },
      { key: "product", label: "Product", kind: "text" },
      currency,
      { key: "quantity", label: "Quantity", kind: "quantity" },
      money("net", "Before VAT"),
      money("total", "Total"),
    ],
    run: async (q, companyId, r) =>
      (
        await q<ReportRow>(
          `select coalesce(p.sku, '') as sku, coalesce(p.name, l.description) as product, trim(i.currency) as currency,
                  sum(l.quantity)::text as quantity, sum(l.net_cents)::text as net, sum(l.total_cents)::text as total
           from public.sales_invoice_lines l
           join public.sales_invoices i on i.id = l.invoice_id
           left join public.products p on p.id = l.product_id
           where i.company_id = $1 and i.docstatus = 1 and i.invoice_date between $2::date and $3::date
           group by 1, 2, 3 order by sum(l.total_cents) desc, 2`,
          [companyId, r.from, r.to],
        )
      ).rows,
  },
  {
    key: "payments-by-method",
    title: "Payments by method",
    description: "Money received on submitted payments, by how customers paid.",
    needs: ["sales.view"],
    dates: "range",
    totals: true,
    columns: [{ key: "method", label: "Method", kind: "text" }, currency, { key: "payments", label: "Payments", kind: "count" }, money("total", "Received")],
    run: async (q, companyId, r) =>
      (
        await q<ReportRow>(
          `select method, trim(currency) as currency, count(*)::int as payments, sum(amount_cents)::text as total
           from public.payments
           where company_id = $1 and docstatus = 1 and received_on between $2::date and $3::date
           group by 1, 2 order by sum(amount_cents) desc`,
          [companyId, r.from, r.to],
        )
      ).rows.map((row) => ({ ...row, method: METHOD_LABEL[String(row.method)] ?? row.method })),
  },
  {
    key: "debtors-ageing",
    title: "Debtors ageing",
    description: "What each customer owes, by how long it has been due (from the due date, or the invoice date when there is none).",
    needs: ["sales.view"],
    dates: "asAt",
    totals: true,
    columns: [
      { key: "customer", label: "Customer", kind: "text" },
      currency,
      money("d0_30", "Up to 30 days"),
      money("d31_60", "31–60 days"),
      money("d61_90", "61–90 days"),
      money("d90", "Over 90 days"),
      money("total", "Total owed"),
    ],
    run: async (q, companyId, r) =>
      (
        await q<ReportRow>(
          `with open as (
             select i.customer_id, trim(i.currency) as currency, i.balance_cents as bal,
                    $2::date - coalesce(i.due_date, i.invoice_date) as age
             from public.sales_invoices_v i
             where i.company_id = $1 and i.docstatus = 1 and i.invoice_date <= $2::date and i.balance_cents > 0)
           select coalesce(c.name, 'Customer') as customer, o.currency,
                  coalesce(sum(o.bal) filter (where o.age <= 30), 0)::text as d0_30,
                  coalesce(sum(o.bal) filter (where o.age between 31 and 60), 0)::text as d31_60,
                  coalesce(sum(o.bal) filter (where o.age between 61 and 90), 0)::text as d61_90,
                  coalesce(sum(o.bal) filter (where o.age > 90), 0)::text as d90,
                  sum(o.bal)::text as total
           from open o left join public.customers c on c.id = o.customer_id
           group by o.customer_id, c.name, o.currency
           order by sum(o.bal) desc`,
          [companyId, r.to],
        )
      ).rows,
  },
  {
    key: "stock-valuation",
    title: "Stock valuation",
    description: "Stock on hand at weighted-average cost, in your base currency.",
    needs: ["inventory.view", "core.products.view_cost"],
    dates: "none",
    totals: true,
    columns: [
      { key: "sku", label: "Code", kind: "text" },
      { key: "product", label: "Product", kind: "text" },
      { key: "quantity", label: "On hand", kind: "quantity" },
      currency,
      money("unit_cost", "Average cost"),
      money("value", "Value"),
    ],
    run: async (q, companyId, _r, base) =>
      (
        await q<ReportRow>(
          `select p.sku, p.name as product, coalesce(sum(l.quantity), 0)::text as quantity, $2::text as currency,
                  round(p.avg_cost)::text as unit_cost, round(coalesce(sum(l.quantity), 0) * p.avg_cost)::text as value
           from public.products_v p left join public.stock_levels l on l.product_id = p.id
           where p.company_id = $1 and p.is_stock_item and p.archived_at is null and p.avg_cost is not null
           group by p.id, p.sku, p.name, p.avg_cost
           order by round(coalesce(sum(l.quantity), 0) * p.avg_cost) desc, p.name`,
          [companyId, base],
        )
      ).rows,
  },
  {
    key: "vat-summary",
    title: "VAT summary",
    description: "Output VAT on submitted invoices, by rate. Use it to prepare your VAT return.",
    needs: ["sales.view"],
    dates: "range",
    totals: true,
    columns: [
      { key: "tax_code", label: "VAT type", kind: "text" },
      { key: "rate", label: "Rate", kind: "percent" },
      currency,
      money("net", "Sales before VAT"),
      money("tax", "Output VAT"),
      money("total", "Sales with VAT"),
    ],
    run: async (q, companyId, r) =>
      (
        await q<ReportRow>(
          `select l.tax_code, l.tax_rate_bp as rate, trim(i.currency) as currency,
                  sum(l.net_cents)::text as net, sum(l.tax_cents)::text as tax, sum(l.total_cents)::text as total
           from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
           where i.company_id = $1 and i.docstatus = 1 and i.invoice_date between $2::date and $3::date
           group by 1, 2, 3 order by 3, 2 desc, 1`,
          [companyId, r.from, r.to],
        )
      ).rows.map((row) => ({ ...row, tax_code: TAX_LABEL[String(row.tax_code)] ?? row.tax_code })),
  },
];

export function findReport(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}

export function canRunReport(def: ReportDef, permissions: Set<string>, action: "view" | "export" = "view"): boolean {
  return permissions.has(action === "view" ? "reports.view" : "reports.export") && permissions.has("reports.view") && def.needs.every((p) => permissions.has(p));
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: string | undefined): s is string {
  return !!s && ISO.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

/** Date range from the address, defaulting to this month so far. Never more than five years. */
export function reportRange(sp: { from?: string; to?: string }, today: string): DateRange {
  const to = validDate(sp.to) ? sp.to : today;
  const from = validDate(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  if (from > to) return { from: to, to: from };
  const earliest = `${Number(to.slice(0, 4)) - 5}${to.slice(4)}`;
  return { from: from < earliest ? earliest : from, to };
}

/** Minor units as a plain decimal ("-1250" → "-12.50"), for CSV. */
export function centsToDecimal(cents: string | number | null): string {
  if (cents === null || cents === "") return "";
  const v = BigInt(cents);
  const neg = v < BigInt(0);
  const abs = neg ? -v : v;
  return `${neg ? "-" : ""}${abs / BigInt(100)}.${(abs % BigInt(100)).toString().padStart(2, "0")}`;
}

/** Sum of each money column per currency, for the totals rows. */
export function totalsByCurrency(def: ReportDef, rows: ReportRow[]): ReportRow[] {
  const moneyCols = def.columns.filter((c) => c.kind === "money").map((c) => c.key);
  const countCols = def.columns.filter((c) => c.kind === "count").map((c) => c.key);
  const byCurrency = new Map<string, ReportRow>();
  for (const row of rows) {
    const cur = String(row.currency ?? "");
    const t = byCurrency.get(cur) ?? { currency: cur };
    for (const k of moneyCols) t[k] = (BigInt(String(t[k] ?? 0)) + BigInt(String(row[k] ?? 0))).toString();
    for (const k of countCols) t[k] = Number(t[k] ?? 0) + Number(row[k] ?? 0);
    byCurrency.set(cur, t);
  }
  return [...byCurrency.values()];
}

/** A cell for CSV: money as decimals, rates as percentages, the rest as is. */
export function csvValue(col: ReportColumn, row: ReportRow): string | number | null {
  const v = row[col.key];
  if (v === null || v === undefined) return null;
  if (col.kind === "money") return centsToDecimal(v);
  if (col.kind === "percent") return (Number(v) / 100).toString();
  if (col.kind === "quantity") return Number(v).toString();
  return v;
}
