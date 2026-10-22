import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "./secrets";

const secret = "s".repeat(40);

describe("sealed secrets", () => {
  it("round-trips and never stores the plain value", () => {
    const sealed = sealSecret("paynow-key-123", "paynow", secret);
    expect(sealed).not.toContain("paynow-key-123");
    expect(openSecret(sealed, "paynow", secret)).toBe("paynow-key-123");
    expect(sealSecret("x", "paynow", secret)).not.toBe(sealSecret("x", "paynow", secret));
  });

  it("refuses another purpose, another server secret or tampering", () => {
    const sealed = sealSecret("paynow-key-123", "paynow", secret);
    expect(() => openSecret(sealed, "totp", secret)).toThrow();
    expect(() => openSecret(sealed, "paynow", "t".repeat(40))).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => openSecret(parts.join("."), "paynow", secret)).toThrow();
  });
});
