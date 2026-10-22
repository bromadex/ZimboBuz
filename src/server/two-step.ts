import "server-only";
import type pg from "pg";
import { getPool } from "./db";
import { open, seal } from "./secret-box";
import { sessionSecret } from "./session";
import { base32Decode, hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from "./totp";

// Two-step sign-in for the development sign-in adapter (P3): authenticator
// app codes (TOTP) with single-use recovery codes. Secrets are encrypted with
// a key derived from SESSION_SECRET and kept in app.user_totp, which only the
// server can read. With AUTH_MODE=supabase, Supabase Auth MFA is used instead
// and these functions report two-step sign-in as not available here.

const PURPOSE = "totp-secret";
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

export class TwoStepError extends Error {}

interface Row {
  secret_enc: string | null;
  enabled_at: Date | null;
  last_step: string;
  recovery_hashes: string[];
  failed_attempts: number;
  locked_until: Date | null;
}

/** Two-step sign-in is ZimERP's own, so it works with either sign-in mode. */
export function twoStepAvailable(): boolean {
  return true;
}

async function inTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function lockRow(c: pg.PoolClient, userId: string): Promise<Row | undefined> {
  return (await c.query<Row>("select * from app.user_totp where user_id = $1 for update", [userId])).rows[0];
}

export interface TwoStepStatus {
  enabled: boolean;
  /** A secret waiting to be confirmed (setting up). */
  pending: { secret: string; uri: string } | null;
  recoveryCodesLeft: number;
}

export async function twoStepEnabled(userId: string): Promise<boolean> {
  if (!twoStepAvailable()) return false;
  const { rows } = await getPool().query("select 1 from app.user_totp where user_id = $1 and enabled_at is not null", [userId]);
  return rows.length > 0;
}

export async function twoStepStatus(userId: string, email: string): Promise<TwoStepStatus> {
  const row = (await getPool().query<Row>("select * from app.user_totp where user_id = $1", [userId])).rows[0];
  if (!row || (!row.enabled_at && !row.secret_enc)) return { enabled: false, pending: null, recoveryCodesLeft: 0 };
  if (row.enabled_at) return { enabled: true, pending: null, recoveryCodesLeft: row.recovery_hashes.length };
  const secret = open(row.secret_enc!, sessionSecret(), PURPOSE);
  return { enabled: false, pending: { secret, uri: otpauthUri(secret, email) }, recoveryCodesLeft: 0 };
}

/** Starts (or restarts) setting up: a new secret, not yet switched on. */
export async function beginTwoStepSetup(userId: string): Promise<void> {
  if (!twoStepAvailable()) throw new TwoStepError("Two-step sign-in is managed by your sign-in provider.");
  await inTransaction(async (c) => {
    const row = await lockRow(c, userId);
    if (row?.enabled_at) throw new TwoStepError("Two-step sign-in is already on.");
    const sealed = seal(newTotpSecret(), sessionSecret(), PURPOSE);
    await c.query(
      `insert into app.user_totp (user_id, secret_enc) values ($1, $2)
       on conflict (user_id) do update set secret_enc = excluded.secret_enc, enabled_at = null, last_step = 0,
         recovery_hashes = '{}', failed_attempts = 0, locked_until = null`,
      [userId, sealed],
    );
  });
}

type Outcome = "ok" | "wrong" | "locked";

/**
 * Checks a code (authenticator, or recovery code when allowed), counting wrong
 * codes towards a short lock-out. Consumes recovery codes and refuses reusing
 * an authenticator code. Never throws, so the transaction commits the count.
 */
async function check(c: pg.PoolClient, userId: string, row: Row, code: string, allowRecovery: boolean): Promise<Outcome> {
  if (row.locked_until && row.locked_until > new Date()) return "locked";
  const secret = row.secret_enc ? base32Decode(open(row.secret_enc, sessionSecret(), PURPOSE)) : null;
  const step = secret ? verifyTotp(secret, code) : null;
  if (step !== null && step > Number(row.last_step)) {
    await c.query("update app.user_totp set last_step = $2, failed_attempts = 0, locked_until = null where user_id = $1", [userId, step]);
    return "ok";
  }
  if (allowRecovery && step === null) {
    const hash = hashRecoveryCode(code);
    if (row.recovery_hashes.includes(hash)) {
      await c.query(
        "update app.user_totp set recovery_hashes = array_remove(recovery_hashes, $2), failed_attempts = 0, locked_until = null where user_id = $1",
        [userId, hash],
      );
      return "ok";
    }
  }
  const failed = row.failed_attempts + 1;
  if (failed >= MAX_ATTEMPTS) {
    await c.query("update app.user_totp set failed_attempts = 0, locked_until = now() + make_interval(mins => $2) where user_id = $1", [
      userId,
      LOCK_MINUTES,
    ]);
    return "locked";
  }
  await c.query("update app.user_totp set failed_attempts = $2 where user_id = $1", [userId, failed]);
  return "wrong";
}

const LOCKED_MESSAGE = `Too many wrong codes. Please wait ${LOCK_MINUTES} minutes and try again.`;

function explain(outcome: Outcome, wrong: string): never {
  throw new TwoStepError(outcome === "locked" ? LOCKED_MESSAGE : wrong);
}

/** Confirms setup with a code from the app; returns the recovery codes to show once. */
export async function confirmTwoStepSetup(userId: string, code: string): Promise<string[]> {
  const result = await inTransaction(async (c) => {
    const row = await lockRow(c, userId);
    if (!row?.secret_enc || row.enabled_at) throw new TwoStepError("Start setting up two-step sign-in first.");
    const outcome = await check(c, userId, row, code.trim(), false);
    if (outcome !== "ok") return { outcome };
    const codes = newRecoveryCodes();
    await c.query("update app.user_totp set enabled_at = now(), recovery_hashes = $2 where user_id = $1", [userId, codes.map(hashRecoveryCode)]);
    return { outcome, codes };
  });
  if (!result.codes) explain(result.outcome, "That code is not right. Check the time on your phone and try the newest code.");
  return result.codes;
}

/** Checks the second step at sign-in. Throws a TwoStepError with a plain message when refused. */
export async function verifyTwoStepCode(userId: string, code: string): Promise<void> {
  const outcome = await inTransaction(async (c) => {
    const row = await lockRow(c, userId);
    if (!row?.enabled_at) return "ok" as const; // switched off meanwhile: nothing to check
    return check(c, userId, row, code.trim(), true);
  });
  if (outcome !== "ok") explain(outcome, "That code is not right. Try the newest code from your app, or a recovery code.");
}

/** New recovery codes (the old ones stop working). Needs a current code. */
export async function replaceRecoveryCodes(userId: string, code: string): Promise<string[]> {
  const result = await inTransaction(async (c) => {
    const row = await lockRow(c, userId);
    if (!row?.enabled_at) throw new TwoStepError("Two-step sign-in is not on.");
    const outcome = await check(c, userId, row, code.trim(), false);
    if (outcome !== "ok") return { outcome };
    const codes = newRecoveryCodes();
    await c.query("update app.user_totp set recovery_hashes = $2 where user_id = $1", [userId, codes.map(hashRecoveryCode)]);
    return { outcome, codes };
  });
  if (!result.codes) explain(result.outcome, "That code is not right.");
  return result.codes;
}

/** Switches two-step sign-in off. Needs a current code or a recovery code. */
export async function disableTwoStep(userId: string, code: string): Promise<void> {
  const outcome = await inTransaction(async (c) => {
    const row = await lockRow(c, userId);
    if (!row?.enabled_at) throw new TwoStepError("Two-step sign-in is not on.");
    const result = await check(c, userId, row, code.trim(), true);
    if (result === "ok") {
      await c.query("update app.user_totp set enabled_at = null, secret_enc = null, recovery_hashes = '{}', last_step = 0 where user_id = $1", [userId]);
    }
    return result;
  });
  if (outcome !== "ok") explain(outcome, "That code is not right.");
}

/** Cancels a setup that was never confirmed. */
export async function cancelTwoStepSetup(userId: string): Promise<void> {
  await getPool().query("update app.user_totp set secret_enc = null where user_id = $1 and enabled_at is null", [userId]);
}
