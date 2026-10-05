import { describe, expect, it } from "vitest";
import { parseExport } from "../src/domain/importer.ts";
import type { ObservationRecord } from "../src/domain/record.ts";
import { computeStatistics, NO_FILTER, type StatsFilter } from "../src/domain/statistics.ts";
import { parseStatsQuery, statsQueryString } from "../src/domain/statsQuery.ts";
import { datasetCsv, EXPECTED } from "./helpers/dataset.ts";
import { hackId } from "./helpers/export.ts";

const NOW = Date.UTC(2026, 9, 4) / 1000;

function dataset(): ObservationRecord[] {
  const result = parseExport(new TextEncoder().encode(datasetCsv()), { now: NOW });
  if (!result.ok || result.rejected.length > 0) throw new Error(`dataset rejected: ${JSON.stringify(result)}`);
  return result.records.map((entry) => entry.record);
}

const stats = (filter: Partial<StatsFilter> = {}) => computeStatistics(dataset(), { ...NO_FILTER, ...filter });
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
      { item: "Hypercube", quantity: 2, averagePerObservation: 1, multiplied: 0, multipliedUnknown: 0, levels: null },
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
      panels: "both",
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
  });
});
