/** The statistics filter form, as the strings its fields hold. Empty means no filter. */
export interface StatsForm {
  kind: "" | "hack" | "drop";
  panels: "portal" | "bonus" | "both";
  utcFrom: string;
  utcTo: string;
  localDateFrom: string;
  localDateTo: string;
  localHourFrom: string;
  localHourTo: string;
  portalLevelMin: string;
  portalLevelMax: string;
  hackingBonusMin: string;
  hackingBonusMax: string;
  speedBonusMin: string;
  speedBonusMax: string;
}

export const EMPTY_FORM: StatsForm = {
  kind: "",
  panels: "portal",
  utcFrom: "",
  utcTo: "",
  localDateFrom: "",
  localDateTo: "",
  localHourFrom: "",
  localHourTo: "",
  portalLevelMin: "",
  portalLevelMax: "",
  hackingBonusMin: "",
  hackingBonusMax: "",
  speedBonusMin: "",
  speedBonusMax: "",
};

function nextDay(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? date : new Date(ms + 86_400_000).toISOString().slice(0, 10);
}

/**
 * The query string for the form. UTC dates become whole days: "to" is
 * inclusive, so it becomes midnight after it. Values aren't checked here;
 * the server validates them and explains what it refuses.
 */
export function formQuery(form: StatsForm): string {
  const params = new URLSearchParams();
  const set = (name: string, value: string) => {
    if (value.trim() !== "") params.set(name, value.trim());
  };
  set("kind", form.kind);
  if (form.panels !== "portal") params.set("panels", form.panels);
  if (form.utcFrom.trim() !== "") params.set("utcFrom", `${form.utcFrom.trim()}T00:00:00Z`);
  if (form.utcTo.trim() !== "") params.set("utcTo", `${nextDay(form.utcTo.trim())}T00:00:00Z`);
  for (const name of [
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
  ] as const) {
    set(name, form[name]);
  }
  return params.toString();
}
