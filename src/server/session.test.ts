import { describe, expect, it } from "vitest";
import { createSessionToken, readSessionToken, sessionSecret } from "./session";

const secret = "x".repeat(40);
const user = "6f1c2a9e-0a4b-4c1f-9a3e-2b7d8c9e0f11";

describe("session tokens", () => {
  it("round-trips a valid token", () => {
    const token = createSessionToken(user, secret);
    expect(readSessionToken(token, secret)?.userId).toBe(user);
  });

  it("rejects tampering, other secrets and expiry", () => {
    const token = createSessionToken(user, secret, 60, 0);
    expect(readSessionToken(token, secret, 59_000)).not.toBeNull();
    expect(readSessionToken(token, secret, 61_000)).toBeNull();
    const fresh = createSessionToken(user, secret);
    const [payload, sig] = fresh.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "someone-else", expiresAt: 9e9 })).toString("base64url");
    expect(readSessionToken(`${forged}.${sig}`, secret)).toBeNull();
    expect(readSessionToken(`${payload}.${sig}`, "y".repeat(40))).toBeNull();
    expect(readSessionToken("garbage", secret)).toBeNull();
    expect(readSessionToken(undefined, secret)).toBeNull();
  });

  it("keeps handoff tokens and session cookies apart", () => {
    const handoff = createSessionToken(user, secret, 120, Date.now(), "erp.mhofu.zimerp.co.zw");
    expect(readSessionToken(handoff, secret)).toBeNull();
    expect(readSessionToken(handoff, secret, Date.now(), "erp.other.zimerp.co.zw")).toBeNull();
    expect(readSessionToken(handoff, secret, Date.now(), "erp.mhofu.zimerp.co.zw")?.userId).toBe(user);
    expect(readSessionToken(createSessionToken(user, secret), secret, Date.now(), "erp.mhofu.zimerp.co.zw")).toBeNull();
  });

  it("requires a real secret in production", () => {
    expect(() => sessionSecret({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
    expect(sessionSecret({ NODE_ENV: "production", SESSION_SECRET: secret })).toBe(secret);
    expect(sessionSecret({ NODE_ENV: "development" })).toHaveLength(64);
  });
});
