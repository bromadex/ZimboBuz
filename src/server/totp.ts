import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP) with HMAC-SHA-1,
// 6 digits and 30-second steps: what authenticator apps (Google Authenticator,
// Microsoft Authenticator, Authy) use by default. Pure functions, no storage.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error("invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 4226 HOTP value for a counter, as a zero-padded string. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, "0");
}

export const STEP_SECONDS = 30;

export function timeStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/** RFC 6238 TOTP for a moment in time. */
export function totp(secret: Buffer, nowMs = Date.now(), digits = 6): string {
  return hotp(secret, timeStep(nowMs), digits);
}

/**
 * Checks a code against the current step and one step either side (clock
 * drift). Returns the matching step, or null. Callers refuse steps at or below
 * the last one used, so a code cannot be replayed.
 */
export function verifyTotp(secret: Buffer, code: string, nowMs = Date.now(), window = 1): number | null {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const now = timeStep(nowMs);
  for (let step = now - window; step <= now + window; step++) {
    const expected = hotp(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return step;
  }
  return null;
}

/** A new random 160-bit secret (the length RFC 4226 recommends), base32-encoded. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The otpauth:// address authenticator apps understand (as a link or QR code). */
export function otpauthUri(secretBase32: string, account: string, issuer = "ZimERP"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: "6", period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

/** The secret split into groups of four, easier to type. */
export function groupSecret(secretBase32: string): string {
  return secretBase32.match(/.{1,4}/g)?.join(" ") ?? secretBase32;
}

// --- Recovery codes ---------------------------------------------------------

const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (0/o, 1/l/i)

/** Ten single-use codes like "k7mq-29xd". */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

export function normaliseRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Recovery codes are stored only as hashes. */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(`zimerp-recovery:${normaliseRecoveryCode(code)}`).digest("hex");
}
