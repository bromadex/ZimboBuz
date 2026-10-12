import { timingSafeEqual } from "node:crypto";

/** Scheduler requests carry "Authorization: Bearer <CRON_SECRET>". Refused when CRON_SECRET is not set. */
export function cronAuthorised(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
