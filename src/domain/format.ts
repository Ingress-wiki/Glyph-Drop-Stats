/**
 * DynamicGlyph gear export, format version 1.
 *
 * Source of truth: DynamicGlyph `Docs/GEAR_EXPORT_FORMAT.md` and
 * `Apps/DynamicGlyph/Sources/Results/GearExport.swift` (`GearExport.columns`).
 * Within v1, columns are only appended at the end; renaming or removing one
 * makes v2.
 */

export const FORMAT_VERSION = 1;

export type ColumnType = "integer" | "boolean" | "enumeration" | "identifier" | "timestamp" | "date" | "text";

export const COLUMNS = [
  ["format_version", "integer"],
  ["record_id", "identifier"],
  ["kind", "enumeration"],
  ["time_basis", "enumeration"],
  ["time_bucket_start_utc", "timestamp"],
  ["time_bucket_end_utc", "timestamp"],
  ["local_date", "date"],
  ["local_hour", "integer"],
  ["utc_offset_minutes", "integer"],
  ["session", "integer"],
  ["order", "integer"],
  ["read_status", "enumeration"],
  ["read_reason", "identifier"],
  ["association", "enumeration"],
  ["observed_panels_read_in_full", "boolean"],
  ["both_panels_read", "boolean"],
  ["panel", "enumeration"],
  ["panel_partial", "boolean"],
  ["panel_effects", "text"],
  ["slot", "integer"],
  ["item", "text"],
  ["level", "integer"],
  ["level_state", "enumeration"],
  ["rarity", "enumeration"],
  ["rarity_source", "enumeration"],
  ["quantity", "integer"],
  ["multiplied", "boolean"],
  ["hack_state", "enumeration"],
  ["hack_glyph_count", "integer"],
  ["hacking_bonus", "integer"],
  ["hacking_bonus_final", "boolean"],
  ["speed_bonus", "integer"],
  ["speed_bonus_final", "boolean"],
  ["command_mode", "enumeration"],
  ["speed_command", "enumeration"],
  ["speed_command_status", "enumeration"],
  ["key_command", "enumeration"],
  ["key_command_status", "enumeration"],
  ["portal_level_low", "integer"],
  ["portal_level_high", "integer"],
  ["portal_level_confidence", "enumeration"],
  ["portal_level_conflict", "boolean"],
  ["capture_mode", "enumeration"],
  ["game_language", "enumeration"],
  ["game_language_source", "enumeration"],
  ["source_app_version", "text"],
  ["source_app_build", "text"],
  ["exporter_app_version", "text"],
  ["exporter_app_build", "text"],
] as const satisfies readonly (readonly [string, ColumnType])[];

export type ColumnName = (typeof COLUMNS)[number][0];

export const COLUMN_NAMES: readonly ColumnName[] = COLUMNS.map(([name]) => name);

export const COLUMN_TYPES: ReadonlyMap<ColumnName, ColumnType> = new Map(COLUMNS);

/** Columns that describe one panel; they may differ between a record's rows. */
export const PANEL_COLUMNS = ["panel", "panel_partial", "panel_effects"] as const satisfies readonly ColumnName[];

/** Columns that describe one item; blank on placeholder rows. */
export const ITEM_COLUMNS = [
  "slot",
  "item",
  "level",
  "level_state",
  "rarity",
  "rarity_source",
  "quantity",
  "multiplied",
] as const satisfies readonly ColumnName[];

/** Blank on every drop row. */
export const HACK_COLUMNS = [
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
] as const satisfies readonly ColumnName[];

/**
 * Written by the exporting app, not stored with the record. `session` and
 * `order` are numbered within one file only and are never identifiers.
 */
export const EXPORT_ONLY_COLUMNS = [
  "format_version",
  "session",
  "order",
  "exporter_app_version",
  "exporter_app_build",
] as const satisfies readonly ColumnName[];

export const KINDS = ["hack", "drop"] as const;
export const TIME_BASES = ["hack_first_seen", "drop_closed"] as const;
export const READ_STATUSES = ["read", "notRead", "unavailable", "unsupported"] as const;
export const READ_REASONS = ["waitTimeout", "frameGap", "queueLimit", "captureStopped"] as const;
export const ASSOCIATIONS = [
  "ordered",
  "orderedWithoutBonus",
  "bonusExpected",
  "noWaitingHack",
  "uncertainContinuity",
  "unassociated",
] as const;
export const PANELS = ["portal", "bonus"] as const;
export const LEVEL_STATES = ["known", "notApplicable", "unreadable"] as const;
export const RARITIES = ["common", "rare", "veryRare", "unreadable"] as const;
export const RARITY_SOURCES = ["fixed", "read"] as const;
export const HACK_STATES = ["complete", "partial", "notObserved", "awaiting"] as const;
export const COMMAND_MODES = ["portal", "drone", "unknown"] as const;
export const SPEED_COMMANDS = ["simple", "complex"] as const;
export const KEY_COMMANDS = ["requestKey", "noKey", "keysOnly"] as const;
export const COMMAND_STATUSES = ["confirmed", "unresolved", "noCommandObserved", "notApplicable"] as const;
export const PORTAL_LEVEL_CONFIDENCES = ["low", "medium", "high"] as const;
export const CAPTURE_MODES = ["glyphAssistance", "gearOnly"] as const;
export const GAME_LANGUAGES = ["en", "zh-Hans", "zh-Hant", "ja", "ko"] as const;
export const GAME_LANGUAGE_SOURCES = ["chosen", "detected", "assumed"] as const;

/**
 * Item names the app recognizes (DynamicGlyph `Docs/GEAR_DROP_ITEMS.md`,
 * `GameText.levelledItems` and `unlevelledItems`). The app may add a name
 * within v1, so other names that look like item names are accepted, flagged
 * in the preview, and kept out of public statistics until added here.
 */
export const ITEM_NAMES = [
  "Resonator",
  "XMP Burster",
  "Ultra Strike",
  "Power Cube",
  "Portal Shield",
  "Aegis Shield",
  "Force Amp",
  "Turret",
  "Heat Sink",
  "Multi-Hack",
  "Link Amp",
  "SoftBank Ultra Link",
  "ITO EN Transmuter (+)",
  "ITO EN Transmuter (-)",
  "Portal Key",
  "Hypercube",
  "ADA Refactor",
  "JARVIS Virus",
  "Capsule",
  "Kinetic Capsule",
  "Media",
] as const;

/** Panel effects the app recognizes, as written in `panel_effects`. */
export const PANEL_EFFECTS = ["ITO EN (+)", "ITO EN (-)"] as const;

/** Characters the exporter guards with a leading `'` in text and id cells. */
export const SPREADSHEET_GUARDED_PREFIXES = ["=", "+", "-", "@", "\t", "\r"] as const;

/** Real-world bounds; values outside them can't come from the app. */
export const BOUNDS = {
  level: { min: 1, max: 8 },
  portalLevel: { min: 1, max: 8 },
  localHour: { min: 0, max: 23 },
  // Foundation's TimeZone(secondsFromGMT:) accepts up to ±18 hours.
  utcOffsetMinutes: { min: -18 * 60, max: 18 * 60 },
  slot: { min: 0, max: 63 },
  quantity: { min: 1, max: 9999 },
  glyphCount: { min: 0, max: 10 },
  bonusPercent: { min: 0, max: 1000 },
  sessionOrder: { min: 1, max: 1_000_000 },
  textLength: 64,
} as const;

/** What an item name not yet in `ITEM_NAMES` must look like to be accepted. */
export const ITEM_NAME_PATTERN = /^[A-Za-z0-9 ().+-]{1,40}$/;

export const BUCKET_SECONDS = { hour: 3600, day: 86400 } as const;
