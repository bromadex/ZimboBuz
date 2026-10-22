// Supabase Auth (issue #18), called over its REST API so no SDK is needed.
// ZimERP keeps its own signed session cookie (src/server/session.ts): once
// Supabase confirms who someone is, the app starts its usual session for that
// user id, and database access keeps going through row-level security as that
// user (src/server/data.ts). Passwords never touch ZimERP's database.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AuthUser {
  id: string;
  email: string;
}

/** A message for the person signing in (shown as is). */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string = "auth_error",
  ) {
    super(message);
  }
}

export interface SignUpResult {
  user: AuthUser;
  /** True when Supabase sent a confirmation email and the person must click it first. */
  needsConfirmation: boolean;
}

export interface AuthProvider {
  readonly name: string;
  signInWithPassword(email: string, password: string): Promise<AuthUser>;
  signUp(email: string, password: string, redirectTo: string): Promise<SignUpResult>;
  sendPasswordReset(email: string, redirectTo: string): Promise<void>;
  /**
   * Invites someone: Supabase emails them a link to choose a password.
   * Returns the new user, or null when the address already has an account
   * (the caller looks it up; no email is sent then).
   */
  invite(email: string, redirectTo: string): Promise<AuthUser | null>;
  /** Exchanges a one-time token hash from an email link for an access token. */
  verifyTokenHash(tokenHash: string, type: string): Promise<string>;
  /** Who an access token (from an email link) belongs to. */
  userFromToken(accessToken: string): Promise<AuthUser>;
  setPassword(accessToken: string, password: string): Promise<AuthUser>;
}

export const MIN_PASSWORD = 10;

export function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new AuthError(`Please choose a password of at least ${MIN_PASSWORD} characters.`, "weak_password");
  if (password.length > 72) throw new AuthError("Please choose a password of at most 72 characters.", "weak_password");
}

function normaliseEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 320) throw new AuthError("Please enter a valid email address.", "invalid_email");
  return e;
}

type GoTrueError = { error_code?: string; code?: string | number; msg?: string; message?: string; error?: string; error_description?: string };
type GoTrueUser = { id: string; email?: string; email_confirmed_at?: string | null; identities?: unknown[] };

/** Plain-English messages for Supabase's error codes. */
function friendly(status: number, body: GoTrueError): AuthError {
  const code = String(body.error_code ?? body.code ?? body.error ?? "");
  const map: Record<string, string> = {
    invalid_credentials: "That email address and password do not match.",
    invalid_grant: "That email address and password do not match.",
    email_not_confirmed: "Please confirm your email address first: open the link we emailed you.",
    user_already_exists: "An account with that email address already exists. Please sign in instead.",
    email_exists: "An account with that email address already exists. Please sign in instead.",
    weak_password: `Please choose a stronger password (at least ${MIN_PASSWORD} characters, not a common one).`,
    over_email_send_rate_limit: "We have sent too many emails to that address. Please wait a few minutes and try again.",
    over_request_rate_limit: "Too many attempts. Please wait a few minutes and try again.",
    bad_jwt: "That link has expired or was already used. Please ask for a new one.",
    otp_expired: "That link has expired or was already used. Please ask for a new one.",
    user_banned: "This account has been switched off. Please contact ZimERP support.",
    signup_disabled: "New accounts cannot be created at the moment.",
    same_password: "Please choose a password you have not used before.",
  };
  if (map[code]) return new AuthError(map[code], code);
  if (status === 429) return new AuthError(map.over_request_rate_limit, "rate_limited");
  if (status === 401 || status === 403) return new AuthError(map.bad_jwt, "unauthorised");
  return new AuthError("Sign-in is not available at the moment. Please try again shortly.", code || `http_${status}`);
}

export class SupabaseAuthProvider implements AuthProvider {
  readonly name = "supabase";
  private readonly base: string;

  constructor(
    url: string,
    private readonly anonKey: string,
    private readonly serviceKey: string | null,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    this.base = `${url.replace(/\/+$/, "")}/auth/v1`;
  }

  private async call<T>(path: string, init: { method: string; body?: unknown; bearer?: string; admin?: boolean }): Promise<T> {
    if (init.admin && !this.serviceKey) throw new AuthError("Invitations need the Supabase service role key to be configured.", "not_configured");
    const key = init.admin ? this.serviceKey! : this.anonKey;
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: init.method,
      headers: {
        apikey: key,
        authorization: `Bearer ${init.bearer ?? key}`,
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as T & GoTrueError) : ({} as T & GoTrueError);
    if (!res.ok) throw friendly(res.status, body);
    return body;
  }

  private toUser(u: GoTrueUser | undefined, fallbackEmail = ""): AuthUser {
    if (!u?.id) throw new AuthError("Sign-in is not available at the moment. Please try again shortly.", "no_user");
    return { id: u.id, email: (u.email ?? fallbackEmail).toLowerCase() };
  }

  async signInWithPassword(email: string, password: string) {
    const e = normaliseEmail(email);
    if (!password) throw new AuthError("Please enter your password.", "missing_password");
    const r = await this.call<{ user?: GoTrueUser }>("/token?grant_type=password", { method: "POST", body: { email: e, password } });
    return this.toUser(r.user, e);
  }

  async signUp(email: string, password: string, redirectTo: string) {
    const e = normaliseEmail(email);
    checkPassword(password);
    const r = await this.call<GoTrueUser & { user?: GoTrueUser; access_token?: string }>(
      `/signup?redirect_to=${encodeURIComponent(redirectTo)}`,
      { method: "POST", body: { email: e, password } },
    );
    // With email confirmation on, Supabase returns the user without a session.
    // An address that is already registered comes back with no identities.
    const user = r.user ?? r;
    if (Array.isArray(user.identities) && user.identities.length === 0) {
      throw new AuthError("An account with that email address already exists. Please sign in instead.", "user_already_exists");
    }
    return { user: this.toUser(user, e), needsConfirmation: !r.access_token };
  }

  async sendPasswordReset(email: string, redirectTo: string) {
    const e = normaliseEmail(email);
    try {
      await this.call(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", body: { email: e } });
    } catch (err) {
      // Never reveal whether an address has an account; only rate limits are worth saying.
      if (err instanceof AuthError && err.code.includes("rate_limit")) throw err;
    }
  }

  async invite(email: string, redirectTo: string) {
    const e = normaliseEmail(email);
    try {
      const u = await this.call<GoTrueUser>(`/invite?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", body: { email: e }, admin: true });
      return this.toUser(u, e);
    } catch (err) {
      if (err instanceof AuthError && (err.code === "email_exists" || err.code === "user_already_exists")) return null;
      throw err;
    }
  }

  async verifyTokenHash(tokenHash: string, type: string) {
    const kinds = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];
    if (!/^[A-Za-z0-9_-]{6,200}$/.test(tokenHash) || !kinds.includes(type)) {
      throw new AuthError("That link has expired or was already used. Please ask for a new one.", "bad_jwt");
    }
    const r = await this.call<{ access_token?: string }>("/verify", { method: "POST", body: { type, token_hash: tokenHash } });
    if (!r.access_token) throw new AuthError("That link has expired or was already used. Please ask for a new one.", "bad_jwt");
    return r.access_token;
  }

  async userFromToken(accessToken: string) {
    if (!accessToken || accessToken.length > 4096) throw new AuthError("That link has expired or was already used. Please ask for a new one.", "bad_jwt");
    return this.toUser(await this.call<GoTrueUser>("/user", { method: "GET", bearer: accessToken }));
  }

  async setPassword(accessToken: string, password: string) {
    checkPassword(password);
    return this.toUser(await this.call<GoTrueUser>("/user", { method: "PUT", bearer: accessToken, body: { password } }));
  }
}

/** For tests: accounts in memory; tokens are "token-<user id>". */
export class FakeAuthProvider implements AuthProvider {
  readonly name = "fake";
  readonly users = new Map<string, { id: string; email: string; password: string | null; confirmed: boolean }>();
  readonly emails: Array<{ kind: "confirm" | "reset" | "invite"; email: string; redirectTo: string }> = [];
  constructor(private readonly confirmEmails = false) {}

  private byEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email);
  }

  async signInWithPassword(email: string, password: string) {
    const u = this.byEmail(normaliseEmail(email));
    if (!u || u.password !== password) throw new AuthError("That email address and password do not match.", "invalid_credentials");
    if (!u.confirmed) throw new AuthError("Please confirm your email address first: open the link we emailed you.", "email_not_confirmed");
    return { id: u.id, email: u.email };
  }

  async signUp(email: string, password: string, redirectTo: string) {
    const e = normaliseEmail(email);
    checkPassword(password);
    if (this.byEmail(e)) throw new AuthError("An account with that email address already exists. Please sign in instead.", "user_already_exists");
    const id = crypto.randomUUID();
    this.users.set(id, { id, email: e, password, confirmed: !this.confirmEmails });
    if (this.confirmEmails) this.emails.push({ kind: "confirm", email: e, redirectTo });
    return { user: { id, email: e }, needsConfirmation: this.confirmEmails };
  }

  async sendPasswordReset(email: string, redirectTo: string) {
    const e = normaliseEmail(email);
    if (this.byEmail(e)) this.emails.push({ kind: "reset", email: e, redirectTo });
  }

  async invite(email: string, redirectTo: string) {
    const e = normaliseEmail(email);
    if (this.byEmail(e)) return null;
    const id = crypto.randomUUID();
    this.users.set(id, { id, email: e, password: null, confirmed: true });
    this.emails.push({ kind: "invite", email: e, redirectTo });
    return { id, email: e };
  }

  async verifyTokenHash(tokenHash: string) {
    return `token-${tokenHash.replace(/^hash-/, "")}`;
  }

  async userFromToken(accessToken: string) {
    const u = this.users.get(accessToken.replace(/^token-/, ""));
    if (!u) throw new AuthError("That link has expired or was already used. Please ask for a new one.", "bad_jwt");
    u.confirmed = true;
    return { id: u.id, email: u.email };
  }

  async setPassword(accessToken: string, password: string) {
    checkPassword(password);
    const u = await this.userFromToken(accessToken);
    this.users.get(u.id)!.password = password;
    return u;
  }
}
