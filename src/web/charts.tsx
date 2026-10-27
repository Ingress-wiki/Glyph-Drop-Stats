import { useMemo } from "react";
import { barX, barY, cell, defineChart, dot, lineY, text } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import type { ChartTooltipRow } from "@tanstack/charts";
import { sharePercent } from "./dashboard.ts";
import { shade } from "./itemTable.ts";
import type { Paint } from "./paint.ts";

/** A shade step's fill, or none for nothing at all. */
const fillFor = (paint: Paint, step: number) => (step <= 0 ? "transparent" : paint.shades[Math.min(step, 5) - 1]);
const inkFor = (paint: Paint, step: number) => (step <= 0 ? paint.dim : paint.inkOn[Math.min(step, 5) - 1]);

export interface BarRow {
  label: string;
  value: number;
  /** Rests on so few observations that it is drawn dimmed. */
  few?: boolean;
  /** What the value is over, for the tooltip: "Items / 217 eligible". */
  basis?: string;
}

/** A tooltip line with no label of its own: a caveat under the figure. */
const note = (value: string): ChartTooltipRow => ({ label: "", value });

/**
 * Hover and keyboard focus outline the focused shape instead of drawing the
 * default ring, which would sit on top of its number.
 */
const outlined = (paint: Paint) => ({ stroke: paint.fg, strokeWidth: 2 });

/**
 * Horizontal bars, one per row in the given order, each labelled with its
 * value. Bars are shaded like the table cells: brighter for more.
 */
export function Bars({
  rows,
  paint,
  label,
  metric,
  fewNote,
  format,
  max,
}: {
  rows: readonly BarRow[];
  paint: Paint;
  label: string;
  /** The value's name in the tooltip. */
  metric: string;
  /** Said in the tooltip of a row resting on few observations. */
  fewNote?: string;
  format: (value: number) => string;
  /** The domain's end, when several charts must share one. */
  max?: number;
}) {
  const definition = useMemo(() => {
    const top = max ?? Math.max(0, ...rows.map((row) => row.value));
    return defineChart({
      marks: [
        barX(rows, {
          y: "label",
          x: "value",
          inset: 3,
          fill: (row) => (row.few ? paint.dim : fillFor(paint, Math.max(1, shade(row.value, top)))),
          // Whether the bar or its value label is nearest, the row's bar shows it.
          states: [{ when: { focus: "y" }, style: outlined(paint) }],
        }),
        text(rows, {
          y: "label",
          x: "value",
          text: (row) => format(row.value),
          anchor: "start",
          dx: 6,
          fontSize: paint.text,
          fill: (row) => (row.few ? paint.muted : paint.fg),
        }),
      ],
      scales: {
        y: {
          scale: () =>
            scaleBand<string>()
              .domain(rows.map((row) => row.label))
              .padding(0.08),
          axis: { ticks: { size: 0 }, tickLabels: { fontSize: paint.text }, line: false },
        },
        x: {
          // Room after the longest bar for its value.
          scale: () => scaleLinear().domain([0, top === 0 ? 1 : top * 1.18]),
          axis: false,
        },
      },
      // Anywhere along a row (its name, bar or value) focuses that row.
      focus: "nearest-y",
      focusRing: false,
      tooltip: {
        use: tooltip,
        content: (points) => {
          const row = points[0]?.datum;
          if (!row) return { rows: [] };
          const lines = [{ label: metric, value: format(row.value) }, ...(row.basis ? [note(row.basis)] : []), ...(row.few && fewNote ? [note(fewNote)] : [])];
          return { title: row.label, rows: lines };
        },
      },
    });
  }, [rows, paint, metric, fewNote, format, max]);
  return <Chart definition={definition} ariaLabel={label} height={Math.max(60, rows.length * Math.round(paint.text * 2) + 8)} initialWidth={480} />;
}

export interface GridCell {
  row: string;
  column: string;
  share: number;
  /** Levelled items at this item level, and in the whole row. */
  items: number;
  total: number;
  few: boolean;
}


/** Item level by portal level: each cell a row's share, shaded against the grid's largest share. */
export function LevelHeatmap({
  cells,
  rows,
  paint,
  label,
  describe,
}: {
  cells: readonly GridCell[];
  rows: readonly string[];
  paint: Paint;
  label: string;
  /** The tooltip's line for a cell: "L4: 54 of 200 levelled items (27%)". */
  describe: (cell: GridCell) => string;
}) {
  const definition = useMemo(() => {
    const max = Math.max(0, ...cells.map((c) => c.share));
    const columns = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
    return defineChart({
      marks: [
        cell(cells, {
          x: "column",
          y: "row",
          key: (c) => `${c.row}-${c.column}`,
          inset: 1,
          color: (c) => shade(c.share, max),
          states: [{ when: (context) => context.focus.primary.datum === context.datum, style: outlined(paint) }],
        }),
        text(cells, {
          x: "column",
          y: "row",
          key: (c) => `${c.row}-${c.column}:label`,
          text: (c) => (c.share === 0 ? "·" : sharePercent(c.share)),
          fontSize: paint.text,
          fill: (c) => (c.few && c.share === 0 ? paint.dim : inkFor(paint, shade(c.share, max))),
        }),
      ],
      // A cell's colour is its shade step, as in the item table: 0 is none.
      color: { domain: [0, 1, 2, 3, 4, 5], range: [0, 1, 2, 3, 4, 5].map((step) => fillFor(paint, step)) },
      scales: {
        x: {
          scale: () => scaleBand<string>().domain(columns).padding(0),
          side: "top",
          axis: { ticks: { size: 0 }, tickLabels: { fontSize: paint.text }, line: false },
        },
        y: {
          scale: () => scaleBand<string>().domain(rows).padding(0),
          axis: { ticks: { size: 0 }, tickLabels: { fontSize: paint.text }, line: false },
        },
      },
      focusRing: false,
      tooltip: {
        use: tooltip,
        content: (points) => {
          const c = points[0]?.datum;
          return c ? { title: c.row, rows: [note(describe(c))] } : { rows: [] };
        },
      },
    });
  }, [cells, rows, paint, describe]);
  return <Chart definition={definition} ariaLabel={label} height={(rows.length + 1) * Math.round(paint.text * 2.2)} initialWidth={480} />;
}

export interface CountRow {
  /** The count, as its axis shows it: "0" … "9", "10+". */
  label: string;
  /** Eligible observations with that many. */
  observed: number;
  /** What a Poisson count with the same mean would give. */
  expected: number;
}

/**
 * An item's count distribution: a bar of observations at each count, and
 * the Poisson expectation for the same mean as a line of dots over them.
 * Hovering a count shows both.
 */
export function CountChart({
  rows,
  paint,
  label,
  describe,
}: {
  rows: readonly CountRow[];
  paint: Paint;
  label: string;
  /** The tooltip's lines for a count: the observations, then the expectation. */
  describe: (row: CountRow) => readonly string[];
}) {
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(rows, {
            x: "label",
            y: "observed",
            inset: 3,
            fill: paint.shades[3],
            states: [{ when: { focus: "x" }, style: outlined(paint) }],
          }),
          lineY(rows, { x: "label", y: "expected", stroke: paint.fg, strokeWidth: 1.5 }),
          dot(rows, { x: "label", y: "expected", r: 3.5, fill: paint.fg }),
        ],
        scales: {
          x: {
            scale: () =>
              scaleBand<string>()
                .domain(rows.map((row) => row.label))
                .padding(0.12),
            axis: { ticks: { size: 0 }, tickLabels: { fontSize: paint.text } },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: { stroke: paint.dim, strokeOpacity: 0.5 },
            axis: { ticks: { size: 0 }, tickLabels: { fontSize: paint.text }, line: false },
          },
        },
        // A column, wherever it is pointed at, shows its count's observed and expected numbers.
        focus: "nearest-x",
        focusRing: false,
        tooltip: {
          use: tooltip,
          content: (points) => {
            const row = points[0]?.datum;
            return row ? { title: row.label, rows: describe(row).map(note) } : { rows: [] };
          },
        },
      }),
    [rows, paint, describe],
  );
  return <Chart definition={definition} ariaLabel={label} height={Math.round(paint.text * 16)} initialWidth={640} />;
}
