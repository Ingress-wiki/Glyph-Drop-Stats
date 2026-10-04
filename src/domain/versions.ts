import { canonicalJson } from "./normalize.ts";
import type { ObservationRecord, TimeBucket } from "./record.ts";

/**
 * How an incoming copy of a record relates to the version already accepted
 * for its `record_id`. Nothing here replaces the accepted version; the
 * caller records the outcome and decides.
 *
 * - `duplicate`: the same observation with the same time.
 * - `duplicate_other_precision`: the same observation; one interval is the
 *   hour inside the other's day, at the same offset. The player only
 *   changed "Include the hour". The accepted time stays as it is.
 * - `update_candidate`: the accepted copy had no gear reading
 *   (`unavailable` or `unsupported`) and the incoming one is read, with the
 *   hack and time otherwise compatible: the expected late gear reading. It is
 *   held for separate handling, not applied.
 * - `conflict`: anything else, including incompatible times.
 */
export type VersionRelation = "duplicate" | "duplicate_other_precision" | "update_candidate" | "conflict";

export type TimeRelation = "same" | "other_precision" | "incompatible";

/**
 * Validated intervals derive their local columns from the start and offset,
 * so comparing basis, offset and bounds is enough.
 */
export function compareTime(a: TimeBucket, b: TimeBucket): TimeRelation {
  if (a.basis !== b.basis || a.utcOffsetMinutes !== b.utcOffsetMinutes) return "incompatible";
  if (a.precision === b.precision) {
    return a.startUtc === b.startUtc && a.endUtc === b.endUtc ? "same" : "incompatible";
  }
  const [hour, day] = a.precision === "hour" ? [a, b] : [b, a];
  return day.startUtc <= hour.startUtc && hour.endUtc <= day.endUtc ? "other_precision" : "incompatible";
}

/** Everything about the record except its time interval. */
function observationWithoutTime(record: ObservationRecord): string {
  return canonicalJson({ ...record, time: null });
}

/** Origin fields known in the earlier copy must agree with the later one. */
function originCompatible(earlier: ObservationRecord, later: ObservationRecord): boolean {
  return (Object.keys(earlier.origin) as (keyof ObservationRecord["origin"])[]).every(
    (key) => earlier.origin[key] === null || earlier.origin[key] === later.origin[key],
  );
}

export function compareVersions(accepted: ObservationRecord, incoming: ObservationRecord): VersionRelation {
  if (accepted.recordId !== incoming.recordId) {
    throw new Error("compareVersions needs two copies of the same record");
  }
  const time = compareTime(accepted.time, incoming.time);
  if (time === "incompatible") return "conflict";

  if (observationWithoutTime(accepted) === observationWithoutTime(incoming)) {
    return time === "same" ? "duplicate" : "duplicate_other_precision";
  }

  const lateReading =
    accepted.kind === "hack" &&
    (accepted.readStatus === "unavailable" || accepted.readStatus === "unsupported") &&
    incoming.readStatus === "read" &&
    canonicalJson(accepted.hack) === canonicalJson(incoming.hack) &&
    originCompatible(accepted, incoming);
  return lateReading ? "update_candidate" : "conflict";
}
