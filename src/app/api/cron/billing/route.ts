import { runBilling } from "@/server/billing";
import { cronAuthorised } from "@/server/cron";
import { harareDate } from "@/server/daily-summary";
import { getPool } from "@/server/db";

// P11: daily billing run (issue monthly invoices, catch missed Paynow
// notifications, move overdue companies to grace / read-only / suspended).
// Call daily with "Authorization: Bearer <CRON_SECRET>". ?on=YYYY-MM-DD runs
// it as of another day (for support staff and tests).

export async function GET(request: Request) {
  if (!cronAuthorised(request)) return Response.json({ error: "unauthorised" }, { status: 401 });
  const on = new URL(request.url).searchParams.get("on");
  if (on && !/^\d{4}-\d{2}-\d{2}$/.test(on)) return Response.json({ error: "on must be YYYY-MM-DD" }, { status: 400 });
  return Response.json(await runBilling(getPool(), on ?? harareDate(new Date())));
}
