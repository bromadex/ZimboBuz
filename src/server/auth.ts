import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getPool } from "./db";
import { createSessionToken, readSessionToken, sessionSecret } from "./session";
import { requestProtocol } from "./urls";

// Sign-in adapter. "dev": email-only sign-in against the local database, for
// development and demos; refused in production. "supabase": Supabase Auth,
// wired in when the Supabase project is connected (issue #18).

export const SESSION_COOKIE = "zimerp_session";

export type AuthMode = "dev" | "supabase";

export function authMode(env: Record<string, string | undefined> = process.env): AuthMode {
  const mode = (env.AUTH_MODE ?? "dev") as AuthMode;
  if (mode === "dev" && env.NODE_ENV === "production" && env.ALLOW_DEV_AUTH !== "yes") {
    throw new Error("Development sign-in cannot be used in production. Set AUTH_MODE=supabase.");
  }
  return mode;
}

export class AuthNotConfiguredError extends Error {
  constructor() {
    super("Supabase sign-in is not connected yet.");
  }
}

/** Finds or creates the user for an email address (dev mode) and returns the user id. */
export async function devSignIn(email: string): Promise<string> {
  if (authMode() !== "dev") throw new AuthNotConfiguredError();
  const normalised = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) throw new Error("Please enter a valid email address.");
  const pool = getPool();
  const existing = await pool.query<{ id: string }>("select id from auth.users where lower(email) = $1", [normalised]);
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomUUID();
  await pool.query("insert into auth.users (id, email) values ($1, $2)", [id, normalised]);
  return id;
}

/** Session cookie settings. Secure whenever the request came over HTTPS (always, in production). */
export function sessionCookieOptions(protocol: "http" | "https") {
  return { httpOnly: true, sameSite: "lax" as const, secure: protocol === "https", path: "/", maxAge: 30 * 24 * 60 * 60 };
}

export async function startSession(userId: string): Promise<void> {
  const protocol = requestProtocol((await headers()).get("x-forwarded-proto"));
  (await cookies()).set(SESSION_COOKIE, createSessionToken(userId, sessionSecret()), sessionCookieOptions(protocol));
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return readSessionToken(token, sessionSecret())?.userId ?? null;
}
