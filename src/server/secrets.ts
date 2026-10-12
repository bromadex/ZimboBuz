import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sessionSecret } from "./session";

// Seals secrets that must be stored in the database (e.g. a company's Paynow
// integration key) with AES-256-GCM. The key is derived from SESSION_SECRET
// and a purpose label, so a value sealed for one purpose cannot be opened as
// another. Format: v1.<iv>.<tag>.<ciphertext>, base64url.

function key(purpose: string, secret: string): Buffer {
  return createHash("sha256").update(`zimerp:${purpose}:`).update(secret).digest();
}

export function sealSecret(plain: string, purpose: string, secret = sessionSecret()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(purpose, secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function openSecret(sealed: string, purpose: string, secret = sessionSecret()): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) throw new Error("not a sealed secret");
  const decipher = createDecipheriv("aes-256-gcm", key(purpose, secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
