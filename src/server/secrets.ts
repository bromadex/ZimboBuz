import { open, seal } from "./secret-box";
import { sessionSecret } from "./session";

// Seals secrets that must be stored in the database (e.g. a company's Paynow
// integration key) with the server's SESSION_SECRET. One implementation for
// every purpose: see ./secret-box.ts (AES-256-GCM, HKDF key per purpose).

export function sealSecret(plain: string, purpose: string, secret = sessionSecret()): string {
  return seal(plain, secret, purpose);
}

export function openSecret(sealed: string, purpose: string, secret = sessionSecret()): string {
  return open(sealed, secret, purpose);
}
