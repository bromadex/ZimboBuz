import type { Query } from "./data";

// P10: the owner dashboard's figures, read as the signed-in user so each tile
// only shows what their role may see. Dates are Zimbabwe dates (YYYY-MM-DD).

export interface DashboardDates {
  today: string;
  weekStart: string; // Monday
  monthStart: string;
  chartStart: string; // 13 days before today
}

export function dashboardDates(today: string): DashboardDates {
  const d = new Date(`${today}T12:00:00Z`);
  const shift = (days: number) => new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const weekday = (d.getUTCDay() + 6) % 7; // Monday = 0
  return { today, weekStart: shift(-weekday), monthStart: `${today.slice(0, 7)}-01`, chartStart: shift(-13) };
}

export interface SalesTotals {
  currency: string;
  today: string;
  todayCount: number;
  week: string;
  month: string;
}

export interface Dashboard {
  sales: SalesTotals[] | null;
  paymentsToday: Array<{ method: string; currency: string; total: string }> | null;
  owed: Array<{ currency: string; total: string; overdue: string }> | null;
  lowStock: number | null;
  topProducts: Array<{ name: string; quantity: string; base: string }> | null;
  daily: Array<{ day: string; base: string }> | null;
  activities: Array<{ id: string; doctype: string; record_id: string; activity_type: string; summary: string; due_on: string }>;
}

export async function loadDashboard(q: Query, companyId: string, userId: string, permissions: Set<string>, dates: DashboardDates): Promise<Dashboard> {
  const sales = permissions.has("sales.view");
  const stock = permissions.has("inventory.view") && permissions.has("core.products.view");
  const d = dates;

  return {
    sales: sales
      ? (
          await q<SalesTotals>(
            `select trim(currency) as currency,
                    coalesce(sum(total_cents) filter (where invoice_date = $2::date), 0)::text as today,
                    count(*) filter (where invoice_date = $2::date)::int as "todayCount",
                    coalesce(sum(total_cents) filter (where invoice_date >= $3::date), 0)::text as week,
                    coalesce(sum(total_cents) filter (where invoice_date >= $4::date), 0)::text as month
             from public.sales_invoices
             where company_id = $1 and docstatus = 1 and invoice_date between least($3::date, $4::date) and $2::date
             group by 1 order by 1`,
            [companyId, d.today, d.weekStart, d.monthStart],
          )
        ).rows
      : null,
    paymentsToday: sales
      ? (
          await q<{ method: string; currency: string; total: string }>(
            `select method, trim(currency) as currency, sum(amount_cents)::text as total
             from public.payments where company_id = $1 and docstatus = 1 and received_on = $2::date
             group by 1, 2 order by sum(amount_cents) desc`,
            [companyId, d.today],
          )
        ).rows
      : null,
    owed: sales
      ? (
          await q<{ currency: string; total: string; overdue: string }>(
            `select trim(currency) as currency, sum(balance_cents)::text as total,
                    coalesce(sum(balance_cents) filter (where coalesce(due_date, invoice_date) < $2::date), 0)::text as overdue
             from public.sales_invoices_v where company_id = $1 and docstatus = 1 and balance_cents > 0
             group by 1 order by 1`,
            [companyId, d.today],
          )
        ).rows
      : null,
    lowStock: stock
      ? (
          await q<{ n: number }>(
            `select count(*)::int as n from public.products p
             where p.company_id = $1 and p.archived_at is null and p.is_stock_item and p.reorder_level is not null
               and coalesce((select sum(l.quantity) from public.stock_levels l where l.product_id = p.id), 0) <= p.reorder_level`,
            [companyId],
          )
        ).rows[0].n
      : null,
    topProducts: sales
      ? (
          await q<{ name: string; quantity: string; base: string }>(
            `select coalesce(p.name, l.description) as name, sum(l.quantity)::text as quantity,
                    sum(app.to_base(l.total_cents, i.exchange_rate))::text as base
             from public.sales_invoice_lines l
             join public.sales_invoices i on i.id = l.invoice_id
             left join public.products p on p.id = l.product_id
             where i.company_id = $1 and i.docstatus = 1 and i.invoice_date between $2::date and $3::date
             group by coalesce(l.product_id::text, l.description), 1
             order by sum(app.to_base(l.total_cents, i.exchange_rate)) desc limit 5`,
            [companyId, d.monthStart, d.today],
          )
        ).rows
      : null,
    daily: sales
      ? (
          await q<{ day: string; base: string }>(
            `select g.day::date::text as day,
                    coalesce((select sum(app.to_base(i.total_cents, i.exchange_rate)) from public.sales_invoices i
                              where i.company_id = $1 and i.docstatus = 1 and i.invoice_date = g.day::date), 0)::text as base
             from generate_series($2::date, $3::date, interval '1 day') as g(day) order by 1`,
            [companyId, d.chartStart, d.today],
          )
        ).rows
      : null,
    activities: (
      await q<{ id: string; doctype: string; record_id: string; activity_type: string; summary: string; due_on: string }>(
        `select id, doctype, record_id::text, activity_type, summary, due_on::text
         from public.record_activities
         where company_id = $1 and assigned_to = $2 and status = 'open'
         order by due_on, created_at limit 8`,
        [companyId, userId],
      )
    ).rows,
  };
}
