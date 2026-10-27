import { PORTAL_ALIGNMENTS } from "../domain/format.ts";
import { SPLITS } from "../domain/statistics.ts";
import { DEFAULT_SORT, type Sort, type SortKey } from "./itemTable.ts";
import { EMPTY_FORM, type StatsForm } from "./statsForm.ts";

/**
 * The statistics view as the page's own address, so a finding can be linked
 * and opens as it was seen: the applied filters, the comparison, the level
 * grid's group, the search and the sort. Only what differs from the default
 * is written. Fields keep the names and forms the page shows (dates as
 * YYYY-MM-DD), unlike the API query, which `formQuery` builds.
 */

export interface ViewState {
  form: StatsForm;
  search: string;
  sort: Sort;
  gridGroup: string | null;
}

export const DEFAULT_VIEW: ViewState = { form: EMPTY_FORM, search: "", sort: DEFAULT_SORT, gridGroup: null };

/** Form fields typed as text; the server validates them and explains what it refuses. */
const RANGE_FIELDS = [
  "utcFrom",
  "utcTo",
  "localDateFrom",
  "localDateTo",
  "localHourFrom",
  "localHourTo",
  "portalLevelMin",
  "portalLevelMax",
  "hackingBonusMin",
  "hackingBonusMax",
  "speedBonusMin",
  "speedBonusMax",
] as const satisfies readonly (keyof StatsForm)[];

/** Fields chosen from a list: a value not on it would leave a picker showing nothing. */
const CHOICES = {
  kind: ["", "hack", "drop"],
  panels: ["portal", "bonus", "both"],
  alignment: ["", ...PORTAL_ALIGNMENTS],
  split: SPLITS,
} as const satisfies Partial<Record<keyof StatsForm, readonly string[]>>;

const SORT_KEYS: readonly string[] = [
  "item",
  "quantity",
  "averagePerObservation",
  "chance",
  "whenPresent",
  "multiplied",
  "multipliedUnknown",
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((level) => `L${level}`),
];

/** Whether any range is set: a link with one opens the filter panel, so the viewer sees it. */
export function hasRanges(form: StatsForm): boolean {
  return RANGE_FIELDS.some((name) => form[name].trim() !== "");
}

/** The query string for a view, without "?"; empty for the default view. */
export function viewQuery(view: ViewState): string {
  const params = new URLSearchParams();
  for (const name of Object.keys(CHOICES) as (keyof typeof CHOICES)[]) {
    if (view.form[name] !== EMPTY_FORM[name]) params.set(name, view.form[name]);
  }
  for (const name of RANGE_FIELDS) {
    const value = view.form[name].trim();
    if (value !== "") params.set(name, value);
  }
  if (view.gridGroup !== null) params.set("group", view.gridGroup);
  if (view.search.trim() !== "") params.set("q", view.search.trim());
  if (view.sort.key !== DEFAULT_SORT.key || view.sort.descending !== DEFAULT_SORT.descending) {
    params.set("sort", `${view.sort.descending ? "-" : ""}${view.sort.key}`);
  }
  return params.toString();
}

/** A view from an address's query. Unknown parameters and choices not on their list are ignored. */
export function viewFromQuery(query: string): ViewState {
  const params = new URLSearchParams(query);
  const form = { ...EMPTY_FORM };
  for (const [name, allowed] of Object.entries(CHOICES) as [keyof typeof CHOICES, readonly string[]][]) {
    const value = params.get(name);
    if (value !== null && allowed.includes(value)) Object.assign(form, { [name]: value });
  }
  for (const name of RANGE_FIELDS) form[name] = params.get(name)?.trim() ?? "";
  const sortParam = params.get("sort") ?? "";
  const descending = sortParam.startsWith("-");
  const key = descending ? sortParam.slice(1) : sortParam;
  return {
    form,
    search: params.get("q") ?? "",
    sort: SORT_KEYS.includes(key) ? { key: key as SortKey, descending } : DEFAULT_SORT,
    gridGroup: params.get("group") || null,
  };
}

/** The page's address for a view: its query, and `#submit` for the submit view. */
export function address(view: ViewState, submitting: boolean): string {
  const query = viewQuery(view);
  return `${query === "" ? "" : `?${query}`}${submitting ? "#submit" : ""}`;
}
