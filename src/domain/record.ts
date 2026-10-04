import type {
  ASSOCIATIONS,
  CAPTURE_MODES,
  COMMAND_MODES,
  COMMAND_STATUSES,
  GAME_LANGUAGE_SOURCES,
  GAME_LANGUAGES,
  HACK_STATES,
  KEY_COMMANDS,
  KINDS,
  LEVEL_STATES,
  PANELS,
  PORTAL_LEVEL_CONFIDENCES,
  RARITIES,
  RARITY_SOURCES,
  READ_REASONS,
  READ_STATUSES,
  SPEED_COMMANDS,
  TIME_BASES,
} from "./format.ts";

/**
 * One record rebuilt from its CSV rows. `null` always means the export left
 * the cell blank (unknown or not applicable), never zero or false.
 */

export type Kind = (typeof KINDS)[number];
export type TimeBasis = (typeof TIME_BASES)[number];
export type ReadStatus = (typeof READ_STATUSES)[number];
export type ReadReason = (typeof READ_REASONS)[number];
export type Association = (typeof ASSOCIATIONS)[number];
export type PanelStage = (typeof PANELS)[number];
export type LevelState = (typeof LEVEL_STATES)[number];
export type Rarity = (typeof RARITIES)[number];
export type RaritySource = (typeof RARITY_SOURCES)[number];
export type HackState = (typeof HACK_STATES)[number];
export type CommandMode = (typeof COMMAND_MODES)[number];
export type SpeedCommand = (typeof SPEED_COMMANDS)[number];
export type KeyCommand = (typeof KEY_COMMANDS)[number];
export type CommandStatus = (typeof COMMAND_STATUSES)[number];
export type PortalLevelConfidence = (typeof PORTAL_LEVEL_CONFIDENCES)[number];
export type CaptureMode = (typeof CAPTURE_MODES)[number];
export type GameLanguage = (typeof GAME_LANGUAGES)[number];
export type GameLanguageSource = (typeof GAME_LANGUAGE_SOURCES)[number];

export type TimePrecision = "hour" | "day";

export interface TimeBucket {
  basis: TimeBasis;
  /** Unix seconds, inclusive. */
  startUtc: number;
  /** Unix seconds, exclusive. */
  endUtc: number;
  precision: TimePrecision;
  /** The capturing iPhone's offset; null for records saved before it was kept. */
  utcOffsetMinutes: number | null;
  localDate: string | null;
  localHour: number | null;
}

export interface Item {
  slot: number;
  /** Null when the row was read but its name wasn't recognized. */
  item: string | null;
  level: number | null;
  levelState: LevelState;
  rarity: Rarity | null;
  raritySource: RaritySource | null;
  quantity: number;
  multiplied: boolean | null;
}

export interface Panel {
  stage: PanelStage;
  partial: boolean;
  /** Null when none were shown or the reading predates effects. */
  effects: string[] | null;
  /** Empty for a panel seen with no row read. */
  items: Item[];
}

export interface Reading {
  association: Association;
  observedPanelsReadInFull: boolean;
  bothPanelsRead: boolean;
  /** Empty for a reading with no panel. */
  panels: Panel[];
}

export interface HackResult {
  state: HackState;
  glyphCount: number;
  hackingBonus: { percent: number; final: boolean } | null;
  speedBonus: { percent: number; final: boolean } | null;
  commands: {
    mode: CommandMode;
    speed: SpeedCommand | null;
    speedStatus: CommandStatus;
    key: KeyCommand | null;
    keyStatus: CommandStatus;
  } | null;
  portalLevel: { low: number; high: number; confidence: PortalLevelConfidence; conflict: boolean } | null;
}

export interface Origin {
  captureMode: CaptureMode | null;
  gameLanguage: GameLanguage | null;
  gameLanguageSource: GameLanguageSource | null;
  sourceAppVersion: string | null;
  sourceAppBuild: string | null;
}

/** Everything the record itself holds; this is what deduplication compares. */
export interface ObservationRecord {
  recordId: string;
  kind: Kind;
  time: TimeBucket;
  readStatus: ReadStatus;
  readReason: ReadReason | null;
  /** Present exactly when `readStatus` is `read`. */
  reading: Reading | null;
  /** Present exactly for hacks. */
  hack: HackResult | null;
  origin: Origin;
}

/** Numbering that only means something inside one file. */
export interface ExportPlacement {
  session: number;
  order: number;
}
