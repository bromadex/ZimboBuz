import Link from "next/link";
import { Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/company";
import { canRunReport, REPORTS } from "@/server/reports";

// P10: the list of reports this user may run.

export default async function ReportsPage({ params, searchParams }: PageProps<"/e/[slug]/reports">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "reports.view");
  const reports = REPORTS.filter((r) => canRunReport(r, ctx.permissions));

  return (
    <>
      <PageHeader
        title="Reports"
        description={ctx.permissions.has("reports.export") ? "Pick a report, choose dates, and download it for Excel if you need to." : "Pick a report and choose dates."}
      />
      <Notice error={sp.error} success={sp.success} />
      {reports.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {reports.map((r) => (
            <li key={r.key}>
              <Link
                href={`/reports/${r.key}`}
                className="block h-full rounded-[var(--radius,0.5rem)] border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-[var(--brand,#0b6e4f)] dark:border-zinc-800 dark:bg-zinc-900"
              >
                <p className="font-semibold">{r.title}</p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{r.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">Your role does not include any reports yet.</p>
      )}
    </>
  );
}
