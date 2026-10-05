import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Coverage, ItemExclusion, Statistics, UnplacedReason } from "../domain/statistics.ts";
import { fetchStatistics, type StatisticsOutcome } from "./api.ts";
import { columnMaxima, DEFAULT_SORT, itemsTsv, shade, sortItems, type Sort, type SortKey } from "./itemTable.ts";
import { itemCategory, matchesSearch } from "./items.ts";
import { LatestOnly, STALE } from "./latest.ts";
import { EMPTY_FORM, formQuery, type StatsForm } from "./statsForm.ts";

// Each label follows a count: "2 with no portal level".
const UNPLACED: Record<UnplacedReason, string> = {
  crosses_utc_boundary: "whose interval crosses a boundary of the UTC dates",
  no_local_time: "with no local time (recorded in UTC only)",
  no_local_hour: "with no local hour (whole-day interval)",
  no_portal_level: "with no portal level (includes every drop)",
  portal_level_crosses_filter: "whose portal level range crosses the filter",
  no_hacking_bonus: "with no hacking bonus (includes every drop)",
  hacking_bonus_not_final: "whose hacking bonus isn't final",
  no_speed_bonus: "with no speed bonus (includes every drop)",
  speed_bonus_not_final: "whose speed bonus isn't final",
};

const COVERAGE: Record<Coverage, string> = {
  both_panels_in_full: "with portal and bonus panels read in full",
  seen_panels_in_full: "with every panel seen read in full",
  partly_read: "with a panel partly read, or a row unidentified",
  no_panel: "read, but with no panel seen",
  notRead: "not read (timed out or capture lost)",
  unavailable: "with no gear reading",
  unsupported: "saved in an unsupported format",
};

const EXCLUSIONS: Record<ItemExclusion, string> = {
  no_reading: "with no gear reading",
  panel_not_seen: "without the selected panel",
  partly_read: "with the selected panel partly read",
  unidentified_items: "with an unreadable item or level",
  unlisted_item_names: "with an item name awaiting review",
};

const PANELS = { portal: "portal panel", bonus: "bonus panel", both: "portal and bonus panels" } as const;
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const DISCLAIMER_KEY = "glyph-drop-stats:disclaimer-seen";

const average = (value: number | null) => (value === null ? "—" : value.toFixed(2));
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);

/** Range filters that are filled in, for the Filters button's count. */
const RANGE_FIELDS = [
  ["utcFrom", "utcTo"],
  ["localDateFrom", "localDateTo"],
  ["localHourFrom", "localHourTo"],
  ["portalLevelMin", "portalLevelMax"],
  ["hackingBonusMin", "hackingBonusMax"],
  ["speedBonusMin", "speedBonusMax"],
] as const satisfies readonly (readonly [keyof StatsForm, keyof StatsForm])[];

function activeRanges(form: StatsForm): number {
  return RANGE_FIELDS.filter(([from, to]) => form[from].trim() !== "" || form[to].trim() !== "").length;
}

function readDisclaimerSeen(): boolean {
  try {
    return window.localStorage.getItem(DISCLAIMER_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDisclaimerSeen(): void {
  try {
    window.localStorage.setItem(DISCLAIMER_KEY, "1");
  } catch {
    // Without storage the note shows again next visit; nothing else depends on it.
  }
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** A native modal dialog that opens while `open` is set and reports every way it closes. */
function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose}>
      {children}
    </dialog>
  );
}

function RangeField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span>{label}</span>
      {children}
    </div>
  );
}

export function StatisticsView() {
  const [form, setForm] = useState<StatsForm>(EMPTY_FORM);
  const [outcome, setOutcome] = useState<StatisticsOutcome | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [guideOpen, setGuideOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(() => !readDisclaimerSeen());
  const latest = useRef(new LatestOnly());

  async function load(query: string) {
    try {
      const result = await latest.current.run((signal) => fetchStatistics(query, signal));
      if (result !== STALE) setOutcome(result);
    } catch (error) {
      setOutcome({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }

  useEffect(() => {
    void load("");
    const pending = latest.current;
    return () => pending.cancel();
  }, []);

  /** Selects apply at once, like a unit switch; ranges wait for Apply. */
  function choose(next: StatsForm) {
    setForm(next);
    void load(formQuery(next));
  }

  function apply(event: FormEvent) {
    event.preventDefault();
    void load(formQuery(form));
  }

  const rangeInput = (name: keyof StatsForm, label: string, props: Record<string, string | number> = {}) => (
    <input
      aria-label={label}
      value={form[name]}
      onChange={(event) => setForm({ ...form, [name]: event.target.value })}
      {...props}
    />
  );

  const statistics = outcome?.kind === "ok" ? outcome.statistics : null;
  const ranges = activeRanges(form);

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search items or click a tag"
          aria-label="Search items"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Items from"
          value={form.panels}
          onChange={(event) => choose({ ...form, panels: event.target.value as StatsForm["panels"] })}
        >
          <option value="portal">items: portal panel</option>
          <option value="bonus">items: bonus panel</option>
          <option value="both">items: both panels</option>
        </select>
        <select
          aria-label="Kind"
          value={form.kind}
          onChange={(event) => choose({ ...form, kind: event.target.value as StatsForm["kind"] })}
        >
          <option value="">hacks and drops</option>
          <option value="hack">hacks only</option>
          <option value="drop">drops only</option>
        </select>
        <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          Filters{ranges > 0 ? ` (${ranges})` : ""} {filtersOpen ? "▴" : "▾"}
        </button>
        <span className="spacer" />
        <button type="button" onClick={() => setGuideOpen(true)}>
          About these numbers
        </button>
        <button
          type="button"
          disabled={!statistics}
          onClick={() =>
            statistics && download("glyph-drop-stats-items.tsv", itemsTsv(statistics), "text/tab-separated-values")
          }
        >
          ↓ Download TSV
        </button>
      </div>

      {filtersOpen && (
        <form className="filter-panel" onSubmit={apply} aria-label="Filters">
          <RangeField label="UTC dates">
            {rangeInput("utcFrom", "UTC dates from", { type: "date" })} –{" "}
            {rangeInput("utcTo", "UTC dates to", { type: "date" })}
          </RangeField>
          <RangeField label="Local dates (needs a recorded offset)">
            {rangeInput("localDateFrom", "Local dates from", { type: "date" })} –{" "}
            {rangeInput("localDateTo", "Local dates to", { type: "date" })}
          </RangeField>
          <RangeField label="Local hours (needs a recorded offset)">
            {rangeInput("localHourFrom", "Local hours from", { type: "number", min: 0, max: 23 })} –{" "}
            {rangeInput("localHourTo", "Local hours to", { type: "number", min: 0, max: 23 })}
          </RangeField>
          <RangeField label="Portal level">
            {rangeInput("portalLevelMin", "Portal level from", { type: "number", min: 1, max: 8 })} –{" "}
            {rangeInput("portalLevelMax", "Portal level to", { type: "number", min: 1, max: 8 })}
          </RangeField>
          <RangeField label="Hacking bonus % (final only)">
            {rangeInput("hackingBonusMin", "Hacking bonus % from", { type: "number", min: 0 })} –{" "}
            {rangeInput("hackingBonusMax", "Hacking bonus % to", { type: "number", min: 0 })}
          </RangeField>
          <RangeField label="Speed bonus % (final only)">
            {rangeInput("speedBonusMin", "Speed bonus % from", { type: "number", min: 0 })} –{" "}
            {rangeInput("speedBonusMax", "Speed bonus % to", { type: "number", min: 0 })}
          </RangeField>
          <div className="actions">
            <button type="submit">Apply</button>
            <button type="button" onClick={() => choose({ ...EMPTY_FORM, kind: form.kind, panels: form.panels })}>
              Clear
            </button>
          </div>
        </form>
      )}

      {outcome?.kind === "refused" && (
        <p className="error">{outcome.issues.map((issue) => issue.message).join(" ")}</p>
      )}
      {outcome?.kind === "failed" && <p className="error">Couldn't load statistics: {outcome.message}</p>}
      {outcome === null && <p className="empty label">Loading…</p>}
      {statistics && (
        <Dashboard
          statistics={statistics}
          search={search}
          onTag={setSearch}
          sort={sort}
          onSort={(key) =>
            setSort(sort.key === key ? { key, descending: !sort.descending } : { key, descending: key !== "item" })
          }
        />
      )}

      <Modal open={guideOpen} onClose={() => setGuideOpen(false)}>
        <Guide />
        <form method="dialog">
          <button type="submit">Close</button>
        </form>
      </Modal>
      <Modal
        open={disclaimerOpen}
        onClose={() => {
          rememberDisclaimerSeen();
          setDisclaimerOpen(false);
        }}
      >
        <p>
          <strong>An important note:</strong> these are descriptive counts of what players chose to submit, from what
          the DynamicGlyph app managed to read on their screens. They are not the drop rate of every hack played. Drop
          groups aren't confirmed hacks, the app can misread, and files can be edited. Darker cells mean more items in
          that column; they don't mean better, rarer or certain.
        </p>
        <form method="dialog">
          <button type="submit">Got it</button>
        </form>
      </Modal>
    </>
  );
}

function Dashboard(props: {
  statistics: Statistics;
  search: string;
  onTag: (tag: string) => void;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  const { statistics, search, sort } = props;
  const { selection, records, items } = statistics;
  const excluded = sum(items.excluded);
  const unplaced = sum(selection.unplaced);
  const max = columnMaxima(items.byItem);
  const rows = sortItems(
    items.byItem.filter((row) => matchesSearch(row.item, search)),
    sort,
  );

  const header = (key: SortKey, label: ReactNode) => {
    const active = sort.key === key;
    return (
      <th aria-sort={active ? (sort.descending ? "descending" : "ascending") : undefined}>
        <button type="button" className="sort" onClick={() => props.onSort(key)}>
          <span>{label}</span>
          <span aria-hidden="true">{active ? (sort.descending ? "▼" : "▲") : "⇕"}</span>
        </button>
      </th>
    );
  };

  return (
    <>
      <div className="strip">
        <div>
          <span className="label">Records</span>
          <span className="value">{records.total}</span>
          <span className="label">each counted once{unplaced > 0 ? ` · ${unplaced} couldn't be placed` : ""}</span>
        </div>
        <div>
          <span className="label">Eligible observations</span>
          <span className="value">
            {items.eligible}
            <span className="label"> of {records.total}</span>
          </span>
          <span className="label">{PANELS[items.panels]} read in full</span>
        </div>
        <div>
          <span className="label">Left out of item counts</span>
          <span className="value">{excluded}</span>
          <span className="label">incomplete is unknown, never zero</span>
        </div>
        <div>
          <span className="label">Items</span>
          <span className="value">{items.totalQuantity}</span>
          <span className="label">from eligible observations</span>
        </div>
        <div>
          <span className="label">Per observation</span>
          <span className="value">{average(items.averagePerObservation)}</span>
          <span className="label">items ÷ {items.eligible} eligible</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {header("item", "Item")}
              {header("quantity", "Quantity")}
              {header(
                "averagePerObservation",
                <>
                  <abbr title={`Quantity ÷ ${items.eligible} eligible observations`}>Per obs.</abbr> n={items.eligible}
                </>,
              )}
              {LEVELS.map((level) => (
                <Fragment key={level}>{header(`L${level}`, `L${level}`)}</Fragment>
              ))}
              {header("multiplied", <abbr title="Of the quantity, printed in red: a multiplier applied">Multiplied</abbr>)}
              {header("multipliedUnknown", <abbr title="Of the quantity, colour not read">Colour unread</abbr>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const category = itemCategory(row.item);
              return (
                <tr key={row.item}>
                  <td>
                    {row.item}
                    <br />
                    {category && (
                      <button type="button" className="tag" onClick={() => props.onTag(category)}>
                        {category}
                      </button>
                    )}
                  </td>
                  <td className={`num shade-${shade(row.quantity, max.quantity)}`}>{row.quantity}</td>
                  <td className={`num shade-${shade(row.averagePerObservation, max.average)}`}>
                    {row.averagePerObservation.toFixed(2)}
                  </td>
                  {LEVELS.map((level) => {
                    const value = row.levels?.[level - 1] ?? null;
                    if (value === null) {
                      return (
                        <td key={level} className="num muted" title="This item has no levels">
                          —
                        </td>
                      );
                    }
                    const step = shade(value, max.level);
                    return (
                      <td key={level} className={`num${step === 0 ? " muted" : ` shade-${step}`}`}>
                        {value}
                      </td>
                    );
                  })}
                  <td className="num">{row.multiplied}</td>
                  <td className="num">{row.multipliedUnknown}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="empty label">
            {items.byItem.length === 0 ? "No eligible observations match these filters." : "No item matches the search."}
          </p>
        )}
      </div>

      <div className="breakdowns">
        <Breakdown title="Coverage" counts={records.byCoverage} labels={COVERAGE} total={records.total} />
        <Breakdown title="Left out of item counts" counts={items.excluded} labels={EXCLUSIONS} total={excluded} />
        <Breakdown title="Couldn't be placed" counts={selection.unplaced} labels={UNPLACED} total={unplaced} />
      </div>
      <p className="label caption">
        {plural(records.byKind.hack, "hack")} · {plural(records.byKind.drop, "drop group")} · items from the{" "}
        {PANELS[items.panels]}
      </p>
    </>
  );
}

function Breakdown<K extends string>(props: {
  title: string;
  counts: Record<K, number>;
  labels: Record<K, string>;
  total: number;
}) {
  const shown = (Object.keys(props.labels) as K[]).filter((key) => props.counts[key] > 0);
  return (
    <section>
      <h2 className="label">
        {props.title} · {props.total}
      </h2>
      {shown.length === 0 ? (
        <p className="empty label">none</p>
      ) : (
        <table className="data">
          <tbody>
            {shown.map((key) => (
              <tr key={key}>
                <td className="count">{props.counts[key]}</td>
                <td>{props.labels[key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Guide() {
  return (
    <>
      <h2>About these numbers</h2>
      <ul>
        <li>
          <strong>Records</strong> are hacks and drop groups players submitted. Each counts once, as its accepted
          version. Withdrawn submissions, conflicting copies and unreviewed updates don't count.
        </li>
        <li>
          <strong>Eligible observations</strong> had their gear read, with every selected panel seen, read in full and
          every item identified. Anything less is left out and counted below the table: a missing panel is unknown, not
          zero.
        </li>
        <li>
          <strong>Per observation</strong> is quantity ÷ eligible observations, including observations without that
          item.
        </li>
        <li>
          <strong>Shading</strong> runs from pale to full yellow as a value approaches its column's largest. It means
          more, not better.
        </li>
        <li>
          <strong>Filters</strong> that can't judge a record (a drop has no portal level; an old record has no local
          time) set it aside and say so, instead of guessing.
        </li>
        <li>
          Only what the app read is here, and players choose what to submit. Agent level, faction, mods and hack type
          aren't recorded. There are no confidence intervals: records cluster by player and session.
        </li>
      </ul>
    </>
  );
}
