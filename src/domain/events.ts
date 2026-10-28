/**
 * Ingress events that may change what a hack gives (more keys, a bonus
 * item, a changed rarity), so the statistics can compare inside and outside
 * them and shade them on trends. Maintainers add an event here by pull
 * request, with its source, so nobody can post a window that isn't real.
 *
 * Windows are UTC, start inclusive, end exclusive, in seconds. An event run
 * in each player's local time is entered as the widest UTC window it covers
 * and says so in `note`. Events are in time order and don't overlap
 * (`tests/events.test.ts` checks).
 */
export interface IngressEvent {
  /** Stable and URL-safe: it is the comparison group's key and goes into links. */
  id: string;
  /** As Niantic named it; shown as it is in every language. */
  name: string;
  startUtc: number;
  endUtc: number;
  /** Where the dates come from, and anything a reader should know about the window. */
  note: string;
}

export const EVENTS: readonly IngressEvent[] = [];

/** The comparison group of records outside every event. */
export const OUTSIDE_EVENTS = "outside";
