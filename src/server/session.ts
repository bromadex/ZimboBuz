import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Signed session tokens: "<base64url payload>.<base64url HMAC-SHA256>".
// The payload holds only the user id and expiry; nothing secret.

export interface Session {
  userId: string;
  expiresAt: number; // epoch seconds
  aud?: string; // set on single-purpose tokens (e.g. a sign-up handoff to one host)
}

const DAY = 24 * 60 * 60;

let devSecret: string | undefined;

export function sessionSecret(env: Record<string, string | undefined> = process.env): string {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return env.SESSION_SECRET;
  if (env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (at least 32 characters) must be set in production");
  }
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString("base64url");

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(
  userId: string,
  secret: string,
  ttlSeconds = 30 * DAY,
  now = Date.now(),
  aud?: string,
): string {
  const session: Session = { userId, expiresAt: Math.floor(now / 1000) + ttlSeconds, ...(aud ? { aud } : {}) };
  const payload = b64(JSON.stringify(session));
  return `${payload}.${sign(payload, secret)}`;
}

/** Verifies a token. `aud` must match exactly: a session cookie has none, a handoff token has its host. */
export function readSessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
  aud?: string,
): Session | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (typeof session.userId !== "string" || typeof session.expiresAt !== "number") return null;
    if (session.expiresAt <= Math.floor(now / 1000)) return null;
    if (session.aud !== aud) return null;
    return session;
  } catch {
    return null;
  }
}
