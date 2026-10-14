import { Badge, Button, Card, Notice, PageHeader, SelectField, TextArea } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requirePermission } from "@/server/company";
import { collectSummary, harareDate, summaryText } from "@/server/daily-summary";
import { withUser } from "@/server/data";
import { getPool } from "@/server/db";
import { saveSummarySettings, sendTestSummary } from "./actions";

// P10: the daily WhatsApp summary of sales, money received, what customers
// owe and low stock, sent to the numbers the owner chooses.

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: new Date(Date.UTC(2026, 0, 1, h)).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }),
}));

const RUN_TONE = { sent: "ok", failed: "warn", sending: "info" } as const;

export default async function NotificationsPage({ params, searchParams }: PageProps<"/e/[slug]/settings/notifications">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "admin.company.edit");

  const { prefs, runs } = await withUser(ctx.userId, async (q) => ({
    prefs: (
      await q<{ daily_summary_enabled: boolean; daily_summary_phones: string[]; daily_summary_hour: number }>(
        "select daily_summary_enabled, daily_summary_phones, daily_summary_hour from public.company_preferences where company_id = $1",
        [ctx.company.id],
      )
    ).rows[0],
    runs: (
      await q<{ summary_date: Date; status: "sent" | "failed" | "sending"; recipients: number; error: string | null }>(
        "select summary_date, status, recipients, error from public.daily_summary_runs where company_id = $1 order by summary_date desc limit 7",
        [ctx.company.id],
      )
    ).rows,
  }));
  // Permission checked above; the preview reads this company's figures as the server.
  // Sales figures only for people who may see sales.
  const canSeeFigures = ctx.permissions.has("sales.view") || ctx.permissions.has("reports.view");
  const preview = canSeeFigures ? summaryText(await collectSummary(getPool(), ctx.company.id, harareDate(new Date()))) : null;

  return (
    <>
      <PageHeader title="Notifications" description="A short WhatsApp message at the end of each day with how the business did." />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Daily WhatsApp summary">
          <form action={saveSummarySettings.bind(null, slug)} className="space-y-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="enabled" defaultChecked={prefs?.daily_summary_enabled ?? false} className="size-4 accent-[var(--brand,#0b6e4f)]" />
              Send me a summary every day
            </label>
            <TextArea
              label="WhatsApp numbers"
              name="phones"
              defaultValue={(prefs?.daily_summary_phones ?? []).join("\n")}
              placeholder={"077 123 4567"}
              hint="One per line, up to 5. Zimbabwean numbers can start with 0."
            />
            <SelectField label="Send at (Harare time)" name="hour" defaultValue={String(prefs?.daily_summary_hour ?? 18)} options={HOURS} />
            <Button type="submit">Save</Button>
          </form>
          {prefs?.daily_summary_phones.length ? (
            <form action={sendTestSummary.bind(null, slug)} className="mt-3">
              <Button type="submit" variant="secondary">
                Send a test now
              </Button>
            </form>
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card title="Today's message so far">
            {preview ? (
              <pre className="whitespace-pre-wrap break-words rounded-[var(--radius,0.5rem)] bg-emerald-50 p-3 font-sans text-sm text-zinc-800 dark:bg-emerald-950 dark:text-zinc-100">
                {preview}
              </pre>
            ) : (
              <p className="text-sm text-zinc-500">The message includes sales figures, which your role does not show.</p>
            )}
          </Card>
          <Card title="Recently sent">
            {runs.length ? (
              <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                {runs.map((r) => (
                  <li key={String(r.summary_date)} className="flex items-center justify-between gap-2 py-2">
                    <span>{formatDate(r.summary_date)}</span>
                    <span className="flex items-center gap-2">
                      {r.status === "sent" ? `${r.recipients} number${r.recipients === 1 ? "" : "s"}` : r.error ?? ""}
                      <Badge tone={RUN_TONE[r.status]}>{r.status === "sent" ? "Sent" : r.status === "failed" ? "Failed" : "Sending"}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Nothing sent yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
