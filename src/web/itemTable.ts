import type { ItemTotal, Statistics } from "../domain/statistics.ts";

/**
 * Shade steps for a value within its column: 0 for nothing, 1 (pale) to 5
 * (full yellow) for the share of the column's largest value. Shading says
 * "more", never "better" or "worse".
 */
export function shade(value: number, columnMax: number): number {
  if (value <= 0 || columnMax <= 0) return 0;
  return Math.max(1, Math.ceil((value / columnMax) * 5));
}

export type SortKey = "item" | "quantity" | "averagePerObservation" | "multiplied" | "multipliedUnknown" | `L${number}`;

export interface Sort {
  key: SortKey;
  descending: boolean;
}

export const DEFAULT_SORT: Sort = { key: "quantity", descending: true };

/** A level column's value; items without levels sort below every levelled item. */
function sortValue(row: ItemTotal, key: SortKey): string | number {
  if (key === "item") return row.item;
  if (key.startsWith("L")) return row.levels?.[Number(key.slice(1)) - 1] ?? -1;
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
export function columnMaxima(rows: readonly ItemTotal[]): { quantity: number; average: number; level: number } {
  return {
    quantity: Math.max(0, ...rows.map((row) => row.quantity)),
    average: Math.max(0, ...rows.map((row) => row.averagePerObservation)),
    level: Math.max(0, ...rows.flatMap((row) => row.levels ?? [])),
  };
}

/**
 * The item table as tab-separated values, with the denominator on every row
 * so a copied row still says what its average is over. Blank level cells are
 * items without levels.
 */
export function itemsTsv(statistics: Statistics): string {
  const { items } = statistics;
  const header = [
    "item",
    "quantity",
    "eligible_observations",
    "per_observation",
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((level) => `L${level}`),
    "multiplied",
    "colour_unread",
    "panels",
  ];
  const rows = items.byItem.map((row) => [
    row.item,
    row.quantity,
    items.eligible,
    row.averagePerObservation,
    ...(row.levels ?? Array<string>(8).fill("")),
    row.multiplied,
    row.multipliedUnknown,
    items.panels,
  ]);
  return [header, ...rows].map((cells) => cells.join("\t")).join("\n") + "\n";
}
