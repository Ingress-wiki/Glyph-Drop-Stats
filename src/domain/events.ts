/**
 * Ingress events, imported from the activity board the game shows
 * (`activityBoard.ts`, refreshed daily by the Worker), so the statistics can
 * compare inside and outside them and shade them on trends.
 *
 * Windows are UTC, start inclusive, end exclusive, in seconds. An event run
 * in each player's local time is held as the widest UTC window it covers,
 * and its note says so. Events overlap: campaigns often run together.
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

/** The comparison group of records outside every event. */
export const OUTSIDE_EVENTS = "outside";

/**
 * An event's id: its name as a slug, then the date it starts as listed
 * (YYYY-MM-DD), so a monthly event such as First Saturday has one id a month
 * and fetching the board again finds the same event.
 */
export function eventId(name: string, startDate: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return `${slug || "event"}-${startDate}`;
}
