import { timingSafeEqual } from "node:crypto";
import { createAdapters } from "@/server/adapters";
import { getPool } from "@/server/db";
import { createHandlers } from "@/server/events/handlers";
import { PgDeliveryStore, processDeliveries } from "@/server/events/worker";

// Scheduler entry point: raise due-activity events, then drain each
// subscriber's queue. Called every minute by the host's scheduler (Vercel Cron
// now, an Azure timer later) with "Authorization: Bearer <CRON_SECRET>".

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  const db = getPool();
  const adapters = createAdapters();
  const store = new PgDeliveryStore(db);

  const { rows } = await db.query<{ n: number }>("select app.emit_due_activities() as n");
  const results = [];
  for (const [subscriber, handler] of Object.entries(createHandlers({ db, adapters }))) {
    results.push(await processDeliveries(store, subscriber, handler));
  }
  return Response.json({ dueActivities: rows[0]?.n ?? 0, results, adaptersOnFakes: adapters.missing });
}
