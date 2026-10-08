import type { Context, Rect } from "@synth-ui/core";
import { menu, scrollView, textField, useTheme } from "@synth-ui/widgets";
import type { ItemTotal, Statistics } from "../../domain/statistics.ts";
import type { Store } from "../app/store.ts";
import type { Messages } from "../i18n/en.ts";
import { issuesText, problemText } from "../i18n/index.ts";
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
} from "./ui.ts";

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);
const average = (value: number | null) => (value === null ? "—" : value.toFixed(2));

export function drawStatistics(ctx: Context, store: Store): void {
  const s = store.strings;
  const { statistics } = store.state;
  toolbar(ctx, store, s);
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
    filters: s.stats.filters(activeRanges(form)),
  };
  const widths = [
    140,
    buttonWidth(ctx, labels.panels, true),
    buttonWidth(ctx, labels.kind, true),
    buttonWidth(ctx, labels.filters, true),
    buttonWidth(ctx, s.stats.about),
    buttonWidth(ctx, s.stats.tsv),
  ];
  const [search, panels, kind, filters, about, tsv] = wrapRow(ctx, widths, buttonHeight(ctx), 4);
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
  const { colors: c } = useTheme(ctx);
  const { selection, records, items } = statistics;
  const excluded = sum(items.excluded);
  const unplaced = sum(selection.unplaced);
  const h = s.stats.headline;

  // Headline numbers, each with its caveat beside it.
  const cells: [string, string, string][] = [
    [h.records, String(records.total), h.recordsNote(unplaced)],
    [h.eligible, h.eligibleValue(items.eligible, records.total), h.eligibleNote(s.panels[items.panels])],
    [h.leftOut, String(excluded), h.leftOutNote],
    [h.items, String(items.totalQuantity), h.itemsNote],
    [h.perObservation, average(items.averagePerObservation), h.perObservationNote(items.eligible)],
  ];
  const smallH = lineHeight(ctx, FONT.small);
  const valueH = lineHeight(ctx, FONT.mixed) * 2;
  const cellH = 3 + smallH + 2 + valueH + 2 + smallH + 3;
  const perRow = Math.max(1, Math.min(5, Math.floor(ctx.bounds.w / 128)));
  const cellW = Math.floor(ctx.bounds.w / perRow);
  for (let i = 0; i < cells.length; i += perRow) {
    const r = ctx.place({ w: ctx.bounds.w, h: cellH });
    cells.slice(i, i + perRow).forEach(([label, value, note], j) => {
      const x = r.x + j * cellW;
      ctx.strokeRect({ x, y: r.y, w: cellW, h: r.h }, c.line);
      ctx.text(label, x + 4, r.y + 3, { color: c.muted, font: FONT.small });
      ctx.text(value, x + 4, r.y + 3 + smallH + 2, { color: c.paper, font: FONT.mixed, scale: 2 });
      const caveat = ctx.layoutText(note, { font: FONT.small, color: c.slate, width: cellW - 8, overflow: "clip" });
      ctx.drawText(caveat, x + 4, r.y + 3 + smallH + 2 + valueH + 2);
    });
  }
  ctx.place({ w: 0, h: 4 });

  itemTable(ctx, store, s, statistics);

  // Coverage, exclusions and unplaced records, as counts beside labels.
  const lists: [string, Record<string, number>, Record<string, string>, number][] = [
    [s.stats.breakdowns.coverage, records.byCoverage, s.coverage, records.total],
    [s.stats.breakdowns.leftOut, items.excluded, s.exclusions, excluded],
    [s.stats.breakdowns.unplaced, selection.unplaced, s.unplaced, unplaced],
  ];
  const columns = ctx.bounds.w >= 480 ? 3 : 1;
  const listW = Math.floor((ctx.bounds.w - (columns - 1) * 8) / columns);
  for (let i = 0; i < lists.length; i += columns) {
    ctx.row({ gap: 8 }, (row) => {
      for (const [title, counts, labels, total] of lists.slice(i, i + columns)) {
        row.column({ w: listW, gap: 2 }, (col) => {
          heading(col, title, String(total));
          const shown = Object.keys(labels).filter((key) => counts[key] > 0);
          if (shown.length === 0) paragraph(col, s.stats.none, { color: c.muted });
          for (const key of shown) {
            const text = col.layoutText(labels[key], { font: FONT.mixed, color: c.text, width: listW - 30, wrap: "word", lineGap: 2 });
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
  paragraph(
    ctx,
    s.stats.caption(records.byKind.hack, records.byKind.drop, s.panels[items.panels], store.state.statistics.loading),
    { color: c.slate, font: FONT.small },
  );
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
        drawCell(table, { x: cx, y, w: col.w, h: rowH }, col, row, max, store, s);
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

  if (width <= ctx.bounds.w) {
    draw(ctx);
  } else {
    // Wider than the screen: the table scrolls sideways in its own box.
    const r = ctx.place({ w: ctx.bounds.w, h: height + 6 });
    scrollView(ctx, { key: "items:scroll", axis: "x", content: { w: width, h: height } }, (content) => draw(content), r);
  }
  ctx.place({ w: 0, h: 6 });
}

function drawCell(
  ctx: Context,
  rect: Rect,
  col: Column,
  row: ItemTotal,
  max: ReturnType<typeof columnMaxima>,
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
