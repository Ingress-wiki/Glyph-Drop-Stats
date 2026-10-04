import { sha256Hex } from "../domain/hash.ts";
import type { ImportResult } from "../domain/importer.ts";
import { contentHash } from "../domain/normalize.ts";
import { hashReceiptSecret } from "../domain/receipt.ts";
import type { ObservationRecord } from "../domain/record.ts";
import type { SubmissionSummary } from "../domain/submission.ts";
import { compareVersions, emptyOutcomeCounts, OUTCOMES, type Outcome } from "../domain/versions.ts";
import { bulkInsert, jsonChunks, type Db, type DbStatement } from "./db.ts";
import {
  fromRows,
  ITEM_COLUMNS,
  PANEL_COLUMNS,
  toRows,
  VERSION_COLUMNS,
  type ItemRow,
  type PanelRow,
  type VersionRow,
} from "./rows.ts";

export interface Classified {
  record: ObservationRecord;
  versionHash: string;
  outcome: Outcome;
}

/** Ids or hashes as JSON arrays small enough for one bound parameter each. */
const idChunks = (values: readonly string[]) => jsonChunks(values);

/** Stored versions rebuilt as records, by version hash. */
export async function loadVersions(db: Db, hashes: readonly string[]): Promise<Map<string, ObservationRecord>> {
  const versions = new Map<string, ObservationRecord>();
  for (const chunk of idChunks(hashes)) {
    const inChunk = "version_hash IN (SELECT value FROM json_each(?1))";
    const [versionRows, panelRows, itemRows] = await Promise.all([
      db.prepare(`SELECT * FROM record_versions WHERE ${inChunk}`).bind(chunk).all<VersionRow>(),
      db.prepare(`SELECT * FROM panels WHERE ${inChunk}`).bind(chunk).all<PanelRow>(),
      db.prepare(`SELECT * FROM items WHERE ${inChunk}`).bind(chunk).all<ItemRow>(),
    ]);
    for (const version of versionRows.results) {
      const hash = version.version_hash;
      versions.set(
        String(hash),
        fromRows(
          version,
          panelRows.results.filter((row) => row.version_hash === hash),
          itemRows.results.filter((row) => row.version_hash === hash),
        ),
      );
    }
  }
  return versions;
}

/**
 * Classifies each record against the accepted version of its `record_id`.
 * Read-only: the preview uses it as is, and confirmation commits its result
 * only if no other upload claimed one of the new records meanwhile.
 */
export async function classify(db: Db, records: readonly ObservationRecord[]): Promise<Classified[]> {
  const hashes = await Promise.all(records.map(contentHash));
  const accepted = new Map<string, string>();
  for (const chunk of idChunks(records.map((record) => record.recordId))) {
    const rows = await db
      .prepare("SELECT record_id, version_hash FROM accepted_versions WHERE record_id IN (SELECT value FROM json_each(?1))")
      .bind(chunk)
      .all<{ record_id: string; version_hash: string }>();
    for (const row of rows.results) accepted.set(row.record_id, row.version_hash);
  }

  const differing = new Set<string>();
  records.forEach((record, index) => {
    const acceptedHash = accepted.get(record.recordId);
    if (acceptedHash !== undefined && acceptedHash !== hashes[index]) differing.add(acceptedHash);
  });
  const acceptedVersions = await loadVersions(db, [...differing]);

  return records.map((record, index) => {
    const versionHash = hashes[index];
    const acceptedHash = accepted.get(record.recordId);
    if (acceptedHash === undefined) return { record, versionHash, outcome: "new" };
    if (acceptedHash === versionHash) return { record, versionHash, outcome: "duplicate" };
    const acceptedRecord = acceptedVersions.get(acceptedHash);
    if (!acceptedRecord) throw new Error(`Accepted version ${acceptedHash} is missing`);
    return { record, versionHash, outcome: compareVersions(acceptedRecord, record) };
  });
}

export function countOutcomes(classified: readonly Classified[]): Record<Outcome, number> {
  const counts = emptyOutcomeCounts();
  for (const entry of classified) counts[entry.outcome]++;
  return counts;
}

export interface SubmissionInput {
  secret: string;
  fileBytes: Uint8Array<ArrayBuffer>;
  parsed: Extract<ImportResult, { ok: true }>;
  /** Unix seconds. */
  now: number;
}

export interface Prepared {
  secretHash: string;
  fileHash: string;
  classified: Classified[];
  statements: DbStatement[];
  summary: SubmissionSummary;
}

/**
 * Classifies the upload and builds the one batch that commits it: the upload,
 * its new versions, claims on records nobody had accepted, and every link.
 * Running the batch either applies all of it or none of it.
 */
export async function prepareSubmission(db: Db, input: SubmissionInput): Promise<Prepared> {
  const { parsed, now } = input;
  const [secretHash, fileHash] = await Promise.all([hashReceiptSecret(input.secret), sha256Hex(input.fileBytes)]);
  const classified = await classify(
    db,
    parsed.records.map((entry) => entry.record),
  );

  const statements: DbStatement[] = [
    db
      .prepare(
        `INSERT INTO uploads (secret_hash, file_hash, status, created_at, format_version,
           exporter_app_version, exporter_app_build, row_count, rejected_count)
         VALUES (?1, ?2, 'completed', ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        secretHash,
        fileHash,
        now,
        parsed.formatVersion,
        parsed.exporter.appVersion,
        parsed.exporter.appBuild,
        parsed.rowCount,
        parsed.rejected.length,
      ),
  ];

  // An exact duplicate's version is already stored.
  const versions = { version: [] as unknown[], panels: [] as unknown[], items: [] as unknown[] };
  for (const entry of classified) {
    if (entry.outcome === "duplicate") continue;
    const rows = toRows(entry.record, entry.versionHash, now);
    versions.version.push(rows.version);
    versions.panels.push(...rows.panels);
    versions.items.push(...rows.items);
  }
  // Identical by construction when another upload stored the same version first, so a
  // duplicate key is ignored.
  for (const chunk of jsonChunks(versions.version)) {
    statements.push(bulkInsert(db, "record_versions", VERSION_COLUMNS, chunk, "ignore"));
  }
  for (const chunk of jsonChunks(versions.panels)) {
    statements.push(bulkInsert(db, "panels", PANEL_COLUMNS, chunk, "ignore"));
  }
  for (const chunk of jsonChunks(versions.items)) {
    statements.push(bulkInsert(db, "items", ITEM_COLUMNS, chunk, "ignore"));
  }

  const uploadId = "(SELECT id FROM uploads WHERE secret_hash = ?2)";
  // A plain INSERT: if a concurrent upload claimed one of these records after `classify`
  // read the table, the primary key fails and the whole batch rolls back.
  const claims = classified.filter((entry) => entry.outcome === "new").map((entry) => [entry.record.recordId, entry.versionHash]);
  for (const chunk of jsonChunks(claims)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO accepted_versions (record_id, version_hash, upload_id, decision, decided_at)
           SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ${uploadId}, 'first_confirmed', ?3
           FROM json_each(?1)`,
        )
        .bind(chunk, secretHash, now),
    );
  }
  const links = classified.map((entry) => [entry.record.recordId, entry.versionHash, entry.outcome]);
  for (const chunk of jsonChunks(links)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO upload_records (upload_id, record_id, version_hash, outcome)
           SELECT ${uploadId}, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]')
           FROM json_each(?1)`,
        )
        .bind(chunk, secretHash),
    );
  }

  return {
    secretHash,
    fileHash,
    classified,
    statements,
    summary: {
      status: "completed",
      createdAt: now,
      rowCount: parsed.rowCount,
      rejected: parsed.rejected.length,
      outcomes: countOutcomes(classified),
    },
  };
}

interface StoredUpload {
  fileHash: string;
  summary: SubmissionSummary;
}

export async function findSubmission(db: Db, secretHash: string): Promise<StoredUpload | null> {
  const upload = await db
    .prepare("SELECT id, file_hash, status, created_at, row_count, rejected_count FROM uploads WHERE secret_hash = ?1")
    .bind(secretHash)
    .first<{
      id: number;
      file_hash: string;
      status: SubmissionSummary["status"];
      created_at: number;
      row_count: number;
      rejected_count: number;
    }>();
  if (!upload) return null;
  const rows = await db
    .prepare("SELECT outcome, COUNT(*) AS n FROM upload_records WHERE upload_id = ?1 GROUP BY outcome")
    .bind(upload.id)
    .all<{ outcome: Outcome; n: number }>();
  const outcomes = emptyOutcomeCounts();
  for (const row of rows.results) {
    if (OUTCOMES.includes(row.outcome)) outcomes[row.outcome] = row.n;
  }
  return {
    fileHash: upload.file_hash,
    summary: {
      status: upload.status,
      createdAt: upload.created_at,
      rowCount: upload.row_count,
      rejected: upload.rejected_count,
      outcomes,
    },
  };
}

export type ConfirmResult =
  | { kind: "created"; summary: SubmissionSummary }
  /** The same receipt and file were already confirmed: a retry, often after a lost response. */
  | { kind: "replayed"; summary: SubmissionSummary }
  /** The receipt was already used for a different file. */
  | { kind: "receipt_in_use" };

const MAX_ATTEMPTS = 4;

function isUniqueViolation(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error).includes("UNIQUE constraint failed");
}

/**
 * Confirms an upload, safely under retries and concurrency:
 *
 * - The receipt is the idempotency key. If it was already confirmed with the
 *   same file, the stored result is returned and nothing is counted again.
 * - Everything commits in one batch. A concurrent upload that claims one of
 *   the same new records first makes the batch fail on a unique key; the
 *   upload is then classified again against the now-accepted version.
 */
export async function confirmSubmission(db: Db, input: SubmissionInput): Promise<ConfirmResult> {
  const fileHash = await sha256Hex(input.fileBytes);
  const secretHash = await hashReceiptSecret(input.secret);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const existing = await findSubmission(db, secretHash);
    if (existing) {
      return existing.fileHash === fileHash ? { kind: "replayed", summary: existing.summary } : { kind: "receipt_in_use" };
    }
    const prepared = await prepareSubmission(db, input);
    try {
      await db.batch(prepared.statements);
      return { kind: "created", summary: prepared.summary };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
    }
  }
  throw new Error(`Confirmation kept conflicting with concurrent uploads: ${String(lastError)}`);
}
