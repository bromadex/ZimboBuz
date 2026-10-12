import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getPool } from "./db";
import { createSessionToken, readSessionToken, sessionSecret } from "./session";
import { requestProtocol } from "./urls";

// Sign-in adapter. "dev": email-only sign-in against the local database, for
// development and demos; refused in production. "supabase": Supabase Auth,
// wired in when the Supabase project is connected (issue #18). Two-step
// sign-in for the dev adapter lives in ./two-step.ts; with Supabase Auth,
// Supabase's own MFA takes its place.

export const SESSION_COOKIE = "zimerp_session";
/** Holds who has passed the first step while the two-step code is asked for. */
export const TWO_STEP_COOKIE = "zimerp_two_step";
const TWO_STEP_SECONDS = 5 * 60;
const TWO_STEP_AUDIENCE = "two-step";

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

function normaliseEmail(email: string): string {
  const normalised = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) throw new Error("Please enter a valid email address.");
  return normalised;
}

async function findOrCreateUser(email: string): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomUUID();
  await pool.query("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [id, email]);
  return (await pool.query<{ id: string }>("select id from auth.users where lower(email) = $1", [email])).rows[0].id;
}

/** Finds or creates the user for an email address (dev mode) and returns the user id. */
export async function devSignIn(email: string): Promise<string> {
  if (authMode() !== "dev") throw new AuthNotConfiguredError();
  return findOrCreateUser(normaliseEmail(email));
}

/**
 * The user to invite for an email address, created if they have never signed
 * in. With Supabase Auth this becomes an admin invitation (inviteUserByEmail).
 */
export async function userForInvitation(email: string): Promise<{ id: string; email: string }> {
  if (authMode() !== "dev") throw new AuthNotConfiguredError();
  const normalised = normaliseEmail(email);
  return { id: await findOrCreateUser(normalised), email: normalised };
}

/** Session cookie settings. Secure whenever the request came over HTTPS (always, in production). */
export function sessionCookieOptions(protocol: "http" | "https") {
  return { httpOnly: true, sameSite: "lax" as const, secure: protocol === "https", path: "/", maxAge: 30 * 24 * 60 * 60 };
}

async function protocol() {
  return requestProtocol((await headers()).get("x-forwarded-proto"));
}

export async function startSession(userId: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, createSessionToken(userId, sessionSecret()), sessionCookieOptions(await protocol()));
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(TWO_STEP_COOKIE);
}

export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return readSessionToken(token, sessionSecret())?.userId ?? null;
}

// --- Between the two steps ---------------------------------------------------
// No session cookie is issued until the code is checked: the first step only
// earns a short-lived signed token naming the user, good for nothing else.

export async function startTwoStep(userId: string): Promise<void> {
  (await cookies()).set(
    TWO_STEP_COOKIE,
    createSessionToken(userId, sessionSecret(), TWO_STEP_SECONDS, Date.now(), TWO_STEP_AUDIENCE),
    { ...sessionCookieOptions(await protocol()), maxAge: TWO_STEP_SECONDS },
  );
}

export async function twoStepUserId(): Promise<string | null> {
  const token = (await cookies()).get(TWO_STEP_COOKIE)?.value;
  return readSessionToken(token, sessionSecret(), Date.now(), TWO_STEP_AUDIENCE)?.userId ?? null;
}

export async function endTwoStep(): Promise<void> {
  (await cookies()).delete(TWO_STEP_COOKIE);
}

/** Email address of a user (auth.users is not readable by signed-in users). */
export async function userEmail(userId: string): Promise<string> {
  return (await getPool().query<{ email: string }>("select email from auth.users where id = $1", [userId])).rows[0]?.email ?? "";
}
