import { getAdapters } from "@/server/adapters/shared";
import { cronAuthorised } from "@/server/cron";
import { sendDueSummaries } from "@/server/daily-summary";
import { getPool } from "@/server/db";

// P10: sends each company's daily WhatsApp summary once its chosen hour has
// come (Harare time). Call every 15 minutes or hourly with
// "Authorization: Bearer <CRON_SECRET>"; each company gets one per day.

export async function GET(request: Request) {
  if (!cronAuthorised(request)) return Response.json({ error: "unauthorised" }, { status: 401 });
  const adapters = getAdapters();
  const results = await sendDueSummaries(getPool(), adapters.messaging);
  return Response.json({ results, messenger: adapters.messaging.name });
}
