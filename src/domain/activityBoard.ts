import { eventId, type IngressEvent } from "./events.ts";

/**
 * Reads the activity board the game shows (`ACTIVITY_BOARD_URL`): an HTML
 * page with a row per event, its name, START, END and LOCATION.
 *
 * Global campaigns list their times as "…T18:00:00 UTC". Events run in each
 * player's local time (First Saturday, Second Sunday) list theirs as
 * "…Etc/UTC" although they are local: First Saturday's own text says 8 AM
 * to 8 PM. Those are held as the UTC window that local time covers in every
 * time zone, and one listed with no length is taken as the whole local day.
 */

export const ACTIVITY_BOARD_URL = "https://prod-ingress.ingress.com/plfe/events";

const HOUR = 3600;
const DAY = 24 * HOUR;
/** Local times run from UTC−12:00 to UTC+14:00: a local start is up to 14 hours earlier in UTC, a local end up to 12 hours later. */
const EARLIEST_OFFSET = 14 * HOUR;
const LATEST_OFFSET = 12 * HOUR;
/** Names are shown on the page; the board's are short, so a long one is cut rather than trusted. */
const MAX_NAME = 120;

const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}) (UTC|Etc\/UTC)$/;

export interface BoardParse {
  /** Each event once, by start then name. */
  events: IngressEvent[];
  /** Rows with a name whose times couldn't be read, by name: the board may have changed its layout. */
  skipped: string[];
}

/** Windows-1252's 0x80–0x9F; its other bytes are the same code points as Latin-1. 0xFFFD where it defines none. */
const CP1252_HIGH = "€\ufffd‚ƒ„…†‡ˆ‰Š‹Œ\ufffdŽ\ufffd\ufffd‘’“”•–—˜™š›œ\ufffdžŸ";

/**
 * The page's text. It has been served as Windows-1252 without saying so
 * ("Cempasúchil"), so that is the fallback when it isn't UTF-8. Decoded by
 * hand: not every runtime's TextDecoder knows Windows-1252.
 */
export function decodeBoard(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return Array.from(bytes, (byte) => (byte >= 0x80 && byte < 0xa0 ? CP1252_HIGH[byte - 0x80] : String.fromCharCode(byte))).join("");
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function text(html: string): string {
  return html
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? entity;
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** The value after a label such as START: in a row, as text. */
function field(row: string, label: string): string | null {
  const match = new RegExp(`>\\s*${label}:\\s*</div>\\s*<div[^>]*>([^<]*)<`).exec(row);
  return match ? text(match[1]) : null;
}

function time(value: string | null): { at: number; date: string; local: boolean } | null {
  const match = value === null ? null : TIME.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, zone] = match;
  const at = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) / 1000;
  return Number.isFinite(at) ? { at, date: `${y}-${mo}-${d}`, local: zone === "Etc/UTC" } : null;
}

export function parseActivityBoard(html: string): BoardParse {
  const byId = new Map<string, IngressEvent>();
  const skipped: string[] = [];
  for (const row of html.split(/<div class=["']row["']>/).slice(1)) {
    const titled = /darker-green-background["']>([^<]*)</.exec(row);
    const name = titled ? text(titled[1]).slice(0, MAX_NAME) : "";
    if (!name) continue;
    const start = time(field(row, "START"));
    const end = time(field(row, "END"));
    if (!start || !end || start.local !== end.local || end.at < start.at || (!start.local && end.at === start.at)) {
      skipped.push(name);
      continue;
    }
    const location = field(row, "LOCATION");
    const wholeDay = start.local && end.at === start.at;
    const note = [
      "Ingress activity board",
      start.local ? "local times, held as the UTC window they cover in every time zone" : "UTC",
      ...(wholeDay ? ["listed with no length, so taken as the whole local day"] : []),
      ...(location && location !== "Global" ? [`location: ${location}`] : []),
    ].join("; ");
    const id = eventId(name, start.date);
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      name,
      startUtc: start.local ? start.at - EARLIEST_OFFSET : start.at,
      endUtc: start.local ? (wholeDay ? start.at + DAY : end.at) + LATEST_OFFSET : end.at,
      note,
    });
  }
  const events = [...byId.values()].sort((a, b) => a.startUtc - b.startUtc || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { events, skipped };
}
