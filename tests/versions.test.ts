import { describe, expect, it } from "vitest";
import { parseExport } from "../src/domain/importer.ts";
import type { ObservationRecord } from "../src/domain/record.ts";
import { compareVersions } from "../src/domain/versions.ts";
import { bytes, csv, DROP_ID, dropRecord, fullHackRows, hackRecord, item, type Row } from "./helpers/export.ts";

const NOW = Date.UTC(2026, 9, 4) / 1000;

function record(rows: Row[]): ObservationRecord {
  const result = parseExport(bytes(csv(rows)), { now: NOW });
  if (!result.ok || result.records.length !== 1) throw new Error(`expected one record: ${JSON.stringify(result)}`);
  return result.records[0].record;
}

/** The day at UTC+08:00 that holds the helpers' 07:00 hour. */
const DAY: Row = {
  time_bucket_start_utc: "2026-10-02T16:00:00Z",
  time_bucket_end_utc: "2026-10-03T16:00:00Z",
  local_hour: "",
};

const NO_READING: Row = {
  read_status: "unavailable",
  association: "",
  observed_panels_read_in_full: "",
  both_panels_read: "",
};

describe("compareVersions", () => {
  it("finds a re-export a duplicate", () => {
    expect(compareVersions(record(fullHackRows()), record(fullHackRows({ session: "3", order: "9" })))).toBe("duplicate");
  });

  it("treats the same observation exported by hour and by day as a duplicate, either way round", () => {
    const hour = record(fullHackRows());
    const day = record(fullHackRows(DAY));
    expect(compareVersions(hour, day)).toBe("duplicate_other_precision");
    expect(compareVersions(day, hour)).toBe("duplicate_other_precision");
  });

  it("finds an hour outside the day a conflict", () => {
    const otherDay: Row = {
      time_bucket_start_utc: "2026-10-03T16:00:00Z",
      time_bucket_end_utc: "2026-10-04T16:00:00Z",
      local_date: "2026-10-04",
      local_hour: "",
    };
    expect(compareVersions(record(fullHackRows()), record(fullHackRows(otherDay)))).toBe("conflict");
  });

  it("finds different hours or offsets a conflict", () => {
    const nextHour: Row = {
      time_bucket_start_utc: "2026-10-03T00:00:00Z",
      time_bucket_end_utc: "2026-10-03T01:00:00Z",
      local_hour: "8",
    };
    expect(compareVersions(record(fullHackRows()), record(fullHackRows(nextHour)))).toBe("conflict");
    const utc: Row = {
      time_bucket_start_utc: "2026-10-02T23:00:00Z",
      time_bucket_end_utc: "2026-10-03T00:00:00Z",
      local_date: "",
      local_hour: "",
      utc_offset_minutes: "",
    };
    expect(compareVersions(record(fullHackRows()), record(fullHackRows(utc)))).toBe("conflict");
  });

  it("finds changed gear a conflict, even with compatible time", () => {
    const changed = fullHackRows(DAY);
    changed[0].quantity = "5";
    expect(compareVersions(record(fullHackRows()), record(changed))).toBe("conflict");
  });

  it("holds a late gear reading as an update candidate, not the other way round", () => {
    const before = record([hackRecord(NO_READING)]);
    const after = record(fullHackRows());
    expect(compareVersions(before, after)).toBe("update_candidate");
    expect(compareVersions(after, before)).toBe("conflict");
  });

  it("doesn't take a late reading whose hack result differs", () => {
    const before = record([hackRecord({ ...NO_READING, hacking_bonus: "100" })]);
    expect(compareVersions(before, record(fullHackRows()))).toBe("conflict");
  });

  it("doesn't take a late reading that contradicts the known origin", () => {
    const before = record([hackRecord({ ...NO_READING, game_language: "ja" })]);
    expect(compareVersions(before, record(fullHackRows()))).toBe("conflict");
    const unknownOrigin = record([hackRecord({ ...NO_READING, game_language: "", game_language_source: "" })]);
    expect(compareVersions(unknownOrigin, record(fullHackRows()))).toBe("update_candidate");
  });

  it("refuses to compare different records", () => {
    const drop = record([{ ...dropRecord({ record_id: DROP_ID }), ...item("portal", 0) }]);
    expect(() => compareVersions(record(fullHackRows()), drop)).toThrow();
  });
});
