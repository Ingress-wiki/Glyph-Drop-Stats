import { describe, expect, it } from "vitest";
import { computeStatistics, NO_FILTER, type ItemTotal } from "../src/domain/statistics.ts";
import { columnMaxima, itemsTsv, shade, sortItems } from "../src/web/itemTable.ts";
import { itemCategory, matchesSearch } from "../src/web/items.ts";

const row = (item: string, quantity: number, levels: number[] | null = null): ItemTotal => ({
  item,
  quantity,
  averagePerObservation: quantity / 4,
  multiplied: 0,
  multipliedUnknown: 0,
  levels,
});

describe("shade", () => {
  it("is 0 for nothing and 1–5 by share of the column's largest value", () => {
    expect(shade(0, 10)).toBe(0);
    expect(shade(5, 0)).toBe(0);
    expect(shade(0.1, 10)).toBe(1);
    expect(shade(2, 10)).toBe(1);
    expect(shade(2.1, 10)).toBe(2);
    expect(shade(6, 10)).toBe(3);
    expect(shade(10, 10)).toBe(5);
  });
});

describe("sortItems", () => {
  const rows = [row("Resonator", 7, [0, 0, 0, 0, 3, 4, 0, 0]), row("Hypercube", 2), row("Power Cube", 2, [0, 0, 0, 0, 0, 0, 0, 2])];

  it("sorts by a column, breaking ties by name", () => {
    expect(sortItems(rows, { key: "quantity", descending: true }).map((r) => r.item)).toEqual([
      "Resonator",
      "Hypercube",
      "Power Cube",
    ]);
    expect(sortItems(rows, { key: "item", descending: false }).map((r) => r.item)).toEqual([
      "Hypercube",
      "Power Cube",
      "Resonator",
    ]);
  });

  it("puts items without levels below every levelled item in a level column", () => {
    expect(sortItems(rows, { key: "L8", descending: true }).map((r) => r.item)).toEqual([
      "Power Cube",
      "Resonator",
      "Hypercube",
    ]);
  });

  it("finds each shaded column's largest value", () => {
    expect(columnMaxima(rows)).toEqual({ quantity: 7, average: 1.75, level: 4 });
    expect(columnMaxima([])).toEqual({ quantity: 0, average: 0, level: 0 });
  });
});

describe("itemsTsv", () => {
  it("writes the denominator on every row and leaves level cells blank for items without levels", () => {
    const statistics = computeStatistics([], NO_FILTER);
    statistics.items.eligible = 4;
    statistics.items.byItem = [row("Resonator", 7, [0, 0, 0, 0, 3, 4, 0, 0]), row("Hypercube", 2)];
    expect(itemsTsv(statistics).split("\n")).toEqual([
      "item\tquantity\teligible_observations\tper_observation\tL1\tL2\tL3\tL4\tL5\tL6\tL7\tL8\tmultiplied\tcolour_unread\tpanels",
      "Resonator\t7\t4\t1.75\t0\t0\t0\t0\t3\t4\t0\t0\t0\t0\tportal",
      "Hypercube\t2\t4\t0.5\t\t\t\t\t\t\t\t\t0\t0\tportal",
      "",
    ]);
  });
});

describe("item search", () => {
  it("matches names in any case, and categories exactly", () => {
    expect(matchesSearch("Resonator", "RES")).toBe(true);
    expect(matchesSearch("Portal Shield", "mod")).toBe(true);
    expect(matchesSearch("Portal Key", "mod")).toBe(false);
    expect(matchesSearch("Anything", "  ")).toBe(true);
    expect(itemCategory("Event Beacon")).toBeNull();
  });
});
