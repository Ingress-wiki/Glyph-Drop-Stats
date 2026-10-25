import type { ObservationRecord } from "../domain/record.ts";
import { computeStatistics, type Statistics, type StatsFilter } from "../domain/statistics.ts";
import type { Db } from "./db.ts";
import { loadVersions } from "./submissions.ts";

export interface CountedRecords {
  records: ObservationRecord[];
  /** Record id → the earliest active upload that supplied it. */
  uploadOf: Map<string, number>;
}

/**
 * The accepted version of every record that counts, read only through the
 * `counted_records` view: one row per record, however many uploads support
 * it, and nothing from withdrawn uploads, conflicts or update candidates.
 * Each comes with the earliest completed upload that supports it, by the
 * same rule as the view.
 *
 * A UTC range is applied in SQL to bound the work, keeping intervals that
 * overlap it so that ones crossing its boundary can be reported. Every other
 * rule is applied by `computeStatistics`.
 */
export async function loadCountedRecords(db: Db, utc: StatsFilter["utc"]): Promise<CountedRecords> {
  const rows = await db
    .prepare(
      `SELECT counted.version_hash, counted.record_id,
         (SELECT MIN(link.upload_id)
          FROM upload_records AS link
          JOIN uploads AS upload ON upload.id = link.upload_id
          WHERE link.record_id = counted.record_id
            AND link.outcome IN ('new', 'duplicate', 'duplicate_other_precision')
            AND upload.status = 'completed') AS upload_id
       FROM counted_records AS counted
       JOIN record_versions AS version ON version.version_hash = counted.version_hash
       WHERE ?1 IS NULL OR (version.bucket_end_utc > ?1 AND version.bucket_start_utc < ?2)`,
    )
    .bind(utc?.from ?? null, utc?.to ?? null)
    .all<{ version_hash: string; record_id: string; upload_id: number }>();
  const versions = await loadVersions(
    db,
    rows.results.map((row) => row.version_hash),
  );
  return {
    records: [...versions.values()],
    uploadOf: new Map(rows.results.map((row) => [row.record_id, row.upload_id])),
  };
}

/** Computed on every request from current data: there is no cache to refresh after a withdrawal. */
export async function statistics(db: Db, filter: StatsFilter): Promise<Statistics> {
  const { records, uploadOf } = await loadCountedRecords(db, filter.utc);
  return computeStatistics(records, filter, uploadOf);
}
