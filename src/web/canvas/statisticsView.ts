import type { Context, Rect } from "@synth-ui/core";
import { menu, scrollView, textField, useTheme } from "@synth-ui/widgets";
import { SMALL_SAMPLE, SPLITS, type ItemTotal, type Statistics } from "../../domain/statistics.ts";
import type { Store } from "../app/store.ts";
import type { Messages } from "../i18n/en.ts";
import { issuesText, problemText } from "../i18n/index.ts";
import { averageText, barLabel, barTotals, chance, groupLabel, isFew, levelShares, percent, whenPresent } from "../dashboard.ts";
import { columnMaxima, shade, sortItems, type SortKey } from "../itemTable.ts";
import { itemCategory, matchesSearch } from "../items.ts";
import type { StatsForm } from "../statsForm.ts";
import { COLORS, FONT, inkOn, shadeFill } from "./theme.ts";
import {
  actionButton,
  announceField,
  buttonHeight,
  buttonWidth,
  drawFocusRing,
  errorLine,
  heading,
  lineHeight,
  paragraph,
  pressable,
  wrapRow,
  wrapText,
} from "./ui.ts";

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);

export function drawStatistics(ctx: Context, store: Store): void {
  const s = store.strings;
  const { statistics } = store.state;
  toolbar(ctx, store, s);
  if (store.state.testPeriod) paragraph(ctx, s.app.testPeriod, { color: COLORS.flame });
  if (statistics.filtersOpen) filterPanel(ctx, store, s);
  const { outcome } = statistics;
  if (outcome === null) {
    paragraph(ctx, s.stats.loading, { color: COLORS.muted });
    return;
  }
  if (outcome.kind === "refused") errorLine(ctx, issuesText(s, outcome.issues));
  if (outcome.kind === "failed") errorLine(ctx, s.stats.loadFailed(problemText(s, outcome.problem)));
  if (outcome.kind === "ok") dashboard(ctx, store, s, outcome.statistics);
}

/** A button that opens a menu of choices; keyboard: Enter opens it, arrows and Enter pick. */
function picker<T extends string>(
  ctx: Context,
  rect: Rect,
  opts: { key: string; label: string; value: T; options: readonly { value: T; label: string }[]; onPick: (value: T) => void },
): void {
  const state = ctx.state(() => ({ open: false }), { key: `${opts.key}:state` });
  if (actionButton(ctx, { key: opts.key, label: opts.label, hint: opts.label, caret: state.open ? "up" : "down" }, rect)) {
    state.open = !state.open;
  }
  const result = menu(ctx, {
    key: `${opts.key}:menu`,
    items: opts.options.map((option) => ({ label: option.label })),
    anchor: rect,
    open: state.open,
    selected: opts.options.findIndex((option) => option.value === opts.value),
  });
  if (result.picked !== null) {
    state.open = false;
    opts.onPick(opts.options[result.picked].value);
  }
  if (result.dismissed) state.open = false;
}

function toolbar(ctx: Context, store: Store, s: Messages): void {
  const { statistics } = store.state;
  const { form } = statistics;
  const ok = statistics.outcome?.kind === "ok";
  const labels = {
    panels: s.stats.items(s.stats.panelShort[form.panels]),
    kind: s.stats.kind[form.kind],
    alignment: s.stats.alignmentChoice[form.alignment],
    filters: s.stats.filters(activeRanges(form)),
  };
  // Wide enough for its placeholder in this face, which is larger in CJK at 12px.
  const searchW = Math.min(ctx.bounds.w, Math.max(140, ctx.measureText(s.stats.search, { font: FONT.mixed }) + 12));
  const widths = [
    searchW,
    buttonWidth(ctx, labels.panels, true),
    buttonWidth(ctx, labels.kind, true),
    buttonWidth(ctx, labels.alignment, true),
    buttonWidth(ctx, labels.filters, true),
    buttonWidth(ctx, s.stats.about),
    buttonWidth(ctx, s.stats.tsv),
  ];
  const [search, panels, kind, alignment, filters, about, tsv] = wrapRow(ctx, widths, buttonHeight(ctx), 4);
  const fieldH = lineHeight(ctx, FONT.mixed) + 4;
  const field = textField(
    ctx,
    { key: "search", value: statistics.search, placeholder: s.stats.search, font: FONT.mixed, hint: s.stats.searchHint },
    { ...search, y: search.y + Math.floor((search.h - fieldH) / 2), h: fieldH },
  );
  if (field.it.focused) announceField(s.a11y.searchItems);
  if (field.changed) store.setSearch(field.text);

  picker(ctx, panels, {
    key: "panels",
    label: labels.panels,
    value: form.panels,
    options: (["portal", "bonus", "both"] as const).map((value) => ({ value, label: s.stats.panelChoice[value] })),
    onPick: (value) => store.choose({ panels: value }),
  });
  picker(ctx, kind, {
    key: "kind",
    label: labels.kind,
    value: form.kind,
    options: (["", "hack", "drop"] as const).map((value) => ({ value, label: s.stats.kind[value] })),
    onPick: (value) => store.choose({ kind: value }),
  });
  picker(ctx, alignment, {
    key: "alignment",
    label: labels.alignment,
    value: form.alignment,
    options: (["", "same_faction", "enemy", "machina"] as const).map((value) => ({ value, label: s.stats.alignmentChoice[value] })),
    onPick: (value) => store.choose({ alignment: value }),
  });
  const filtersButton = {
    key: "filters",
    label: labels.filters,
    on: statistics.filtersOpen,
    caret: statistics.filtersOpen ? ("up" as const) : ("down" as const),
    hint: s.stats.filtersHint,
  };
  if (actionButton(ctx, filtersButton, filters)) store.toggleFilters();
  if (actionButton(ctx, { key: "about", label: s.stats.about, hint: s.stats.aboutHint }, about)) store.setGuideOpen(true);
  if (actionButton(ctx, { key: "tsv", label: s.stats.tsv, disabled: !ok, hint: s.stats.tsvHint }, tsv)) store.downloadTsv();
  ctx.place({ w: 0, h: 2 });
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

function activeRanges(form: StatsForm): number {
  return RANGES.filter(([, from, to]) => form[from].trim() !== "" || form[to].trim() !== "").length;
}

function filterPanel(ctx: Context, store: Store, s: Messages): void {
  const { colors: c } = useTheme(ctx);
  const { form } = store.state.statistics;
  const top = ctx.cursor.y;
  const cellW = 160;
  const perRow = Math.max(1, Math.floor((ctx.bounds.w - 8) / cellW));
  const smallH = lineHeight(ctx, FONT.small);
  const fieldH = lineHeight(ctx, FONT.mixed) + 4;
  const rowH = smallH + 2 + fieldH;
  ctx.column({ gap: 4 }, (panel) => {
    panel.inset(4, 4, 4, 4);
    for (let i = 0; i < RANGES.length; i += perRow) {
      panel.row({ gap: 8, h: rowH }, (row) => {
        for (const [name, from, to, kind] of RANGES.slice(i, i + perRow)) {
          const label = s.stats.ranges[name];
          row.allocate({ w: cellW - 8, h: rowH }, (cell) => {
            cell.text(label, 0, 0, { color: c.muted, font: FONT.small });
            const w = kind === "date" ? 66 : 30;
            const keep = kind === "date" ? (text: string) => text.replace(/[^0-9-]/g, "") : (text: string) => text.replace(/\D/g, "");
            for (const [index, field] of [from, to].entries()) {
              const rect = { x: index * (w + 10), y: smallH + 2, w, h: fieldH };
              const fieldLabel = index === 0 ? s.a11y.filterFrom(label) : s.a11y.filterTo(label);
              const result = textField(
                cell,
                {
                  key: `filter:${field}`,
                  value: form[field],
                  font: FONT.mixed,
                  filter: keep,
                  placeholder: kind === "date" ? s.stats.datePlaceholder : "",
                  hint: fieldLabel,
                },
                rect,
              );
              if (result.it.focused) announceField(fieldLabel);
              if (result.changed || result.committed !== null) store.setFormField(field, result.committed ?? result.text);
              if (index === 0) cell.text("–", rect.x + w + 3, rect.y + 2, { color: c.muted, font: FONT.mixed });
            }
          });
        }
      });
    }
    panel.row({ gap: 6, h: buttonHeight(panel) }, (row) => {
      if (actionButton(row, { key: "filters:apply", label: s.stats.apply, on: true })) store.applyFilters();
      if (actionButton(row, { key: "filters:clear", label: s.stats.clear })) store.clearFilters();
    });
  });
  ctx.strokeRect({ x: ctx.bounds.x, y: top, w: ctx.bounds.w, h: ctx.cursor.y - top + 2 }, c.border);
  ctx.place({ w: 0, h: 6 });
}

function dashboard(ctx: Context, store: Store, s: Messages, statistics: Statistics): void {
  headline(ctx, s, statistics);
  compare(ctx, store, s, statistics);
  levelGrid(ctx, store, s, statistics);
  gives(ctx, s, statistics);
  itemTable(ctx, store, s, statistics);
  sample(ctx, store, s, statistics);
  paragraph(
    ctx,
    s.stats.caption(
      statistics.records.byKind.hack,
      statistics.records.byKind.drop,
      s.panels[statistics.items.panels],
      store.state.statistics.loading,
    ),
    { color: useTheme(ctx).colors.slate, font: FONT.small },
  );
}

/** The headline numbers, each with its caveat beside it; a share from few observations is dimmed and says so. */
function headline(ctx: Context, s: Messages, statistics: Statistics): void {
  const { colors: c } = useTheme(ctx);
  const { selection, records, summary, items } = statistics;
  const h = s.stats.headline;
  const cells: [string, string, string, boolean][] = [
    [h.records, String(records.total), h.recordsNote(selection.uploads, sum(selection.unplaced)), false],
    [h.eligible, h.eligibleValue(summary.eligible, records.total), h.eligibleNote(s.panels[items.panels]), false],
    [h.perObservation, averageText(summary.averagePerObservation), h.perObservationNote(summary.eligible), isFew(summary.eligible)],
    [h.rare, percent(summary.rare), h.rareNote(summary.rare.known), isFew(summary.rare.known)],
    [h.key, percent(summary.key), h.keyNote(summary.key.known), isFew(summary.key.known)],
  ];
  const smallH = lineHeight(ctx, FONT.small);
  const valueH = lineHeight(ctx, FONT.mixed) * 2;
  const perRow = Math.max(1, Math.min(5, Math.floor(ctx.bounds.w / 128)));
  const cellW = Math.floor(ctx.bounds.w / perRow);
  for (let i = 0; i < cells.length; i += perRow) {
    // A caveat wraps rather than being cut off (larger CJK faces need it); a row is as tall as its longest.
    const row = cells.slice(i, i + perRow).map(([label, value, note, few]) => ({
      label,
      value,
      few,
      caveat: ctx.layoutText(wrapText(ctx, few ? `${note} · ${h.few}` : note, cellW - 8, FONT.small), {
        font: FONT.small,
        color: few ? c.muted : c.slate,
        width: cellW - 8,
        lineGap: 1,
      }),
    }));
    const cellH = 3 + smallH + 2 + valueH + 2 + Math.max(...row.map((cell) => cell.caveat.bounds.h)) + 3;
    const r = ctx.place({ w: ctx.bounds.w, h: cellH });
    row.forEach(({ label, value, few, caveat }, j) => {
      const x = r.x + j * cellW;
      ctx.strokeRect({ x, y: r.y, w: cellW, h: r.h }, c.line);
      ctx.text(label, x + 4, r.y + 3, { color: c.muted, font: FONT.small });
      ctx.text(value, x + 4, r.y + 3 + smallH + 2, { color: few ? c.muted : c.paper, font: FONT.mixed, scale: 2 });
      ctx.drawText(caveat, x + 4, r.y + 3 + smallH + 2 + valueH + 2);
    });
  }
  ctx.place({ w: 0, h: 6 });
}

/** A table drawn by `draw` at `width`, scrolling sideways in its own box when the screen is narrower. */
function wideTable(ctx: Context, key: string, width: number, height: number, draw: (table: Context) => void): void {
  if (width <= ctx.bounds.w) {
    draw(ctx);
  } else {
    const r = ctx.place({ w: ctx.bounds.w, h: height + 6 });
    scrollView(ctx, { key, axis: "x", content: { w: width, h: height } }, (content) => draw(content), r);
  }
}

/** The headline figures for each group of the chosen split. */
function compare(ctx: Context, store: Store, s: Messages, statistics: Statistics): void {
  const { colors: c } = useTheme(ctx);
  const t = s.stats.compare;
  const { form } = store.state.statistics;
  heading(ctx, t.heading);
  const label = t.splitChoice[form.split];
  const [rect] = wrapRow(ctx, [buttonWidth(ctx, label, true)], buttonHeight(ctx), 4);
  picker(ctx, rect, {
    key: "split",
    label,
    value: form.split,
    options: SPLITS.map((value) => ({ value, label: t.splitChoice[value] })),
    onPick: (split) => store.choose({ split }),
  });
  ctx.place({ w: 0, h: 4 });
  const { groups, split } = statistics;
  if (groups.length === 0) {
    paragraph(ctx, t.empty, { color: c.muted });
    ctx.place({ w: 0, h: 6 });
    return;
  }

  const fit = (text: string, min: number) => Math.max(min, ctx.measureText(text, { font: FONT.small }) + 10);
  const labels = groups.map((group) => groupLabel(s, split, group.key));
  const nameW = Math.max(72, ...labels.map((name) => ctx.measureText(name, { font: FONT.mixed }) + 10));
  const columns = [t.columns.records, t.columns.eligible, t.columns.perObservation, t.columns.rare, t.columns.key].map((name) => ({ name, w: fit(name, 44) }));
  const width = nameW + columns.reduce((total, col) => total + col.w, 0);
  const smallH = lineHeight(ctx, FONT.small);
  const rowH = lineHeight(ctx, FONT.mixed) + 5;
  const headH = smallH + 6;
  const height = headH + groups.length * rowH + 1;
  wideTable(ctx, "compare:scroll", width, height, (table) => {
    const origin = table.place({ w: width, h: height });
    table.fillRect({ x: origin.x, y: origin.y, w: width, h: headH }, c.panel);
    let x = origin.x + nameW;
    for (const col of columns) {
      table.text(col.name, x + 3, origin.y + 3, { color: c.ash, font: FONT.small });
      x += col.w;
    }
    table.hline(origin.x, origin.y + headH - 1, width, c.border);
    groups.forEach((group, index) => {
      const { summary } = group;
      const y = origin.y + headH + index * rowH;
      const ink = isFew(summary.eligible) ? c.dim : c.text;
      table.fillRect({ x: origin.x, y, w: width, h: rowH }, index % 2 === 0 ? c.panel : c.bg);
      table.text(labels[index], origin.x + 3, y + 3, { color: isFew(summary.eligible) ? c.dim : c.paper, font: FONT.mixed });
      const values = [String(summary.records), String(summary.eligible), averageText(summary.averagePerObservation), percent(summary.rare), percent(summary.key)];
      let cx = origin.x + nameW;
      values.forEach((value, column) => {
        table.text(value, cx + 3, y + 3, { color: ink, font: FONT.mixed });
        cx += columns[column].w;
      });
      table.hline(origin.x, y + rowH - 1, width, c.line);
    });
    table.strokeRect({ x: origin.x, y: origin.y, w: width, h: height }, c.border);
  });
  ctx.place({ w: 0, h: 3 });
  const notes = [t.notes[split], ...(groups.some((group) => isFew(group.summary.eligible)) ? [t.few(SMALL_SAMPLE)] : [])];
  for (const note of notes) paragraph(ctx, note, { color: c.slate, font: FONT.small });
  ctx.place({ w: 0, h: 6 });
}

/** Item levels by trusted portal level, as shares of each row, for every record or one comparison group. */
function levelGrid(ctx: Context, store: Store, s: Messages, statistics: Statistics): void {
  const { colors: c } = useTheme(ctx);
  const t = s.stats.levels;
  heading(ctx, t.heading);
  const { groups, split } = statistics;
  const { gridGroup } = store.state.statistics;
  const selected = groups.find((group) => group.key === gridGroup) ?? null;
  // Split by portal level, each group would be a single row: the grid of every record says the same.
  if (split !== "portalLevel" && groups.length > 1) {
    const tabs: { key: string | null; label: string }[] = [
      { key: null, label: t.all },
      ...groups.map((group) => ({ key: group.key, label: groupLabel(s, split, group.key) })),
    ];
    const rects = wrapRow(ctx, tabs.map((tab) => buttonWidth(ctx, tab.label)), buttonHeight(ctx), 4);
    tabs.forEach((tab, index) => {
      const on = (selected?.key ?? null) === tab.key;
      if (actionButton(ctx, { key: `grid:${tab.key ?? "all"}`, label: tab.label, on }, rects[index])) store.setGridGroup(tab.key);
    });
    ctx.place({ w: 0, h: 4 });
  }
  const summary = selected?.summary ?? statistics.summary;
  const rows = summary.portalLevels
    .map((observations, index) => ({ level: index + 1, observations, shares: levelShares(summary.levelGrid[index]) }))
    .filter((row) => row.observations > 0);
  if (rows.length === 0) {
    paragraph(ctx, t.empty, { color: c.muted });
    ctx.place({ w: 0, h: 6 });
    return;
  }
  const maxShare = Math.max(...rows.flatMap((row) => row.shares ?? []));
  const labelW = Math.max(...rows.map((row) => ctx.measureText(t.row(row.level, row.observations), { font: FONT.small }) + 8));
  const cellW = 26;
  const smallH = lineHeight(ctx, FONT.small);
  const mixedH = lineHeight(ctx, FONT.mixed);
  const headH = smallH + 6;
  const rowH = mixedH + 6;
  const width = labelW + cellW * 8;
  const height = headH + rows.length * rowH + 1;
  wideTable(ctx, "levels:scroll", width, height, (table) => {
    const origin = table.place({ w: width, h: height });
    table.fillRect({ x: origin.x, y: origin.y, w: width, h: headH }, c.panel);
    for (let level = 1; level <= 8; level++) {
      table.text(`L${level}`, origin.x + labelW + (level - 1) * cellW + 3, origin.y + 3, { color: c.ash, font: FONT.small });
    }
    rows.forEach((row, index) => {
      const y = origin.y + headH + index * rowH;
      table.text(t.row(row.level, row.observations), origin.x + 3, y + Math.floor((rowH - smallH) / 2), {
        color: isFew(row.observations) ? c.dim : c.muted,
        font: FONT.small,
      });
      for (let level = 0; level < 8; level++) {
        const share = row.shares?.[level] ?? 0;
        const cell = { x: origin.x + labelW + level * cellW, y, w: cellW - 1, h: rowH - 1 };
        const fill = shadeFill(shade(share, maxShare));
        if (fill !== null) table.fillRect(cell, fill);
        const text = share === 0 ? "·" : String(Math.round(share * 100));
        table.text(text, cell.x + 3, y + 3, { color: fill !== null ? inkOn(fill) : c.dim, font: FONT.mixed });
      }
      table.hline(origin.x, y + rowH - 1, width, c.line);
    });
    table.strokeRect({ x: origin.x, y: origin.y, w: width, h: height }, c.border);
  });
  ctx.place({ w: 0, h: 3 });
  paragraph(ctx, t.note, { color: c.slate, font: FONT.small });
  ctx.place({ w: 0, h: 6 });
}

/** Average quantity per eligible observation for each kind of item, as bars. */
function gives(ctx: Context, s: Messages, statistics: Statistics): void {
  const { colors: c } = useTheme(ctx);
  const t = s.stats.gives;
  const { summary, items } = statistics;
  const bars = barTotals(items.byItem, summary.eligible);
  if (bars.length === 0) return;
  heading(ctx, t.heading);
  const labels = bars.map(({ bar }) => barLabel(s, bar));
  const labelW = Math.max(...labels.map((label) => ctx.measureText(label, { font: FONT.mixed }) + 8));
  const valueW = 34;
  const barW = Math.max(24, ctx.bounds.w - labelW - valueW);
  const max = Math.max(...bars.map((bar) => bar.perObservation));
  const rowH = lineHeight(ctx, FONT.mixed) + 4;
  bars.forEach(({ perObservation }, index) => {
    const r = ctx.place({ w: ctx.bounds.w, h: rowH });
    ctx.text(labels[index], r.x, r.y + 2, { color: c.text, font: FONT.mixed });
    const w = max === 0 ? 0 : Math.round((perObservation / max) * barW);
    const fill = shadeFill(shade(perObservation, max));
    if (fill !== null && w > 0) ctx.fillRect({ x: r.x + labelW, y: r.y + 2, w, h: rowH - 4 }, fill);
    ctx.text(perObservation.toFixed(2), r.x + labelW + w + 4, r.y + 2, { color: perObservation === 0 ? c.dim : c.paper, font: FONT.mixed });
  });
  ctx.place({ w: 0, h: 3 });
  paragraph(ctx, t.note(summary.eligible), { color: c.slate, font: FONT.small });
  ctx.place({ w: 0, h: 6 });
}

/** Coverage, exclusions, unplaced records and app builds: collapsed until asked for. */
function sample(ctx: Context, store: Store, s: Messages, statistics: Statistics): void {
  const { colors: c } = useTheme(ctx);
  const { sampleOpen } = store.state.statistics;
  const t = s.stats.sample;
  const toggleButton = {
    key: "sample",
    label: t.heading,
    hint: t.hint,
    caret: sampleOpen ? ("up" as const) : ("down" as const),
  };
  if (actionButton(ctx, toggleButton)) store.toggleSample();
  ctx.place({ w: 0, h: 4 });
  if (!sampleOpen) return;

  const { selection, records, items } = statistics;
  const apps = Object.fromEntries(records.byApp.map((app, index) => [String(index), app.records]));
  const appLabels = Object.fromEntries(
    records.byApp.map((app, index) => [String(index), t.app(app.version ?? t.appUnknown, app.build ?? t.appUnknown)]),
  );
  const lists: [string, Record<string, number>, Record<string, string>, number][] = [
    [s.stats.breakdowns.coverage, records.byCoverage, s.coverage, records.total],
    [s.stats.breakdowns.leftOut, items.excluded, s.exclusions, sum(items.excluded)],
    [s.stats.breakdowns.unplaced, selection.unplaced, s.unplaced, sum(selection.unplaced)],
    [t.apps, apps, appLabels, records.total],
  ];
  const columns = ctx.bounds.w >= 480 ? 2 : 1;
  const listW = Math.floor((ctx.bounds.w - (columns - 1) * 8) / columns);
  for (let i = 0; i < lists.length; i += columns) {
    ctx.row({ gap: 8 }, (row) => {
      for (const [title, counts, labels, total] of lists.slice(i, i + columns)) {
        row.column({ w: listW, gap: 2 }, (col) => {
          heading(col, title, String(total));
          const shown = Object.keys(labels).filter((key) => counts[key] > 0);
          if (shown.length === 0) paragraph(col, s.stats.none, { color: c.muted });
          for (const key of shown) {
            const text = col.layoutText(wrapText(col, labels[key], listW - 30, FONT.mixed), { font: FONT.mixed, color: c.text, width: listW - 30, lineGap: 2 });
            const r = col.place({ w: listW, h: text.bounds.h });
            const count = String(counts[key]);
            col.text(count, r.x + 24 - col.measureText(count, { font: FONT.mixed }), r.y, { color: c.paper, font: FONT.mixed });
            col.drawText(text, r.x + 30, r.y);
          }
        });
      }
    });
    ctx.place({ w: 0, h: 6 });
  }
  paragraph(ctx, t.gaps, { color: c.slate, font: FONT.small });
  ctx.place({ w: 0, h: 6 });
}

interface Column {
  key: SortKey;
  label: string;
  w: number;
}

function itemTable(ctx: Context, store: Store, s: Messages, statistics: Statistics): void {
  const { colors: c } = useTheme(ctx);
  const { items } = statistics;
  const { search, sort } = store.state.statistics;
  const t = s.stats.table;
  const fit = (label: string, min: number) => Math.max(min, ctx.measureText(label, { font: FONT.small }) + 12);
  const perObservation = t.perObservation(items.eligible);
  const columns: Column[] = [
    { key: "item", label: t.item, w: 132 },
    { key: "quantity", label: t.quantity, w: fit(t.quantity, 36) },
    { key: "averagePerObservation", label: perObservation, w: fit(perObservation, 58) },
    { key: "chance", label: t.chance, w: fit(t.chance, 40) },
    { key: "whenPresent", label: t.whenPresent, w: fit(t.whenPresent, 40) },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((level) => ({ key: `L${level}` as SortKey, label: `L${level}`, w: 24 })),
    { key: "multiplied", label: t.multiplied, w: fit(t.multiplied, 36) },
    { key: "multipliedUnknown", label: t.colourUnread, w: fit(t.colourUnread, 44) },
  ];
  const width = columns.reduce((total, col) => total + col.w, 0);
  const rows = sortItems(
    items.byItem.filter((row) => matchesSearch(row.item, search, s.stats.categories)),
    sort,
  );
  const smallH = lineHeight(ctx, FONT.small);
  const mixedH = lineHeight(ctx, FONT.mixed);
  const headH = smallH + 8;
  const rowH = 2 + mixedH + 2 + smallH + 4;
  const height = headH + Math.max(rows.length, 1) * rowH + 1;
  const max = columnMaxima(items.byItem);

  const draw = (table: Context) => {
    const origin = table.place({ w: width, h: height });
    let x = origin.x;
    for (const col of columns) {
      const head = { x, y: origin.y, w: col.w, h: headH };
      const active = sort.key === col.key;
      const { it, activated } = pressable(table, head, {
        key: `sort:${col.key}`,
        label: s.a11y.sortBy(col.label, active ? (sort.descending ? "descending" : "ascending") : null),
      });
      if (activated) store.sortBy(col.key);
      table.fillRect(head, it.hovered || it.focused ? c.raised : c.panel);
      table.text(col.label, head.x + 3, head.y + 4, { color: active ? c.accent : c.ash, font: FONT.small });
      const arrow = active ? (sort.descending ? "▼" : "▲") : "";
      if (arrow) table.text(arrow, head.x + col.w - 7, head.y + 3, { color: c.accent, font: FONT.mixed });
      if (it.focused) drawFocusRing(table, head);
      x += col.w;
    }
    table.hline(origin.x, origin.y + headH - 1, width, c.border);

    rows.forEach((row, index) => {
      const y = origin.y + headH + index * rowH;
      table.fillRect({ x: origin.x, y, w: width, h: rowH }, index % 2 === 0 ? c.panel : c.bg);
      let cx = origin.x;
      for (const col of columns) {
        drawCell(table, { x: cx, y, w: col.w, h: rowH }, col, row, max, items.eligible, store, s);
        cx += col.w;
      }
      table.hline(origin.x, y + rowH - 1, width, c.line);
    });
    if (rows.length === 0) {
      const message = items.byItem.length === 0 ? t.noEligible : t.noMatch;
      table.text(message, origin.x + 4, origin.y + headH + 4, { color: c.muted, font: FONT.mixed });
    }
    let gx = origin.x;
    for (const col of columns.slice(0, -1)) {
      gx += col.w;
      table.vline(gx - 1, origin.y, height, c.line);
    }
    table.strokeRect({ x: origin.x, y: origin.y, w: width, h: height }, c.border);
  };

  wideTable(ctx, "items:scroll", width, height, draw);
  ctx.place({ w: 0, h: 6 });
}

function drawCell(
  ctx: Context,
  rect: Rect,
  col: Column,
  row: ItemTotal,
  max: ReturnType<typeof columnMaxima>,
  eligible: number,
  store: Store,
  s: Messages,
): void {
  const { colors: c } = useTheme(ctx);
  const mixedH = lineHeight(ctx, FONT.mixed);
  if (col.key === "item") {
    ctx.text(row.item, rect.x + 3, rect.y + 2, { color: c.paper, font: FONT.mixed });
    const category = itemCategory(row.item);
    if (category) {
      const label = s.stats.categories[category];
      const tag = {
        x: rect.x + 3,
        y: rect.y + 2 + mixedH + 2,
        w: ctx.measureText(label, { font: FONT.small }) + 4,
        h: lineHeight(ctx, FONT.small) + 1,
      };
      const name = s.a11y.showCategory(label);
      const { it, activated } = pressable(ctx, tag, { key: `tag:${row.item}`, label: name, hint: name });
      if (activated) store.setSearch(label);
      ctx.fillRect(tag, it.hovered || it.focused ? c.accent : c.control);
      ctx.text(label, tag.x + 2, tag.y + 1, { color: it.hovered || it.focused ? c.void : c.muted, font: FONT.small });
    }
    return;
  }
  let value: number | null;
  let text: string;
  let step = 0;
  if (col.key === "quantity") {
    value = row.quantity;
    text = String(value);
    step = shade(value, max.quantity);
  } else if (col.key === "averagePerObservation") {
    value = row.averagePerObservation;
    text = value.toFixed(2);
    step = shade(value, max.average);
  } else if (col.key === "chance") {
    value = chance(row, eligible);
    text = value === null ? "—" : `${Math.round(value * 100)}%`;
    step = shade(row.observations, max.observations);
  } else if (col.key === "whenPresent") {
    value = whenPresent(row);
    text = averageText(value);
    step = value === null ? 0 : shade(value, max.whenPresent);
  } else if (col.key.startsWith("L")) {
    value = row.levels?.[Number(col.key.slice(1)) - 1] ?? null;
    text = value === null ? "—" : String(value);
    step = value === null ? 0 : shade(value, max.level);
  } else {
    value = col.key === "multiplied" ? row.multiplied : row.multipliedUnknown;
    text = String(value);
  }
  const fill = shadeFill(step);
  if (fill !== null) ctx.fillRect({ x: rect.x, y: rect.y, w: rect.w - 1, h: rect.h - 1 }, fill);
  const ink = fill !== null ? inkOn(fill) : value === null || value === 0 ? c.dim : c.text;
  ctx.text(text, rect.x + 3, rect.y + Math.floor((rect.h - mixedH) / 2), { color: ink, font: FONT.mixed });
}
