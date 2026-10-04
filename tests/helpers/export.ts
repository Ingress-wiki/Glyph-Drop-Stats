import { COLUMN_NAMES, type ColumnName } from "../../src/domain/format.ts";

export type Row = Partial<Record<ColumnName, string>>;

export const HACK_ID = "h3f9a0c7e5b1d2a4c8e6f0b9d7c5a3e1f";
export const DROP_ID = "d81c2e94b07fa3d5e6a1f0c9b8d7e6f5a";
export const OTHER_HACK_ID = "h5b7d1a0e93c2f468a0b1c2d3e4f5a6b7";

/** 2026-10-03 07:00 at UTC+08:00, the hour every builder below uses. */
const TIME: Row = {
  time_bucket_start_utc: "2026-10-02T23:00:00Z",
  time_bucket_end_utc: "2026-10-03T00:00:00Z",
  local_date: "2026-10-03",
  local_hour: "7",
  utc_offset_minutes: "480",
};

const ORIGIN: Row = {
  capture_mode: "glyphAssistance",
  game_language: "en",
  game_language_source: "detected",
  source_app_version: "0.1.0",
  source_app_build: "74",
};

const EXPORTER: Row = { exporter_app_version: "0.1.0", exporter_app_build: "74" };

const HACK: Row = {
  hack_state: "complete",
  hack_glyph_count: "4",
  hacking_bonus: "120",
  hacking_bonus_final: "true",
  speed_bonus: "40",
  speed_bonus_final: "false",
  command_mode: "portal",
  speed_command: "complex",
  speed_command_status: "confirmed",
  key_command_status: "noCommandObserved",
  portal_level_low: "6",
  portal_level_high: "6",
  portal_level_confidence: "high",
  portal_level_conflict: "false",
};

/** The record-level cells of a read hack. */
export function hackRecord(overrides: Row = {}): Row {
  return {
    format_version: "1",
    record_id: HACK_ID,
    kind: "hack",
    time_basis: "hack_first_seen",
    ...TIME,
    session: "1",
    order: "1",
    read_status: "read",
    association: "ordered",
    observed_panels_read_in_full: "true",
    both_panels_read: "true",
    ...HACK,
    ...ORIGIN,
    ...EXPORTER,
    ...overrides,
  };
}

/** The record-level cells of a drop. */
export function dropRecord(overrides: Row = {}): Row {
  return {
    format_version: "1",
    record_id: DROP_ID,
    kind: "drop",
    time_basis: "drop_closed",
    ...TIME,
    session: "1",
    order: "2",
    read_status: "read",
    association: "noWaitingHack",
    observed_panels_read_in_full: "true",
    both_panels_read: "false",
    ...ORIGIN,
    ...EXPORTER,
    ...overrides,
  };
}

export function item(panel: "portal" | "bonus", slot: number, cells: Row = {}): Row {
  return {
    panel,
    panel_partial: "false",
    slot: String(slot),
    item: "Resonator",
    level: "6",
    level_state: "known",
    quantity: "1",
    ...cells,
  };
}

/** A hack read in full: two portal items and one Bonus item. */
export function fullHackRows(overrides: Row = {}): Row[] {
  const record = hackRecord(overrides);
  return [
    { ...record, ...item("portal", 0, { quantity: "2", multiplied: "true" }) },
    {
      ...record,
      ...item("portal", 1, {
        item: "Portal Shield",
        level: "",
        level_state: "notApplicable",
        rarity: "rare",
        rarity_source: "read",
      }),
    },
    {
      ...record,
      ...item("bonus", 0, {
        item: "Hypercube",
        level: "",
        level_state: "notApplicable",
        rarity: "veryRare",
        rarity_source: "fixed",
        multiplied: "false",
      }),
    },
  ];
}

function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/** A v1 file: the real header, then each row's cells in column order. */
export function csv(rows: Row[], options: { header?: readonly string[]; extra?: string[][] } = {}): string {
  const header = options.header ?? COLUMN_NAMES;
  const lines = [header.map(quote).join(",")];
  rows.forEach((row, index) => {
    const cells = COLUMN_NAMES.map((name) => row[name] ?? "");
    const extra = options.extra?.[index] ?? [];
    lines.push([...cells, ...extra].map(quote).join(","));
  });
  return lines.map((line) => `${line}\r\n`).join("");
}

export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** The n-th synthetic hack id, distinct from the fixed ids above. */
export function hackId(n: number): string {
  return `h${n.toString(16).padStart(32, "0")}`;
}
