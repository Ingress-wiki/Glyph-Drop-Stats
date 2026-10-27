import { COUNT_CAP, SMALL_SAMPLE, UNKNOWN_GROUP, type ItemTotal, type Share, type Split } from "../domain/statistics.ts";
import type { Messages } from "./i18n/en.ts";

/**
 * What the dashboard derives from a `Statistics` answer, kept apart from
 * drawing so the canvas and the text mirror say the same thing.
 */

/** Whether a figure rests on so few observations that the page marks it. */
export const isFew = (observations: number): boolean => observations < SMALL_SAMPLE;

/** A share as a whole percentage, or a dash when nothing is known. */
export function percent(share: Share): string {
  return share.known === 0 ? "—" : `${Math.round((share.yes / share.known) * 100)}%`;
}

export function averageText(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/** A group's name in the page's language. */
export function groupLabel(s: Messages, split: Split, key: string): string {
  const g = s.stats.compare;
  if (key === UNKNOWN_GROUP) return g.unknown;
  switch (split) {
    case "alignment":
      return g.alignments[key as keyof typeof g.alignments] ?? key;
    case "portalLevel":
      return g.portalLevel(key);
    case "glyphCount":
      return g.glyphCount(Number(key));
    case "speedCommand":
      return g.speedCommands[key as keyof typeof g.speedCommands] ?? key;
    case "keyCommand":
      return g.keyCommands[key as keyof typeof g.keyCommands] ?? key;
    case "panelEffect":
      return g.panelEffects[key as keyof typeof g.panelEffects] ?? key;
  }
}

/** The bars of "what an observation gives": the four levelled items, then mods, keys and the rest. */
export const BARS = ["Resonator", "XMP Burster", "Ultra Strike", "Power Cube", "shields", "mods", "Portal Key", "other"] as const;
export type Bar = (typeof BARS)[number];

const SHIELDS = new Set(["Portal Shield", "Aegis Shield"]);
const MODS = new Set([
  "Force Amp",
  "Turret",
  "Heat Sink",
  "Multi-Hack",
  "Link Amp",
  "SoftBank Ultra Link",
  "ITO EN Transmuter (+)",
  "ITO EN Transmuter (-)",
]);

export function barOf(item: string): Bar {
  if ((BARS as readonly string[]).includes(item)) return item as Bar;
  if (SHIELDS.has(item)) return "shields";
  if (MODS.has(item)) return "mods";
  return "other";
}

/** Average quantity per eligible observation for every bar, in `BARS` order; empty without eligible observations. */
export function barTotals(byItem: readonly ItemTotal[], eligible: number): { bar: Bar; perObservation: number }[] {
  if (eligible === 0) return [];
  const totals = new Map<Bar, number>(BARS.map((bar) => [bar, 0]));
  for (const row of byItem) {
    const bar = barOf(row.item);
    totals.set(bar, (totals.get(bar) ?? 0) + row.quantity);
  }
  return BARS.map((bar) => ({ bar, perObservation: (totals.get(bar) ?? 0) / eligible }));
}

/** A bar's name: item names stay as the game prints them, groups are translated. */
export function barLabel(s: Messages, bar: Bar): string {
  const groups = s.stats.gives.groups;
  return bar === "shields" || bar === "mods" || bar === "other" ? groups[bar] : bar;
}

/** Each item level's share of one portal level's levelled items; null when there are none. */
export function levelShares(row: readonly number[]): number[] | null {
  const total = row.reduce((sum, n) => sum + n, 0);
  return total === 0 ? null : row.map((n) => n / total);
}

/** A share as a whole percentage, without the sign; one that rounds to nothing but isn't, as "<1". */
export function sharePercent(share: number): string {
  const whole = Math.round(share * 100);
  return whole === 0 && share > 0 ? "<1" : String(whole);
}

/** Of eligible observations, the share with this item; null without any. */
export function chance(row: ItemTotal, eligible: number): number | null {
  return eligible === 0 ? null : row.observations / eligible;
}

/** The average quantity in observations that had the item. */
export function whenPresent(row: ItemTotal): number | null {
  return row.observations === 0 ? null : row.quantity / row.observations;
}

/**
 * How many of `observations` a Poisson distribution with this `mean` would
 * put at each count, binned as `ItemTotal.distribution` is: the last bin is
 * everything from `COUNT_CAP` up. Empty without observations.
 */
export function poissonExpected(mean: number, observations: number): number[] {
  if (observations === 0) return [];
  const expected: number[] = [];
  let probability = Math.exp(-mean);
  let below = 0;
  for (let k = 0; k < COUNT_CAP; k++) {
    expected.push(probability * observations);
    below += probability;
    probability *= mean / (k + 1);
  }
  expected.push(Math.max(0, 1 - below) * observations);
  return expected;
}

/**
 * Variance ÷ mean: 1 for a Poisson count, above 1 for counts more spread
 * out, below 1 for more even ones. Null when either is unknown or the mean
 * is 0.
 */
export function dispersion(row: ItemTotal): number | null {
  return row.variance === null || row.averagePerObservation === 0 ? null : row.variance / row.averagePerObservation;
}

/** A count's label: "10+" for the last bin. */
export const countLabel = (k: number): string => (k === COUNT_CAP ? `${k}+` : String(k));
