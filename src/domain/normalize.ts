import { sha256Hex } from "./hash.ts";
import type { ObservationRecord } from "./record.ts";

/**
 * JSON with object keys sorted at every level, so equal records always give
 * equal text whatever order their fields were built in.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * SHA-256 of the record's canonical form, lowercase hex: the identity of one
 * exact version. Export-only data (session numbering, the exporting build)
 * lives outside `ObservationRecord` and so can't change it, and items are in
 * slot order, so reordered item rows hash the same. Copies that differ only
 * in disclosed time precision hash differently; `compareVersions` decides
 * whether two versions are equivalent.
 */
export function contentHash(record: ObservationRecord): Promise<string> {
  return sha256Hex(canonicalJson(record));
}
