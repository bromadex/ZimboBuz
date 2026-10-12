import { csvFileName, toCsv } from "@/lib/csv";
import { todayIso } from "@/lib/format";
import { lookupCompany } from "@/server/company";
import { withUser } from "@/server/data";
import { canRunReport, csvValue, findReport, reportRange } from "@/server/reports";

// P10/P11: CSV download of a report, at erp.<slug>.<domain>/reports/export/<key>.
// Checks the session and reports.export (allowed in read-only mode, so a
// lapsed company can always take its data), then runs the same query as the
// screen as the signed-in user, so hidden fields stay hidden (P17).

const deny = (status: number, message: string) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function GET(request: Request, ctx: RouteContext<"/e/[slug]/reports/export/[report]">) {
  const { slug, report } = await ctx.params;
  const company = await lookupCompany(slug);
  if (company.kind !== "ok") return deny(401, "Please sign in.");
  if (company.twoStep.required && !company.twoStep.enabled) return deny(403, "Please set up two-step sign-in first.");
  const def = findReport(report);
  if (!def) return deny(404, "No such report.");
  if (!canRunReport(def, company.permissions, "export")) return deny(403, "You do not have permission to export this report.");

  const sp = new URL(request.url).searchParams;
  const range = reportRange({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined }, todayIso());
  const rows = await withUser(company.userId, (q) => def.run(q, company.company.id, range, company.company.baseCurrency));
  const body = toCsv(
    def.columns.map((c) => c.label),
    rows.map((row) => def.columns.map((c) => csvValue(c, row))),
  );
  const name = csvFileName(company.company.slug, def.key, ...(def.dates === "range" ? [range.from, "to", range.to] : def.dates === "asAt" ? ["at", range.to] : [todayIso()]));
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
