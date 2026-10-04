import {
  ASSOCIATIONS,
  BOUNDS,
  CAPTURE_MODES,
  COLUMN_TYPES,
  COMMAND_MODES,
  COMMAND_STATUSES,
  GAME_LANGUAGE_SOURCES,
  GAME_LANGUAGES,
  HACK_STATES,
  ITEM_NAME_PATTERN,
  ITEM_NAMES,
  KEY_COMMANDS,
  KINDS,
  LEVEL_STATES,
  PANEL_EFFECTS,
  PANELS,
  PORTAL_LEVEL_CONFIDENCES,
  RARITIES,
  RARITY_SOURCES,
  READ_REASONS,
  READ_STATUSES,
  SPEED_COMMANDS,
  SPREADSHEET_GUARDED_PREFIXES,
  TIME_BASES,
  type ColumnName,
} from "./format.ts";

/** A cell that can't hold what its column allows. */
export class Invalid {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

/** Decodes a non-blank cell. Blank cells never reach a decoder: blank is null. */
type Decoder<T> = (raw: string) => T | Invalid;

const INTEGER = /^(0|-?[1-9][0-9]*)$/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RECORD_ID = /^[hd][0-9a-f]{32}$/;
const APP_VERSION = /^[0-9A-Za-z._+-]+$/;

const ITEM_NAME_SET: ReadonlySet<string> = new Set(ITEM_NAMES);
const PANEL_EFFECT_SET: ReadonlySet<string> = new Set(PANEL_EFFECTS);

function integer(min: number, max: number): Decoder<number> {
  return (raw) => {
    if (!INTEGER.test(raw)) return new Invalid("is not an integer");
    const value = Number(raw);
    if (value < min || value > max) return new Invalid(`is outside ${min}–${max}`);
    return value;
  };
}

const boolean: Decoder<boolean> = (raw) =>
  raw === "true" ? true : raw === "false" ? false : new Invalid('is not "true" or "false"');

function oneOf<const T extends readonly string[]>(values: T): Decoder<T[number]> {
  const allowed: ReadonlySet<string> = new Set(values);
  return (raw) => (allowed.has(raw) ? (raw as T[number]) : new Invalid("is not an allowed value"));
}

/** Unix seconds of a `YYYY-MM-DDTHH:MM:SSZ` timestamp. */
const timestamp: Decoder<number> = (raw) => {
  const match = TIMESTAMP.exec(raw);
  if (!match) return new Invalid("is not a YYYY-MM-DDTHH:MM:SSZ timestamp");
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return new Invalid("is not a real time");
  }
  return ms / 1000;
};

const date: Decoder<string> = (raw) => {
  const match = DATE.exec(raw);
  if (!match) return new Invalid("is not a YYYY-MM-DD date");
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return new Invalid("is not a real date");
  }
  return raw;
};

const recordId: Decoder<string> = (raw) =>
  RECORD_ID.test(raw) ? raw : new Invalid("is not h or d followed by 32 lowercase hex digits");

export const isListedItem = (name: string): boolean => ITEM_NAME_SET.has(name);

const itemName: Decoder<string> = (raw) =>
  isListedItem(raw) || ITEM_NAME_PATTERN.test(raw) ? raw : new Invalid("is not an item name");

/** `;`-joined; empty elements are kept by the exporter but never valid effects. */
const panelEffects: Decoder<string[]> = (raw) => {
  const elements = raw.split(";");
  return elements.every((element) => PANEL_EFFECT_SET.has(element))
    ? elements
    : new Invalid("lists an unknown panel effect");
};

const appVersion: Decoder<string> = (raw) =>
  raw.length <= BOUNDS.textLength && APP_VERSION.test(raw) ? raw : new Invalid("is not a version or build string");

const DECODERS = {
  format_version: integer(0, 1_000),
  record_id: recordId,
  kind: oneOf(KINDS),
  time_basis: oneOf(TIME_BASES),
  time_bucket_start_utc: timestamp,
  time_bucket_end_utc: timestamp,
  local_date: date,
  local_hour: integer(BOUNDS.localHour.min, BOUNDS.localHour.max),
  utc_offset_minutes: integer(BOUNDS.utcOffsetMinutes.min, BOUNDS.utcOffsetMinutes.max),
  session: integer(BOUNDS.sessionOrder.min, BOUNDS.sessionOrder.max),
  order: integer(BOUNDS.sessionOrder.min, BOUNDS.sessionOrder.max),
  read_status: oneOf(READ_STATUSES),
  read_reason: oneOf(READ_REASONS),
  association: oneOf(ASSOCIATIONS),
  observed_panels_read_in_full: boolean,
  both_panels_read: boolean,
  panel: oneOf(PANELS),
  panel_partial: boolean,
  panel_effects: panelEffects,
  slot: integer(BOUNDS.slot.min, BOUNDS.slot.max),
  item: itemName,
  level: integer(BOUNDS.level.min, BOUNDS.level.max),
  level_state: oneOf(LEVEL_STATES),
  rarity: oneOf(RARITIES),
  rarity_source: oneOf(RARITY_SOURCES),
  quantity: integer(BOUNDS.quantity.min, BOUNDS.quantity.max),
  multiplied: boolean,
  hack_state: oneOf(HACK_STATES),
  hack_glyph_count: integer(BOUNDS.glyphCount.min, BOUNDS.glyphCount.max),
  hacking_bonus: integer(BOUNDS.bonusPercent.min, BOUNDS.bonusPercent.max),
  hacking_bonus_final: boolean,
  speed_bonus: integer(BOUNDS.bonusPercent.min, BOUNDS.bonusPercent.max),
  speed_bonus_final: boolean,
  command_mode: oneOf(COMMAND_MODES),
  speed_command: oneOf(SPEED_COMMANDS),
  speed_command_status: oneOf(COMMAND_STATUSES),
  key_command: oneOf(KEY_COMMANDS),
  key_command_status: oneOf(COMMAND_STATUSES),
  portal_level_low: integer(BOUNDS.portalLevel.min, BOUNDS.portalLevel.max),
  portal_level_high: integer(BOUNDS.portalLevel.min, BOUNDS.portalLevel.max),
  portal_level_confidence: oneOf(PORTAL_LEVEL_CONFIDENCES),
  portal_level_conflict: boolean,
  capture_mode: oneOf(CAPTURE_MODES),
  game_language: oneOf(GAME_LANGUAGES),
  game_language_source: oneOf(GAME_LANGUAGE_SOURCES),
  source_app_version: appVersion,
  source_app_build: appVersion,
  exporter_app_version: appVersion,
  exporter_app_build: appVersion,
} satisfies { [K in ColumnName]: Decoder<unknown> };

type Decoded<D> = D extends Decoder<infer T> ? T : never;

/** A row with every cell typed; null is a blank cell. */
export type DecodedRow = { [K in ColumnName]: Decoded<(typeof DECODERS)[K]> | null };

export interface CellIssue {
  column: ColumnName;
  message: string;
}

/**
 * Undoes the exporter's spreadsheet guard: a `text` or `id` cell that would
 * start with a formula character was written with one leading `'`.
 */
export function unguard(column: ColumnName, raw: string): string {
  const type = COLUMN_TYPES.get(column);
  if (type !== "text" && type !== "identifier") return raw;
  if (raw.length >= 2 && raw[0] === "'" && (SPREADSHEET_GUARDED_PREFIXES as readonly string[]).includes(raw[1])) {
    return raw.slice(1);
  }
  return raw;
}

/** Types every cell of a row whose fields are already in v1 column order. */
export function decodeRow(
  fields: readonly string[],
  columns: readonly ColumnName[],
): { row: DecodedRow; issues: CellIssue[] } {
  const row = {} as Record<ColumnName, unknown>;
  const issues: CellIssue[] = [];
  columns.forEach((column, index) => {
    const raw = unguard(column, fields[index]);
    if (raw === "") {
      row[column] = null;
      return;
    }
    const decoder: Decoder<unknown> = DECODERS[column];
    const value = decoder(raw);
    if (value instanceof Invalid) {
      issues.push({ column, message: value.message });
      row[column] = null;
    } else {
      row[column] = value;
    }
  });
  // Every column was assigned above; the cast only restores the per-column types.
  return { row: row as DecodedRow, issues };
}
