import { useCallback, useMemo } from "react";
import { SMALL_SAMPLE, SPLITS, type ItemTotal, type Statistics } from "../domain/statistics.ts";
import type { AppState, Store } from "./app/store.ts";
import {
  averageText,
  barLabel,
  barTotals,
  chance,
  countLabel,
  dispersion,
  groupLabel,
  isFew,
  levelShares,
  percent,
  poissonExpected,
  sharePercent,
  whenPresent,
} from "./dashboard.ts";
import type { Messages } from "./i18n/en.ts";
import { issuesText, messages, problemText } from "./i18n/index.ts";
import { itemCategory, matchesSearch } from "./items.ts";
import { columnMaxima, shade, sortItems, type SortKey } from "./itemTable.ts";
import type { StatsForm } from "./statsForm.ts";
import { Bars, CountChart, LevelHeatmap, type BarRow, type CountRow, type GridCell } from "./charts.tsx";
import { usePaint, type Paint } from "./paint.ts";

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);
const percentOf = (value: number) => `${Math.round(value * 100)}%`;

export function StatisticsView({ store, state }: { store: Store; state: AppState }) {
  const s = messages(state.locale);
  const { statistics } = state;
  const { outcome } = statistics;
  const paint = usePaint();
  return (
    <>
      <Toolbar store={store} state={state} s={s} />
      {statistics.filtersOpen && <FilterPanel store={store} form={statistics.form} s={s} />}
      {state.testPeriod && <p className="notice" data-testid="test-period">{s.app.testPeriod}</p>}
      {outcome === null && <p className="empty">{s.stats.loading}</p>}
      {outcome?.kind === "refused" && <p className="error" role="alert">{issuesText(s, outcome.issues)}</p>}
      {outcome?.kind === "failed" && <p className="error" role="alert">{s.stats.loadFailed(problemText(s, outcome.problem))}</p>}
      {outcome?.kind === "ok" && <Dashboard store={store} state={state} s={s} statistics={outcome.statistics} paint={paint} />}
    </>
  );
}

function Select<T extends string>({ value, options, label, onChange }: { value: T; options: readonly { value: T; label: string }[]; label: string; onChange: (value: T) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

type RangeName = keyof Messages["stats"]["ranges"];
const RANGES = [
  ["utc", "utcFrom", "utcTo", "date"],
  ["localDate", "localDateFrom", "localDateTo", "date"],
  ["localHour", "localHourFrom", "localHourTo", "number"],
  ["portalLevel", "portalLevelMin", "portalLevelMax", "number"],
  ["hackingBonus", "hackingBonusMin", "hackingBonusMax", "number"],
  ["speedBonus", "speedBonusMin", "speedBonusMax", "number"],
] as const satisfies readonly (readonly [RangeName, keyof StatsForm, keyof StatsForm, "date" | "number"])[];

const activeRanges = (form: StatsForm) => RANGES.filter(([, from, to]) => form[from].trim() !== "" || form[to].trim() !== "").length;

function Toolbar({ store, state, s }: { store: Store; state: AppState; s: Messages }) {
  const { form, search, filtersOpen, outcome } = state.statistics;
  return (
    <div className="toolbar">
      <input type="search" value={search} placeholder={s.stats.search} aria-label={s.a11y.searchItems} title={s.stats.searchHint} onChange={(event) => store.setSearch(event.target.value)} />
      <Select
        label={s.stats.items(s.stats.panelShort[form.panels])}
        value={form.panels}
        options={(["portal", "bonus", "both"] as const).map((value) => ({ value, label: s.stats.panelChoice[value] }))}
        onChange={(panels) => store.choose({ panels })}
      />
      <Select
        label={s.stats.kind[form.kind]}
        value={form.kind}
        options={(["", "hack", "drop"] as const).map((value) => ({ value, label: s.stats.kind[value] }))}
        onChange={(kind) => store.choose({ kind })}
      />
      <Select
        label={s.stats.alignmentChoice[form.alignment]}
        value={form.alignment}
        options={(["", "same_faction", "enemy", "machina"] as const).map((value) => ({ value, label: s.stats.alignmentChoice[value] }))}
        onChange={(alignment) => store.choose({ alignment })}
      />
      <button type="button" aria-expanded={filtersOpen} aria-keyshortcuts="F3" title={s.stats.filtersHint} onClick={() => store.toggleFilters()}>
        {s.stats.filters(activeRanges(form))}
      </button>
      <span className="spacer" />
      <button type="button" aria-keyshortcuts="F4" title={s.stats.aboutHint} onClick={() => store.setGuideOpen(true)}>
        {s.stats.about}
      </button>
      <button type="button" title={s.stats.copyLinkHint} onClick={() => void store.copyLink(window.location.href)}>
        {s.stats.copyLink}
      </button>
      <button type="button" title={s.stats.tsvHint} disabled={outcome?.kind !== "ok"} onClick={() => store.downloadTsv()}>
        {s.stats.tsv}
      </button>
    </div>
  );
}

function FilterPanel({ store, form, s }: { store: Store; form: StatsForm; s: Messages }) {
  return (
    <form
      className="filter-panel"
      onSubmit={(event) => {
        event.preventDefault();
        store.applyFilters();
      }}
    >
      {RANGES.map(([name, from, to, kind]) => {
        const label = s.stats.ranges[name];
        const type = kind === "date" ? "date" : "number";
        return (
          <div className="field" key={name}>
            <span>{label}</span>
            <input type={type} aria-label={s.a11y.filterFrom(label)} value={form[from]} onChange={(event) => store.setFormField(from, event.target.value)} />
            <span aria-hidden="true">–</span>
            <input type={type} aria-label={s.a11y.filterTo(label)} value={form[to]} onChange={(event) => store.setFormField(to, event.target.value)} />
          </div>
        );
      })}
      <div className="actions">
        <button type="submit" className="primary">
          {s.stats.apply}
        </button>
        <button type="button" onClick={() => store.clearFilters()}>
          {s.stats.clear}
        </button>
      </div>
    </form>
  );
}

function Dashboard({ store, state, s, statistics, paint }: { store: Store; state: AppState; s: Messages; statistics: Statistics; paint: Paint }) {
  return (
    <>
      <Headline s={s} statistics={statistics} />
      <Compare store={store} state={state} s={s} statistics={statistics} paint={paint} />
      <div className="pair">
        <Levels store={store} state={state} s={s} statistics={statistics} paint={paint} />
        <Gives s={s} statistics={statistics} paint={paint} />
      </div>
      <Distribution store={store} state={state} s={s} statistics={statistics} paint={paint} />
      <ItemTable store={store} state={state} s={s} statistics={statistics} />
      <Sample s={s} statistics={statistics} />
      <p className="caption">
        {s.stats.caption(statistics.records.byKind.hack, statistics.records.byKind.drop, s.panels[statistics.items.panels], state.statistics.loading)}
      </p>
    </>
  );
}

function Headline({ s, statistics }: { s: Messages; statistics: Statistics }) {
  const { selection, records, summary, items } = statistics;
  const h = s.stats.headline;
  const cells: [string, string, string, boolean][] = [
    [h.records, String(records.total), h.recordsNote(selection.uploads, sum(selection.unplaced)), false],
    [h.eligible, h.eligibleValue(summary.eligible, records.total), h.eligibleNote(s.panels[items.panels]), false],
    [h.perObservation, averageText(summary.averagePerObservation), h.perObservationNote(summary.eligible), isFew(summary.eligible)],
    [h.rare, percent(summary.rare), h.rareNote(summary.rare.known), isFew(summary.rare.known)],
    [h.key, percent(summary.key), h.keyNote(summary.key.known), isFew(summary.key.known)],
  ];
  return (
    <dl className="strip" data-testid="headline">
      {cells.map(([label, value, note, few]) => (
        <div key={label} className={few ? "few" : undefined}>
          <dt className="label">{label}</dt>
          <dd className="value">{value}</dd>
          <dd className="note">{few ? `${note} · ${h.few}` : note}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="block">
      <header className="block-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Compare({ store, state, s, statistics, paint }: { store: Store; state: AppState; s: Messages; statistics: Statistics; paint: Paint }) {
  const t = s.stats.compare;
  const { groups, split } = statistics;
  const picker = (
    <Select
      label={t.heading}
      value={state.statistics.form.split}
      options={SPLITS.map((value) => ({ value, label: t.splitChoice[value] }))}
      onChange={(next) => store.choose({ split: next })}
    />
  );
  const h = s.stats.headline;
  const series = useMemo(() => {
    type GroupSummary = (typeof groups)[number]["summary"];
    const row = (pick: (g: GroupSummary) => number | null, known: (g: GroupSummary) => number, basis: (n: number) => string): BarRow[] =>
      groups.map(({ key, summary }) => ({
        label: groupLabel(s, split, key),
        value: pick(summary) ?? 0,
        few: isFew(known(summary)),
        basis: basis(known(summary)),
      }));
    const share = ({ yes, known }: { yes: number; known: number }) => (known === 0 ? null : yes / known);
    return {
      perObservation: row((g) => g.averagePerObservation, (g) => g.eligible, h.perObservationNote),
      rare: row((g) => share(g.rare), (g) => g.rare.known, h.rareNote),
      key: row((g) => share(g.key), (g) => g.key.known, h.keyNote),
    };
  }, [groups, split, s, h]);
  const two = useCallback((value: number) => value.toFixed(2), []);
  if (groups.length === 0) {
    return (
      <Section title={t.heading} aside={picker}>
        <p className="empty">{t.empty}</p>
      </Section>
    );
  }
  return (
    <Section title={t.heading} aside={picker}>
      <div className="small-multiples">
        <figure>
          <figcaption className="label">{t.columns.perObservation}</figcaption>
          <Bars rows={series.perObservation} paint={paint} label={`${t.splitChoice[split]}: ${h.perObservation}`} metric={h.perObservation} fewNote={h.few} format={two} />
        </figure>
        <figure>
          <figcaption className="label">{t.columns.rare}</figcaption>
          <Bars rows={series.rare} paint={paint} label={`${t.splitChoice[split]}: ${h.rare}`} metric={h.rare} fewNote={h.few} format={percentOf} max={1} />
        </figure>
        <figure>
          <figcaption className="label">{t.columns.key}</figcaption>
          <Bars rows={series.key} paint={paint} label={`${t.splitChoice[split]}: ${h.key}`} metric={h.key} fewNote={h.few} format={percentOf} max={1} />
        </figure>
      </div>
      <div className="table-wrap">
        <table className="data" data-testid="compare">
          <thead>
            <tr>
              <th scope="col">{t.splitChoice[split]}</th>
              <th scope="col">{t.columns.records}</th>
              <th scope="col">{t.columns.eligible}</th>
              <th scope="col">{t.columns.perObservation}</th>
              <th scope="col">{t.columns.rare}</th>
              <th scope="col">{t.columns.key}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ key, summary }) => (
              <tr key={key} className={isFew(summary.eligible) ? "few" : undefined}>
                <th scope="row">{groupLabel(s, split, key)}</th>
                <td>{summary.records}</td>
                <td>{summary.eligible}</td>
                <td>{averageText(summary.averagePerObservation)}</td>
                <td>{percent(summary.rare)}</td>
                <td>{percent(summary.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">{t.notes[split]}</p>
      {groups.some((g) => isFew(g.summary.eligible)) && <p className="note">{t.few(SMALL_SAMPLE)}</p>}
    </Section>
  );
}

function Levels({ store, state, s, statistics, paint }: { store: Store; state: AppState; s: Messages; statistics: Statistics; paint: Paint }) {
  const t = s.stats.levels;
  const { groups, split } = statistics;
  const { gridGroup } = state.statistics;
  const { selected, cells, rows } = useMemo(() => {
    const selected = statistics.groups.find((group) => group.key === gridGroup) ?? null;
    const summary = selected?.summary ?? statistics.summary;
    const levels = summary.portalLevels.map((observations, index) => ({ level: index + 1, observations })).filter((row) => row.observations > 0);
    const rowNames = levels.map((row) => s.stats.levels.row(row.level, row.observations));
    const gridCells: GridCell[] = levels.flatMap((row, i) => {
      const counts = summary.levelGrid[row.level - 1];
      const total = counts.reduce((sum, n) => sum + n, 0);
      const shares = levelShares(counts) ?? Array<number>(8).fill(0);
      return shares.map((share, level) => ({ row: rowNames[i], column: `L${level + 1}`, share, items: counts[level], total, few: isFew(row.observations) }));
    });
    return { selected, cells: gridCells, rows: rowNames };
  }, [statistics, gridGroup, s]);
  const describe = useCallback((c: GridCell) => s.stats.levels.cell(c.column, c.items, c.total, sharePercent(c.share)), [s]);
  const tabs = split !== "portalLevel" && groups.length > 1 && (
    <div className="segmented" role="group" aria-label={t.heading}>
      {[{ key: null as string | null, label: t.all }, ...groups.map((g) => ({ key: g.key, label: groupLabel(s, split, g.key) }))].map((tab) => (
        <button key={tab.key ?? "all"} type="button" aria-pressed={(selected?.key ?? null) === tab.key} onClick={() => store.setGridGroup(tab.key)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
  return (
    <Section title={t.heading}>
      {tabs}
      {rows.length === 0 ? (
        <p className="empty">{t.empty}</p>
      ) : (
        <div className="chart">
          <LevelHeatmap cells={cells} rows={rows} paint={paint} label={t.mirrorCaption(selected ? groupLabel(s, split, selected.key) : t.all)} describe={describe} />
          <LevelTable cells={cells} rows={rows} caption={t.mirrorCaption(selected ? groupLabel(s, split, selected.key) : t.all)} />
        </div>
      )}
      <p className="note">{t.note}</p>
    </Section>
  );
}

/**
 * The level grid as a table, for screen readers: the chart's cells are drawn,
 * not read. It sits in a hidden box because a table ignores the 1px size that
 * hides it, and would widen the page.
 */
function LevelTable({ cells, rows, caption }: { cells: readonly GridCell[]; rows: readonly string[]; caption: string }) {
  const columns = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
  return (
    <div className="sr-only">
      <table data-testid="levels">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <td />
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th scope="row">{row}</th>
              {cells
                .filter((c) => c.row === row)
                .map((c) => (
                  <td key={c.column}>{`${sharePercent(c.share)}%`}</td>
                ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Gives({ s, statistics, paint }: { s: Messages; statistics: Statistics; paint: Paint }) {
  const t = s.stats.gives;
  const { summary, items } = statistics;
  const basis = t.note(summary.eligible);
  const rows = useMemo(
    () => barTotals(items.byItem, summary.eligible).map(({ bar, perObservation }) => ({ label: barLabel(s, bar), value: perObservation, basis })),
    [items, summary, s, basis],
  );
  const two = useCallback((value: number) => value.toFixed(2), []);
  if (rows.length === 0) return null;
  return (
    <Section title={t.heading}>
      <div className="chart">
        <Bars rows={rows} paint={paint} label={t.heading} metric={s.stats.headline.perObservation} format={two} />
      </div>
      <p className="note">{t.note(summary.eligible)}</p>
    </Section>
  );
}

/** The item shown when none is chosen: shields, whose counts first suggested looking at all this. */
const DEFAULT_DIST_ITEM = "Portal Shield";

/**
 * How many of one item each eligible observation had, against a Poisson
 * count with the same mean. A description of the sample, not a test.
 */
function Distribution({ store, state, s, statistics, paint }: { store: Store; state: AppState; s: Messages; statistics: Statistics; paint: Paint }) {
  const t = s.stats.distribution;
  const { byItem, eligible } = statistics.items;
  const { distItem } = state.statistics;
  const row =
    byItem.find((entry) => entry.item === distItem) ?? byItem.find((entry) => entry.item === DEFAULT_DIST_ITEM) ?? byItem[0] ?? null;
  const rows = useMemo((): CountRow[] => {
    if (row === null) return [];
    const expected = poissonExpected(row.averagePerObservation, eligible);
    const all = row.distribution.map((observed, k) => ({ label: countLabel(k), observed, expected: expected[k] }));
    // The tail past anything observed or expected even once only stretches the axis.
    const last = Math.max(2, ...all.flatMap((entry, k) => (entry.observed > 0 || entry.expected >= 1 ? [k] : [])));
    return all.slice(0, last + 1);
  }, [row, eligible]);
  const describe = useCallback(
    (entry: CountRow) => [
      s.stats.distribution.bin(entry.observed, sharePercent(eligible === 0 ? 0 : entry.observed / eligible)),
      s.stats.distribution.expected(entry.expected.toFixed(1)),
    ],
    [s, eligible],
  );
  if (row === null) {
    return (
      <Section title={t.heading}>
        <p className="empty">{t.empty}</p>
      </Section>
    );
  }
  const ratio = dispersion(row);
  const few = isFew(eligible);
  const picker = (
    <Select label={t.item} value={row.item} options={byItem.map((entry) => ({ value: entry.item, label: entry.item }))} onChange={(item) => store.setDistItem(item)} />
  );
  return (
    <Section title={t.heading} aside={picker}>
      <div className="distribution">
        <div className="chart">
          <CountChart rows={rows} paint={paint} label={`${t.heading}: ${row.item}`} describe={describe} />
          <p className="note">{t.legend}</p>
        </div>
        <dl className={few ? "figures few" : "figures"} data-testid="distribution">
          <dt>{t.observations}</dt>
          <dd>{eligible}</dd>
          <dt>{t.mean}</dt>
          <dd>{row.averagePerObservation.toFixed(2)}</dd>
          <dt>{t.variance}</dt>
          <dd>{averageText(row.variance)}</dd>
          <dt>{t.dispersion}</dt>
          <dd>{averageText(ratio)}</dd>
        </dl>
      </div>
      <div className="sr-only">
        <table>
          <caption>{`${t.heading}: ${row.item}`}</caption>
          <thead>
            <tr>
              <td />
              <th scope="col">{t.observations}</th>
              <th scope="col">{t.poisson}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.label}>
                <th scope="row">{entry.label}</th>
                <td>{entry.observed}</td>
                <td>{entry.expected.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {few && <p className="note">{s.stats.headline.few}</p>}
      <p className="note">{t.note}</p>
    </Section>
  );
}

interface Column {
  key: SortKey;
  label: string;
}

function ItemTable({ store, state, s, statistics }: { store: Store; state: AppState; s: Messages; statistics: Statistics }) {
  const { items } = statistics;
  const { search, sort } = state.statistics;
  const t = s.stats.table;
  const columns: Column[] = [
    { key: "item", label: t.item },
    { key: "quantity", label: t.quantity },
    { key: "averagePerObservation", label: t.perObservation(items.eligible) },
    { key: "chance", label: t.chance },
    { key: "whenPresent", label: t.whenPresent },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((level) => ({ key: `L${level}` as SortKey, label: `L${level}` })),
    { key: "multiplied", label: t.multiplied },
    { key: "multipliedUnknown", label: t.colourUnread },
  ];
  const rows = sortItems(
    items.byItem.filter((row) => matchesSearch(row.item, search, s.stats.categories)),
    sort,
  );
  const max = columnMaxima(items.byItem);
  return (
    <section className="block">
      <div className="table-wrap">
        <table className="data items" data-testid="items">
          <caption className="sr-only">{s.stats.mirrorCaption(s.panels[items.panels], items.eligible)}</caption>
          <thead>
            <tr>
              {columns.map((col) => {
                const active = sort.key === col.key;
                return (
                  <th key={col.key} scope="col" aria-sort={active ? (sort.descending ? "descending" : "ascending") : undefined}>
                    <button type="button" className="sort" onClick={() => store.sortBy(col.key)}>
                      <span>{col.label}</span>
                      <span aria-hidden="true">{active ? (sort.descending ? "▼" : "▲") : ""}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ItemRow key={row.item} row={row} eligible={items.eligible} max={max} store={store} s={s} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">{items.byItem.length === 0 ? t.noEligible : t.noMatch}</p>}
      </div>
    </section>
  );
}

function Shaded({ step, children }: { step: number; children: React.ReactNode }) {
  return <td className={step > 0 ? `num shade-${Math.min(step, 5)}` : "num muted"}>{children}</td>;
}

function ItemRow({ row, eligible, max, store, s }: { row: ItemTotal; eligible: number; max: ReturnType<typeof columnMaxima>; store: Store; s: Messages }) {
  const category = itemCategory(row.item);
  const share = chance(row, eligible);
  const present = whenPresent(row);
  return (
    <tr>
      <th scope="row">
        {row.item}
        {category && (
          <button type="button" className="tag" onClick={() => store.setSearch(s.stats.categories[category])} aria-label={s.a11y.showCategory(s.stats.categories[category])}>
            {s.stats.categories[category]}
          </button>
        )}
      </th>
      <Shaded step={shade(row.quantity, max.quantity)}>{row.quantity}</Shaded>
      <Shaded step={shade(row.averagePerObservation, max.average)}>{row.averagePerObservation.toFixed(2)}</Shaded>
      <Shaded step={shade(row.observations, max.observations)}>{share === null ? "—" : percentOf(share)}</Shaded>
      <Shaded step={present === null ? 0 : shade(present, max.whenPresent)}>{averageText(present)}</Shaded>
      {(row.levels ?? Array<number | null>(8).fill(null)).map((value, level) => (
        <Shaded key={level} step={value === null ? 0 : shade(value, max.level)}>
          {value === null ? "—" : value}
        </Shaded>
      ))}
      <td className={row.multiplied === 0 ? "num muted" : "num"}>{row.multiplied}</td>
      <td className={row.multipliedUnknown === 0 ? "num muted" : "num"}>{row.multipliedUnknown}</td>
    </tr>
  );
}

function Counts({ title, counts, labels, total, none }: { title: string; counts: Record<string, number>; labels: Record<string, string>; total: number; none: string }) {
  const shown = Object.keys(labels).filter((key) => counts[key] > 0);
  return (
    <section>
      <h3>
        {title} <span className="label">{total}</span>
      </h3>
      {shown.length === 0 ? (
        <p className="empty">{none}</p>
      ) : (
        <table className="counts">
          <tbody>
            {shown.map((key) => (
              <tr key={key}>
                <td className="count">{counts[key]}</td>
                <td>{labels[key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Sample({ s, statistics }: { s: Messages; statistics: Statistics }) {
  const t = s.stats.sample;
  const { selection, records, items } = statistics;
  const apps = Object.fromEntries(records.byApp.map((app, index) => [String(index), app.records]));
  const appLabels = Object.fromEntries(records.byApp.map((app, index) => [String(index), t.app(app.version ?? t.appUnknown, app.build ?? t.appUnknown)]));
  return (
    <details className="block sample">
      <summary title={t.hint}>{t.heading}</summary>
      <div className="breakdowns">
        <Counts title={s.stats.breakdowns.coverage} counts={records.byCoverage} labels={s.coverage} total={records.total} none={s.stats.none} />
        <Counts title={s.stats.breakdowns.leftOut} counts={items.excluded} labels={s.exclusions} total={sum(items.excluded)} none={s.stats.none} />
        <Counts title={s.stats.breakdowns.unplaced} counts={selection.unplaced} labels={s.unplaced} total={sum(selection.unplaced)} none={s.stats.none} />
        <Counts title={t.apps} counts={apps} labels={appLabels} total={records.total} none={s.stats.none} />
      </div>
      <p className="note">{t.gaps}</p>
    </details>
  );
}
