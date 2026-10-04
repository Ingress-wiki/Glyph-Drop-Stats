import type {
  HackResult,
  Item,
  ObservationRecord,
  Origin,
  Panel,
  PanelStage,
  Reading,
} from "../domain/record.ts";
import type { SqlValue } from "./db.ts";

/**
 * Converts records to and from the `record_versions`, `panels` and `items`
 * tables. Reading reverses writing exactly, so a stored version hashes the
 * same as the record it came from (tested).
 */

export const VERSION_COLUMNS = [
  "version_hash",
  "record_id",
  "kind",
  "time_basis",
  "bucket_start_utc",
  "bucket_end_utc",
  "time_precision",
  "utc_offset_minutes",
  "local_date",
  "local_hour",
  "read_status",
  "read_reason",
  "association",
  "observed_panels_read_in_full",
  "both_panels_read",
  "hack_state",
  "hack_glyph_count",
  "hacking_bonus",
  "hacking_bonus_final",
  "speed_bonus",
  "speed_bonus_final",
  "command_mode",
  "speed_command",
  "speed_command_status",
  "key_command",
  "key_command_status",
  "portal_level_low",
  "portal_level_high",
  "portal_level_confidence",
  "portal_level_conflict",
  "capture_mode",
  "game_language",
  "game_language_source",
  "source_app_version",
  "source_app_build",
  "created_at",
] as const;

export const PANEL_COLUMNS = ["version_hash", "stage", "partial", "effects"] as const;

export const ITEM_COLUMNS = [
  "version_hash",
  "stage",
  "slot",
  "item",
  "level",
  "level_state",
  "rarity",
  "rarity_source",
  "quantity",
  "multiplied",
] as const;

type VersionColumn = (typeof VERSION_COLUMNS)[number];
type PanelColumn = (typeof PANEL_COLUMNS)[number];
type ItemColumn = (typeof ITEM_COLUMNS)[number];

export type VersionRow = Record<VersionColumn, SqlValue>;
export type PanelRow = Record<PanelColumn, SqlValue>;
export type ItemRow = Record<ItemColumn, SqlValue>;

const flag = (value: boolean | null): number | null => (value === null ? null : value ? 1 : 0);

export interface RecordRows {
  version: SqlValue[];
  panels: SqlValue[][];
  items: SqlValue[][];
}

/** Rows in the column order of the constants above, ready for `bulkInsert`. */
export function toRows(record: ObservationRecord, versionHash: string, createdAt: number): RecordRows {
  const { hack, reading, origin, time } = record;
  const row: VersionRow = {
    version_hash: versionHash,
    record_id: record.recordId,
    kind: record.kind,
    time_basis: time.basis,
    bucket_start_utc: time.startUtc,
    bucket_end_utc: time.endUtc,
    time_precision: time.precision,
    utc_offset_minutes: time.utcOffsetMinutes,
    local_date: time.localDate,
    local_hour: time.localHour,
    read_status: record.readStatus,
    read_reason: record.readReason,
    association: reading?.association ?? null,
    observed_panels_read_in_full: flag(reading?.observedPanelsReadInFull ?? null),
    both_panels_read: flag(reading?.bothPanelsRead ?? null),
    hack_state: hack?.state ?? null,
    hack_glyph_count: hack?.glyphCount ?? null,
    hacking_bonus: hack?.hackingBonus?.percent ?? null,
    hacking_bonus_final: flag(hack?.hackingBonus?.final ?? null),
    speed_bonus: hack?.speedBonus?.percent ?? null,
    speed_bonus_final: flag(hack?.speedBonus?.final ?? null),
    command_mode: hack?.commands?.mode ?? null,
    speed_command: hack?.commands?.speed ?? null,
    speed_command_status: hack?.commands?.speedStatus ?? null,
    key_command: hack?.commands?.key ?? null,
    key_command_status: hack?.commands?.keyStatus ?? null,
    portal_level_low: hack?.portalLevel?.low ?? null,
    portal_level_high: hack?.portalLevel?.high ?? null,
    portal_level_confidence: hack?.portalLevel?.confidence ?? null,
    portal_level_conflict: flag(hack?.portalLevel?.conflict ?? null),
    capture_mode: origin.captureMode,
    game_language: origin.gameLanguage,
    game_language_source: origin.gameLanguageSource,
    source_app_version: origin.sourceAppVersion,
    source_app_build: origin.sourceAppBuild,
    created_at: createdAt,
  };
  const panels: SqlValue[][] = [];
  const items: SqlValue[][] = [];
  for (const panel of reading?.panels ?? []) {
    const panelRow: PanelRow = {
      version_hash: versionHash,
      stage: panel.stage,
      partial: flag(panel.partial),
      effects: panel.effects === null ? null : JSON.stringify(panel.effects),
    };
    panels.push(PANEL_COLUMNS.map((column) => panelRow[column]));
    for (const entry of panel.items) {
      const itemRow: ItemRow = {
        version_hash: versionHash,
        stage: panel.stage,
        slot: entry.slot,
        item: entry.item,
        level: entry.level,
        level_state: entry.levelState,
        rarity: entry.rarity,
        rarity_source: entry.raritySource,
        quantity: entry.quantity,
        multiplied: flag(entry.multiplied),
      };
      items.push(ITEM_COLUMNS.map((column) => itemRow[column]));
    }
  }
  return { version: VERSION_COLUMNS.map((column) => row[column]), panels, items };
}

/**
 * Rows read back from this schema. They were written by `toRows` under the
 * schema's CHECK constraints, so the casts below restore types the database
 * already enforces rather than validating outside input.
 */
export function fromRows(version: VersionRow, panelRows: PanelRow[], itemRows: ItemRow[]): ObservationRecord {
  const v = version as Record<VersionColumn, never>;
  const bool = (value: SqlValue): boolean | null => (value === null ? null : value === 1);
  const must = <T>(value: T | null): T => {
    if (value === null) throw new Error(`Stored version ${String(version.version_hash)} is missing a required value`);
    return value;
  };

  let hack: HackResult | null = null;
  if (v.kind === "hack") {
    hack = {
      state: must(v.hack_state),
      glyphCount: must(v.hack_glyph_count),
      hackingBonus:
        v.hacking_bonus === null ? null : { percent: v.hacking_bonus, final: must(bool(v.hacking_bonus_final)) },
      speedBonus: v.speed_bonus === null ? null : { percent: v.speed_bonus, final: must(bool(v.speed_bonus_final)) },
      commands:
        v.command_mode === null
          ? null
          : {
              mode: v.command_mode,
              speed: v.speed_command,
              speedStatus: must(v.speed_command_status),
              key: v.key_command,
              keyStatus: must(v.key_command_status),
            },
      portalLevel:
        v.portal_level_low === null
          ? null
          : {
              low: v.portal_level_low,
              high: must(v.portal_level_high),
              confidence: must(v.portal_level_confidence),
              conflict: must(bool(v.portal_level_conflict)),
            },
    };
  }

  let reading: Reading | null = null;
  if (v.read_status === "read") {
    const order: Record<PanelStage, number> = { portal: 0, bonus: 1 };
    const panels: Panel[] = panelRows
      .map((row) => {
        const stage = row.stage as PanelStage;
        const items: Item[] = itemRows
          .filter((itemRow) => itemRow.stage === stage)
          .map((itemRow) => {
            const i = itemRow as Record<ItemColumn, never>;
            return {
              slot: i.slot,
              item: i.item,
              level: i.level,
              levelState: i.level_state,
              rarity: i.rarity,
              raritySource: i.rarity_source,
              quantity: i.quantity,
              multiplied: bool(i.multiplied),
            };
          })
          .sort((a, b) => a.slot - b.slot);
        return {
          stage,
          partial: row.partial === 1,
          effects: row.effects === null ? null : (JSON.parse(String(row.effects)) as string[]),
          items,
        };
      })
      .sort((a, b) => order[a.stage] - order[b.stage]);
    reading = {
      association: must(v.association),
      observedPanelsReadInFull: must(bool(v.observed_panels_read_in_full)),
      bothPanelsRead: must(bool(v.both_panels_read)),
      panels,
    };
  }

  const origin: Origin = {
    captureMode: v.capture_mode,
    gameLanguage: v.game_language,
    gameLanguageSource: v.game_language_source,
    sourceAppVersion: v.source_app_version,
    sourceAppBuild: v.source_app_build,
  };

  return {
    recordId: v.record_id,
    kind: v.kind,
    time: {
      basis: v.time_basis,
      startUtc: v.bucket_start_utc,
      endUtc: v.bucket_end_utc,
      precision: v.time_precision,
      utcOffsetMinutes: v.utc_offset_minutes,
      localDate: v.local_date,
      localHour: v.local_hour,
    },
    readStatus: v.read_status,
    readReason: v.read_reason,
    reading,
    hack,
    origin,
  };
}
