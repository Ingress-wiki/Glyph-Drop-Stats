import { describe, expect, it } from "vitest";
import type { ItemTotal } from "../src/domain/statistics.ts";
import { averageText, barOf, countLabel, dispersion, eventsDuring, isTimeSplit, poissonExpected, barTotals, chance, groupLabel, isFew, levelShares, percent, sharePercent, whenPresent } from "../src/web/dashboard.ts";
import { en } from "../src/web/i18n/en.ts";

const row = (item: string, quantity: number, observations: number): ItemTotal => ({
  item,
  quantity,
  averagePerObservation: 0,
  multiplied: 0,
  multipliedUnknown: 0,
  levels: null,
  observations,
  rarities: { common: 0, rare: 0, veryRare: 0 },
  distribution: [],
  variance: null,
});

describe("dashboard figures", () => {
  it("marks fewer than 30 observations as few", () => {
    expect(isFew(29)).toBe(true);
    expect(isFew(30)).toBe(false);
  });

  it("writes shares and averages, with a dash when there is nothing to divide by", () => {
    expect(percent({ yes: 1, known: 3 })).toBe("33%");
    expect(percent({ yes: 0, known: 0 })).toBe("—");
    expect(averageText(1.005)).toBe("1.00");
    expect(averageText(null)).toBe("—");
  });

  it("writes a tiny share that isn't zero as <1, never 0", () => {
    expect(sharePercent(0)).toBe("0");
    expect(sharePercent(0.004)).toBe("<1");
    expect(sharePercent(0.005)).toBe("1");
    expect(sharePercent(0.274)).toBe("27");
  });

  it("names groups in the page's language, unknown included", () => {
    expect(groupLabel(en, "alignment", "enemy")).toBe("Enemy");
    expect(groupLabel(en, "portalLevel", "8")).toBe("P8");
    expect(groupLabel(en, "glyphCount", "1")).toBe("1 Glyph");
    expect(groupLabel(en, "keyCommand", "unknown")).toBe("Unknown");
    expect(groupLabel(en, "panelEffect", "none")).toBe("No effect shown");
    expect(groupLabel(en, "panelEffect", "ITO EN (-)")).toBe("ITO EN (−)");
  });

  it("sorts items into bars and averages each bar over eligible observations", () => {
    expect(barOf("Resonator")).toBe("Resonator");
    expect(barOf("Aegis Shield")).toBe("shields");
    expect(barOf("Heat Sink")).toBe("mods");
    expect(barOf("Hypercube")).toBe("other");
    const bars = barTotals([row("Portal Shield", 2, 2), row("Aegis Shield", 1, 1), row("Hypercube", 4, 1)], 4);
    expect(bars.map((bar) => bar.bar)).toEqual(["Resonator", "XMP Burster", "Ultra Strike", "Power Cube", "shields", "mods", "Portal Key", "other"]);
    expect(Object.fromEntries(bars.map((bar) => [bar.bar, bar.perObservation]))).toMatchObject({ shields: 0.75, other: 1, mods: 0 });
    expect(barTotals([row("Hypercube", 4, 1)], 0)).toEqual([]);
  });

  it("splits a portal level's items into item-level shares", () => {
    expect(levelShares([0, 0, 0, 0, 0, 1, 3, 0])).toEqual([0, 0, 0, 0, 0, 0.25, 0.75, 0]);
    expect(levelShares([0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it("gives an item's chance per observation and its average when present", () => {
    expect(chance(row("Hypercube", 6, 2), 8)).toBe(0.25);
    expect(chance(row("Hypercube", 6, 2), 0)).toBeNull();
    expect(whenPresent(row("Hypercube", 6, 2))).toBe(3);
    expect(whenPresent(row("Hypercube", 0, 0))).toBeNull();
  });
});

describe("count distributions", () => {
  it("expect Poisson counts that sum to the observations, the tail in the last bin", () => {
    const expected = poissonExpected(2, 100);
    expect(expected).toHaveLength(11);
    expect(expected[0]).toBeCloseTo(100 * Math.exp(-2), 10);
    expect(expected[2]).toBeCloseTo(100 * 2 * Math.exp(-2), 10);
    expect(expected.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    expect(poissonExpected(0, 5)).toEqual([5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(poissonExpected(1, 0)).toEqual([]);
  });

  it("divide variance by the mean, and say nothing without either", () => {
    expect(dispersion({ ...row("Portal Shield", 5, 2), averagePerObservation: 0.5, variance: 0.75 })).toBe(1.5);
    expect(dispersion({ ...row("Portal Shield", 0, 0), variance: 0 })).toBeNull();
    expect(dispersion(row("Portal Shield", 5, 2))).toBeNull();
  });

  it("label the last bin as that many or more", () => {
    expect(countLabel(3)).toBe("3");
    expect(countLabel(10)).toBe("10+");
  });
});

describe("trends", () => {
  const event = (id: string, from: string, to: string) => ({ id, name: id, startUtc: Date.parse(from) / 1000, endUtc: Date.parse(to) / 1000, note: "test" });
  const weekend = event("weekend", "2026-10-03T00:00:00Z", "2026-10-05T00:00:00Z");

  it("finds the events a day or week overlaps, ends exclusive", () => {
    expect(eventsDuring("day", "2026-10-03", [weekend])).toEqual([weekend]);
    expect(eventsDuring("day", "2026-10-02", [weekend])).toEqual([]);
    expect(eventsDuring("day", "2026-10-05", [weekend])).toEqual([]);
    expect(eventsDuring("week", "2026-09-28", [weekend])).toEqual([weekend]);
    expect(eventsDuring("week", "2026-10-05", [weekend])).toEqual([]);
    expect(eventsDuring("week", "unknown", [weekend])).toEqual([]);
  });

  it("knows which splits are periods of time", () => {
    expect(isTimeSplit("week") && isTimeSplit("day")).toBe(true);
    expect(isTimeSplit("event")).toBe(false);
  });

  it("names time and event groups", () => {
    expect(groupLabel(en, "week", "2026-09-28")).toBe("Week of 2026-09-28");
    expect(groupLabel(en, "day", "2026-10-02")).toBe("2026-10-02");
    expect(groupLabel(en, "event", "outside")).toBe("Outside events");
  });
});
