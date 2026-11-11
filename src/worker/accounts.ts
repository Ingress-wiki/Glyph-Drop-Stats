import type { AccountView } from "../domain/account.ts";
import type { Db } from "./db.ts";
import { uploadSummaries, withdrawSubmission, type WithdrawResult } from "./submissions.ts";

export type { AccountView };

/**
 * Optional passkey accounts. An account is its passkeys: no email, username
 * or password. It groups the submissions its holder claimed with their
 * receipts, can withdraw them, and can make agent keys that read them.
 * Receipts keep working whether or not a submission is in an account.
 */

/** Signed in for two weeks, then the passkey again. */
export const SESSION_SECONDS = 14 * 24 * 60 * 60;
/** Long enough to unlock a phone and choose a passkey. */
export const CHALLENGE_SECONDS = 5 * 60;
/** Bounds what an account's pages and keys read, as `MAX_UPLOADS_PER_KEY` does for a key. */
export const MAX_UPLOADS_PER_ACCOUNT = 500;
/** Backup passkeys on other devices; more is a sign of something wrong. */
export const MAX_PASSKEYS = 20;

export type ChallengePurpose = "register" | "sign_in" | "add_passkey";

export interface StoredPasskey {
  credentialId: string;
  accountId: number;
  userHandle: string;
  publicKey: string;
  counter: number;
  transports: string[];
}

export interface NewPasskey {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  backedUp: boolean;
}

// Challenges

export async function saveChallenge(
  db: Db,
  challenge: { value: string; purpose: ChallengePurpose; userHandle?: string; accountId?: number },
  now: number,
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM passkey_challenges WHERE expires_at <= ?1").bind(now),
    db
      .prepare("INSERT INTO passkey_challenges (challenge, purpose, user_handle, account_id, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(challenge.value, challenge.purpose, challenge.userHandle ?? null, challenge.accountId ?? null, now + CHALLENGE_SECONDS),
  ]);
}

/** Takes a challenge for one use: null if it is unknown, expired, used or for something else. */
export async function takeChallenge(db: Db, value: string, purpose: ChallengePurpose, now: number): Promise<{ userHandle: string | null; accountId: number | null } | null> {
  const row = await db
    .prepare("DELETE FROM passkey_challenges WHERE challenge = ?1 AND purpose = ?2 AND expires_at > ?3 RETURNING user_handle, account_id")
    .bind(value, purpose, now)
    .first<{ user_handle: string | null; account_id: number | null }>();
  return row ? { userHandle: row.user_handle, accountId: row.account_id } : null;
}

// Accounts and passkeys

/** Creates the account with its first passkey, in one transaction. Null when the passkey is already registered. */
export async function createAccount(db: Db, userHandle: string, passkey: NewPasskey, now: number): Promise<number | null> {
  if (await passkeyExists(db, passkey.credentialId)) return null;
  try {
    const [, , created] = (await db.batch([
      db.prepare("INSERT INTO accounts (user_handle, created_at) VALUES (?1, ?2)").bind(userHandle, now),
      insertPasskey(db, "(SELECT id FROM accounts WHERE user_handle = ?7)", passkey, now, userHandle),
      db.prepare("SELECT id FROM accounts WHERE user_handle = ?1").bind(userHandle),
    ])) as [unknown, unknown, { results: { id: number }[] }];
    return created.results[0].id;
  } catch (error) {
    // The same passkey registered by a concurrent request.
    if (String(error instanceof Error ? error.message : error).includes("UNIQUE constraint failed")) return null;
    throw error;
  }
}

const passkeyExists = async (db: Db, credentialId: string) => (await db.prepare("SELECT 1 AS found FROM passkeys WHERE credential_id = ?1").bind(credentialId).first()) !== null;

function insertPasskey(db: Db, account: string, passkey: NewPasskey, now: number, accountRef: string | number) {
  return db
    .prepare(
      `INSERT INTO passkeys (credential_id, account_id, public_key, counter, transports, backed_up, created_at)
       VALUES (?1, ${account}, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(passkey.credentialId, passkey.publicKey, passkey.counter, JSON.stringify(passkey.transports), passkey.backedUp ? 1 : 0, now, accountRef);
}

export type AddPasskeyResult = "added" | "exists" | "full";

export async function addPasskey(db: Db, accountId: number, passkey: NewPasskey, now: number): Promise<AddPasskeyResult> {
  if (await passkeyExists(db, passkey.credentialId)) return "exists";
  const count = await db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE account_id = ?1").bind(accountId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_PASSKEYS) return "full";
  await insertPasskey(db, "?7", passkey, now, accountId).run();
  return "added";
}

export async function findPasskey(db: Db, credentialId: string): Promise<StoredPasskey | null> {
  const row = await db
    .prepare(
      `SELECT passkey.credential_id, passkey.account_id, account.user_handle, passkey.public_key, passkey.counter, passkey.transports
       FROM passkeys AS passkey JOIN accounts AS account ON account.id = passkey.account_id
       WHERE passkey.credential_id = ?1`,
    )
    .bind(credentialId)
    .first<{ credential_id: string; account_id: number; user_handle: string; public_key: string; counter: number; transports: string }>();
  if (!row) return null;
  return {
    credentialId: row.credential_id,
    accountId: row.account_id,
    userHandle: row.user_handle,
    publicKey: row.public_key,
    counter: row.counter,
    transports: JSON.parse(row.transports) as string[],
  };
}

export async function recordPasskeyUse(db: Db, credentialId: string, counter: number, backedUp: boolean, now: number): Promise<void> {
  await db
    .prepare("UPDATE passkeys SET counter = ?2, backed_up = ?3, last_used_at = ?4 WHERE credential_id = ?1")
    .bind(credentialId, counter, backedUp ? 1 : 0, now)
    .run();
}

export async function passkeyIds(db: Db, accountId: number): Promise<{ id: string; transports: string[] }[]> {
  const rows = await db.prepare("SELECT credential_id, transports FROM passkeys WHERE account_id = ?1").bind(accountId).all<{ credential_id: string; transports: string }>();
  return rows.results.map((row) => ({ id: row.credential_id, transports: JSON.parse(row.transports) as string[] }));
}

export async function userHandleOf(db: Db, accountId: number): Promise<string | null> {
  const row = await db.prepare("SELECT user_handle FROM accounts WHERE id = ?1").bind(accountId).first<{ user_handle: string }>();
  return row?.user_handle ?? null;
}

/** An account keeps at least one passkey: without one, no one could sign in to it. */
export async function removePasskey(db: Db, accountId: number, credentialId: string): Promise<"removed" | "last" | "not_found"> {
  const rows = await db.prepare("SELECT credential_id FROM passkeys WHERE account_id = ?1").bind(accountId).all<{ credential_id: string }>();
  if (!rows.results.some((row) => row.credential_id === credentialId)) return "not_found";
  if (rows.results.length === 1) return "last";
  await db.prepare("DELETE FROM passkeys WHERE account_id = ?1 AND credential_id = ?2").bind(accountId, credentialId).run();
  return "removed";
}

/**
 * Deletes the account, its passkeys, sessions, links and agent keys. Its
 * submissions stay, as they were before they were claimed: their receipts
 * still check and withdraw them.
 */
export async function deleteAccount(db: Db, accountId: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM agent_key_uploads WHERE key_id IN (SELECT id FROM agent_keys WHERE account_id = ?1)").bind(accountId),
    db.prepare("DELETE FROM agent_keys WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM account_uploads WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM sessions WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM passkey_challenges WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM passkeys WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM accounts WHERE id = ?1").bind(accountId),
  ]);
}

// Sessions

export async function createSession(db: Db, accountId: number, tokenHash: string, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now),
    db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)").bind(tokenHash, accountId, now, now + SESSION_SECONDS),
  ]);
}

export async function sessionAccount(db: Db, tokenHash: string, now: number): Promise<number | null> {
  const row = await db.prepare("SELECT account_id FROM sessions WHERE token_hash = ?1 AND expires_at > ?2").bind(tokenHash, now).first<{ account_id: number }>();
  return row?.account_id ?? null;
}

export async function endSession(db: Db, tokenHash: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(tokenHash).run();
}

/** For the daily cron: sessions and challenges nobody can use any more. */
export async function pruneExpired(db: Db, now: number): Promise<void> {
  await db.batch([db.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now), db.prepare("DELETE FROM passkey_challenges WHERE expires_at <= ?1").bind(now)]);
}

// Submissions

export type ClaimResult = "linked" | "not_found" | "withdrawn" | "elsewhere" | "full";

/** Links the submission whose receipt hashes to `secretHash`. Repeating it changes nothing. */
export async function claimUpload(db: Db, accountId: number, secretHash: string, now: number): Promise<ClaimResult> {
  const upload = await db
    .prepare("SELECT upload.id, upload.status, link.account_id FROM uploads AS upload LEFT JOIN account_uploads AS link ON link.upload_id = upload.id WHERE upload.secret_hash = ?1")
    .bind(secretHash)
    .first<{ id: number; status: string; account_id: number | null }>();
  if (!upload) return "not_found";
  if (upload.account_id === accountId) return "linked";
  if (upload.account_id !== null) return "elsewhere";
  if (upload.status !== "completed") return "withdrawn";
  const count = await db.prepare("SELECT COUNT(*) AS n FROM account_uploads WHERE account_id = ?1").bind(accountId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_UPLOADS_PER_ACCOUNT) return "full";
  await db.prepare("INSERT INTO account_uploads (upload_id, account_id, linked_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING").bind(upload.id, accountId, now).run();
  const owner = await db.prepare("SELECT account_id FROM account_uploads WHERE upload_id = ?1").bind(upload.id).first<{ account_id: number }>();
  return owner?.account_id === accountId ? "linked" : "elsewhere";
}

export async function accountUploadIds(db: Db, accountId: number): Promise<number[]> {
  const rows = await db.prepare("SELECT upload_id FROM account_uploads WHERE account_id = ?1 ORDER BY linked_at, upload_id").bind(accountId).all<{ upload_id: number }>();
  return rows.results.map((row) => row.upload_id);
}

/** Withdraws one of the account's submissions, exactly as its receipt would. */
export async function withdrawAccountUpload(db: Db, accountId: number, uploadId: number, now: number): Promise<WithdrawResult> {
  const row = await db
    .prepare("SELECT upload.secret_hash FROM uploads AS upload JOIN account_uploads AS link ON link.upload_id = upload.id WHERE upload.id = ?1 AND link.account_id = ?2")
    .bind(uploadId, accountId)
    .first<{ secret_hash: string }>();
  if (!row) return { kind: "not_found" };
  return withdrawSubmission(db, row.secret_hash, now);
}

// Agent keys

export async function createAccountKey(db: Db, accountId: number, keyHash: string, now: number): Promise<boolean> {
  const result = await db
    .prepare("INSERT INTO agent_keys (key_hash, created_at, account_id) VALUES (?1, ?2, ?3) ON CONFLICT (key_hash) DO NOTHING")
    .bind(keyHash, now, accountId)
    .run();
  return (result as unknown as { meta: { changes: number } }).meta.changes > 0;
}

export async function revokeAccountKey(db: Db, accountId: number, keyId: number): Promise<boolean> {
  const results = (await db.batch([
    db.prepare("DELETE FROM agent_key_uploads WHERE key_id = (SELECT id FROM agent_keys WHERE id = ?1 AND account_id = ?2)").bind(keyId, accountId),
    db.prepare("DELETE FROM agent_keys WHERE id = ?1 AND account_id = ?2").bind(keyId, accountId),
  ])) as { meta: { changes: number } }[];
  return results[1].meta.changes > 0;
}

export async function accountView(db: Db, accountId: number): Promise<AccountView | null> {
  const account = await db.prepare("SELECT created_at FROM accounts WHERE id = ?1").bind(accountId).first<{ created_at: number }>();
  if (!account) return null;
  const [uploads, passkeys, keys] = await Promise.all([
    accountUploadIds(db, accountId),
    db
      .prepare("SELECT credential_id, created_at, last_used_at, backed_up FROM passkeys WHERE account_id = ?1 ORDER BY created_at, credential_id")
      .bind(accountId)
      .all<{ credential_id: string; created_at: number; last_used_at: number | null; backed_up: number }>(),
    db.prepare("SELECT id, created_at FROM agent_keys WHERE account_id = ?1 ORDER BY created_at, id").bind(accountId).all<{ id: number; created_at: number }>(),
  ]);
  return {
    createdAt: account.created_at,
    submissions: await uploadSummaries(db, uploads),
    passkeys: passkeys.results.map((row) => ({ id: row.credential_id, createdAt: row.created_at, lastUsedAt: row.last_used_at, backedUp: row.backed_up === 1 })),
    agentKeys: keys.results.map((row) => ({ id: row.id, createdAt: row.created_at })),
  };
}
