import { describe, expect, it } from "vitest";
import { open, seal } from "./secret-box";

const SECRET = "a".repeat(64);

describe("secret box", () => {
  it("round-trips and never stores the plaintext", () => {
    const sealed = seal("JBSWY3DPEHPK3PXP", SECRET, "totp");
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(open(sealed, SECRET, "totp")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("uses a fresh nonce each time", () => {
    expect(seal("same", SECRET, "totp")).not.toBe(seal("same", SECRET, "totp"));
  });

  it("refuses another key, another purpose and tampering", () => {
    const sealed = seal("secret", SECRET, "totp");
    expect(() => open(sealed, "b".repeat(64), "totp")).toThrow();
    expect(() => open(sealed, SECRET, "other")).toThrow();
    const [v, iv, tag, ct] = sealed.split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 1;
    expect(() => open([v, iv, tag, flipped.toString("base64url")].join("."), SECRET, "totp")).toThrow();
    expect(() => open("v2.x.y.z", SECRET, "totp")).toThrow(/unrecognised/);
  });
});
