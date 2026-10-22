import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Encrypts small secrets (such as two-step sign-in keys) before they are
// stored: AES-256-GCM with a key derived from SESSION_SECRET by HKDF-SHA-256,
// separate per purpose. Stored as "v1.<iv>.<tag>.<ciphertext>" (base64url).
// Changing SESSION_SECRET makes stored secrets unreadable, so it must be kept.

function key(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("zimerp-secret-box"), Buffer.from(purpose), 32));
}

export function seal(plaintext: string, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret, purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** Decrypts a sealed value; throws if it was tampered with or sealed with another key or purpose. */
export function open(sealed: string, secret: string, purpose: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || ciphertext === undefined) throw new Error("unrecognised sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key(secret, purpose), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
