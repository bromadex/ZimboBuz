import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  groupSecret,
  hashRecoveryCode,
  hotp,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  totp,
  verifyTotp,
} from "./totp";

// RFC 6238 appendix B, SHA-1 key "12345678901234567890".
const RFC_KEY = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("HOTP (RFC 4226 appendix D)", () => {
  it.each([
    [0, "755224"],
    [1, "287082"],
    [2, "359152"],
    [3, "969429"],
    [4, "338314"],
    [5, "254676"],
    [6, "287922"],
    [7, "162583"],
    [8, "399871"],
    [9, "520489"],
  ])("counter %i gives %s", (counter, code) => {
    expect(hotp(RFC_KEY, counter)).toBe(code);
  });
});

describe("TOTP (RFC 6238 appendix B, SHA-1)", () => {
  it.each(RFC_VECTORS)("at %i seconds gives %s (8 digits)", (seconds, code) => {
    expect(totp(RFC_KEY, seconds * 1000, 8)).toBe(code);
  });

  it.each(RFC_VECTORS)("at %i seconds gives the last six digits of %s", (seconds, code) => {
    expect(totp(RFC_KEY, seconds * 1000)).toBe(code.slice(2));
  });
});

describe("verifyTotp", () => {
  const now = 1_111_111_111_000;

  it("accepts the current code and one step either side, returning the step", () => {
    expect(verifyTotp(RFC_KEY, totp(RFC_KEY, now), now)).toBe(Math.floor(now / 30000));
    expect(verifyTotp(RFC_KEY, totp(RFC_KEY, now - 30_000), now)).toBe(Math.floor(now / 30000) - 1);
    expect(verifyTotp(RFC_KEY, totp(RFC_KEY, now + 30_000), now)).toBe(Math.floor(now / 30000) + 1);
  });

  it("refuses old, wrong and malformed codes", () => {
    expect(verifyTotp(RFC_KEY, totp(RFC_KEY, now - 90_000), now)).toBeNull();
    expect(verifyTotp(RFC_KEY, "000000", now)).toBeNull();
    expect(verifyTotp(RFC_KEY, "12345", now)).toBeNull();
    expect(verifyTotp(RFC_KEY, "abcdef", now)).toBeNull();
  });

  it("ignores spaces in the code", () => {
    const code = totp(RFC_KEY, now);
    expect(verifyTotp(RFC_KEY, `${code.slice(0, 3)} ${code.slice(3)}`, now)).not.toBeNull();
  });
});

describe("base32", () => {
  it("matches RFC 4648 test vectors", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Encode(Buffer.from("f"))).toBe("MY");
    expect(base32Decode("MZXW6YTBOI======").toString()).toBe("foobar");
    expect(base32Decode("mzxw 6ytb oi").toString()).toBe("foobar");
  });

  it("round-trips new secrets of 160 bits", () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(groupSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });

  it("rejects invalid characters", () => {
    expect(() => base32Decode("ABC1")).toThrow();
  });
});

describe("otpauthUri", () => {
  it("builds the address authenticator apps read", () => {
    expect(otpauthUri("JBSWY3DPEHPK3PXP", "owner@mhofu.co.zw")).toBe(
      "otpauth://totp/ZimERP%3Aowner%40mhofu.co.zw?secret=JBSWY3DPEHPK3PXP&issuer=ZimERP&algorithm=SHA1&digits=6&period=30",
    );
  });
});

describe("recovery codes", () => {
  it("are ten distinct readable codes, hashed the same however they are typed", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(` ${codes[0].toUpperCase().replace("-", "")} `));
    expect(hashRecoveryCode(codes[0])).not.toBe(hashRecoveryCode(codes[1]));
  });
});
