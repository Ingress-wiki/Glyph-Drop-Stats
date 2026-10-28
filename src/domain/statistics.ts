import { isListedItem } from "./cells.ts";
import { EVENTS, OUTSIDE_EVENTS, type IngressEvent } from "./events.ts";
import { ITEMS_WITH_RARITY, KEY_COMMANDS, PANEL_EFFECTS, PORTAL_ALIGNMENTS, SPEED_COMMANDS } from "./format.ts";
import type { HackResult, Item, Kind, ObservationRecord, PanelStage, PortalAlignment, ReadStatus } from "./record.ts";

/**
 * Descriptive statistics over accepted, counted records. The rules live here
 * as plain functions so they can be read, tested against hand-calculated
 * datasets, and quoted next to every number. See docs/statistics.md.
 *
 * Input is one record per `record_id` (its accepted version), so a record
 * counts once however many uploads support it.
 */

export type PanelSelection = "portal" | "bonus" | "both";

/**
 * Whether observations with multiplied items count. The game prints a
 * multiplied quantity in red, but the export says neither the factor (×2,
 * ×3, ×1.15…) nor its cause (a Fracker, the day's first hack, a beacon), so
 * the base quantity can't be recovered: the only clean choice is to leave
 * such observations out.
 */
export type MultipliedSelection = "include" | "exclude";

/** What the comparison groups records by. */
export const SPLITS = ["alignment", "portalLevel", "glyphCount", "speedCommand", "keyCommand", "panelEffect", "event", "week", "day"] as const;
export type Split = (typeof SPLITS)[number];

/** A group's key when its records don't have the split's value (drops, older builds, unreliable levels). */
export const UNKNOWN_GROUP = "unknown";

/**
 * The panel-effect group of a reading whose panels showed none. The export
 * leaves `panel_effects` blank both for no effect and for builds that didn't
 * record effects, so this group holds both.
 */
export const NO_EFFECT_GROUP = "none";

/**
 * Below this many eligible observations a figure is marked as resting on
 * few observations. There are no confidence intervals (see
 * docs/statistics.md), so this is the page's only sample-size warning.
 */
export const SMALL_SAMPLE = 30;

/**
 * An item's distribution counts observations with 0, 1, … of it, and puts
 * every count from this one up in its last bin.
 */
export const COUNT_CAP = 10;

/** Inclusive bounds. */
export interface Range {
  min: number;
  max: number;
}

export interface StatsFilter {
  kind: Kind | null;
  /** Unix seconds, start inclusive, end exclusive. */
  utc: { from: number; to: number } | null;
  /** Inclusive `YYYY-MM-DD` dates in the capturing iPhone's offset. */
  localDate: { from: string; to: string } | null;
  /** Inclusive hours, 0–23, in the capturing iPhone's offset. */
  localHour: { from: number; to: number } | null;
  portalLevel: Range | null;
  /** Percent, final values only. */
  hackingBonus: Range | null;
  speedBonus: Range | null;
  alignment: PortalAlignment | null;
  /** Which panels item metrics read. */
  panels: PanelSelection;
  multiplied: MultipliedSelection;
  split: Split;
}

export const NO_FILTER: StatsFilter = {
  kind: null,
  utc: null,
  localDate: null,
  localHour: null,
  portalLevel: null,
  hackingBonus: null,
  speedBonus: null,
  alignment: null,
  panels: "both",
  multiplied: "exclude",
  split: "alignment",
};

/**
 * Why a record can't be placed inside or outside the filter. These records
 * are neither counted nor silently dropped: each total is reported.
 */
export const UNPLACED_REASONS = [
  "crosses_utc_boundary",
  "no_local_time",
  "no_local_hour",
  "no_portal_level",
  "portal_level_unreliable",
  "portal_level_crosses_filter",
  "no_hacking_bonus",
  "hacking_bonus_not_final",
  "no_speed_bonus",
  "speed_bonus_not_final",
  "no_alignment",
] as const;
export type UnplacedReason = (typeof UNPLACED_REASONS)[number];

export const COVERAGES = [
  "both_panels_in_full",
  "seen_panels_in_full",
  "partly_read",
  "no_panel",
  "notRead",
  "unavailable",
  "unsupported",
] as const;
export type Coverage = (typeof COVERAGES)[number];

/** Why a selected record is left out of item metrics, in the order they are tested. */
export const ITEM_EXCLUSIONS = [
  "no_reading",
  "panel_not_seen",
  "partly_read",
  "unidentified_items",
  "unlisted_item_names",
  "multiplied",
  "multiplied_unread",
] as const;
export type ItemExclusion = (typeof ITEM_EXCLUSIONS)[number];

export interface ItemTotal {
  item: string;
  quantity: number;
  /** quantity ÷ eligible observations, including those without this item. */
  averagePerObservation: number;
  /** Of `quantity`, printed in red by the game (a multiplier applied). */
  multiplied: number;
  /** Of `quantity`, whose colour wasn't read. */
  multipliedUnknown: number;
  /** Quantity by level, L1 at index 0 to L8 at index 7; null for items without levels. */
  levels: number[] | null;
  /** Eligible observations with this item: the chance per observation is this ÷ eligible. */
  observations: number;
  /** Of `quantity`, by known rarity; the rest has none or wasn't read. */
  rarities: { common: number; rare: number; veryRare: number };
  /**
   * Eligible observations by how many of this item they had: index k for k
   * (0 included), the last index for `COUNT_CAP` or more. Sums to the
   * eligible observations.
   */
  distribution: number[];
  /**
   * Sample variance of the quantity per eligible observation (n - 1 in the
   * denominator, uncapped); null with fewer than two eligible observations.
   */
  variance: number | null;
}

/** How many observations answer yes, of those where the answer is known. */
export interface Share {
  yes: number;
  known: number;
}

/** The headline figures for a set of records, over the selected panels. */
export interface Summary {
  records: number;
  eligible: number;
  totalQuantity: number;
  /** Null when no observation is eligible. */
  averagePerObservation: number | null;
  /**
   * Eligible observations with a Rare or Very Rare item. One without, but
   * with an item whose rarity wasn't read, isn't known either way.
   */
  rare: Share;
  /** Eligible observations with a Portal Key. */
  key: Share;
  /** Eligible observations by reliable portal level, P1 at index 0. */
  portalLevels: number[];
  /** Levelled item quantities: row = reliable portal level, column = item level, both 1–8 at index 0–7. */
  levelGrid: number[][];
}

export interface Group {
  /** The split's value (`same_faction`, `6`, `complex`…) or `UNKNOWN_GROUP`. */
  key: string;
  summary: Summary;
}

/** Records by the app build that captured them. */
export interface AppCount {
  version: string | null;
  build: string | null;
  records: number;
}

export interface Statistics {
  filter: StatsFilter;
  selection: {
    matched: number;
    unplaced: Record<UnplacedReason, number>;
    /**
     * Distinct uploads the matched records came from, each record counted
     * with the earliest active upload that supplied it. Records cluster by
     * player, so this is the scale to read every figure against. Null when
     * the caller didn't say where records came from.
     */
    uploads: number | null;
  };
  records: {
    total: number;
    byKind: Record<Kind, number>;
    byReadStatus: Record<ReadStatus, number>;
    byCoverage: Record<Coverage, number>;
    byApp: AppCount[];
  };
  /** Every matched record together. */
  summary: Summary;
  split: Split;
  /** The matched records grouped by `split`, in the split's natural order, unknown last; only groups with records. */
  groups: Group[];
  items: {
    panels: PanelSelection;
    eligible: number;
    excluded: Record<ItemExclusion, number>;
    totalQuantity: number;
    /** Null when no observation is eligible: an average of nothing isn't zero. */
    averagePerObservation: number | null;
    byItem: ItemTotal[];
  };
}

function zeroes<const K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

type Placement = "in" | "out" | UnplacedReason;

/**
 * Whether a portal level can be used at all. The app flags a conflict when
 * its reads disagree, and every released build through 1.0.0 (2) can read an
 * L1 label as L7 and report such a level, so conflicts and low confidence
 * are left out rather than counted at the wrong level.
 */
function levelTrusted(level: NonNullable<HackResult["portalLevel"]>): boolean {
  return !level.conflict && level.confidence !== "low";
}

/** The portal's exact level, when it is trusted and not a range. */
export function exactPortalLevel(hack: HackResult | null): number | null {
  const level = hack?.portalLevel ?? null;
  return level !== null && levelTrusted(level) && level.low === level.high ? level.low : null;
}

/** Inclusive range test for a single known value. */
function inRange(value: number, range: Range): boolean {
  return value >= range.min && value <= range.max;
}

/**
 * Where a record falls. A record definitely outside any one criterion is
 * out, whatever else is unknown about it; otherwise the first criterion it
 * can't be judged on makes it unplaced.
 */
export function place(record: ObservationRecord, filter: StatsFilter): Placement {
  const verdicts: Placement[] = [];
  const { time, hack } = record;

  if (filter.kind !== null) verdicts.push(record.kind === filter.kind ? "in" : "out");

  if (filter.utc) {
    const { from, to } = filter.utc;
    if (time.endUtc <= from || time.startUtc >= to) verdicts.push("out");
    else if (time.startUtc >= from && time.endUtc <= to) verdicts.push("in");
    else verdicts.push("crosses_utc_boundary");
  }

  if (filter.localDate) {
    if (time.localDate === null) verdicts.push("no_local_time");
    else verdicts.push(time.localDate >= filter.localDate.from && time.localDate <= filter.localDate.to ? "in" : "out");
  }

  if (filter.localHour) {
    if (time.utcOffsetMinutes === null) verdicts.push("no_local_time");
    else if (time.localHour === null) verdicts.push("no_local_hour");
    else verdicts.push(time.localHour >= filter.localHour.from && time.localHour <= filter.localHour.to ? "in" : "out");
  }

  if (filter.portalLevel) {
    const level = hack?.portalLevel ?? null;
    if (level === null) verdicts.push("no_portal_level");
    else if (!levelTrusted(level)) verdicts.push("portal_level_unreliable");
    else if (inRange(level.low, filter.portalLevel) && inRange(level.high, filter.portalLevel)) verdicts.push("in");
    else if (level.high < filter.portalLevel.min || level.low > filter.portalLevel.max) verdicts.push("out");
    else verdicts.push("portal_level_crosses_filter");
  }

  const bonus = (value: { percent: number; final: boolean } | null, range: Range | null, missing: UnplacedReason, notFinal: UnplacedReason) => {
    if (!range) return;
    if (value === null) verdicts.push(missing);
    else if (!value.final) verdicts.push(notFinal);
    else verdicts.push(inRange(value.percent, range) ? "in" : "out");
  };
  bonus(hack?.hackingBonus ?? null, filter.hackingBonus, "no_hacking_bonus", "hacking_bonus_not_final");
  bonus(hack?.speedBonus ?? null, filter.speedBonus, "no_speed_bonus", "speed_bonus_not_final");

  if (filter.alignment) {
    const alignment = hack?.portalAlignment;
    if (alignment === undefined) verdicts.push("no_alignment");
    else verdicts.push(alignment === filter.alignment ? "in" : "out");
  }

  if (verdicts.includes("out")) return "out";
  return verdicts.find((verdict) => verdict !== "in") ?? "in";
}

/**
 * `both_panels_read` only says neither panel was partial; a panel can still
 * hold an unidentified row. "In full" therefore always needs
 * `observed_panels_read_in_full` as well.
 */
export function coverage(record: ObservationRecord): Coverage {
  if (record.readStatus !== "read" || record.reading === null) {
    return record.readStatus === "read" ? "no_panel" : record.readStatus;
  }
  const { reading } = record;
  if (reading.panels.length === 0) return "no_panel";
  if (!reading.observedPanelsReadInFull) return "partly_read";
  return reading.bothPanelsRead ? "both_panels_in_full" : "seen_panels_in_full";
}

const STAGES: Record<PanelSelection, PanelStage[]> = {
  portal: ["portal"],
  bonus: ["bonus"],
  both: ["portal", "bonus"],
};

/**
 * Whether a record's item list is complete for the selected panels. Only
 * then can its quantities be summed: a missing or partly read panel is
 * unknown, never zero. Leaving multiplied items out judges only the selected
 * panels' items, the ones counted; an observation with no items shows no
 * colour, so a multiplier on it can't be seen and it stays in.
 */
export function itemEligibility(record: ObservationRecord, panels: PanelSelection, multiplied: MultipliedSelection = "include"): "eligible" | ItemExclusion {
  if (record.readStatus !== "read" || record.reading === null) return "no_reading";
  const selected = STAGES[panels].map((stage) => record.reading?.panels.find((panel) => panel.stage === stage));
  if (selected.some((panel) => panel === undefined)) return "panel_not_seen";
  const present = selected.filter((panel) => panel !== undefined);
  if (present.some((panel) => panel.partial)) return "partly_read";
  const items = present.flatMap((panel) => panel.items);
  if (items.some((item) => item.item === null || item.levelState === "unreadable")) return "unidentified_items";
  if (items.some((item) => item.item !== null && !isListedItem(item.item))) return "unlisted_item_names";
  if (multiplied === "exclude") {
    if (items.some((item) => item.multiplied === true)) return "multiplied";
    if (items.some((item) => item.multiplied === null)) return "multiplied_unread";
  }
  return "eligible";
}

const DAY = 86_400;

/** The UTC date of a time, as YYYY-MM-DD. */
const utcDate = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * The UTC day or week (Monday to Monday) a record's time interval lies in,
 * as the YYYY-MM-DD it starts; null when the interval crosses into the
 * next, as a local day does, so it is never placed by a guess.
 */
function period(record: ObservationRecord, days: 1 | 7): string | null {
  const { startUtc, endUtc } = record.time;
  const day = Math.floor(startUtc / DAY);
  // 1970-01-01 was a Thursday: three days after a Monday.
  const first = days === 1 ? day : day - ((day + 3) % 7);
  return endUtc <= (first + days) * DAY ? utcDate(first * DAY) : null;
}

/**
 * The event a record's time interval lies in, `OUTSIDE_EVENTS` when it
 * touches none, and null when it crosses an event's start or end.
 */
function eventOf(record: ObservationRecord, events: readonly IngressEvent[]): string | null {
  const { startUtc, endUtc } = record.time;
  for (const event of events) {
    if (endUtc <= event.startUtc || startUtc >= event.endUtc) continue;
    return startUtc >= event.startUtc && endUtc <= event.endUtc ? event.id : null;
  }
  return OUTSIDE_EVENTS;
}

/** Groups in a split's natural order; time splits instead sort by their dates. */
const GROUP_ORDER: Record<Exclude<Split, "event" | "week" | "day">, readonly string[]> = {
  alignment: PORTAL_ALIGNMENTS,
  portalLevel: ["1", "2", "3", "4", "5", "6", "7", "8"],
  glyphCount: Array.from({ length: 11 }, (_, n) => String(n)),
  speedCommand: SPEED_COMMANDS,
  keyCommand: KEY_COMMANDS,
  panelEffect: [NO_EFFECT_GROUP, ...PANEL_EFFECTS],
};

/**
 * The one effect a reading's panels showed, or none. A record with no
 * reading, or whose panels disagree, has no single effect.
 */
function panelEffect(record: ObservationRecord): string | null {
  if (record.reading === null || record.reading.panels.length === 0) return null;
  const effects = new Set(record.reading.panels.flatMap((panel) => panel.effects ?? []));
  if (effects.size === 0) return NO_EFFECT_GROUP;
  return effects.size === 1 ? [...effects][0] : null;
}

/** Which group of `split` a record belongs to. `events` is the known events' list. */
export function groupKey(record: ObservationRecord, split: Split, events: readonly IngressEvent[] = EVENTS): string {
  const { hack } = record;
  const known = (value: string | number | null | undefined) => (value === null || value === undefined ? UNKNOWN_GROUP : String(value));
  switch (split) {
    case "alignment":
      return known(hack?.portalAlignment);
    case "portalLevel":
      return known(exactPortalLevel(hack));
    case "glyphCount":
      return known(hack?.glyphCount);
    case "speedCommand":
      return known(hack?.commands?.speed);
    case "keyCommand":
      return known(hack?.commands?.key);
    case "panelEffect":
      return known(panelEffect(record));
    case "event":
      return known(eventOf(record, events));
    case "week":
      return known(period(record, 7));
    case "day":
      return known(period(record, 1));
  }
}

const RARE = new Set(["rare", "veryRare"]);

/** Running totals for one `Summary`. */
class Tally {
  records = 0;
  eligible = 0;
  totalQuantity = 0;
  rare: Share = { yes: 0, known: 0 };
  key: Share = { yes: 0, known: 0 };
  portalLevels = Array<number>(8).fill(0);
  levelGrid = Array.from({ length: 8 }, () => Array<number>(8).fill(0));

  /** `items` is the selected panels' items when the record is eligible, else null. */
  add(record: ObservationRecord, items: readonly Item[] | null): void {
    this.records++;
    if (items === null) return;
    this.eligible++;
    for (const entry of items) this.totalQuantity += entry.quantity;

    if (items.some((entry) => entry.rarity !== null && RARE.has(entry.rarity))) {
      this.rare.yes++;
      this.rare.known++;
    } else if (!items.some((entry) => ITEMS_WITH_RARITY.has(entry.item as string) && (entry.rarity === null || entry.rarity === "unreadable"))) {
      this.rare.known++;
    }
    this.key.known++;
    if (items.some((entry) => entry.item === "Portal Key")) this.key.yes++;

    const level = exactPortalLevel(record.hack);
    if (level !== null) {
      this.portalLevels[level - 1]++;
      for (const entry of items) {
        if (entry.level !== null) this.levelGrid[level - 1][entry.level - 1] += entry.quantity;
      }
    }
  }

  summary(): Summary {
    return {
      records: this.records,
      eligible: this.eligible,
      totalQuantity: this.totalQuantity,
      averagePerObservation: this.eligible === 0 ? null : this.totalQuantity / this.eligible,
      rare: this.rare,
      key: this.key,
      portalLevels: this.portalLevels,
      levelGrid: this.levelGrid,
    };
  }
}

/** Builds sort first by version, then build, both as numbers where they are; unknown last. */
function compareApps(a: AppCount, b: AppCount): number {
  const text = (x: string | null, y: string | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x.localeCompare(y, "en", { numeric: true }));
  return text(a.version, b.version) || text(a.build, b.build);
}

/**
 * `uploadOf` maps a record id to the upload it is counted from; without it,
 * `selection.uploads` is null. `events` is the known events' list.
 */
export function computeStatistics(
  records: readonly ObservationRecord[],
  filter: StatsFilter,
  uploadOf?: ReadonlyMap<string, number>,
  events: readonly IngressEvent[] = EVENTS,
): Statistics {
  const unplaced = zeroes(UNPLACED_REASONS);
  const byKind: Record<Kind, number> = { hack: 0, drop: 0 };
  const byReadStatus: Record<ReadStatus, number> = { read: 0, notRead: 0, unavailable: 0, unsupported: 0 };
  const byCoverage = zeroes(COVERAGES);
  const excluded = zeroes(ITEM_EXCLUSIONS);
  const totals = new Map<string, Omit<ItemTotal, "item" | "averagePerObservation" | "variance">>();
  /** Per item, the sum of each eligible observation's squared quantity: the variance needs it uncapped. */
  const squares = new Map<string, number>();
  const apps = new Map<string, AppCount>();
  const uploads = new Set<number>();
  const overall = new Tally();
  const groups = new Map<string, Tally>();
  let matched = 0;

  for (const record of records) {
    const placement = place(record, filter);
    if (placement === "out") continue;
    if (placement !== "in") {
      unplaced[placement]++;
      continue;
    }
    matched++;
    byKind[record.kind]++;
    byReadStatus[record.readStatus]++;
    byCoverage[coverage(record)]++;
    const { sourceAppVersion: version, sourceAppBuild: build } = record.origin;
    const appKey = JSON.stringify([version, build]);
    const app = apps.get(appKey) ?? { version, build, records: 0 };
    app.records++;
    apps.set(appKey, app);
    const upload = uploadOf?.get(record.recordId);
    if (upload !== undefined) uploads.add(upload);

    const verdict = itemEligibility(record, filter.panels, filter.multiplied);
    if (verdict !== "eligible") excluded[verdict]++;
    const items =
      verdict === "eligible"
        ? (record.reading?.panels ?? []).filter((panel) => STAGES[filter.panels].includes(panel.stage)).flatMap((panel) => panel.items)
        : null;
    overall.add(record, items);
    const key = groupKey(record, filter.split, events);
    const group = groups.get(key) ?? new Tally();
    group.add(record, items);
    groups.set(key, group);
    if (items === null) continue;

    /** This observation's quantity of each item: one item can fill several slots. */
    const here = new Map<string, number>();
    for (const entry of items) {
      // Eligibility guarantees every name is known and listed.
      const name = entry.item as string;
      const total = totals.get(name) ?? {
        quantity: 0,
        multiplied: 0,
        multipliedUnknown: 0,
        levels: null,
        observations: 0,
        rarities: { common: 0, rare: 0, veryRare: 0 },
        distribution: Array<number>(COUNT_CAP + 1).fill(0),
      };
      total.quantity += entry.quantity;
      // Eligibility rules out unreadable levels, so a levelled item always has its level here.
      if (entry.level !== null) {
        total.levels ??= [0, 0, 0, 0, 0, 0, 0, 0];
        total.levels[entry.level - 1] += entry.quantity;
      }
      if (entry.multiplied === true) total.multiplied += entry.quantity;
      if (entry.multiplied === null) total.multipliedUnknown += entry.quantity;
      if (entry.rarity !== null && entry.rarity !== "unreadable") total.rarities[entry.rarity] += entry.quantity;
      if (!here.has(name)) total.observations++;
      here.set(name, (here.get(name) ?? 0) + entry.quantity);
      totals.set(name, total);
    }
    for (const [name, quantity] of here) {
      (totals.get(name) as { distribution: number[] }).distribution[Math.min(quantity, COUNT_CAP)]++;
      squares.set(name, (squares.get(name) ?? 0) + quantity * quantity);
    }
  }

  const summary = overall.summary();
  const byItem: ItemTotal[] = [...totals]
    .map(([item, total]) => {
      const n = summary.eligible;
      // Observations without the item are the eligible ones not counted yet.
      const distribution = total.distribution.map((count, k) => (k === 0 ? n - total.observations : count));
      // (n·Σq² − (Σq)²) / n(n − 1): whole numbers until the one division, so it is exact and never negative.
      const sum = total.quantity;
      const variance = n < 2 ? null : (n * (squares.get(item) ?? 0) - sum * sum) / (n * (n - 1));
      return { item, ...total, distribution, averagePerObservation: sum / n, variance };
    })
    .sort((a, b) => b.quantity - a.quantity || (a.item < b.item ? -1 : 1));
  const { split } = filter;
  const natural =
    split === "event" ? [OUTSIDE_EVENTS, ...events.map((event) => event.id)] : split === "week" || split === "day" ? null : GROUP_ORDER[split];
  // Dates sort as text; unknown goes last either way.
  const rank = (key: string) => (key === UNKNOWN_GROUP ? Number.POSITIVE_INFINITY : natural === null ? 0 : natural.indexOf(key));
  const byOrder = ([a]: [string, Tally], [b]: [string, Tally]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);

  return {
    filter,
    selection: { matched, unplaced, uploads: uploadOf ? uploads.size : null },
    records: {
      total: matched,
      byKind,
      byReadStatus,
      byCoverage,
      byApp: [...apps.values()].sort(compareApps),
    },
    summary,
    split: filter.split,
    groups: [...groups].sort(byOrder).map(([key, tally]) => ({ key, summary: tally.summary() })),
    items: {
      panels: filter.panels,
      eligible: summary.eligible,
      excluded,
      totalQuantity: summary.totalQuantity,
      averagePerObservation: summary.averagePerObservation,
      byItem,
    },
  };
}
