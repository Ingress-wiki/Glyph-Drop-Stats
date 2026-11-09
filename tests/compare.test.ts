import { describe, expect, it } from "vitest";
import { compareStatistics } from "../src/domain/compare.ts";
import { parseExport } from "../src/domain/importer.ts";
import type { ObservationRecord } from "../src/domain/record.ts";
import { computeStatistics, NO_FILTER, type StatsFilter } from "../src/domain/statistics.ts";
import { datasetCsv } from "./helpers/dataset.ts";

const NOW = Date.UTC(2026, 9, 4) / 1000;

function dataset(): ObservationRecord[] {
  const result = parseExport(new TextEncoder().encode(datasetCsv()), { now: NOW });
  if (!result.ok || result.rejected.length > 0) throw new Error("dataset rejected");
  return result.records.map((entry) => entry.record);
}

const PORTAL: StatsFilter = { ...NO_FILTER, panels: "portal", multiplied: "include" };

/** The first four records are "mine", the rest everyone else's. */
function split(filter: StatsFilter = PORTAL) {
  const records = dataset();
  const mine = computeStatistics(records.slice(0, 4), filter);
  const others = computeStatistics(records.slice(4), filter);
  const whole = computeStatistics(records, filter);
  return { mine, others, whole, comparison: compareStatistics(mine, others) };
}

describe("comparing a player with everyone else", () => {
  it("takes each side's headline figures, which add up to the whole", () => {
    const { mine, others, whole, comparison } = split();
    expect(comparison.you.records).toBe(mine.summary.records);
    expect(comparison.others.records).toBe(others.summary.records);
    expect(comparison.you.records + comparison.others.records).toBe(whole.summary.records);
    expect(comparison.you.eligible + comparison.others.eligible).toBe(whole.summary.eligible);
    expect(comparison.itemEligible).toEqual({ you: mine.items.eligible, others: others.items.eligible });
    expect(comparison.filter).toEqual(PORTAL);
  });

  it("lists every item either side has, with what the player would expect at everyone else's average", () => {
    const { mine, others, whole, comparison } = split();
    expect(comparison.items.map((item) => item.item).sort()).toEqual(whole.items.byItem.map((item) => item.item).sort());
    for (const row of comparison.items) {
      const theirs = others.items.byItem.find((total) => total.item === row.item);
      const yours = mine.items.byItem.find((total) => total.item === row.item);
      expect(row.you.quantity).toBe(yours?.quantity ?? 0);
      expect(row.others.quantity).toBe(theirs?.quantity ?? 0);
      expect(row.you.quantity + row.others.quantity).toBe(whole.items.byItem.find((total) => total.item === row.item)?.quantity);
      const expected = ((theirs?.quantity ?? 0) / others.items.eligible) * mine.items.eligible;
      expect(row.expected).toBeCloseTo(expected, 12);
      expect(row.ratio).toBe(expected === 0 ? null : row.you.quantity / expected);
    }
    const averages = comparison.items.map((item) => item.others.averagePerObservation ?? -1);
    expect(averages).toEqual([...averages].sort((a, b) => b - a));
  });

  it("marks a sample under 30 eligible observations as few", () => {
    expect(split().comparison.few).toBe(true);
  });

  it("has no average and no expectation where a side has nothing eligible", () => {
    const records = dataset();
    const empty = computeStatistics([], PORTAL);
    const comparison = compareStatistics(empty, computeStatistics(records, PORTAL));
    expect(comparison.you.averagePerObservation).toBeNull();
    for (const row of comparison.items) {
      expect(row.you.averagePerObservation).toBeNull();
      expect(row.expected).toBe(0);
      expect(row.ratio).toBeNull();
    }
    const reversed = compareStatistics(computeStatistics(records, PORTAL), empty);
    for (const row of reversed.items) expect(row.expected).toBeNull();
  });

  it("puts both sides of each group together, in the split's natural order", () => {
    const { whole, comparison } = split({ ...PORTAL, split: "portalLevel" });
    expect(comparison.split).toBe("portalLevel");
    expect(comparison.groups.map((group) => group.key)).toEqual(whole.groups.map((group) => group.key));
    for (const group of comparison.groups) {
      const records = (group.you?.records ?? 0) + (group.others?.records ?? 0);
      expect(records).toBe(whole.groups.find((g) => g.key === group.key)?.summary.records);
      expect(group.you === null || group.you.records > 0).toBe(true);
    }
  });
});
