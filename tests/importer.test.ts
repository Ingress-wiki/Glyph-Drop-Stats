import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLUMN_NAMES } from "../src/domain/format.ts";
import { DEFAULT_LIMITS, parseExport, type ImportResult } from "../src/domain/importer.ts";
import {
  bytes,
  csv,
  DROP_ID,
  dropRecord,
  fullHackRows,
  HACK_ID,
  hackRecord,
  item,
  OTHER_HACK_ID,
  type Row,
} from "./helpers/export.ts";

const NOW = Date.UTC(2026, 9, 4) / 1000;
const SAMPLE = new Uint8Array(readFileSync(new URL("./fixtures/sample-v1.csv", import.meta.url)));

function accepted(result: ImportResult) {
  if (!result.ok) throw new Error(`file rejected: ${JSON.stringify(result.issues)}`);
  return result;
}

function parseRows(rows: Row[]) {
  return accepted(parseExport(bytes(csv(rows)), { now: NOW }));
}

/** The issue codes of the single rejected record. */
function rejectionCodes(rows: Row[]): string[] {
  const result = parseRows(rows);
  expect(result.records).toHaveLength(0);
  expect(result.rejected).toHaveLength(1);
  return result.rejected[0].issues.map((issue) => issue.code);
}

function fileIssue(text: string | Uint8Array, limits = DEFAULT_LIMITS): string {
  const result = parseExport(typeof text === "string" ? bytes(text) : text, { now: NOW, limits });
  if (result.ok) throw new Error("file accepted");
  return result.issues[0].code;
}

describe("the synthetic sample export", () => {
  const result = accepted(parseExport(SAMPLE, { now: NOW }));
  const byId = new Map(result.records.map((parsed) => [parsed.record.recordId, parsed]));

  it("rebuilds three records from seven rows", () => {
    expect(result.rowCount).toBe(7);
    expect(result.records).toHaveLength(3);
    expect(result.rejected).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.exporter).toEqual({ appVersion: "0.1.0", appBuild: "74" });
  });

  it("reads a hack with both panels", () => {
    const hack = byId.get(HACK_ID)!;
    expect(hack.lines).toEqual([2, 3, 4]);
    expect(hack.placement).toEqual({ session: 1, order: 1 });
    const { record } = hack;
    expect(record.kind).toBe("hack");
    expect(record.time).toEqual({
      basis: "hack_first_seen",
      startUtc: Date.UTC(2026, 9, 2, 23) / 1000,
      endUtc: Date.UTC(2026, 9, 3, 0) / 1000,
      precision: "hour",
      utcOffsetMinutes: 480,
      localDate: "2026-10-03",
      localHour: 7,
    });
    expect(record.hack).toEqual({
      state: "complete",
      glyphCount: 4,
      hackingBonus: { percent: 120, final: true },
      speedBonus: { percent: 40, final: false },
      commands: { mode: "portal", speed: "complex", speedStatus: "confirmed", key: null, keyStatus: "noCommandObserved" },
      portalLevel: { low: 6, high: 6, confidence: "high", conflict: false },
    });
    expect(record.reading?.panels).toEqual([
      {
        stage: "portal",
        partial: false,
        effects: ["ITO EN (+)"],
        items: [
          {
            slot: 0,
            item: "Resonator",
            level: 6,
            levelState: "known",
            rarity: null,
            raritySource: null,
            quantity: 2,
            multiplied: true,
          },
          {
            slot: 1,
            item: "Portal Shield",
            level: null,
            levelState: "notApplicable",
            rarity: "rare",
            raritySource: "read",
            quantity: 1,
            multiplied: null,
          },
        ],
      },
      {
        stage: "bonus",
        partial: false,
        effects: null,
        items: [
          {
            slot: 0,
            item: "Hypercube",
            level: null,
            levelState: "notApplicable",
            rarity: "veryRare",
            raritySource: "fixed",
            quantity: 1,
            multiplied: false,
          },
        ],
      },
    ]);
  });

  it("keeps an unrecognized row and an empty, partly read panel", () => {
    const { record } = byId.get(DROP_ID)!;
    expect(record.hack).toBeNull();
    expect(record.reading).toMatchObject({
      association: "noWaitingHack",
      observedPanelsReadInFull: false,
      bothPanelsRead: false,
    });
    const [portal, bonus] = record.reading!.panels;
    expect(portal.items[1]).toMatchObject({ item: null, level: null, levelState: "unreadable", quantity: 1 });
    expect(bonus).toEqual({ stage: "bonus", partial: true, effects: null, items: [] });
  });

  it("keeps an old hack's unknowns as null, never zero or false", () => {
    const { record } = byId.get(OTHER_HACK_ID)!;
    expect(record.readStatus).toBe("unavailable");
    expect(record.reading).toBeNull();
    expect(record.time).toMatchObject({ precision: "hour", utcOffsetMinutes: null, localDate: null, localHour: null });
    expect(record.origin).toEqual({
      captureMode: null,
      gameLanguage: null,
      gameLanguageSource: null,
      sourceAppVersion: null,
      sourceAppBuild: null,
    });
    expect(record.hack).toMatchObject({ state: "partial", glyphCount: 3, speedBonus: null, commands: null, portalLevel: null });
  });
});

describe("file-level checks", () => {
  it("rejects a file that isn't UTF-8", () => {
    expect(fileIssue(new Uint8Array([0x66, 0xff, 0x0a]))).toBe("invalid_encoding");
  });

  it("accepts a byte-order mark added by another tool", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...SAMPLE]);
    expect(accepted(parseExport(withBom, { now: NOW })).records).toHaveLength(3);
  });

  it("rejects something that isn't a gear export", () => {
    expect(fileIssue("name,score\r\nx,1\r\n")).toBe("not_gear_export");
  });

  it("rejects a renamed or missing column", () => {
    const header = COLUMN_NAMES.map((name) => (name === "slot" ? "position" : name));
    expect(fileIssue(csv(fullHackRows(), { header }))).toBe("unsupported_columns");
    expect(fileIssue(csv(fullHackRows(), { header: COLUMN_NAMES.slice(0, -1) }))).toBe("unsupported_columns");
  });

  it("ignores columns appended later in v1 and doesn't store them", () => {
    const rows = fullHackRows();
    const text = csv(rows, {
      header: [...COLUMN_NAMES, "portal_name"],
      extra: rows.map(() => ["Secret Portal"]),
    });
    const result = accepted(parseExport(bytes(text), { now: NOW }));
    expect(result.records).toHaveLength(1);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["ignored_columns"]);
    expect(JSON.stringify(result.records)).not.toContain("Secret Portal");
  });

  it("rejects another format version", () => {
    expect(fileIssue(csv(fullHackRows({ format_version: "2" })))).toBe("unsupported_version");
  });

  it("rejects an empty file or one without records", () => {
    expect(fileIssue("")).toBe("empty_file");
    expect(fileIssue(csv([]))).toBe("no_records");
  });

  it("rejects rows from different exporter builds", () => {
    const rows = [...fullHackRows(), { ...dropRecord({ exporter_app_build: "75" }), ...item("portal", 0) }];
    expect(fileIssue(csv(rows))).toBe("mixed_exporters");
  });

  it("enforces size, row and record limits", () => {
    const text = csv(fullHackRows());
    expect(fileIssue(text, { ...DEFAULT_LIMITS, maxBytes: 100 })).toBe("file_too_large");
    expect(fileIssue(text, { ...DEFAULT_LIMITS, maxRows: 2 })).toBe("too_many_rows");
    const two = csv([...fullHackRows(), { ...dropRecord(), ...item("portal", 0) }]);
    expect(fileIssue(two, { ...DEFAULT_LIMITS, maxRecords: 1 })).toBe("too_many_records");
  });

  it("rejects broken CSV syntax", () => {
    expect(fileIssue(`${csv([])}1,"unterminated\r\n`)).toBe("csv_syntax");
  });
});

describe("record-level checks", () => {
  it("rejects only the broken record and keeps the others", () => {
    const result = parseRows([
      ...fullHackRows(),
      { ...dropRecord({ association: "guessed" }), ...item("portal", 0) },
    ]);
    expect(result.records.map((parsed) => parsed.record.recordId)).toEqual([HACK_ID]);
    expect(result.rejected).toEqual([
      {
        recordId: DROP_ID,
        lines: [5],
        issues: [{ code: "invalid_value", message: "association is not an allowed value.", line: 5, column: "association" }],
      },
    ]);
  });

  it("rejects a record whose repeated fields disagree between rows", () => {
    const rows = fullHackRows();
    rows[1].hacking_bonus = "100";
    expect(rejectionCodes(rows)).toEqual(["inconsistent_record"]);
  });

  it("rejects the whole record when one of its rows is the wrong width", () => {
    const text = `${csv(fullHackRows())}1,${HACK_ID},hack\r\n`;
    const result = accepted(parseExport(bytes(text), { now: NOW }));
    expect(result.records).toHaveLength(0);
    expect(result.rejected[0]).toMatchObject({ recordId: HACK_ID, lines: [2, 3, 4, 5] });
    expect(result.rejected[0].issues.map((issue) => issue.code)).toEqual(["row_width"]);
  });

  it("rejects a malformed or mismatched record id", () => {
    expect(rejectionCodes(fullHackRows({ record_id: "h123" }))).toEqual(["invalid_value", "invalid_value", "invalid_value"]);
    expect(rejectionCodes(fullHackRows({ record_id: DROP_ID }))).toEqual(["inconsistent_record"]);
  });

  it("keeps an item name the site doesn't list yet, and flags it with the app build", () => {
    const rows = fullHackRows();
    rows[0].item = "Event Beacon";
    rows[0].level = "";
    rows[0].level_state = "notApplicable";
    const result = parseRows(rows);
    expect(result.records[0].record.reading!.panels[0].items[0].item).toBe("Event Beacon");
    expect(result.warnings).toEqual([
      {
        code: "unlisted_items",
        message:
          'Item names not on this site\'s list yet: "Event Beacon" (captured by build 74). They are kept as unverified text, never shown publicly, and their records are left out of item statistics until the names are reviewed.',
      },
    ]);
  });

  it("names the build that captured each record, not the exporting build", () => {
    const rows = fullHackRows({ source_app_build: "70" });
    rows[0].item = "Event Beacon";
    rows[0].level = "";
    rows[0].level_state = "notApplicable";
    expect(parseRows(rows).warnings[0].message).toContain('"Event Beacon" (captured by build 70)');
    const old = fullHackRows({ source_app_version: "", source_app_build: "" });
    old[0].item = "Event Beacon";
    old[0].level = "";
    old[0].level_state = "notApplicable";
    expect(parseRows(old).warnings[0].message).toContain("(captured by build unknown)");
  });

  it("rejects an item name that doesn't look like one", () => {
    for (const name of ["visit example.com/?a=1", "x".repeat(41), "Name, Surname"]) {
      const rows = fullHackRows();
      rows[0].item = name;
      expect(rejectionCodes(rows)).toEqual(["invalid_value"]);
    }
  });

  it("rejects an unknown panel effect", () => {
    const rows = fullHackRows().map((row) => (row.panel === "portal" ? { ...row, panel_effects: "ITO EN (+);Free XM" } : row));
    expect(rejectionCodes(rows)).toEqual(["invalid_value", "invalid_value"]);
  });

  it("rejects hack columns on a drop", () => {
    expect(rejectionCodes([{ ...dropRecord({ hack_state: "complete" }), ...item("portal", 0) }])).toEqual([
      "unexpected_value",
    ]);
  });

  it("rejects a drop that isn't read", () => {
    const codes = rejectionCodes([dropRecord({ read_status: "unavailable", association: "", observed_panels_read_in_full: "", both_panels_read: "" })]);
    expect(codes).toEqual(["inconsistent_record"]);
  });

  it("requires a reason for notRead and only one placeholder row without a reading", () => {
    const noReading = { association: "", observed_panels_read_in_full: "", both_panels_read: "" };
    expect(rejectionCodes([hackRecord({ read_status: "notRead", ...noReading })])).toEqual(["missing_value"]);
    const notRead = parseRows([hackRecord({ read_status: "notRead", read_reason: "frameGap", ...noReading })]);
    expect(notRead.records[0].record).toMatchObject({ readStatus: "notRead", readReason: "frameGap", reading: null });
    const twoRows = [hackRecord({ read_status: "unavailable", ...noReading }), hackRecord({ read_status: "unavailable", ...noReading })];
    expect(rejectionCodes(twoRows)).toEqual(["malformed_record"]);
  });

  it("accepts a reading with no panel as one placeholder row", () => {
    const result = parseRows([hackRecord({ observed_panels_read_in_full: "false", both_panels_read: "false" })]);
    expect(result.records[0].record.reading?.panels).toEqual([]);
  });

  it("rejects a slot used twice in one panel", () => {
    const rows = fullHackRows();
    rows[1].slot = "0";
    expect(rejectionCodes(rows)).toEqual(["malformed_record"]);
  });

  it("rejects an empty-panel row mixed with item rows", () => {
    const rows = [...fullHackRows()];
    rows.push({ ...hackRecord(), panel: "bonus", panel_partial: "false" });
    expect(rejectionCodes(rows)).toEqual(["malformed_record"]);
  });

  it("rejects coverage flags that don't match the panels", () => {
    expect(rejectionCodes(fullHackRows({ observed_panels_read_in_full: "false" }))).toEqual(["inconsistent_record"]);
    expect(rejectionCodes(fullHackRows({ both_panels_read: "false" }))).toEqual(["inconsistent_record"]);
    const unread = fullHackRows();
    unread[0].level_state = "unreadable";
    unread[0].level = "";
    expect(rejectionCodes(unread)).toEqual(["inconsistent_record"]);
  });

  it("rejects a level without level_state known, and rarity without its source", () => {
    const level = fullHackRows();
    level[1].level = "3";
    expect(rejectionCodes(level)).toEqual(["inconsistent_record"]);
    const rarity = fullHackRows();
    rarity[1].rarity_source = "";
    expect(rejectionCodes(rarity)).toEqual(["inconsistent_record"]);
  });

  it("rejects a confirmed-only command that isn't confirmed", () => {
    expect(rejectionCodes(fullHackRows({ speed_command_status: "unresolved" }))).toEqual(["inconsistent_record"]);
  });

  it("accepts an unrecognized item whose level was read", () => {
    const rows = fullHackRows({ observed_panels_read_in_full: "false" });
    rows[0].item = "";
    const result = parseRows(rows);
    expect(result.records[0].record.reading!.panels[0].items[0]).toMatchObject({ item: null, level: 6, levelState: "known" });
  });

  it("accepts an empty, partly read portal panel followed by a bonus panel", () => {
    const [, , bonus] = fullHackRows({ observed_panels_read_in_full: "false", both_panels_read: "false" });
    const portal = { ...hackRecord({ observed_panels_read_in_full: "false", both_panels_read: "false" }), panel: "portal", panel_partial: "true" };
    const panels = parseRows([portal, bonus]).records[0].record.reading!.panels;
    expect(panels.map((panel) => [panel.stage, panel.partial, panel.items.length])).toEqual([
      ["portal", true, 0],
      ["bonus", false, 1],
    ]);
  });

  it("orders a panel's items by slot", () => {
    const [first, second, bonus] = fullHackRows();
    const result = parseRows([second, first, bonus]);
    expect(result.records[0].record.reading!.panels[0].items.map((entry) => entry.slot)).toEqual([0, 1]);
  });

  it("rejects bonus rows before portal rows, which the app never writes", () => {
    const [first, second, bonus] = fullHackRows();
    expect(rejectionCodes([bonus, first, second])).toEqual(["malformed_record"]);
    expect(rejectionCodes([first, bonus, second])).toEqual(["malformed_record"]);
  });

  it("accepts a group that starts with the bonus panel alone", () => {
    const [, , bonus] = fullHackRows({ both_panels_read: "false" });
    const result = parseRows([bonus]);
    expect(result.records[0].record.reading!.panels.map((panel) => panel.stage)).toEqual(["bonus"]);
  });

  it("removes the spreadsheet guard from text cells", () => {
    const result = parseRows(fullHackRows({ source_app_build: "'-7" }));
    expect(result.records[0].record.origin.sourceAppBuild).toBe("-7");
  });
});

describe("time intervals", () => {
  it("accepts an hour that starts at a quarter past in UTC", () => {
    const result = parseRows(
      fullHackRows({
        time_bucket_start_utc: "2026-10-03T01:15:00Z",
        time_bucket_end_utc: "2026-10-03T02:15:00Z",
        local_date: "2026-10-03",
        local_hour: "7",
        utc_offset_minutes: "345",
      }),
    );
    expect(result.records[0].record.time).toMatchObject({ precision: "hour", localHour: 7, utcOffsetMinutes: 345 });
  });

  it("accepts a day interval with the hour left blank", () => {
    const result = parseRows(
      fullHackRows({
        time_bucket_start_utc: "2026-10-02T16:00:00Z",
        time_bucket_end_utc: "2026-10-03T16:00:00Z",
        local_date: "2026-10-03",
        local_hour: "",
        utc_offset_minutes: "480",
      }),
    );
    expect(result.records[0].record.time).toMatchObject({ precision: "day", localDate: "2026-10-03", localHour: null });
  });

  it("accepts a UTC day without an offset", () => {
    const result = parseRows(
      fullHackRows({
        time_bucket_start_utc: "2026-10-03T00:00:00Z",
        time_bucket_end_utc: "2026-10-04T00:00:00Z",
        local_date: "",
        local_hour: "",
        utc_offset_minutes: "",
      }),
    );
    expect(result.records[0].record.time).toMatchObject({ precision: "day", utcOffsetMinutes: null });
  });

  it("rejects intervals that aren't an hour or a day", () => {
    expect(rejectionCodes(fullHackRows({ time_bucket_end_utc: "2026-10-03T00:30:00Z" }))).toEqual(["invalid_time"]);
  });

  it("rejects an interval that isn't aligned to its offset", () => {
    expect(rejectionCodes(fullHackRows({ utc_offset_minutes: "345" }))).toContain("invalid_time");
  });

  it("rejects local columns that disagree with the interval", () => {
    expect(rejectionCodes(fullHackRows({ local_hour: "8" }))).toEqual(["invalid_time"]);
    expect(rejectionCodes(fullHackRows({ local_date: "2026-10-02" }))).toEqual(["invalid_time"]);
    expect(rejectionCodes(fullHackRows({ utc_offset_minutes: "" }))).toEqual(["invalid_time"]);
  });

  it("rejects implausible dates", () => {
    expect(
      rejectionCodes(
        fullHackRows({
          time_bucket_start_utc: "2027-01-01T00:00:00Z",
          time_bucket_end_utc: "2027-01-01T01:00:00Z",
          local_date: "",
          local_hour: "",
          utc_offset_minutes: "",
        }),
      ),
    ).toEqual(["invalid_time"]);
  });
});
