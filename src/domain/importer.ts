import { decodeRow, isListedItem, type DecodedRow } from "./cells.ts";
import { parseCsv, type CsvError } from "./csv.ts";
import { issueMessage, type IssueKey, type IssueParams } from "./issueMessages.ts";
import {
  BUCKET_SECONDS,
  COLUMN_NAMES,
  FORMAT_VERSION,
  HACK_COLUMNS,
  ITEM_COLUMNS,
  PANEL_COLUMNS,
  PANELS,
  type ColumnName,
} from "./format.ts";
import type {
  ExportPlacement,
  HackResult,
  Item,
  ObservationRecord,
  Origin,
  Panel,
  PanelStage,
  Reading,
  TimeBucket,
} from "./record.ts";

export interface ImportLimits {
  maxBytes: number;
  /** Data rows, header excluded. */
  maxRows: number;
  maxRecords: number;
}

/** Columns the app may append within v1 before a file is treated as hostile. */
const MAX_APPENDED_COLUMNS = 64;
/** Far above any v1 value; bounds memory for a hostile file. */
const MAX_FIELD_LENGTH = 256;

/**
 * Provisional, from the exporter's retention caps (about 2,100 records and
 * 50,000 rows at most). Replace with measured limits before the pilot.
 */
export const DEFAULT_LIMITS: ImportLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxRows: 60_000,
  maxRecords: 5_000,
};

const RECORD_ID = /^[hd][0-9a-f]{32}$/;

/** Records before this can't come from DynamicGlyph. */
const EARLIEST_BUCKET_UTC = Date.UTC(2025, 0, 1) / 1000;
/** Allows for a capturing iPhone whose clock runs ahead. */
const FUTURE_TOLERANCE_SECONDS = 86400;

export interface Issue {
  /** A broad category, stable for clients: `invalid_value`, `file_too_large`… */
  code: string;
  /** The exact message, for showing it in any language: see `ISSUE_MESSAGES`. */
  key: IssueKey;
  params?: IssueParams;
  /** The message in English. */
  message: string;
  line?: number;
  column?: string;
}

export function makeIssue(
  code: string,
  key: IssueKey,
  params?: IssueParams,
  extra: Pick<Issue, "line" | "column"> = {},
): Issue {
  return { code, key, ...(params ? { params } : {}), message: issueMessage(key, params), ...extra };
}

export interface ParsedRecord {
  record: ObservationRecord;
  placement: ExportPlacement;
  /** File lines the record came from, for the preview. */
  lines: number[];
}

export interface RejectedRecord {
  /** Null when no valid id could be read from the rows. */
  recordId: string | null;
  lines: number[];
  issues: Issue[];
}

export interface Exporter {
  appVersion: string | null;
  appBuild: string | null;
}

export type ImportResult =
  | { ok: false; issues: Issue[] }
  | {
      ok: true;
      formatVersion: typeof FORMAT_VERSION;
      exporter: Exporter;
      records: ParsedRecord[];
      rejected: RejectedRecord[];
      /** Non-fatal notes about the file, such as ignored columns. */
      warnings: Issue[];
      rowCount: number;
    };

export interface ImportOptions {
  limits?: ImportLimits;
  /** Unix seconds; records more than a day after it are rejected. */
  now?: number;
}

const fail = (code: string, key: IssueKey, params?: IssueParams, extra: Pick<Issue, "line" | "column"> = {}): ImportResult => ({
  ok: false,
  issues: [makeIssue(code, key, params, extra)],
});

function csvErrorIssue(error: CsvError, maxRows: number): Issue {
  switch (error.code) {
    case "unterminated_quote":
      return makeIssue("csv_syntax", "csv.unterminatedQuote", undefined, { line: error.line });
    case "unexpected_quote":
      return makeIssue("csv_syntax", "csv.unexpectedQuote", undefined, { line: error.line });
    case "text_after_quote":
      return makeIssue("csv_syntax", "csv.textAfterQuote", undefined, { line: error.line });
    case "too_many_rows":
      return makeIssue("too_many_rows", "file.tooManyRows", { limit: maxRows });
    case "too_many_fields":
      return makeIssue("too_many_fields", "file.tooManyFields", { limit: error.limit }, { line: error.line });
    case "field_too_long":
      return makeIssue("field_too_long", "file.fieldTooLong", { limit: error.limit }, { line: error.line });
  }
}

/**
 * Reads a DynamicGlyph gear export. File-level problems (encoding, header,
 * limits) reject the whole file; a problem inside one record rejects only
 * that record, and the preview explains it.
 */
export function parseExport(bytes: Uint8Array, options: ImportOptions = {}): ImportResult {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const now = options.now ?? Date.now() / 1000;

  if (bytes.byteLength > limits.maxBytes) {
    return fail("file_too_large", "file.tooLarge", { limit: limits.maxBytes });
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return fail("invalid_encoding", "file.invalidEncoding");
  }

  const csv = parseCsv(text, {
    maxRows: limits.maxRows + 1,
    maxFieldsPerRow: COLUMN_NAMES.length + MAX_APPENDED_COLUMNS,
    maxFieldLength: MAX_FIELD_LENGTH,
  });
  if (csv.error) return { ok: false, issues: [csvErrorIssue(csv.error, limits.maxRows)] };
  if (csv.rows.length === 0) return fail("empty_file", "file.empty");

  const header = csv.rows[0].fields;
  if (header[0] !== "format_version" || header[1] !== "record_id") {
    return fail("not_gear_export", "file.notGearExport", undefined, { line: 1 });
  }
  for (let index = 0; index < COLUMN_NAMES.length; index++) {
    if (header[index] !== COLUMN_NAMES[index]) {
      return fail("unsupported_columns", "file.unexpectedColumn", { index: index + 1, expected: COLUMN_NAMES[index] }, { line: 1 });
    }
  }
  const extraColumns = header.slice(COLUMN_NAMES.length);
  if (extraColumns.some((name) => name === "") || new Set(header).size !== header.length) {
    return fail("unsupported_columns", "file.badHeader", undefined, { line: 1 });
  }
  const warnings: Issue[] = [];
  if (extraColumns.length > 0) {
    warnings.push(makeIssue("ignored_columns", "warning.ignoredColumns", { count: extraColumns.length, columns: extraColumns.join(", ") }));
  }

  const dataRows = csv.rows.slice(1);
  if (dataRows.length === 0) return fail("no_records", "file.noRecords");

  let exporter: Exporter | null = null;
  const groups = new Map<string, { lines: number[]; fields: string[][]; issues: Issue[] }>();
  const unattributed: RejectedRecord[] = [];

  for (const { fields, line } of dataRows) {
    if (fields.length !== header.length) {
      const issue = makeIssue("row_width", "row.width", { fields: fields.length, expected: header.length }, { line });
      // A broken row still taints its record: accepting the rest would silently drop an item.
      const group = RECORD_ID.test(fields[1] ?? "") ? groups.get(fields[1]) : undefined;
      if (group) {
        group.lines.push(line);
        group.issues.push(issue);
      } else if (RECORD_ID.test(fields[1] ?? "")) {
        groups.set(fields[1], { lines: [line], fields: [], issues: [issue] });
      } else {
        unattributed.push({ recordId: null, lines: [line], issues: [issue] });
      }
      continue;
    }
    if (fields[0] !== String(FORMAT_VERSION)) {
      return fail("unsupported_version", "file.unsupportedVersion", { version: FORMAT_VERSION }, { line, column: "format_version" });
    }
    const rowExporter: Exporter = {
      appVersion: fields[COLUMN_NAMES.indexOf("exporter_app_version")] || null,
      appBuild: fields[COLUMN_NAMES.indexOf("exporter_app_build")] || null,
    };
    if (exporter === null) {
      exporter = rowExporter;
    } else if (exporter.appVersion !== rowExporter.appVersion || exporter.appBuild !== rowExporter.appBuild) {
      return fail("mixed_exporters", "file.mixedExporters", undefined, { line });
    }
    const v1Fields = fields.slice(0, COLUMN_NAMES.length);
    const id = v1Fields[1];
    const group = groups.get(id);
    if (group) {
      group.lines.push(line);
      group.fields.push(v1Fields);
    } else {
      groups.set(id, { lines: [line], fields: [v1Fields], issues: [] });
    }
  }

  if (groups.size > limits.maxRecords) {
    return fail("too_many_records", "file.tooManyRecords", { limit: limits.maxRecords });
  }

  const records: ParsedRecord[] = [];
  const rejected: RejectedRecord[] = [...unattributed];
  for (const [id, group] of groups) {
    const result: Built = group.issues.length > 0 ? { issues: group.issues } : buildRecord(group.fields, group.lines, now);
    if ("issues" in result) {
      rejected.push({ recordId: RECORD_ID.test(id) ? id : null, lines: group.lines, issues: result.issues });
    } else {
      records.push({ ...result, lines: group.lines });
    }
  }

  // Named by the build that captured each record, not the one that exported the file.
  const unlisted = new Map<string, Set<string>>();
  for (const { record } of records) {
    for (const panel of record.reading?.panels ?? []) {
      for (const entry of panel.items) {
        if (entry.item === null || isListedItem(entry.item)) continue;
        const builds = unlisted.get(entry.item) ?? new Set<string>();
        builds.add(record.origin.sourceAppBuild ?? "?");
        unlisted.set(entry.item, builds);
      }
    }
  }
  if (unlisted.size > 0) {
    const names = [...unlisted]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, builds]) => `"${name}" (${[...builds].sort().join(", ")})`);
    warnings.push(makeIssue("unlisted_items", "warning.unlistedItems", { items: names.join("; ") }));
  }

  return {
    ok: true,
    formatVersion: FORMAT_VERSION,
    exporter: exporter ?? { appVersion: null, appBuild: null },
    records,
    rejected,
    warnings,
    rowCount: dataRows.length,
  };
}

const RECORD_COLUMNS: readonly ColumnName[] = COLUMN_NAMES.filter(
  (name) => !(PANEL_COLUMNS as readonly string[]).includes(name) && !(ITEM_COLUMNS as readonly string[]).includes(name),
);

type Built = { record: ObservationRecord; placement: ExportPlacement } | { issues: Issue[] };

class RecordIssues {
  readonly list: Issue[] = [];
  add(code: string, key: IssueKey, params: IssueParams | undefined, line?: number, column?: ColumnName): void {
    this.list.push(makeIssue(code, key, params, { ...(line === undefined ? {} : { line }), ...(column ? { column } : {}) }));
  }
  get any(): boolean {
    return this.list.length > 0;
  }
}

function buildRecord(rawRows: string[][], lines: number[], now: number): Built {
  const issues = new RecordIssues();
  const rows: DecodedRow[] = [];
  rawRows.forEach((fields, index) => {
    const decoded = decodeRow(fields, COLUMN_NAMES);
    for (const issue of decoded.issues) {
      issues.add("invalid_value", issue.key, { column: issue.column, ...issue.params }, lines[index], issue.column);
    }
    rows.push(decoded.row);
  });
  if (issues.any) return { issues: issues.list };

  for (const column of RECORD_COLUMNS) {
    const first = rawRows[0][COLUMN_NAMES.indexOf(column)];
    const index = rawRows.findIndex((fields) => fields[COLUMN_NAMES.indexOf(column)] !== first);
    if (index !== -1) {
      issues.add("inconsistent_record", "record.columnDiffers", { column }, lines[index], column);
    }
  }
  if (issues.any) return { issues: issues.list };

  const r = rows[0];
  const line = lines[0];
  const require = <K extends ColumnName>(column: K): NonNullable<DecodedRow[K]> | null => {
    const value = r[column];
    if (value === null) issues.add("missing_value", "record.blank", { column }, line, column);
    return value ?? null;
  };
  const requireBlank = (columns: readonly ColumnName[], why: IssueKey, params: IssueParams = {}): void => {
    for (const column of columns) {
      if (r[column] !== null) issues.add("unexpected_value", why, { column, ...params }, line, column);
    }
  };

  const recordId = require("record_id");
  const kind = require("kind");
  const timeBasis = require("time_basis");
  const readStatus = require("read_status");
  const session = require("session");
  const order = require("order");
  if (recordId === null || kind === null || timeBasis === null || readStatus === null || session === null || order === null) {
    return { issues: issues.list };
  }
  if (recordId[0] !== (kind === "hack" ? "h" : "d")) {
    issues.add("inconsistent_record", "record.idKind", undefined, line, "record_id");
  }
  if (timeBasis !== (kind === "hack" ? "hack_first_seen" : "drop_closed")) {
    issues.add("inconsistent_record", "record.basisKind", undefined, line, "time_basis");
  }

  const time = buildTime(r, line, now, issues);
  const hack = kind === "hack" ? buildHack(r, line, issues) : null;
  if (kind === "drop") requireBlank(HACK_COLUMNS, "record.mustBeBlankForDrop");

  let reading: Reading | null = null;
  if (readStatus === "read") {
    requireBlank(["read_reason"], "record.mustBeBlankWhenRead");
    reading = buildReading(rows, lines, issues);
  } else {
    if (kind === "drop") issues.add("inconsistent_record", "record.dropAlwaysRead", undefined, line, "read_status");
    if (readStatus === "notRead") require("read_reason");
    else requireBlank(["read_reason"], "record.mustBeBlankForStatus", { status: readStatus });
    requireBlank(["association", "observed_panels_read_in_full", "both_panels_read"], "record.mustBeBlankWithoutReading");
    if (rows.length !== 1) {
      issues.add("malformed_record", "record.oneRowWithoutReading", undefined, lines[1]);
    }
    requireBlank([...PANEL_COLUMNS, ...ITEM_COLUMNS], "record.mustBeBlankWithoutReading");
  }

  const origin: Origin = {
    captureMode: r.capture_mode,
    gameLanguage: r.game_language,
    gameLanguageSource: r.game_language_source,
    sourceAppVersion: r.source_app_version,
    sourceAppBuild: r.source_app_build,
  };

  if (issues.any || time === null) return { issues: issues.list };
  return {
    record: { recordId, kind, time, readStatus, readReason: r.read_reason, reading, hack, origin },
    placement: { session, order },
  };
}

function buildTime(r: DecodedRow, line: number, now: number, issues: RecordIssues): TimeBucket | null {
  const start = r.time_bucket_start_utc;
  const end = r.time_bucket_end_utc;
  const basis = r.time_basis;
  if (start === null || end === null || basis === null) {
    if (start === null) issues.add("missing_value", "record.blank", { column: "time_bucket_start_utc" }, line, "time_bucket_start_utc");
    if (end === null) issues.add("missing_value", "record.blank", { column: "time_bucket_end_utc" }, line, "time_bucket_end_utc");
    return null;
  }
  const duration = end - start;
  const precision = duration === BUCKET_SECONDS.hour ? "hour" : duration === BUCKET_SECONDS.day ? "day" : null;
  if (precision === null) {
    issues.add("invalid_time", "time.notHourOrDay", undefined, line, "time_bucket_end_utc");
    return null;
  }
  if (start < EARLIEST_BUCKET_UTC || start > now + FUTURE_TOLERANCE_SECONDS) {
    issues.add("invalid_time", "time.implausible", undefined, line, "time_bucket_start_utc");
    return null;
  }

  const offset = r.utc_offset_minutes;
  if (offset === null) {
    if (r.local_date !== null || r.local_hour !== null) {
      issues.add("invalid_time", "time.localWithoutOffset", undefined, line);
    }
    if (start % duration !== 0) {
      issues.add("invalid_time", precision === "hour" ? "time.notUtcHour" : "time.notUtcDay", undefined, line);
    }
    return { basis, startUtc: start, endUtc: end, precision, utcOffsetMinutes: null, localDate: null, localHour: null };
  }

  const localStart = start + offset * 60;
  const local = new Date(localStart * 1000);
  const localDate = local.toISOString().slice(0, 10);
  if (localStart % duration !== 0) {
    issues.add("invalid_time", precision === "hour" ? "time.notLocalHour" : "time.notLocalDay", undefined, line, "time_bucket_start_utc");
  }
  if (r.local_date !== localDate) {
    issues.add("invalid_time", "time.localDateMismatch", undefined, line, "local_date");
  }
  if (precision === "hour" && r.local_hour !== local.getUTCHours()) {
    issues.add("invalid_time", "time.localHourMismatch", undefined, line, "local_hour");
  }
  if (precision === "day" && r.local_hour !== null) {
    issues.add("invalid_time", "time.localHourOnDay", undefined, line, "local_hour");
  }
  return {
    basis,
    startUtc: start,
    endUtc: end,
    precision,
    utcOffsetMinutes: offset,
    localDate,
    localHour: precision === "hour" ? local.getUTCHours() : null,
  };
}

function buildHack(r: DecodedRow, line: number, issues: RecordIssues): HackResult | null {
  const state = r.hack_state;
  const glyphCount = r.hack_glyph_count;
  if (state === null) issues.add("missing_value", "record.blank", { column: "hack_state" }, line, "hack_state");
  if (glyphCount === null) issues.add("missing_value", "record.blank", { column: "hack_glyph_count" }, line, "hack_glyph_count");

  const bonus = (percent: number | null, final: boolean | null, name: string) => {
    if ((percent === null) !== (final === null)) {
      issues.add("inconsistent_record", "hack.bonusPair", { name }, line);
      return null;
    }
    return percent === null || final === null ? null : { percent, final };
  };
  const hackingBonus = bonus(r.hacking_bonus, r.hacking_bonus_final, "hacking_bonus");
  const speedBonus = bonus(r.speed_bonus, r.speed_bonus_final, "speed_bonus");

  let commands: HackResult["commands"] = null;
  if (r.command_mode === null) {
    for (const column of ["speed_command", "speed_command_status", "key_command", "key_command_status"] as const) {
      if (r[column] !== null) issues.add("unexpected_value", "record.mustBeBlankWithoutCommandMode", { column }, line, column);
    }
  } else if (r.speed_command_status === null || r.key_command_status === null) {
    issues.add("missing_value", "hack.commandStatuses", undefined, line);
  } else {
    if (r.speed_command !== null && r.speed_command_status !== "confirmed") {
      issues.add("inconsistent_record", "hack.commandNotConfirmed", { column: "speed_command" }, line, "speed_command");
    }
    if (r.key_command !== null && r.key_command_status !== "confirmed") {
      issues.add("inconsistent_record", "hack.commandNotConfirmed", { column: "key_command" }, line, "key_command");
    }
    commands = {
      mode: r.command_mode,
      speed: r.speed_command,
      speedStatus: r.speed_command_status,
      key: r.key_command,
      keyStatus: r.key_command_status,
    };
  }

  let portalLevel: HackResult["portalLevel"] = null;
  const level = [r.portal_level_low, r.portal_level_high, r.portal_level_confidence, r.portal_level_conflict];
  if (level.some((value) => value !== null)) {
    if (
      r.portal_level_low === null ||
      r.portal_level_high === null ||
      r.portal_level_confidence === null ||
      r.portal_level_conflict === null
    ) {
      issues.add("inconsistent_record", "hack.levelColumns", undefined, line);
    } else if (r.portal_level_low > r.portal_level_high) {
      issues.add("inconsistent_record", "hack.levelOrder", undefined, line, "portal_level_low");
    } else {
      portalLevel = {
        low: r.portal_level_low,
        high: r.portal_level_high,
        confidence: r.portal_level_confidence,
        conflict: r.portal_level_conflict,
      };
    }
  }

  if (state === null || glyphCount === null) return null;
  return { state, glyphCount, hackingBonus, speedBonus, commands, portalLevel };
}

const PANEL_ORDER: Record<PanelStage, number> = { portal: 0, bonus: 1 };

function buildReading(rows: DecodedRow[], lines: number[], issues: RecordIssues): Reading | null {
  const r = rows[0];
  const association = r.association;
  const observedInFull = r.observed_panels_read_in_full;
  const bothRead = r.both_panels_read;
  if (association === null) issues.add("missing_value", "record.blank", { column: "association" }, lines[0], "association");
  if (observedInFull === null) {
    issues.add("missing_value", "record.blank", { column: "observed_panels_read_in_full" }, lines[0], "observed_panels_read_in_full");
  }
  if (bothRead === null) issues.add("missing_value", "record.blank", { column: "both_panels_read" }, lines[0], "both_panels_read");

  const isPlaceholder = (row: DecodedRow) => ITEM_COLUMNS.every((column) => row[column] === null);
  const panels: Panel[] = [];

  if (rows.some((row) => row.panel === null)) {
    // A reading with no panel is exactly one placeholder row.
    if (rows.length !== 1 || !isPlaceholder(r) || r.panel_partial !== null || r.panel_effects !== null) {
      issues.add("malformed_record", "panel.withoutPanel", undefined, lines[0]);
    }
  } else {
    // The app writes the portal panel's rows, then the bonus panel's; it never repeats a stage.
    const outOfOrder = rows.findIndex(
      (row, index) => index > 0 && PANEL_ORDER[row.panel as PanelStage] < PANEL_ORDER[rows[index - 1].panel as PanelStage],
    );
    if (outOfOrder !== -1) {
      issues.add("malformed_record", "panel.order", undefined, lines[outOfOrder]);
    }
    const byStage = new Map<PanelStage, { rows: DecodedRow[]; lines: number[] }>();
    rows.forEach((row, index) => {
      const stage = row.panel as PanelStage;
      const entry = byStage.get(stage) ?? { rows: [], lines: [] };
      entry.rows.push(row);
      entry.lines.push(lines[index]);
      byStage.set(stage, entry);
    });
    for (const stage of PANELS) {
      const group = byStage.get(stage);
      if (group) {
        const panel = buildPanel(stage, group.rows, group.lines, isPlaceholder, issues);
        if (panel) panels.push(panel);
      }
    }
  }

  if (issues.any || association === null || observedInFull === null || bothRead === null) return null;

  const unidentified = panels.some((panel) =>
    panel.items.some((item) => item.item === null || item.levelState === "unreadable"),
  );
  const expectedInFull = panels.length > 0 && panels.every((panel) => !panel.partial) && !unidentified;
  if (observedInFull !== expectedInFull) {
    issues.add("inconsistent_record", "panel.observedMismatch", undefined, lines[0], "observed_panels_read_in_full");
  }
  const expectedBoth =
    panels.length === 2 && panels[0].stage === "portal" && panels[1].stage === "bonus" && panels.every((p) => !p.partial);
  if (bothRead !== expectedBoth) {
    issues.add("inconsistent_record", "panel.bothMismatch", undefined, lines[0], "both_panels_read");
  }
  if (issues.any) return null;
  return { association, observedPanelsReadInFull: observedInFull, bothPanelsRead: bothRead, panels };
}

function buildPanel(
  stage: PanelStage,
  rows: DecodedRow[],
  lines: number[],
  isPlaceholder: (row: DecodedRow) => boolean,
  issues: RecordIssues,
): Panel | null {
  const first = rows[0];
  if (first.panel_partial === null) {
    issues.add("missing_value", "record.blank", { column: "panel_partial" }, lines[0], "panel_partial");
    return null;
  }
  const effectsKey = JSON.stringify(first.panel_effects);
  rows.forEach((row, index) => {
    if (row.panel_partial !== first.panel_partial || JSON.stringify(row.panel_effects) !== effectsKey) {
      issues.add("inconsistent_record", "panel.columnsDiffer", { panel: stage }, lines[index]);
    }
  });

  const items: Item[] = [];
  const slots = new Set<number>();
  const placeholders = rows.filter(isPlaceholder).length;
  if (placeholders > 0 && rows.length !== 1) {
    issues.add("malformed_record", "panel.mixedPlaceholder", { panel: stage }, lines[0]);
    return null;
  }
  if (placeholders === 0) {
    rows.forEach((row, index) => {
      const item = buildItem(row, lines[index], issues);
      if (!item) return;
      if (slots.has(item.slot)) {
        issues.add("malformed_record", "panel.slotTwice", { panel: stage, slot: item.slot }, lines[index], "slot");
        return;
      }
      slots.add(item.slot);
      items.push(item);
    });
  }
  items.sort((a, b) => a.slot - b.slot);
  return { stage, partial: first.panel_partial, effects: first.panel_effects, items };
}

function buildItem(row: DecodedRow, line: number, issues: RecordIssues): Item | null {
  const { slot, level_state: levelState, quantity } = row;
  if (slot === null) issues.add("missing_value", "record.blankOnItemRow", { column: "slot" }, line, "slot");
  if (levelState === null) issues.add("missing_value", "record.blankOnItemRow", { column: "level_state" }, line, "level_state");
  if (quantity === null) issues.add("missing_value", "record.blankOnItemRow", { column: "quantity" }, line, "quantity");
  if (slot === null || levelState === null || quantity === null) return null;

  if ((row.level !== null) !== (levelState === "known")) {
    issues.add("inconsistent_record", "item.levelState", undefined, line, "level");
    return null;
  }
  if ((row.rarity === null) !== (row.rarity_source === null)) {
    issues.add("inconsistent_record", "item.rarityPair", undefined, line, "rarity_source");
    return null;
  }
  return {
    slot,
    item: row.item,
    level: row.level,
    levelState,
    rarity: row.rarity,
    raritySource: row.rarity_source,
    quantity,
    multiplied: row.multiplied,
  };
}
