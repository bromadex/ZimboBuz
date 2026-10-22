import { money } from "@/lib/format";
import type { Messenger } from "./adapters/messaging";
import type { Queryable } from "./db";

// P10: the daily WhatsApp summary for owners. Figures are read by the server
// for one company at a time (explicit company scoping, no user session) and
// sent through the messaging adapter. One summary per company per day.

export interface SummaryFacts {
  companyName: string;
  date: string; // YYYY-MM-DD
  sales: Array<{ currency: string; count: number; totalCents: string }>;
  payments: Array<{ currency: string; totalCents: string }>;
  owed: Array<{ currency: string; totalCents: string }>;
  lowStock: number;
}

const TZ = "Africa/Harare";

export function harareDate(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function harareHour(now: Date): number {
  return Number(now.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }));
}

const list = (items: Array<{ currency: string; totalCents: string }>) => items.map((i) => money(i.totalCents, i.currency)).join(" + ");

/** The message text: short, plain English, fits a phone screen. */
export function summaryText(f: SummaryFacts): string {
  const day = new Date(`${f.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const invoices = f.sales.reduce((n, s) => n + s.count, 0);
  const lines = [
    `${f.companyName}: summary for ${day}`,
    invoices ? `Sales: ${list(f.sales)} (${invoices} invoice${invoices === 1 ? "" : "s"})` : "Sales: none today",
    f.payments.length ? `Money received: ${list(f.payments)}` : "Money received: none today",
    f.owed.length ? `Customers owe you: ${list(f.owed)}` : "Customers owe you nothing",
  ];
  if (f.lowStock > 0) lines.push(`${f.lowStock} product${f.lowStock === 1 ? " is" : "s are"} low on stock`);
  lines.push("Change these messages in ZimERP under Settings, Notifications.");
  return lines.join("\n");
}

export async function collectSummary(db: Queryable, companyId: string, date: string): Promise<SummaryFacts> {
  const name = (await db.query<{ name: string }>("select name from public.companies where id = $1", [companyId])).rows[0]?.name ?? "";
  const sales = (
    await db.query<{ currency: string; count: number; total: string }>(
      `select trim(currency) as currency, count(*)::int as count, sum(total_cents)::text as total
       from public.sales_invoices where company_id = $1 and docstatus = 1 and invoice_date = $2::date
       group by 1 order by 1`,
      [companyId, date],
    )
  ).rows;
  const payments = (
    await db.query<{ currency: string; total: string }>(
      `select trim(currency) as currency, sum(amount_cents)::text as total
       from public.payments where company_id = $1 and docstatus = 1 and received_on = $2::date
       group by 1 order by 1`,
      [companyId, date],
    )
  ).rows;
  const owed = (
    await db.query<{ currency: string; total: string }>(
      `select trim(i.currency) as currency, sum(i.total_cents - app.invoice_paid_cents(i.id))::text as total
       from public.sales_invoices i where i.company_id = $1 and i.docstatus = 1
       group by 1 having sum(i.total_cents - app.invoice_paid_cents(i.id)) > 0 order by 1`,
      [companyId],
    )
  ).rows;
  const lowStock = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from public.products p
       where p.company_id = $1 and p.archived_at is null and p.is_stock_item and p.reorder_level is not null
         and coalesce((select sum(l.quantity) from public.stock_levels l where l.product_id = p.id), 0) <= p.reorder_level`,
      [companyId],
    )
  ).rows[0].n;
  return {
    companyName: name,
    date,
    sales: sales.map((s) => ({ currency: s.currency, count: s.count, totalCents: s.total })),
    payments: payments.map((p) => ({ currency: p.currency, totalCents: p.total })),
    owed: owed.map((o) => ({ currency: o.currency, totalCents: o.total })),
    lowStock,
  };
}

export interface SummaryRun {
  companyId: string;
  status: "sent" | "failed";
  recipients: number;
  error?: string;
}

/**
 * Sends today's summary to every company whose chosen hour has come and that
 * has not had one today. Claims each company-day first, so overlapping runs
 * never send twice; a failed send may be retried by a later run.
 */
export async function sendDueSummaries(db: Queryable, messenger: Messenger, now = new Date()): Promise<SummaryRun[]> {
  const date = harareDate(now);
  const hour = harareHour(now);
  const due = (
    await db.query<{ company_id: string; phones: string[] }>(
      `select p.company_id, p.daily_summary_phones as phones
       from public.company_preferences p join public.companies c on c.id = p.company_id
       where p.daily_summary_enabled and cardinality(p.daily_summary_phones) > 0 and p.daily_summary_hour <= $1
         and c.archived_at is null and c.status <> 'suspended'
         and not exists (select 1 from public.daily_summary_runs r
                         where r.company_id = p.company_id and r.summary_date = $2::date and r.status <> 'failed')`,
      [hour, date],
    )
  ).rows;

  const results: SummaryRun[] = [];
  for (const { company_id: companyId, phones } of due) {
    const claimed = await db.query(
      `insert into public.daily_summary_runs (company_id, summary_date, status) values ($1, $2::date, 'sending')
       on conflict (company_id, summary_date) do update set status = 'sending', error = null
         where daily_summary_runs.status = 'failed'
       returning 1`,
      [companyId, date],
    );
    if (!claimed.rowCount) continue; // another run has it
    let body = "";
    try {
      body = summaryText(await collectSummary(db, companyId, date));
      for (const to of phones) await messenger.sendText({ to, text: body });
      await db.query("update public.daily_summary_runs set status = 'sent', recipients = $3, body = $4 where company_id = $1 and summary_date = $2::date", [
        companyId,
        date,
        phones.length,
        body,
      ]);
      results.push({ companyId, status: "sent", recipients: phones.length });
    } catch (e) {
      const error = e instanceof Error ? e.message.slice(0, 500) : "send failed";
      await db.query("update public.daily_summary_runs set status = 'failed', error = $3, body = $4 where company_id = $1 and summary_date = $2::date", [
        companyId,
        date,
        error,
        body || null,
      ]);
      results.push({ companyId, status: "failed", recipients: 0, error });
    }
  }
  return results;
}
