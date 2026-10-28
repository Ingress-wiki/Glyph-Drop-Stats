import type { ItemTotal, Statistics } from "../domain/statistics.ts";
import { rarityCounts, whenPresent } from "./dashboard.ts";

/**
 * Shade steps for a value within its column: 0 for nothing, 1 (pale) to 5
 * (full yellow) for the share of the column's largest value. Shading says
 * "more", never "better" or "worse".
 */
export function shade(value: number, columnMax: number): number {
  if (value <= 0 || columnMax <= 0) return 0;
  return Math.max(1, Math.ceil((value / columnMax) * 5));
}

export const RARITY_KEYS = ["common", "rare", "veryRare", "unread"] as const;
export type RarityKey = (typeof RARITY_KEYS)[number];

export type SortKey =
  | "item"
  | "quantity"
  | "averagePerObservation"
  | "chance"
  | "whenPresent"
  | "multiplied"
  | "multipliedUnknown"
  | `L${number}`
  | `rarity.${RarityKey}`;

export interface Sort {
  key: SortKey;
  descending: boolean;
}

export const DEFAULT_SORT: Sort = { key: "quantity", descending: true };

/** A level or rarity column's value; items without levels or rarity sort below every item with them. */
function sortValue(row: ItemTotal, key: SortKey): string | number {
  if (key === "item") return row.item;
  if (key.startsWith("L")) return row.levels?.[Number(key.slice(1)) - 1] ?? -1;
  if (key.startsWith("rarity.")) return rarityCounts(row)?.[key.slice("rarity.".length) as RarityKey] ?? -1;
  // Every row shares the denominator, so observations order rows as the chance does.
  if (key === "chance") return row.observations;
  if (key === "whenPresent") return whenPresent(row) ?? -1;
  return row[key as "quantity" | "averagePerObservation" | "multiplied" | "multipliedUnknown"];
}

export function sortItems(rows: readonly ItemTotal[], sort: Sort): ItemTotal[] {
  const direction = sort.descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    const order = x < y ? -1 : x > y ? 1 : 0;
    return order * direction || (a.item < b.item ? -1 : 1);
  });
}

/** The largest value in each shaded column, over every row. */
export function columnMaxima(rows: readonly ItemTotal[]): {
  quantity: number;
  average: number;
  observations: number;
  whenPresent: number;
  level: number;
  rarity: number;
} {
  return {
    quantity: Math.max(0, ...rows.map((row) => row.quantity)),
    average: Math.max(0, ...rows.map((row) => row.averagePerObservation)),
    observations: Math.max(0, ...rows.map((row) => row.observations)),
    whenPresent: Math.max(0, ...rows.map((row) => whenPresent(row) ?? 0)),
    level: Math.max(0, ...rows.flatMap((row) => row.levels ?? [])),
    rarity: Math.max(
      0,
      ...rows.flatMap((row) => {
        const counts = rarityCounts(row);
        return counts === null ? [] : [counts.common, counts.rare, counts.veryRare];
      }),
    ),
  };
}

/**
 * The item table as tab-separated values, with the denominator on every row
 * so a copied row still says what its average is over. Blank level cells are
 * items without levels; blank rarity cells, items without a rarity.
 */
export function itemsTsv(statistics: Statistics): string {
  const { items } = statistics;
  const header = [
    "item",
    "quantity",
    "eligible_observations",
    "per_observation",
    "observations_with_item",
    "average_when_present",
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((level) => `L${level}`),
    "common",
    "rare",
    "very_rare",
    "rarity_unread",
    "multiplied",
    "colour_unread",
    "panels",
  ];
  const rows = items.byItem.map((row) => {
    const rarity = rarityCounts(row);
    return [
      row.item,
      row.quantity,
      items.eligible,
      row.averagePerObservation,
      row.observations,
      whenPresent(row) ?? "",
      ...(row.levels ?? Array<string>(8).fill("")),
      ...(rarity === null ? ["", "", "", ""] : [rarity.common, rarity.rare, rarity.veryRare, rarity.unread]),
      row.multiplied,
      row.multipliedUnknown,
      items.panels,
    ];
  });
  return [header, ...rows].map((cells) => cells.join("\t")).join("\n") + "\n";
}
