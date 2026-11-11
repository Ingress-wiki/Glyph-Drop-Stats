import type { Db } from "./db.ts";

/**
 * Read-only agent keys (src/domain/agentKey.ts). A key is linked to a
 * submission by the holder of that submission's receipt, and reads the
 * records its linked, active submissions supply. Revoking deletes the key
 * and its links: nothing is kept of which submissions it grouped.
 */

/** A player's exports, many times over; it bounds what one key's queries read. */
export const MAX_UPLOADS_PER_KEY = 100;

export type LinkResult = { kind: "linked"; submissions: number } | { kind: "not_found" } | { kind: "withdrawn" } | { kind: "full" } | { kind: "account_key" };

const linkedCount = (db: Db, keyHash: string) =>
  db
    .prepare("SELECT COUNT(*) AS n FROM agent_key_uploads WHERE key_id = (SELECT id FROM agent_keys WHERE key_hash = ?1)")
    .bind(keyHash)
    .first<{ n: number }>()
    .then((row) => row?.n ?? 0);

/**
 * Links the submission whose receipt hashes to `secretHash` to the key,
 * creating the key on its first link. Repeating it changes nothing, so a
 * lost answer can be retried. Only an active submission can be linked.
 */
export async function linkAgentKey(db: Db, secretHash: string, keyHash: string, now: number): Promise<LinkResult> {
  const upload = await db.prepare("SELECT id, status FROM uploads WHERE secret_hash = ?1").bind(secretHash).first<{ id: number; status: string }>();
  if (!upload) return { kind: "not_found" };
  if (upload.status !== "completed") return { kind: "withdrawn" };
  const key = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM agent_key_uploads WHERE key_id = agent_key.id) AS n,
         EXISTS (SELECT 1 FROM agent_key_uploads WHERE key_id = agent_key.id AND upload_id = ?2) AS linked,
         agent_key.account_id
       FROM agent_keys AS agent_key WHERE agent_key.key_hash = ?1`,
    )
    .bind(keyHash, upload.id)
    .first<{ n: number; linked: number; account_id: number | null }>();
  // An account's key reads what the account holds; a submission joins it through the account.
  if (key && key.account_id !== null) return { kind: "account_key" };
  if (key && !key.linked && key.n >= MAX_UPLOADS_PER_KEY) return { kind: "full" };
  await db.batch([
    db.prepare("INSERT INTO agent_keys (key_hash, created_at) VALUES (?1, ?2) ON CONFLICT (key_hash) DO NOTHING").bind(keyHash, now),
    db
      .prepare("INSERT INTO agent_key_uploads (key_id, upload_id, linked_at) SELECT id, ?2, ?3 FROM agent_keys WHERE key_hash = ?1 ON CONFLICT DO NOTHING")
      .bind(keyHash, upload.id, now),
  ]);
  return { kind: "linked", submissions: await linkedCount(db, keyHash) };
}

/** Deletes the key and its links. False when no key matched: never made, or already revoked. */
export async function revokeAgentKey(db: Db, keyHash: string): Promise<boolean> {
  const results = (await db.batch([
    db.prepare("DELETE FROM agent_key_uploads WHERE key_id = (SELECT id FROM agent_keys WHERE key_hash = ?1)").bind(keyHash),
    db.prepare("DELETE FROM agent_keys WHERE key_hash = ?1").bind(keyHash),
  ])) as { meta: { changes: number } }[];
  return results[1].meta.changes > 0;
}

/**
 * The uploads a key reads, oldest link first; null when no key matches. An
 * account's key reads every submission in the account, including ones added
 * after it was made.
 */
export async function keyUploads(db: Db, keyHash: string): Promise<number[] | null> {
  const key = await db.prepare("SELECT id, account_id FROM agent_keys WHERE key_hash = ?1").bind(keyHash).first<{ id: number; account_id: number | null }>();
  if (!key) return null;
  const rows = await (key.account_id === null
    ? db.prepare("SELECT upload_id FROM agent_key_uploads WHERE key_id = ?1 ORDER BY linked_at, upload_id").bind(key.id)
    : db.prepare("SELECT upload_id FROM account_uploads WHERE account_id = ?1 ORDER BY linked_at, upload_id").bind(key.account_id)
  ).all<{ upload_id: number }>();
  return rows.results.map((row) => row.upload_id);
}

/**
 * The records the uploads supply that count: those an active one supports,
 * by the same rule as the `counted_records` view. A withdrawn upload
 * supplies nothing.
 */
export async function ownRecordIds(db: Db, uploadIds: readonly number[]): Promise<Set<string>> {
  if (uploadIds.length === 0) return new Set();
  const rows = await db
    .prepare(
      `SELECT DISTINCT link.record_id
       FROM upload_records AS link
       JOIN uploads AS upload ON upload.id = link.upload_id
       WHERE link.upload_id IN (SELECT value FROM json_each(?1))
         AND link.outcome IN ('new', 'duplicate', 'duplicate_other_precision')
         AND upload.status = 'completed'`,
    )
    .bind(JSON.stringify(uploadIds))
    .all<{ record_id: string }>();
  return new Set(rows.results.map((row) => row.record_id));
}
