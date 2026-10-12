import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Field, PageHeader } from "@/components/ui";
import { currencyLabel, formatDate, formatQuantity, money, todayIso } from "@/lib/format";
import { one } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { canRunReport, findReport, reportRange, totalsByCurrency, type ReportColumn, type ReportRow } from "@/server/reports";

// P10: one report with its date filter, totals and CSV download.

function Cell({ col, row }: { col: ReportColumn; row: ReportRow }) {
  const v = row[col.key];
  if (v === null || v === undefined || v === "") return <>—</>;
  switch (col.kind) {
    case "money":
      return <>{money(String(v), String(row.currency ?? "USD"))}</>;
    case "date":
      return <>{formatDate(String(v))}</>;
    case "quantity":
      return <>{formatQuantity(String(v))}</>;
    case "percent":
      return <>{(Number(v) / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%</>;
    case "count":
      return <>{Number(v).toLocaleString("en-GB")}</>;
    default:
      return <>{col.key === "currency" ? currencyLabel(String(v)) : String(v)}</>;
  }
}

const numeric = (c: ReportColumn) => c.kind !== "text" && c.kind !== "date";

export default async function ReportPage({ params, searchParams }: PageProps<"/e/[slug]/reports/[report]">) {
  const { slug, report } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "reports.view");
  const def = findReport(report);
  if (!def || !canRunReport(def, ctx.permissions)) notFound();

  const range = reportRange({ from: one(sp, "from"), to: one(sp, "to") }, todayIso());
  const rows = await withUser(ctx.userId, (q) => def.run(q, ctx.company.id, range, ctx.company.baseCurrency));
  const totals = def.totals && rows.length > 1 ? totalsByCurrency(def, rows) : [];
  const query = new URLSearchParams(def.dates === "range" ? { from: range.from, to: range.to } : def.dates === "asAt" ? { to: range.to } : {}).toString();
  const canExport = canRunReport(def, ctx.permissions, "export");
  const firstNumeric = def.columns.findIndex(numeric);

  return (
    <>
      <PageHeader
        title={def.title}
        description={def.description}
        actions={
          canExport ? (
            <a
              href={`/reports/export/${def.key}${query ? `?${query}` : ""}`}
              className="inline-flex items-center rounded-[var(--radius,0.5rem)] border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-900"
              download
            >
              Download CSV (Excel)
            </a>
          ) : null
        }
      />
      <p className="mb-3 text-sm">
        <Link href="/reports" className="underline">
          All reports
        </Link>
      </p>
      {def.dates !== "none" ? (
        <form method="get" action={`/reports/${def.key}`} className="mb-4 flex flex-wrap items-end gap-2">
          {def.dates === "range" ? <Field label="From" name="from" type="date" defaultValue={range.from} /> : null}
          <Field label={def.dates === "asAt" ? "As at" : "To"} name="to" type="date" defaultValue={range.to} />
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      ) : (
        <p className="mb-4 text-sm text-zinc-500">As things stand now.</p>
      )}
      <div className="overflow-x-auto rounded-[var(--radius,0.5rem)] border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr>
              {def.columns.map((c) => (
                <th key={c.key} className={`px-4 py-2 font-semibold whitespace-nowrap ${numeric(c) ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={def.columns.length} className="px-4 py-8 text-center text-zinc-500">
                  Nothing for these dates.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i}>
                  {def.columns.map((c) => (
                    <td key={c.key} className={`px-4 py-2 ${numeric(c) ? "text-right tabular-nums whitespace-nowrap" : ""}`}>
                      <Cell col={c} row={row} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {totals.length ? (
            <tfoot className="border-t-2 border-zinc-300 font-semibold dark:border-zinc-700">
              {totals.map((t) => (
                <tr key={String(t.currency)}>
                  {def.columns.map((c, i) => (
                    <td key={c.key} className={`px-4 py-2 ${numeric(c) ? "text-right tabular-nums whitespace-nowrap" : ""}`}>
                      {i === 0 && firstNumeric !== 0 ? "Total" : c.kind === "money" || c.kind === "count" || c.key === "currency" ? <Cell col={c} row={t} /> : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500">{rows.length} row{rows.length === 1 ? "" : "s"}. Only submitted documents are included.</p>
    </>
  );
}
