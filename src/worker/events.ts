import { ACTIVITY_BOARD_URL, decodeBoard, parseActivityBoard } from "../domain/activityBoard.ts";
import type { IngressEvent } from "../domain/events.ts";
import type { Db } from "./db.ts";

/** Says who is asking, without anyone's address: the board is fetched once a day. */
export const USER_AGENT = "GlyphDropStats/1 (+https://stats.ingress.wiki)";

export async function loadEvents(db: Db): Promise<IngressEvent[]> {
  const rows = await db
    .prepare("SELECT id, name, start_utc, end_utc, note FROM ingress_events ORDER BY start_utc, name")
    .all<{ id: string; name: string; start_utc: number; end_utc: number; note: string }>();
  return rows.results.map((row) => ({ id: row.id, name: row.name, startUtc: row.start_utc, endUtc: row.end_utc, note: row.note }));
}

/**
 * Stores what the board lists now. A listed event is added, or updated if
 * its window or name changed. An upcoming event the board no longer lists
 * was cancelled or moved, and is removed; past and running ones stay, since
 * the board drops events once they end.
 */
export async function saveBoard(db: Db, events: readonly IngressEvent[], now: number): Promise<{ removed: number }> {
  const upserts = events.map((event) =>
    db
      .prepare(
        `INSERT INTO ingress_events (id, name, start_utc, end_utc, note, first_seen, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT (id) DO UPDATE SET name = ?2, start_utc = ?3, end_utc = ?4, note = ?5, last_seen = ?6`,
      )
      .bind(event.id, event.name, event.startUtc, event.endUtc, event.note, now),
  );
  const prune = db
    .prepare("DELETE FROM ingress_events WHERE start_utc > ?1 AND id NOT IN (SELECT value FROM json_each(?2))")
    .bind(now, JSON.stringify(events.map((event) => event.id)));
  const results = (await db.batch([...upserts, prune])) as { meta: { changes: number } }[];
  return { removed: results[results.length - 1].meta.changes };
}

export interface Refresh {
  events: number;
  removed: number;
  /** Rows with a name whose times couldn't be read. */
  skipped: string[];
}

/**
 * Fetches the board and stores its events. Refuses a page it can't read an
 * event from rather than treating it as an empty board, which would remove
 * every upcoming event.
 */
export async function refreshEvents(db: Db, fetchBoard: () => Promise<Response>, now: number): Promise<Refresh> {
  const response = await fetchBoard();
  if (!response.ok) throw new Error(`the activity board answered HTTP ${response.status}`);
  const { events, skipped } = parseActivityBoard(decodeBoard(new Uint8Array(await response.arrayBuffer())));
  if (events.length === 0) throw new Error(`no event could be read from the activity board${skipped.length > 0 ? ` (unreadable: ${skipped.join(", ")})` : ""}`);
  const { removed } = await saveBoard(db, events, now);
  return { events: events.length, removed, skipped };
}

export const fetchActivityBoard = (): Promise<Response> => fetch(ACTIVITY_BOARD_URL, { headers: { "user-agent": USER_AGENT } });
