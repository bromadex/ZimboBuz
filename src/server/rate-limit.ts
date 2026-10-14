import "server-only";
import { headers } from "next/headers";
import { getPool } from "./db";

// Limits for public forms. The visitor is identified by the address the
// hosting platform reports (x-forwarded-for from Vercel or Azure Front Door).

export const LIMITS = {
  enquiry: { limit: 5, windowSeconds: 600 },
  checkout: { limit: 10, windowSeconds: 600 },
  signIn: { limit: 10, windowSeconds: 600 },
  signUp: { limit: 5, windowSeconds: 3600 },
  portalPay: { limit: 10, windowSeconds: 600 },
} as const;

export type LimitName = keyof typeof LIMITS;

export const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

export function clientAddress(forwardedFor: string | null, realIp: string | null): string {
  const first = forwardedFor?.split(",")[0]?.trim();
  return (first || realIp?.trim() || "unknown").slice(0, 64);
}

/** True when the attempt is allowed; counts it either way. */
export async function allow(name: LimitName, extra = "", h?: Headers): Promise<boolean> {
  if (process.env.RATE_LIMITS === "off") return true; // automated browser tests only
  const hdrs = h ?? (await headers());
  const key = `${name}:${clientAddress(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip"))}${extra ? `:${extra.toLowerCase().slice(0, 120)}` : ""}`;
  const { limit, windowSeconds } = LIMITS[name];
  try {
    const { rows } = await getPool().query<{ ok: boolean }>("select app.hit_rate_limit($1, $2, $3) as ok", [key, limit, windowSeconds]);
    return rows[0].ok;
  } catch {
    return true; // never lock everyone out because the counter failed
  }
}
