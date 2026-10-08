import type { Context, Rect } from "@synth-ui/core";
import { menu, scrollView, textField, useTheme } from "@synth-ui/widgets";
import type { ItemTotal, Statistics } from "../../domain/statistics.ts";
import { COVERAGE_LABELS, EXCLUSION_LABELS, PANEL_LABELS, UNPLACED_LABELS } from "../copy.ts";
import type { Store } from "../app/store.ts";
import { columnMaxima, shade, sortItems, type SortKey } from "../itemTable.ts";
import { itemCategory, matchesSearch } from "../items.ts";
import type { StatsForm } from "../statsForm.ts";
import { COLORS, FONT, inkOn, shadeFill } from "./theme.ts";
import {
  actionButton,
  BUTTON_H,
  buttonWidth,
  drawFocusRing,
  errorLine,
  focus,
  heading,
  paragraph,
  pressable,
  wrapRow,
} from "./ui.ts";

const KIND_LABELS = { "": "hacks and drops", hack: "hacks only", drop: "drops only" } as const;

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);
const average = (value: number | null) => (value === null ? "—" : value.toFixed(2));

export function drawStatistics(ctx: Context, store: Store): void {
  const { statistics } = store.state;
  toolbar(ctx, store);
  if (statistics.filtersOpen) filterPanel(ctx, store);
  const { outcome } = statistics;
  if (outcome === null) {
    paragraph(ctx, "Loading…", { color: COLORS.muted });
    return;
  }
  if (outcome.kind === "refused") errorLine(ctx, outcome.issues.map((issue) => issue.message).join(" "));
  if (outcome.kind === "failed") errorLine(ctx, `Couldn't load statistics: ${outcome.message}`);
  if (outcome.kind === "ok") dashboard(ctx, store, outcome.statistics);
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
    items: opts.options.map((option) => ({ label: option.label.toUpperCase() })),
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

function toolbar(ctx: Context, store: Store): void {
  const { statistics } = store.state;
  const { form } = statistics;
  const ok = statistics.outcome?.kind === "ok";
  const labels = {
    panels: `ITEMS: ${PANEL_LABELS[form.panels].replace(" panels", "").replace(" panel", "").toUpperCase()}`,
    kind: KIND_LABELS[form.kind].toUpperCase(),
    filters: `FILTERS${activeRanges(form) > 0 ? ` (${activeRanges(form)})` : ""}`,
  };
  const widths = [
    140,
    buttonWidth(ctx, labels.panels, true),
    buttonWidth(ctx, labels.kind, true),
    buttonWidth(ctx, labels.filters, true),
    buttonWidth(ctx, "ABOUT"),
    buttonWidth(ctx, "TSV"),
  ];
  const [search, panels, kind, filters, about, tsv] = wrapRow(ctx, widths, BUTTON_H, 4);
  const field = textField(
    ctx,
    { key: "search", value: statistics.search, placeholder: "SEARCH OR CLICK A TAG", font: FONT.mixed, hint: "Search items by name, or type levelled, mod or other" },
    search,
  );
  if (field.it.focused) focus.next = "Search items, text field";
  if (field.changed) store.setSearch(field.text);

  picker(ctx, panels, {
    key: "panels",
    label: labels.panels,
    value: form.panels,
    options: [
      { value: "portal", label: "items: portal panel" },
      { value: "bonus", label: "items: bonus panel" },
      { value: "both", label: "items: both panels" },
    ],
    onPick: (value) => store.choose({ panels: value }),
  });
  picker(ctx, kind, {
    key: "kind",
    label: labels.kind,
    value: form.kind,
    options: (["", "hack", "drop"] as const).map((value) => ({ value, label: KIND_LABELS[value] })),
    onPick: (value) => store.choose({ kind: value }),
  });
  const filtersButton = {
    key: "filters",
    label: labels.filters,
    on: statistics.filtersOpen,
    caret: statistics.filtersOpen ? ("up" as const) : ("down" as const),
    hint: "Dates, hours, level and bonus filters (F3)",
  };
  if (actionButton(ctx, filtersButton, filters)) {
    store.toggleFilters();
  }
  if (actionButton(ctx, { key: "about", label: "ABOUT", hint: "How to read these numbers (F4)" }, about)) store.setGuideOpen(true);
  if (actionButton(ctx, { key: "tsv", label: "TSV", disabled: !ok, hint: "Download the item table as tab-separated values" }, tsv)) {
    store.downloadTsv();
  }
  ctx.place({ w: 0, h: 2 });
}

const RANGES = [
  ["UTC DATES", "utcFrom", "utcTo", "date"],
  ["LOCAL DATES (NEEDS AN OFFSET)", "localDateFrom", "localDateTo", "date"],
  ["LOCAL HOURS (NEEDS AN OFFSET)", "localHourFrom", "localHourTo", "number"],
  ["PORTAL LEVEL", "portalLevelMin", "portalLevelMax", "number"],
  ["HACKING BONUS % (FINAL ONLY)", "hackingBonusMin", "hackingBonusMax", "number"],
  ["SPEED BONUS % (FINAL ONLY)", "speedBonusMin", "speedBonusMax", "number"],
] as const satisfies readonly (readonly [string, keyof StatsForm, keyof StatsForm, "date" | "number"])[];

function activeRanges(form: StatsForm): number {
  return RANGES.filter(([, from, to]) => form[from].trim() !== "" || form[to].trim() !== "").length;
}

function filterPanel(ctx: Context, store: Store): void {
  const { colors: c } = useTheme(ctx);
  const { form } = store.state.statistics;
  const top = ctx.cursor.y;
  const cellW = 150;
  const perRow = Math.max(1, Math.floor((ctx.bounds.w - 8) / cellW));
  ctx.column({ gap: 4 }, (panel) => {
    panel.inset(4, 4, 4, 4);
    for (let i = 0; i < RANGES.length; i += perRow) {
      panel.row({ gap: 8, h: 20 }, (row) => {
        for (const [label, from, to, kind] of RANGES.slice(i, i + perRow)) {
          row.allocate({ w: cellW - 8, h: 20 }, (cell) => {
            cell.text(label, 0, 0, { color: c.muted, font: FONT.small });
            const w = kind === "date" ? 64 : 30;
            const keep = kind === "date" ? (text: string) => text.replace(/[^0-9-]/g, "") : (text: string) => text.replace(/\D/g, "");
            for (const [index, name] of [from, to].entries()) {
              const rect = { x: index * (w + 10), y: 8, w, h: 11 };
              const field = textField(cell, { key: `filter:${name}`, value: form[name], font: FONT.mixed, filter: keep, placeholder: kind === "date" ? "YYYY-MM-DD" : "", hint: `${label} ${index === 0 ? "from" : "to"}` }, rect);
              if (field.it.focused) focus.next = `${label.toLowerCase()} ${index === 0 ? "from" : "to"}, text field`;
              if (field.changed || field.committed !== null) store.setFormField(name, field.committed ?? field.text);
              if (index === 0) cell.text("–", rect.x + w + 3, 10, { color: c.muted, font: FONT.mixed });
            }
          });
        }
      });
    }
    panel.row({ gap: 6, h: BUTTON_H }, (row) => {
      if (actionButton(row, { key: "filters:apply", label: "APPLY", on: true })) store.applyFilters();
      if (actionButton(row, { key: "filters:clear", label: "CLEAR" })) store.clearFilters();
    });
  });
  ctx.strokeRect({ x: ctx.bounds.x, y: top, w: ctx.bounds.w, h: ctx.cursor.y - top + 2 }, c.border);
  ctx.place({ w: 0, h: 6 });
}

function dashboard(ctx: Context, store: Store, statistics: Statistics): void {
  const { colors: c } = useTheme(ctx);
  const { selection, records, items } = statistics;
  const excluded = sum(items.excluded);
  const unplaced = sum(selection.unplaced);

  // Headline numbers, each with its caveat beside it.
  const cells: [string, string, string][] = [
    ["RECORDS", String(records.total), unplaced > 0 ? `EACH COUNTED ONCE · ${unplaced} UNPLACED` : "EACH COUNTED ONCE"],
    ["ELIGIBLE", `${items.eligible} of ${records.total}`, `${PANEL_LABELS[items.panels].toUpperCase()} READ IN FULL`],
    ["LEFT OUT", String(excluded), "UNKNOWN, NEVER ZERO"],
    ["ITEMS", String(items.totalQuantity), "FROM ELIGIBLE OBSERVATIONS"],
    ["PER OBSERVATION", average(items.averagePerObservation), `ITEMS / ${items.eligible} ELIGIBLE`],
  ];
  const perRow = Math.max(1, Math.min(5, Math.floor(ctx.bounds.w / 128)));
  const cellW = Math.floor(ctx.bounds.w / perRow);
  for (let i = 0; i < cells.length; i += perRow) {
    const r = ctx.place({ w: ctx.bounds.w, h: 33 });
    cells.slice(i, i + perRow).forEach(([label, value, note], j) => {
      const x = r.x + j * cellW;
      ctx.strokeRect({ x, y: r.y, w: cellW, h: r.h }, c.line);
      ctx.text(label, x + 4, r.y + 3, { color: c.muted, font: FONT.small });
      ctx.text(value, x + 4, r.y + 11, { color: c.paper, font: FONT.mixed, scale: 2 });
      const caveat = ctx.layoutText(note, { font: FONT.small, color: c.slate, width: cellW - 8, overflow: "clip" });
      ctx.drawText(caveat, x + 4, r.y + 27);
    });
  }
  ctx.place({ w: 0, h: 4 });

  itemTable(ctx, store, statistics);

  // Coverage, exclusions and unplaced records, as counts beside labels.
  const lists: [string, Record<string, number>, Record<string, string>, number][] = [
    ["COVERAGE", records.byCoverage, COVERAGE_LABELS, records.total],
    ["LEFT OUT OF ITEM COUNTS", items.excluded, EXCLUSION_LABELS, excluded],
    ["COULDN'T BE PLACED", selection.unplaced, UNPLACED_LABELS, unplaced],
  ];
  const columns = ctx.bounds.w >= 480 ? 3 : 1;
  const listW = Math.floor((ctx.bounds.w - (columns - 1) * 8) / columns);
  for (let i = 0; i < lists.length; i += columns) {
    ctx.row({ gap: 8 }, (row) => {
      for (const [title, counts, labels, total] of lists.slice(i, i + columns)) {
        row.column({ w: listW, gap: 2 }, (col) => {
          heading(col, title, String(total));
          const shown = Object.keys(labels).filter((key) => counts[key] > 0);
          if (shown.length === 0) paragraph(col, "none", { color: c.muted });
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
    `${records.byKind.hack} hacks · ${records.byKind.drop} drop groups · items from the ${PANEL_LABELS[items.panels]}${store.state.statistics.loading ? " · updating…" : ""}`,
    { color: c.slate, font: FONT.small },
  );
}

interface Column {
  key: SortKey;
  label: string;
  w: number;
}

const ROW_H = 19;
const HEAD_H = 13;

function itemTable(ctx: Context, store: Store, statistics: Statistics): void {
  const { colors: c } = useTheme(ctx);
  const { items } = statistics;
  const { search, sort } = store.state.statistics;
  const columns: Column[] = [
    { key: "item", label: "ITEM", w: 132 },
    { key: "quantity", label: "QTY", w: 36 },
    { key: "averagePerObservation", label: `PER OBS n=${items.eligible}`, w: 58 },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((level) => ({ key: `L${level}` as SortKey, label: `L${level}`, w: 24 })),
    { key: "multiplied", label: "MULT.", w: 36 },
    { key: "multipliedUnknown", label: "COLOUR ?", w: 44 },
  ];
  const width = columns.reduce((total, col) => total + col.w, 0);
  const rows = sortItems(
    items.byItem.filter((row) => matchesSearch(row.item, search)),
    sort,
  );
  const height = HEAD_H + Math.max(rows.length, 1) * ROW_H + 1;
  const max = columnMaxima(items.byItem);

  const draw = (table: Context) => {
    const origin = table.place({ w: width, h: height });
    let x = origin.x;
    for (const col of columns) {
      const head = { x, y: origin.y, w: col.w, h: HEAD_H };
      const active = sort.key === col.key;
      const { it, activated } = pressable(table, head, {
        key: `sort:${col.key}`,
        label: `Sort by ${col.label}${active ? (sort.descending ? ", descending" : ", ascending") : ""}`,
      });
      if (activated) store.sortBy(col.key);
      table.fillRect(head, it.hovered || it.focused ? c.raised : c.panel);
      table.text(col.label, head.x + 3, head.y + 4, { color: active ? c.accent : c.ash, font: FONT.small });
      const arrow = active ? (sort.descending ? "▼" : "▲") : "";
      if (arrow) table.text(arrow, head.x + col.w - 7, head.y + 3, { color: c.accent, font: FONT.mixed });
      if (it.focused) drawFocusRing(table, head);
      x += col.w;
    }
    table.hline(origin.x, origin.y + HEAD_H - 1, width, c.border);

    rows.forEach((row, index) => {
      const y = origin.y + HEAD_H + index * ROW_H;
      table.fillRect({ x: origin.x, y, w: width, h: ROW_H }, index % 2 === 0 ? c.panel : c.bg);
      let cx = origin.x;
      for (const col of columns) {
        drawCell(table, { x: cx, y, w: col.w, h: ROW_H }, col, row, max, store);
        cx += col.w;
      }
      table.hline(origin.x, y + ROW_H - 1, width, c.line);
    });
    if (rows.length === 0) {
      const message = items.byItem.length === 0 ? "No eligible observations match these filters." : "No item matches the search.";
      table.text(message, origin.x + 4, origin.y + HEAD_H + 6, { color: c.muted, font: FONT.mixed });
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
): void {
  const { colors: c } = useTheme(ctx);
  if (col.key === "item") {
    ctx.text(row.item, rect.x + 3, rect.y + 2, { color: c.paper, font: FONT.mixed });
    const category = itemCategory(row.item);
    if (category) {
      const label = category.toUpperCase();
      const tag = { x: rect.x + 3, y: rect.y + 11, w: ctx.measureText(label, { font: FONT.small }) + 4, h: 7 };
      const { it, activated } = pressable(ctx, tag, { key: `tag:${row.item}`, label: `Show ${category} items`, hint: `Show ${category} items` });
      if (activated) store.setSearch(category);
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
  ctx.text(text, rect.x + 3, rect.y + 6, { color: ink, font: FONT.mixed });
}
