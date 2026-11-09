import { groupOrder, SMALL_SAMPLE, type ItemTotal, type Share, type Split, type Statistics, type StatsFilter, type Summary } from "./statistics.ts";

/**
 * A player's records against everyone else's, under the same filter. The
 * two sides never share a record, so a player is never partly compared with
 * themselves. `expected` is what the player's eligible observations would
 * have held at everyone else's average: a description, not a test. Records
 * cluster by player and session, so no difference here is significant in
 * itself, and the methodology says why.
 */

export interface Side {
  records: number;
  eligible: number;
  totalQuantity: number;
  /** Null when no observation is eligible. */
  averagePerObservation: number | null;
  rare: Share;
  key: Share;
}

export interface ItemSide {
  quantity: number;
  /** Quantity ÷ eligible observations, counting those without the item; null when none is eligible. */
  averagePerObservation: number | null;
  /** Eligible observations with at least one. */
  observations: number;
}

export interface ItemComparison {
  item: string;
  you: ItemSide;
  others: ItemSide;
  /** Everyone else's average times your eligible observations; null when no one else has an eligible observation. */
  expected: number | null;
  /** Your quantity ÷ expected; null when nothing was expected. */
  ratio: number | null;
}

export interface GroupComparison {
  key: string;
  /** Null when that side has no record in the group. */
  you: Side | null;
  others: Side | null;
}

export interface Comparison {
  filter: StatsFilter;
  /** Fewer than `SMALL_SAMPLE` of your observations are eligible for items: every figure of yours is weak. */
  few: boolean;
  you: Side;
  others: Side;
  /** The item averages' denominators: eligible observations over the selected panels. */
  itemEligible: { you: number; others: number };
  /** Every item either side has, by everyone else's average, highest first. */
  items: ItemComparison[];
  split: Split;
  groups: GroupComparison[];
}

const side = (summary: Summary): Side => ({
  records: summary.records,
  eligible: summary.eligible,
  totalQuantity: summary.totalQuantity,
  averagePerObservation: summary.averagePerObservation,
  rare: summary.rare,
  key: summary.key,
});

const itemSide = (total: ItemTotal | undefined, eligible: number): ItemSide => ({
  quantity: total?.quantity ?? 0,
  averagePerObservation: eligible === 0 ? null : (total?.quantity ?? 0) / eligible,
  observations: total?.observations ?? 0,
});

export function compareStatistics(mine: Statistics, others: Statistics): Comparison {
  const yours = new Map(mine.items.byItem.map((total) => [total.item, total]));
  const theirs = new Map(others.items.byItem.map((total) => [total.item, total]));
  const items = [...new Set([...theirs.keys(), ...yours.keys()])].map((item): ItemComparison => {
    const you = itemSide(yours.get(item), mine.items.eligible);
    const other = itemSide(theirs.get(item), others.items.eligible);
    const expected = other.averagePerObservation === null ? null : other.averagePerObservation * mine.items.eligible;
    return { item, you, others: other, expected, ratio: expected ? you.quantity / expected : null };
  });
  items.sort(
    (a, b) =>
      (b.others.averagePerObservation ?? -1) - (a.others.averagePerObservation ?? -1) ||
      (b.you.averagePerObservation ?? -1) - (a.you.averagePerObservation ?? -1) ||
      a.item.localeCompare(b.item),
  );

  const yourGroups = new Map(mine.groups.map((group) => [group.key, group.summary]));
  const theirGroups = new Map(others.groups.map((group) => [group.key, group.summary]));
  const groups = [...new Set([...theirGroups.keys(), ...yourGroups.keys()])].sort(groupOrder(mine.split, mine.events)).map((key): GroupComparison => {
    const you = yourGroups.get(key);
    const other = theirGroups.get(key);
    return { key, you: you ? side(you) : null, others: other ? side(other) : null };
  });

  return {
    filter: mine.filter,
    few: mine.items.eligible < SMALL_SAMPLE,
    you: side(mine.summary),
    others: side(others.summary),
    itemEligible: { you: mine.items.eligible, others: others.items.eligible },
    items,
    split: mine.split,
    groups,
  };
}
