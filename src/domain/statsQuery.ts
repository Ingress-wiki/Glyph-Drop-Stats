import { makeIssue, type Issue } from "./importer.ts";
import type { IssueKey, IssueParams } from "./issueMessages.ts";
import { NO_FILTER, type PanelSelection, type Range, type StatsFilter } from "./statistics.ts";

/**
 * The statistics filter as URL query parameters. Parsing is strict: an
 * unknown, malformed or half-given parameter is an error, never ignored,
 * so a typo can't silently widen what a number describes.
 */

const PAIRS = {
  utc: ["utcFrom", "utcTo"],
  localDate: ["localDateFrom", "localDateTo"],
  localHour: ["localHourFrom", "localHourTo"],
  portalLevel: ["portalLevelMin", "portalLevelMax"],
  hackingBonus: ["hackingBonusMin", "hackingBonusMax"],
  speedBonus: ["speedBonusMin", "speedBonusMax"],
} as const;

const KNOWN = new Set<string>(["kind", "panels", ...Object.values(PAIRS).flat()]);

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER = /^(0|[1-9][0-9]*)$/;

function seconds(value: string): number | null {
  if (!TIMESTAMP.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) || new Date(ms).toISOString().replace(".000Z", "Z") !== value ? null : ms / 1000;
}

function date(value: string): string | null {
  if (!DATE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? null : value;
}

function integer(min: number, max: number): (value: string) => number | null {
  return (value) => {
    if (!INTEGER.test(value)) return null;
    const n = Number(value);
    return n >= min && n <= max ? n : null;
  };
}

export function parseStatsQuery(params: URLSearchParams): { ok: true; filter: StatsFilter } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (key: IssueKey, params?: IssueParams) => issues.push(makeIssue("invalid_filter", key, params));

  for (const name of new Set(params.keys())) {
    if (!KNOWN.has(name)) bad("filter.unknown", { name });
    else if (params.getAll(name).length > 1) bad("filter.repeated", { name });
  }

  /** `invalid` says what a malformed value should have been. */
  const pair = <T>(names: readonly [string, string], read: (value: string) => T | null, invalid: (name: string) => void) => {
    const [a, b] = names.map((name) => params.get(name));
    if (a === null && b === null) return null;
    if (a === null || b === null) {
      bad("filter.pair", { first: names[0], second: names[1] });
      return null;
    }
    const from = read(a);
    const to = read(b);
    if (from === null) invalid(names[0]);
    if (to === null) invalid(names[1]);
    return from === null || to === null ? null : { from, to };
  };

  const utc = pair(PAIRS.utc, seconds, (name) => bad("filter.timestamp", { name }));
  if (utc && utc.from >= utc.to) bad("filter.utcOrder");
  const localDate = pair(PAIRS.localDate, date, (name) => bad("filter.date", { name }));
  if (localDate && localDate.from > localDate.to) bad("filter.localDateOrder");
  const localHour = pair(PAIRS.localHour, integer(0, 23), (name) => bad("filter.hour", { name }));
  if (localHour && localHour.from > localHour.to) bad("filter.localHourOrder");

  const range = (names: readonly [string, string], min: number, max: number): Range | null => {
    const value = pair(names, integer(min, max), (name) => bad("filter.integer", { name, min, max }));
    if (value && value.from > value.to) bad("filter.rangeOrder", { first: names[0], second: names[1] });
    return value && { min: value.from, max: value.to };
  };
  const portalLevel = range(PAIRS.portalLevel, 1, 8);
  const hackingBonus = range(PAIRS.hackingBonus, 0, 1000);
  const speedBonus = range(PAIRS.speedBonus, 0, 1000);

  const kind = params.get("kind");
  if (kind !== null && kind !== "hack" && kind !== "drop") bad("filter.kind");
  const panels = params.get("panels") ?? NO_FILTER.panels;
  if (panels !== "portal" && panels !== "bonus" && panels !== "both") bad("filter.panels");

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    filter: {
      kind: kind as StatsFilter["kind"],
      utc,
      localDate,
      localHour,
      portalLevel,
      hackingBonus,
      speedBonus,
      panels: panels as PanelSelection,
    },
  };
}

/** The query string for a filter; `parseStatsQuery` reads it back to the same filter. */
export function statsQueryString(filter: StatsFilter): string {
  const params = new URLSearchParams();
  const iso = (s: number) => new Date(s * 1000).toISOString().replace(".000Z", "Z");
  if (filter.kind) params.set("kind", filter.kind);
  if (filter.utc) {
    params.set("utcFrom", iso(filter.utc.from));
    params.set("utcTo", iso(filter.utc.to));
  }
  if (filter.localDate) {
    params.set("localDateFrom", filter.localDate.from);
    params.set("localDateTo", filter.localDate.to);
  }
  if (filter.localHour) {
    params.set("localHourFrom", String(filter.localHour.from));
    params.set("localHourTo", String(filter.localHour.to));
  }
  for (const key of ["portalLevel", "hackingBonus", "speedBonus"] as const) {
    const range = filter[key];
    if (range) {
      params.set(PAIRS[key][0], String(range.min));
      params.set(PAIRS[key][1], String(range.max));
    }
  }
  if (filter.panels !== NO_FILTER.panels) params.set("panels", filter.panels);
  return params.toString();
}
