import type { Exporter, ImportResult, Issue, RejectedRecord } from "./importer.ts";
import type { Kind, ReadStatus } from "./record.ts";
import type { Outcome } from "./versions.ts";

/**
 * What the uploader sees before confirming. It echoes record ids, line
 * numbers and reasons only, never the file's other contents.
 */
export type Preview =
  | { ok: false; issues: Issue[] }
  | {
      ok: true;
      formatVersion: number;
      exporter: Exporter;
      rowCount: number;
      warnings: Issue[];
      records: {
        valid: number;
        rejected: number;
        byKind: Record<Kind, number>;
        byReadStatus: Record<ReadStatus, number>;
        /** Read records where a panel was partial or a row unidentified. */
        partlyRead: number;
      };
      /**
       * How the valid records compare with accepted data right now. Another
       * upload may land before confirmation, so the final result can differ.
       */
      outcomes: Record<Outcome, number>;
      rejected: RejectedRecord[];
    };

export function previewOf(result: ImportResult, outcomes: Record<Outcome, number>): Preview {
  if (!result.ok) return result;
  const byKind: Record<Kind, number> = { hack: 0, drop: 0 };
  const byReadStatus: Record<ReadStatus, number> = { read: 0, notRead: 0, unavailable: 0, unsupported: 0 };
  let partlyRead = 0;
  for (const { record } of result.records) {
    byKind[record.kind]++;
    byReadStatus[record.readStatus]++;
    if (record.reading && !record.reading.observedPanelsReadInFull) partlyRead++;
  }
  return {
    ok: true,
    formatVersion: result.formatVersion,
    exporter: result.exporter,
    rowCount: result.rowCount,
    warnings: result.warnings,
    records: { valid: result.records.length, rejected: result.rejected.length, byKind, byReadStatus, partlyRead },
    outcomes,
    rejected: result.rejected,
  };
}
