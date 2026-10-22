import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { AuthError, FakeAuthProvider, SupabaseAuthProvider, type AuthProvider } from "./adapters/supabase-auth";
import { getPool } from "./db";
import { createSessionToken, readSessionToken, sessionSecret } from "./session";
import { requestProtocol } from "./urls";

// Sign-in adapter. "dev": email-only sign-in against the local database, for
// development and demos; refused in production. "supabase": email and
// password through Supabase Auth (issue #18; ./adapters/supabase-auth.ts),
// with DATABASE_URL pointing at the same Supabase database. Either way the
// app keeps its own signed session cookie, and two-step sign-in
// (./two-step.ts) works on top of both.

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

export { AuthError };

const PROVIDER = Symbol.for("zimerp.auth-provider");

/**
 * Supabase Auth from NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 * and (for invitations) SUPABASE_SERVICE_ROLE_KEY. With ADAPTERS=fake, an
 * in-memory stand-in for automated tests. One per process.
 */
export function authProvider(env: Record<string, string | undefined> = process.env): AuthProvider {
  const g = globalThis as { [PROVIDER]?: AuthProvider };
  if (g[PROVIDER]) return g[PROVIDER];
  if (env.ADAPTERS === "fake") {
    g[PROVIDER] = new FakeAuthProvider(env.AUTH_FAKE_CONFIRM === "yes");
  } else {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new AuthNotConfiguredError();
    g[PROVIDER] = new SupabaseAuthProvider(url, anon, env.SUPABASE_SERVICE_ROLE_KEY || null);
  }
  return g[PROVIDER];
}

/** The fake provider keeps accounts in memory; the database still needs the user row. */
async function mirrorFakeUser(provider: AuthProvider, user: { id: string; email: string }) {
  if (provider.name !== "fake") return;
  await getPool().query("insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing", [user.id, user.email]);
}

/** Signs in with email and password (dev mode: the password is ignored). Returns the user id. */
export async function passwordSignIn(email: string, password: string): Promise<string> {
  if (authMode() === "dev") return devSignIn(email);
  return (await authProvider().signInWithPassword(email, password)).id;
}

/**
 * Creates an account. With Supabase, the person may first have to confirm
 * their email address (Supabase sends the link, back to `redirectTo`).
 */
export async function createAccount(email: string, password: string, redirectTo: string): Promise<{ userId: string; needsConfirmation: boolean }> {
  if (authMode() === "dev") return { userId: await devSignIn(email), needsConfirmation: false };
  const provider = authProvider();
  const { user, needsConfirmation } = await provider.signUp(email, password, redirectTo);
  await mirrorFakeUser(provider, user);
  return { userId: user.id, needsConfirmation };
}

/** Emails a link to choose a new password (never says whether the address has an account). */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  if (authMode() === "dev") throw new AuthNotConfiguredError();
  await authProvider().sendPasswordReset(email, redirectTo);
}

/**
 * Finishes an emailed link (confirm address, reset password, invitation):
 * checks the access token Supabase put in the link, sets the password when
 * one is given, and returns the user id to start a session for.
 */
export async function completeEmailLink(
  link: { accessToken?: string | null; tokenHash?: string | null; type?: string | null },
  password: string | null,
): Promise<string> {
  if (authMode() === "dev") throw new AuthNotConfiguredError();
  const provider = authProvider();
  let token = link.accessToken ?? "";
  // Newer Supabase email templates send a one-time token hash instead.
  if (!token && link.tokenHash) token = await provider.verifyTokenHash(link.tokenHash, link.type ?? "email");
  const user = password ? await provider.setPassword(token, password) : await provider.userFromToken(token);
  return user.id;
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
 * The user to invite for an email address. Dev mode creates the user row;
 * with Supabase, Supabase creates the account and emails a link to choose a
 * password (back to `redirectTo`); someone who already has an account is
 * simply found.
 */
export async function userForInvitation(email: string, redirectTo = "/"): Promise<{ id: string; email: string; emailed: boolean }> {
  const normalised = normaliseEmail(email);
  if (authMode() === "dev") return { id: await findOrCreateUser(normalised), email: normalised, emailed: false };
  // Someone who already has an account is simply found: no email from Supabase.
  const existing = await getPool().query<{ id: string }>("select id from auth.users where lower(email) = $1", [normalised]);
  if (existing.rows[0]) return { id: existing.rows[0].id, email: normalised, emailed: false };
  const provider = authProvider();
  const invited = await provider.invite(normalised, redirectTo);
  if (!invited) throw new AuthError("We could not find that account. Please try again.", "not_found");
  await mirrorFakeUser(provider, invited);
  return { id: invited.id, email: normalised, emailed: true };
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
