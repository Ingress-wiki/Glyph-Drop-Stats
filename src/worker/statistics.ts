import type { ObservationRecord } from "../domain/record.ts";
import { computeStatistics, type Statistics, type StatsFilter } from "../domain/statistics.ts";
import type { Db } from "./db.ts";
import { loadVersions } from "./submissions.ts";

/**
 * The accepted version of every record that counts, read only through the
 * `counted_records` view: one row per record, however many uploads support
 * it, and nothing from withdrawn uploads, conflicts or update candidates.
 *
 * A UTC range is applied in SQL to bound the work, keeping intervals that
 * overlap it so that ones crossing its boundary can be reported. Every other
 * rule is applied by `computeStatistics`.
 */
export async function loadCountedRecords(db: Db, utc: StatsFilter["utc"]): Promise<ObservationRecord[]> {
  const rows = await db
    .prepare(
      `SELECT counted.version_hash
       FROM counted_records AS counted
       JOIN record_versions AS version ON version.version_hash = counted.version_hash
       WHERE ?1 IS NULL OR (version.bucket_end_utc > ?1 AND version.bucket_start_utc < ?2)`,
    )
    .bind(utc?.from ?? null, utc?.to ?? null)
    .all<{ version_hash: string }>();
  const versions = await loadVersions(
    db,
    rows.results.map((row) => row.version_hash),
  );
  return [...versions.values()];
}

/** Computed on every request from current data: there is no cache to refresh after a withdrawal. */
export async function statistics(db: Db, filter: StatsFilter): Promise<Statistics> {
  return computeStatistics(await loadCountedRecords(db, filter.utc), filter);
}
