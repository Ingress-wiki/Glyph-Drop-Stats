import { isListedItem } from "./cells.ts";
import type { Kind, ObservationRecord, PanelStage, ReadStatus } from "./record.ts";

/**
 * Descriptive statistics over accepted, counted records. The rules live here
 * as plain functions so they can be read, tested against hand-calculated
 * datasets, and quoted next to every number. See docs/statistics.md.
 *
 * Input is one record per `record_id` (its accepted version), so a record
 * counts once however many uploads support it.
 */

export type PanelSelection = "portal" | "bonus" | "both";

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
  /** Which panels item metrics read. */
  panels: PanelSelection;
}

export const NO_FILTER: StatsFilter = {
  kind: null,
  utc: null,
  localDate: null,
  localHour: null,
  portalLevel: null,
  hackingBonus: null,
  speedBonus: null,
  panels: "portal",
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
  "portal_level_crosses_filter",
  "no_hacking_bonus",
  "hacking_bonus_not_final",
  "no_speed_bonus",
  "speed_bonus_not_final",
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
}

export interface Statistics {
  filter: StatsFilter;
  selection: { matched: number; unplaced: Record<UnplacedReason, number> };
  records: {
    total: number;
    byKind: Record<Kind, number>;
    byReadStatus: Record<ReadStatus, number>;
    byCoverage: Record<Coverage, number>;
  };
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
 * unknown, never zero.
 */
export function itemEligibility(record: ObservationRecord, panels: PanelSelection): "eligible" | ItemExclusion {
  if (record.readStatus !== "read" || record.reading === null) return "no_reading";
  const selected = STAGES[panels].map((stage) => record.reading?.panels.find((panel) => panel.stage === stage));
  if (selected.some((panel) => panel === undefined)) return "panel_not_seen";
  const present = selected.filter((panel) => panel !== undefined);
  if (present.some((panel) => panel.partial)) return "partly_read";
  const items = present.flatMap((panel) => panel.items);
  if (items.some((item) => item.item === null || item.levelState === "unreadable")) return "unidentified_items";
  if (items.some((item) => item.item !== null && !isListedItem(item.item))) return "unlisted_item_names";
  return "eligible";
}

export function computeStatistics(records: readonly ObservationRecord[], filter: StatsFilter): Statistics {
  const unplaced = zeroes(UNPLACED_REASONS);
  const byKind: Record<Kind, number> = { hack: 0, drop: 0 };
  const byReadStatus: Record<ReadStatus, number> = { read: 0, notRead: 0, unavailable: 0, unsupported: 0 };
  const byCoverage = zeroes(COVERAGES);
  const excluded = zeroes(ITEM_EXCLUSIONS);
  const totals = new Map<
    string,
    { quantity: number; multiplied: number; multipliedUnknown: number; levels: number[] | null }
  >();
  let matched = 0;
  let eligible = 0;
  let totalQuantity = 0;

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

    const verdict = itemEligibility(record, filter.panels);
    if (verdict !== "eligible") {
      excluded[verdict]++;
      continue;
    }
    eligible++;
    for (const panel of record.reading?.panels ?? []) {
      if (!STAGES[filter.panels].includes(panel.stage)) continue;
      for (const entry of panel.items) {
        // Eligibility guarantees every name is known and listed.
        const name = entry.item as string;
        const total = totals.get(name) ?? { quantity: 0, multiplied: 0, multipliedUnknown: 0, levels: null };
        total.quantity += entry.quantity;
        // Eligibility rules out unreadable levels, so a levelled item always has its level here.
        if (entry.level !== null) {
          total.levels ??= [0, 0, 0, 0, 0, 0, 0, 0];
          total.levels[entry.level - 1] += entry.quantity;
        }
        if (entry.multiplied === true) total.multiplied += entry.quantity;
        if (entry.multiplied === null) total.multipliedUnknown += entry.quantity;
        totals.set(name, total);
        totalQuantity += entry.quantity;
      }
    }
  }

  const byItem: ItemTotal[] = [...totals]
    .map(([item, total]) => ({ item, ...total, averagePerObservation: total.quantity / eligible }))
    .sort((a, b) => b.quantity - a.quantity || (a.item < b.item ? -1 : 1));

  return {
    filter,
    selection: { matched, unplaced },
    records: { total: matched, byKind, byReadStatus, byCoverage },
    items: {
      panels: filter.panels,
      eligible,
      excluded,
      totalQuantity,
      averagePerObservation: eligible === 0 ? null : totalQuantity / eligible,
      byItem,
    },
  };
}
