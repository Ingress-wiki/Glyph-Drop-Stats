import { describe, expect, it } from "vitest";
import { parseExport } from "../src/domain/importer.ts";
import type { ObservationRecord } from "../src/domain/record.ts";
import { computeStatistics, NO_FILTER, type StatsFilter } from "../src/domain/statistics.ts";
import { parseStatsQuery, statsQueryString } from "../src/domain/statsQuery.ts";
import { datasetCsv, EXPECTED } from "./helpers/dataset.ts";
import { COLUMN_NAMES } from "../src/domain/format.ts";
import { csv, dropRecord, hackId, hackRecord, item, type Row } from "./helpers/export.ts";

const NOW = Date.UTC(2026, 9, 4) / 1000;

function dataset(): ObservationRecord[] {
  const result = parseExport(new TextEncoder().encode(datasetCsv()), { now: NOW });
  if (!result.ok || result.rejected.length > 0) throw new Error(`dataset rejected: ${JSON.stringify(result)}`);
  return result.records.map((entry) => entry.record);
}

/**
 * The hand calculations below read the portal panel alone and count
 * multiplied quantities; the page's default is both panels, without them.
 */
const PORTAL: StatsFilter = { ...NO_FILTER, panels: "portal", multiplied: "include" };
const stats = (filter: Partial<StatsFilter> = {}) => computeStatistics(dataset(), { ...PORTAL, ...filter });
const t = (iso: string) => Date.parse(iso) / 1000;

describe("the whole dataset", () => {
  const result = stats();

  it("counts every record once, by kind, read status and coverage", () => {
    expect(result.selection.matched).toBe(10);
    expect(Object.values(result.selection.unplaced).every((n) => n === 0)).toBe(true);
    expect(result.records).toEqual(EXPECTED.records);
  });

  it("sums items only over observations whose portal panel was read completely", () => {
    expect(result.items).toEqual({ panels: "portal", ...EXPECTED.portalItems });
  });

  it("summarizes every matched record, and puts them all in one unknown group without alignments", () => {
    expect(result.summary).toEqual(EXPECTED.summary);
    expect(result.split).toBe("alignment");
    expect(result.groups).toEqual([{ key: "unknown", summary: EXPECTED.summary }]);
  });

  it("can't count uploads unless told where records came from", () => {
    expect(result.selection.uploads).toBeNull();
  });
});

describe("coverage", () => {
  // Both panels present and neither partial, so the app sets both_panels_read; but one row is
  // not fully recognized, so observed_panels_read_in_full is false.
  const bothPanelsWith = (cells: Row) => {
    const record = hackRecord({ record_id: hackId(20), observed_panels_read_in_full: "false", both_panels_read: "true" });
    return [
      { ...record, ...item("portal", 0, cells) },
      { ...record, ...item("bonus", 0, { item: "Hypercube", level: "", level_state: "notApplicable" }) },
    ];
  };
  const coverageOf = (rows: Row[]) => {
    const result = parseExport(new TextEncoder().encode(csv(rows)), { now: NOW });
    if (!result.ok || result.records.length !== 1) throw new Error(`rejected: ${JSON.stringify(result)}`);
    return computeStatistics([result.records[0].record], NO_FILTER);
  };

  it("never counts both panels as read in full with an unidentified name", () => {
    const result = coverageOf(bothPanelsWith({ item: "" }));
    expect(result.records.byCoverage.both_panels_in_full).toBe(0);
    expect(result.records.byCoverage.partly_read).toBe(1);
    expect(result.items.excluded.unidentified_items).toBe(1);
  });

  it("never counts both panels as read in full with an unreadable level", () => {
    const result = coverageOf(bothPanelsWith({ level: "", level_state: "unreadable" }));
    expect(result.records.byCoverage.both_panels_in_full).toBe(0);
    expect(result.records.byCoverage.partly_read).toBe(1);
  });
});

describe("panel selection", () => {
  it("requires both panels read in full for both", () => {
    // Only h1 has both. h6 has no reading; every other record lacks one panel.
    const { items } = stats({ panels: "both" });
    expect(items.eligible).toBe(1);
    expect(items.excluded).toEqual({
      no_reading: 1,
      panel_not_seen: 8,
      partly_read: 0,
      unidentified_items: 0,
      unlisted_item_names: 0,
      multiplied: 0,
      multiplied_unread: 0,
    });
    expect(items.totalQuantity).toBe(4);
    expect(items.averagePerObservation).toBe(4);
    expect(items.byItem.map((entry) => [entry.item, entry.quantity])).toEqual([
      ["Resonator", 2],
      ["Hypercube", 1],
      ["XMP Burster", 1],
    ]);
  });

  it("reads the bonus panel alone for bonus", () => {
    // h1 and h8 have a bonus panel, each with one Hypercube.
    const { items } = stats({ panels: "bonus" });
    expect(items.eligible).toBe(2);
    expect(items.excluded.panel_not_seen).toBe(7);
    expect(items.byItem).toEqual([
      {
        item: "Hypercube",
        quantity: 2,
        averagePerObservation: 1,
        multiplied: 0,
        multipliedUnknown: 0,
        levels: null,
        observations: 2,
        rarities: { common: 0, rare: 0, veryRare: 2 },
        distribution: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        variance: 0,
      },
    ]);
  });
});

describe("filters", () => {
  it("selects by kind", () => {
    const result = stats({ kind: "drop" });
    expect(result.selection.matched).toBe(1);
    expect(result.items.byItem).toEqual([
      {
        item: "Power Cube",
        quantity: 2,
        averagePerObservation: 2,
        multiplied: 0,
        multipliedUnknown: 0,
        levels: [0, 0, 0, 0, 0, 0, 0, 2],
        observations: 1,
        rarities: { common: 0, rare: 0, veryRare: 0 },
        // One observation: no variance.
        distribution: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
        variance: null,
      },
    ]);
  });

  it("places portal levels only when the whole known range is inside the filter", () => {
    const result = stats({ portalLevel: { min: 6, max: 6 } });
    // In: h1 h3 h4 h5 h8 h9. Out: h2 (5). h6 and the drop have no level; h10 is 5–6.
    expect(result.selection.matched).toBe(6);
    expect(result.selection.unplaced.no_portal_level).toBe(2);
    expect(result.selection.unplaced.portal_level_crosses_filter).toBe(1);
  });

  it("uses final hacking bonuses only", () => {
    const result = stats({ hackingBonus: { min: 100, max: 200 } });
    // In: h1 h3 h4 h5 h8 h9 h10. Out: h2 (0). h6's bonus isn't final; the drop has none.
    expect(result.selection.matched).toBe(7);
    expect(result.selection.unplaced.hacking_bonus_not_final).toBe(1);
    expect(result.selection.unplaced.no_hacking_bonus).toBe(1);
  });

  it("puts a non-final speed bonus aside", () => {
    // Every hack's speed bonus (40) is not final; the drop has none.
    const result = stats({ speedBonus: { min: 0, max: 100 } });
    expect(result.selection.matched).toBe(0);
    expect(result.selection.unplaced.speed_bonus_not_final).toBe(9);
    expect(result.selection.unplaced.no_speed_bonus).toBe(1);
  });
});

describe("time", () => {
  it("keeps UTC-only records for UTC analysis", () => {
    const result = stats({ utc: { from: t("2026-10-02T23:00:00Z"), to: t("2026-10-03T00:00:00Z") } });
    // Every hour record, h9 included. The drop's day interval crosses the boundary.
    expect(result.selection.matched).toBe(9);
    expect(result.selection.unplaced.crosses_utc_boundary).toBe(1);
  });

  it("never splits an interval that crosses a boundary", () => {
    const result = stats({ utc: { from: t("2026-10-03T00:00:00Z"), to: t("2026-10-04T00:00:00Z") } });
    expect(result.selection.matched).toBe(0);
    expect(result.selection.unplaced.crosses_utc_boundary).toBe(1);
    expect(result.items.averagePerObservation).toBeNull();
  });

  it("requires a known offset for local dates", () => {
    const result = stats({ localDate: { from: "2026-10-03", to: "2026-10-03" } });
    expect(result.selection.matched).toBe(9);
    expect(result.selection.unplaced.no_local_time).toBe(1);
  });

  it("requires a known offset and an hour interval for local hours", () => {
    const result = stats({ localHour: { from: 7, to: 7 } });
    // h9 has no offset; the drop's interval is a whole day.
    expect(result.selection.matched).toBe(8);
    expect(result.selection.unplaced.no_local_time).toBe(1);
    expect(result.selection.unplaced.no_local_hour).toBe(1);
    expect(stats({ localHour: { from: 8, to: 23 } }).selection.matched).toBe(0);
  });

  it("reports a record definitely outside one filter as out, even if another can't judge it", () => {
    // h9 is out by kind; its missing offset doesn't make it unplaced.
    const result = stats({ kind: "drop", localHour: { from: 0, to: 23 } });
    expect(result.selection.unplaced.no_local_time).toBe(0);
    expect(result.selection.unplaced.no_local_hour).toBe(1);
  });
});

describe("records counted once", () => {
  it("are the input: the database supplies one accepted version per record", () => {
    const records = dataset();
    expect(new Set(records.map((record) => record.recordId)).size).toBe(records.length);
    expect(records.some((record) => record.recordId === hackId(10))).toBe(true);
  });
});

describe("query parameters", () => {
  it("read back a filter written by statsQueryString", () => {
    const filter: StatsFilter = {
      kind: "hack",
      utc: { from: t("2026-10-01T00:00:00Z"), to: t("2026-10-05T00:00:00Z") },
      localDate: { from: "2026-10-01", to: "2026-10-04" },
      localHour: { from: 6, to: 9 },
      portalLevel: { min: 5, max: 8 },
      hackingBonus: { min: 0, max: 120 },
      speedBonus: { min: 10, max: 40 },
      alignment: "enemy",
      panels: "both",
      multiplied: "exclude",
      split: "glyphCount",
    };
    expect(parseStatsQuery(new URLSearchParams(statsQueryString(filter)))).toEqual({ ok: true, filter });
    expect(parseStatsQuery(new URLSearchParams(""))).toEqual({ ok: true, filter: NO_FILTER });
  });

  it("reject unknown, repeated, half-given or malformed parameters", () => {
    const codes = (query: string) => {
      const result = parseStatsQuery(new URLSearchParams(query));
      return result.ok ? [] : result.issues.map((issue) => issue.message);
    };
    expect(codes("portalLevel=6")).toEqual(["portalLevel is not a known filter."]);
    expect(codes("kind=hack&kind=drop")).toEqual(["kind is given more than once."]);
    expect(codes("portalLevelMin=6")).toEqual(["portalLevelMin and portalLevelMax must be given together."]);
    expect(codes("portalLevelMin=0&portalLevelMax=9")).toHaveLength(2);
    expect(codes("portalLevelMin=7&portalLevelMax=6")).toEqual(["portalLevelMin must not be above portalLevelMax."]);
    expect(codes("utcFrom=2026-10-02&utcTo=2026-10-03")).toHaveLength(2);
    expect(codes("utcFrom=2026-10-03T00:00:00Z&utcTo=2026-10-03T00:00:00Z")).toEqual(["utcFrom must be before utcTo."]);
    expect(codes("localDateFrom=2026-02-30&localDateTo=2026-03-01")).toEqual(["localDateFrom must be a YYYY-MM-DD date."]);
    expect(codes("localHourFrom=5&localHourTo=24")).toEqual(["localHourTo must be an hour from 0 to 23."]);
    expect(codes("panels=all")).toEqual(["panels must be portal, bonus or both."]);
    expect(codes("multiplied=yes")).toEqual(["multiplied must be include or exclude."]);
    expect(codes("alignment=neutral")).toEqual(["alignment must be same_faction, enemy or machina."]);
    expect(codes("split=faction")).toEqual(["split must be alignment, portalLevel, glyphCount, speedCommand, keyCommand, panelEffect, event, week or day."]);
  });
});

/**
 * Six records for alignment, portal-level trust, shares and splits. Every
 * expected value below is worked out by hand from this table (portal panel
 * only, each read in full):
 *
 * | id | kind | alignment    | portal level        | speed   | effect     | app        | items                                              |
 * | -- | ---- | ------------ | ------------------- | ------- | ---------- | ---------- | -------------------------------------------------- |
 * | a  | hack | enemy        | 6 high              | complex | ITO EN (+) | 0.1.0 (74) | Resonator L6 ×2, Portal Shield rare ×1, Portal Key ×1 |
 * | b  | hack | enemy        | 6 low, conflict     | complex | —          | 0.1.0 (74) | Resonator L5 ×1                                    |
 * | c  | hack | machina      | 3 medium            | simple  | ITO EN (-) | 0.1.0 (74) | Portal Shield rarity unread ×1, XMP Burster L3 ×1  |
 * | d  | hack | —            | 7 high              | complex | —          | 1.0.0 (2)  | Heat Sink common ×1, Resonator L7 ×1               |
 * | e  | drop | —            | —                   | —       | —          | 0.1.0 (74) | Power Cube L8 ×1                                   |
 * | f  | hack | same_faction | 2 low               | complex | —          | 0.1.0 (10) | Resonator L2 ×1, Hypercube ×1, Resonator L3 ×1     |
 */
describe("alignment, trusted levels, shares and splits", () => {
  const ALIGNED = [...COLUMN_NAMES, "portal_alignment"];
  const one: Row = {
    observed_panels_read_in_full: "true",
    both_panels_read: "false",
  };
  const noLevel = (name: string, extra: Row = {}): Row => ({
    item: name,
    level: "",
    level_state: "notApplicable",
    ...extra,
  });
  const level = (low: string, confidence: string, conflict = "false"): Row => ({
    portal_level_low: low,
    portal_level_high: low,
    portal_level_confidence: confidence,
    portal_level_conflict: conflict,
  });
  const a = hackRecord({
    record_id: hackId(31),
    ...one,
    ...level("6", "high"),
    panel_effects: "ITO EN (+)",
  });
  const b = hackRecord({
    record_id: hackId(32),
    ...one,
    ...level("6", "low", "true"),
  });
  const c = hackRecord({
    record_id: hackId(33),
    ...one,
    ...level("3", "medium"),
    speed_command: "simple",
    panel_effects: "ITO EN (-)",
  });
  const d = hackRecord({
    record_id: hackId(34),
    ...one,
    ...level("7", "high"),
    source_app_version: "1.0.0",
    source_app_build: "2",
  });
  const e = dropRecord({ ...one });
  const f = hackRecord({
    record_id: hackId(36),
    ...one,
    ...level("2", "low"),
    source_app_build: "10",
  });
  const rows: [Row, string][] = [
    [{ ...a, ...item("portal", 0, { quantity: "2" }) }, "enemy"],
    [
      {
        ...a,
        ...item("portal", 1, noLevel("Portal Shield", { rarity: "rare", rarity_source: "read" })),
      },
      "enemy",
    ],
    [{ ...a, ...item("portal", 2, noLevel("Portal Key")) }, "enemy"],
    [{ ...b, ...item("portal", 0, { level: "5" }) }, "enemy"],
    [
      {
        ...c,
        ...item(
          "portal",
          0,
          noLevel("Portal Shield", {
            rarity: "unreadable",
            rarity_source: "read",
          }),
        ),
      },
      "machina",
    ],
    [{ ...c, ...item("portal", 1, { item: "XMP Burster", level: "3" }) }, "machina"],
    [
      {
        ...d,
        ...item("portal", 0, noLevel("Heat Sink", { rarity: "common", rarity_source: "read" })),
      },
      "",
    ],
    [{ ...d, ...item("portal", 1, { level: "7" }) }, ""],
    [{ ...e, ...item("portal", 0, { item: "Power Cube", level: "8" }) }, ""],
    [{ ...f, ...item("portal", 0, { level: "2" }) }, "same_faction"],
    [
      {
        ...f,
        ...item("portal", 1, noLevel("Hypercube", { rarity: "veryRare", rarity_source: "fixed" })),
      },
      "same_faction",
    ],
    [{ ...f, ...item("portal", 2, { level: "3" }) }, "same_faction"],
  ];
  const parsed = parseExport(
    new TextEncoder().encode(
      csv(
        rows.map(([row]) => row),
        { header: ALIGNED, extra: rows.map(([, alignment]) => [alignment]) },
      ),
    ),
    { now: NOW },
  );
  if (!parsed.ok || parsed.rejected.length > 0) throw new Error(`rejected: ${JSON.stringify(parsed)}`);
  const records = parsed.records.map((entry) => entry.record);
  const uploadOf = new Map([
    [hackId(31), 1],
    [hackId(32), 1],
    [hackId(33), 2],
  ]);
  const run = (filter: Partial<StatsFilter> = {}) => computeStatistics(records, { ...PORTAL, ...filter }, uploadOf);
  const grid = (cells: [number, number, number][]) => {
    const rows = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
    for (const [portal, itemLevel, quantity] of cells) rows[portal - 1][itemLevel - 1] = quantity;
    return rows;
  };

  it("summarizes shares, trusted portal levels and the level grid", () => {
    expect(run().summary).toEqual({
      records: 6,
      eligible: 6,
      // a 4, b 1, c 2, d 2, e 1, f 3
      totalQuantity: 13,
      averagePerObservation: 13 / 6,
      // Yes: a (rare shield), f (Hypercube). Unknown: c, whose only candidate's rarity is unread.
      rare: { yes: 2, known: 5 },
      key: { yes: 1, known: 6 },
      // b's level conflicts and f's is low confidence: neither is placed.
      portalLevels: [0, 0, 1, 0, 0, 1, 1, 0],
      levelGrid: grid([
        [3, 3, 1],
        [6, 6, 2],
        [7, 7, 1],
      ]),
    });
  });

  it("counts an item's observations once per record, and its quantity by known rarity", () => {
    const { byItem } = run().items;
    const resonator = byItem.find((entry) => entry.item === "Resonator");
    const shield = byItem.find((entry) => entry.item === "Portal Shield");
    // a, b, d, f; f has two Resonator rows.
    expect(resonator).toMatchObject({
      quantity: 6,
      observations: 4,
      levels: [0, 1, 1, 0, 1, 2, 1, 0],
    });
    expect(shield).toMatchObject({
      quantity: 2,
      observations: 2,
      rarities: { common: 0, rare: 1, veryRare: 0 },
    });
  });

  it("groups by alignment in a fixed order, unknown last", () => {
    const result = run();
    expect(result.groups.map((group) => [group.key, group.summary.records])).toEqual([
      ["same_faction", 1],
      ["enemy", 2],
      ["machina", 1],
      ["unknown", 2],
    ]);
    const enemy = result.groups[1].summary;
    expect(enemy).toMatchObject({
      eligible: 2,
      totalQuantity: 5,
      rare: { yes: 1, known: 2 },
      key: { yes: 1, known: 2 },
    });
    expect(enemy.levelGrid).toEqual(grid([[6, 6, 2]]));
  });

  it("groups by other splits, putting untrusted levels and drops in unknown", () => {
    const keys = (split: StatsFilter["split"]) => run({ split }).groups.map((group) => [group.key, group.summary.records]);
    expect(keys("portalLevel")).toEqual([
      ["3", 1],
      ["6", 1],
      ["7", 1],
      ["unknown", 3],
    ]);
    expect(keys("speedCommand")).toEqual([
      ["simple", 1],
      ["complex", 4],
      ["unknown", 1],
    ]);
    expect(keys("glyphCount")).toEqual([
      ["4", 5],
      ["unknown", 1],
    ]);
  });

  it("groups by the panel effect the app read, readings without one first", () => {
    const groups = run({ split: "panelEffect" }).groups;
    expect(groups.map((group) => [group.key, group.summary.records])).toEqual([
      ["none", 4],
      ["ITO EN (+)", 1],
      ["ITO EN (-)", 1],
    ]);
    // a alone: Resonator ×2, Portal Shield ×1, Portal Key ×1.
    expect(groups[1].summary).toMatchObject({ eligible: 1, totalQuantity: 4, averagePerObservation: 4 });
  });

  it("filters by alignment, setting aside records without one", () => {
    const result = run({ alignment: "enemy" });
    expect(result.selection.matched).toBe(2);
    // d has no alignment and e is a drop; c and f are out.
    expect(result.selection.unplaced.no_alignment).toBe(2);
    expect(result.selection.uploads).toBe(1);
  });

  it("sets aside conflicting and low-confidence levels in a level filter", () => {
    const result = run({ portalLevel: { min: 1, max: 8 } });
    expect(result.selection.matched).toBe(3);
    expect(result.selection.unplaced.portal_level_unreliable).toBe(2);
    expect(result.selection.unplaced.no_portal_level).toBe(1);
  });

  it("counts distinct uploads and app builds, newest last", () => {
    const result = run();
    expect(result.selection.uploads).toBe(2);
    expect(result.records.byApp).toEqual([
      { version: "0.1.0", build: "10", records: 1 },
      { version: "0.1.0", build: "74", records: 4 },
      { version: "1.0.0", build: "2", records: 1 },
    ]);
  });
});

describe("count distributions", () => {
  /**
   * Three hacks, portal panel read in full:
   * | id | Portal Shield rows      | per observation |
   * | -- | ----------------------- | --------------- |
   * | p  | ×1 in slot 0, ×2 in slot 1 | 3            |
   * | q  | ×12                     | 12              |
   * | r  | none (a Resonator)      | 0               |
   */
  const shield = (slot: number, quantity: string): Row =>
    item("portal", slot, { item: "Portal Shield", level: "", level_state: "notApplicable", rarity: "common", rarity_source: "read", quantity });
  const seen: Row = { observed_panels_read_in_full: "true", both_panels_read: "false" };
  const p = hackRecord({ record_id: hackId(51), order: "1", ...seen });
  const q = hackRecord({ record_id: hackId(52), order: "2", ...seen });
  const r = hackRecord({ record_id: hackId(53), order: "3", ...seen });
  const rows = [{ ...p, ...shield(0, "1") }, { ...p, ...shield(1, "2") }, { ...q, ...shield(0, "12") }, { ...r, ...item("portal", 0) }];
  const parsed = parseExport(new TextEncoder().encode(csv(rows)), { now: NOW });
  if (!parsed.ok || parsed.rejected.length > 0) throw new Error(`rejected: ${JSON.stringify(parsed)}`);
  const result = computeStatistics(
    parsed.records.map((entry) => entry.record),
    PORTAL,
  );
  const shields = result.items.byItem.find((row) => row.item === "Portal Shield");

  it("counts an observation by its total of the item, over every slot, with 10 or more in the last bin", () => {
    expect(shields?.distribution).toEqual([1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
    expect(shields?.observations).toBe(2);
  });

  it("works out the variance from the uncapped counts", () => {
    // Σq = 15, Σq² = 9 + 144 = 153: (3·153 − 15²) / (3·2) = 234 / 6.
    expect(shields?.variance).toBe(39);
    expect(shields?.averagePerObservation).toBe(5);
  });
});

describe("leaving out multiplied items", () => {
  /**
   * Four hacks, both panels read in full:
   * | id | portal panel                        | bonus panel      |
   * | -- | ----------------------------------- | ---------------- |
   * | m  | Resonator ×2 red, Resonator ×1 plain | Hypercube ×1 plain |
   * | n  | Resonator ×1 plain                  | Hypercube ×2 red   |
   * | o  | Resonator ×1 colour unread          | Hypercube ×1 plain |
   * | v  | Resonator ×3 plain                  | Hypercube ×1 plain |
   */
  const plain = { multiplied: "false" };
  const red = { multiplied: "true" };
  const cube: Row = { item: "Hypercube", level: "", level_state: "notApplicable", rarity: "veryRare", rarity_source: "fixed" };
  const m = hackRecord({ record_id: hackId(61), order: "1" });
  const n = hackRecord({ record_id: hackId(62), order: "2" });
  const o = hackRecord({ record_id: hackId(63), order: "3" });
  const v = hackRecord({ record_id: hackId(64), order: "4" });
  const rows = [
    { ...m, ...item("portal", 0, { quantity: "2", ...red }) },
    { ...m, ...item("portal", 1, plain) },
    { ...m, ...item("bonus", 0, { ...cube, ...plain }) },
    { ...n, ...item("portal", 0, plain) },
    { ...n, ...item("bonus", 0, { ...cube, quantity: "2", ...red }) },
    { ...o, ...item("portal", 0) },
    { ...o, ...item("bonus", 0, { ...cube, ...plain }) },
    { ...v, ...item("portal", 0, { quantity: "3", ...plain }) },
    { ...v, ...item("bonus", 0, { ...cube, ...plain }) },
  ];
  const parsed = parseExport(new TextEncoder().encode(csv(rows)), { now: NOW });
  if (!parsed.ok || parsed.rejected.length > 0) throw new Error(`rejected: ${JSON.stringify(parsed)}`);
  const records = parsed.records.map((entry) => entry.record);
  const run = (filter: Partial<StatsFilter>) => computeStatistics(records, { ...PORTAL, ...filter });

  it("leaves them out by default", () => {
    expect(computeStatistics(records, NO_FILTER).items.excluded).toMatchObject({ multiplied: 2, multiplied_unread: 1 });
  });

  it("counts multiplied quantities as shown when asked", () => {
    const result = run({});
    expect(result.items.eligible).toBe(4);
    expect(result.items.totalQuantity).toBe(8);
    expect(result.items.excluded).toMatchObject({ multiplied: 0, multiplied_unread: 0 });
  });

  it("leaves out an observation with a red or unread counted item, and says which", () => {
    const result = run({ multiplied: "exclude" });
    // n's red Hypercube is on the bonus panel, which isn't counted.
    expect(result.items.eligible).toBe(2);
    expect(result.items.totalQuantity).toBe(4);
    expect(result.items.excluded).toMatchObject({ multiplied: 1, multiplied_unread: 1 });
    expect(result.records.total).toBe(4);
    expect(result.items.byItem.map((row) => [row.item, row.quantity, row.multiplied, row.multipliedUnknown])).toEqual([["Resonator", 4, 0, 0]]);
  });

  it("judges every counted panel", () => {
    const result = run({ multiplied: "exclude", panels: "both" });
    expect(result.items.eligible).toBe(1);
    expect(result.items.excluded).toMatchObject({ multiplied: 2, multiplied_unread: 1 });
  });
});

describe("time and event splits", () => {
  // Every hack's hour is 2026-10-02 23:00–24:00 UTC, a Friday. The drop's local day at
  // +08:00 is 2026-10-02 16:00 to 2026-10-03 16:00 UTC, so it crosses UTC midnight.
  const keys = (split: StatsFilter["split"], events: Parameters<typeof computeStatistics>[3] = []) =>
    computeStatistics(dataset(), { ...NO_FILTER, split }, undefined, events).groups.map((group) => [group.key, group.summary.records]);
  const event = (id: string, from: string, to: string) => ({ id, name: id, startUtc: t(from), endUtc: t(to), note: "test" });

  it("groups by UTC day, never guessing the day of an interval that crosses midnight", () => {
    expect(keys("day")).toEqual([
      ["2026-10-02", 9],
      ["unknown", 1],
    ]);
  });

  it("groups by the UTC week from Monday, which holds both", () => {
    expect(keys("week")).toEqual([["2026-09-28", 10]]);
  });

  it("groups by event, with what crosses an event's end unknown and the rest outside", () => {
    const friday = event("friday", "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z");
    const later = event("later", "2026-11-01T00:00:00Z", "2026-11-08T00:00:00Z");
    expect(keys("event", [friday, later])).toEqual([
      ["friday", 9],
      ["unknown", 1],
    ]);
    expect(keys("event", [later])).toEqual([["outside", 10]]);
    // An event touching only the drop's day leaves the hacks outside and the drop unknown.
    const morning = event("morning", "2026-10-03T00:00:00Z", "2026-10-03T12:00:00Z");
    expect(keys("event", [morning])).toEqual([
      ["outside", 9],
      ["unknown", 1],
    ]);
  });
});
