import { describe, expect, it } from "vitest";
import type { ItemTotal } from "../src/domain/statistics.ts";
import { averageText, barOf, barTotals, chance, groupLabel, isFew, levelShares, percent, sharePercent, whenPresent } from "../src/web/dashboard.ts";
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
