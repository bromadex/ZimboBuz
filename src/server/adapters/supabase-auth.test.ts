import { describe, expect, it } from "vitest";
import { AuthError, FakeAuthProvider, SupabaseAuthProvider, type FetchLike } from "./supabase-auth";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function server(reply: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const r = reply(call);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200 });
  };
  return { calls, auth: new SupabaseAuthProvider("https://abc.supabase.co/", "anon-key", "service-key", fetchImpl) };
}

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "Chipo@Example.com" };

describe("Supabase sign-in", () => {
  it("signs in with email and password using the public key", async () => {
    const { calls, auth } = server(() => ({ body: { access_token: "t", user: USER } }));
    expect(await auth.signInWithPassword(" Chipo@example.com ", "secret-password")).toEqual({ id: USER.id, email: "chipo@example.com" });
    expect(calls[0].url).toBe("https://abc.supabase.co/auth/v1/token?grant_type=password");
    expect(calls[0].headers.apikey).toBe("anon-key");
    expect(calls[0].body).toEqual({ email: "chipo@example.com", password: "secret-password" });
  });

  it("explains failures in plain English", async () => {
    const { auth } = server(() => ({ status: 400, body: { error_code: "invalid_credentials", msg: "Invalid login credentials" } }));
    await expect(auth.signInWithPassword("a@b.co", "x")).rejects.toThrow("That email address and password do not match.");
    const limited = server(() => ({ status: 429, body: {} }));
    await expect(limited.auth.signInWithPassword("a@b.co", "x")).rejects.toThrow(/Too many attempts/);
    const confirm = server(() => ({ status: 400, body: { error_code: "email_not_confirmed" } }));
    await expect(confirm.auth.signInWithPassword("a@b.co", "x")).rejects.toThrow(/confirm your email address/);
  });

  it("signs up, noting when the email must be confirmed first", async () => {
    const pending = server(() => ({ body: { ...USER, identities: [{}] } }));
    expect(await pending.auth.signUp("chipo@example.com", "long-password-1", "https://erp.x.zimerp.co.zw/auth/callback")).toEqual({
      user: { id: USER.id, email: "chipo@example.com" },
      needsConfirmation: true,
    });
    expect(pending.calls[0].url).toContain("/signup?redirect_to=https%3A%2F%2Ferp.x.zimerp.co.zw%2Fauth%2Fcallback");
    const instant = server(() => ({ body: { access_token: "t", user: { ...USER, identities: [{}] } } }));
    expect((await instant.auth.signUp("chipo@example.com", "long-password-1", "https://x")).needsConfirmation).toBe(false);
    const taken = server(() => ({ body: { ...USER, identities: [] } }));
    await expect(taken.auth.signUp("chipo@example.com", "long-password-1", "https://x")).rejects.toMatchObject({ code: "user_already_exists" });
    await expect(taken.auth.signUp("chipo@example.com", "short", "https://x")).rejects.toThrow(/at least 10 characters/);
  });

  it("invites with the service key and reports existing accounts", async () => {
    const { calls, auth } = server(() => ({ body: USER }));
    expect(await auth.invite("chipo@example.com", "https://erp.x/auth/callback")).toEqual({ id: USER.id, email: "chipo@example.com" });
    expect(calls[0].headers.apikey).toBe("service-key");
    const exists = server(() => ({ status: 422, body: { error_code: "email_exists" } }));
    expect(await exists.auth.invite("chipo@example.com", "https://x")).toBeNull();
    const noKey = new SupabaseAuthProvider("https://abc.supabase.co", "anon-key", null, async () => new Response("{}"));
    await expect(noKey.invite("chipo@example.com", "https://x")).rejects.toThrow(/service role key/);
  });

  it("never reveals whether an address has an account when resetting", async () => {
    const { auth } = server(() => ({ status: 400, body: { error_code: "user_not_found" } }));
    await expect(auth.sendPasswordReset("nobody@example.com", "https://x")).resolves.toBeUndefined();
    const limited = server(() => ({ status: 429, body: { error_code: "over_email_send_rate_limit" } }));
    await expect(limited.auth.sendPasswordReset("a@b.co", "https://x")).rejects.toBeInstanceOf(AuthError);
  });

  it("finishes email links: token hash, then the user, then a new password", async () => {
    const { calls, auth } = server((c) => (c.url.endsWith("/verify") ? { body: { access_token: "abc" } } : { body: USER }));
    expect(await auth.verifyTokenHash("hash_123456", "recovery")).toBe("abc");
    await expect(auth.verifyTokenHash("bad hash!", "recovery")).rejects.toThrow(/expired/);
    await auth.setPassword("abc", "a-new-password");
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.authorization).toBe("Bearer abc");
    expect(put.body).toEqual({ password: "a-new-password" });
  });
});

describe("fake sign-in for tests", () => {
  it("behaves like Supabase", async () => {
    const auth = new FakeAuthProvider(true);
    const { user, needsConfirmation } = await auth.signUp("a@b.co", "long-password-1", "https://x");
    expect(needsConfirmation).toBe(true);
    await expect(auth.signInWithPassword("a@b.co", "long-password-1")).rejects.toThrow(/confirm/);
    await auth.userFromToken(`token-${user.id}`);
    expect(await auth.signInWithPassword("a@b.co", "long-password-1")).toEqual(user);
    expect(await auth.invite("a@b.co", "https://x")).toBeNull();
    const invited = await auth.invite("new@b.co", "https://x");
    await auth.setPassword(`token-${invited!.id}`, "chosen-password");
    expect((await auth.signInWithPassword("new@b.co", "chosen-password")).id).toBe(invited!.id);
  });
});
