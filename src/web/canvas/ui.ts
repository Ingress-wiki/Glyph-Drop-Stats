import type { Context, Interaction, Rect } from "@synth-ui/core";
import { useTheme } from "@synth-ui/widgets";
import { COLORS, FONT } from "./theme.ts";

/**
 * Widgets this site needs beyond synth-ui's: controls that take keyboard
 * focus (synth-ui's buttons don't), wrapped prose, and a record of what has
 * focus for the accessible mirror to announce.
 */

/** What has keyboard focus, refreshed every frame. */
export const focus = { label: "", next: "" };

export function beginFrame(): void {
  focus.next = "";
}

/** After a frame: the focused control's name, if it changed since the last frame. */
export function endFrame(): string | null {
  if (focus.next === focus.label) return null;
  focus.label = focus.next;
  return focus.label;
}

export const BUTTON_H = 13;
const PAD = 5;

export interface Pressable {
  it: Interaction;
  /** Clicked, or Enter or Space while focused. */
  activated: boolean;
}

/**
 * A rect that can be clicked, tabbed to and activated from the keyboard. The
 * caller draws its content; this draws the focus ring.
 */
export function pressable(
  ctx: Context,
  rect: Rect,
  opts: { key: string; label: string; hint?: string; disabled?: boolean },
): Pressable {
  if (opts.disabled) {
    const it = ctx.interaction(rect, { key: opts.key, click: false, hover: false });
    return { it, activated: false };
  }
  const it = ctx.interaction(rect, { key: opts.key, focusable: true, cursor: "pointer", hint: opts.hint ?? opts.label });
  const keyed = it.focused && (ctx.takeKey("Enter") || ctx.takeKey("Space"));
  if (it.focused) focus.next = `${opts.label}, button`;
  return { it, activated: it.clicked || keyed };
}

export function drawFocusRing(ctx: Context, rect: Rect): void {
  ctx.strokeRect({ x: rect.x - 2, y: rect.y - 2, w: rect.w + 4, h: rect.h + 4 }, COLORS.flame);
}

export interface ButtonOptions {
  key: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** Lit in the accent: the primary action, or a toggle that's on. */
  on?: boolean;
  /** A small triangle after the label: it opens a menu or panel. */
  caret?: "down" | "up";
  w?: number;
}

const CARET_W = 8;

export function buttonWidth(ctx: Context, label: string, caret = false): number {
  return ctx.measureText(label, { font: FONT.caps }) + PAD * 2 + (caret ? CARET_W : 0);
}

/** A 5×3 triangle, pointing down or up, its top left at (x, y). */
function drawCaret(ctx: Context, x: number, y: number, direction: "down" | "up", color: number): void {
  for (let i = 0; i < 3; i++) {
    const row = direction === "down" ? i : 2 - i;
    ctx.hline(x + i, y + row, 5 - i * 2, color);
  }
}

/** An outlined button in the 5×7 face. Returns true when activated. */
export function actionButton(ctx: Context, opts: ButtonOptions, rect?: Rect): boolean {
  const { colors: c } = useTheme(ctx);
  const r = rect ?? ctx.place({ w: opts.w ?? buttonWidth(ctx, opts.label, Boolean(opts.caret)), h: BUTTON_H });
  const { it, activated } = pressable(ctx, r, opts);
  const sink = it.held ? 1 : 0;
  const box = { x: r.x, y: r.y + sink, w: r.w, h: r.h };
  const lit = opts.on && !opts.disabled;
  ctx.fillRect(box, lit ? c.accent : it.hovered || it.focused ? c.raised : c.control);
  ctx.strokeRect(box, opts.disabled ? c.line : lit ? c.flame : c.border);
  const ink = opts.disabled ? c.dim : lit ? c.void : it.held ? c.accent : it.hovered ? c.paper : c.text;
  const tw = ctx.measureText(opts.label, { font: FONT.caps }) + (opts.caret ? CARET_W : 0);
  const tx = box.x + Math.floor((box.w - tw) / 2);
  ctx.text(opts.label, tx, box.y + 3, { color: ink, font: FONT.caps });
  if (opts.caret) drawCaret(ctx, tx + tw - 5, box.y + 5, opts.caret, ink);
  if (it.focused) drawFocusRing(ctx, r);
  return activated;
}

/** A check box and label in one focusable control. Returns true when activated; the caller flips it. */
export function toggle(ctx: Context, opts: { key: string; label: string; checked: boolean }, rect?: Rect): boolean {
  const { colors: c } = useTheme(ctx);
  const w = 9 + 4 + ctx.measureText(opts.label, { font: FONT.mixed });
  const r = rect ?? ctx.place({ w, h: 9 });
  const { it, activated } = pressable(ctx, r, { key: opts.key, label: `${opts.label}, ${opts.checked ? "checked" : "not checked"}` });
  const box = { x: r.x, y: r.y, w: 9, h: 9 };
  ctx.fillRect(box, c.control);
  ctx.strokeRect(box, it.hovered || it.focused ? c.ash : c.border);
  if (opts.checked) ctx.fillRect({ x: box.x + 2, y: box.y + 2, w: 5, h: 5 }, c.accent);
  ctx.text(opts.label, r.x + 13, r.y + 1, { color: it.hovered ? c.paper : c.text, font: FONT.mixed });
  if (it.focused) drawFocusRing(ctx, r);
  return activated;
}

/** Text wrapped to the region's width, placed by its flow. Returns the rect it used. */
export function paragraph(
  ctx: Context,
  text: string,
  opts: { color?: number; font?: string; width?: number; indent?: number } = {},
): Rect {
  const { colors: c } = useTheme(ctx);
  const indent = opts.indent ?? 0;
  const width = (opts.width ?? ctx.bounds.w - (ctx.cursor.x - ctx.bounds.x)) - indent;
  const layout = ctx.layoutText(text, {
    font: opts.font ?? FONT.mixed,
    color: opts.color ?? c.text,
    width: Math.max(width, 24),
    wrap: "word",
    lineGap: 2,
  });
  const r = ctx.place({ w: width + indent, h: layout.bounds.h });
  ctx.drawText(layout, r.x + indent, r.y);
  return r;
}

/** A bullet list of wrapped items. */
export function bullets(ctx: Context, items: readonly string[], color?: number): void {
  const { colors: c } = useTheme(ctx);
  for (const item of items) {
    const r = paragraph(ctx, item, { indent: 8, color });
    ctx.fillRect({ x: r.x + 2, y: r.y + 2, w: 2, h: 2 }, c.accent);
  }
}

/** A section heading in the caps face, with a rule under it. */
export function heading(ctx: Context, text: string, right?: string): void {
  const { colors: c } = useTheme(ctx);
  const r = ctx.place({ w: ctx.bounds.w, h: 11 });
  ctx.text(text, r.x, r.y, { color: c.paper, font: FONT.caps });
  if (right) {
    const w = ctx.measureText(right, { font: FONT.small });
    ctx.text(right, r.x + r.w - w, r.y + 1, { color: c.muted, font: FONT.small });
  }
  ctx.hline(r.x, r.y + 9, r.w, c.border);
}

/** A small muted label, then a value, on one line or (narrow) two. */
export function keyValue(ctx: Context, key: string, value: string, opts: { color?: number } = {}): void {
  const { colors: c } = useTheme(ctx);
  const keyW = 96;
  const narrow = ctx.bounds.w < 260;
  const r = ctx.place({ w: ctx.bounds.w, h: narrow ? 18 : 9 });
  ctx.text(key.toUpperCase(), r.x, r.y + 1, { color: c.muted, font: FONT.small });
  const layout = ctx.layoutText(value, {
    font: FONT.mixed,
    color: opts.color ?? c.text,
    width: narrow ? r.w : r.w - keyW,
    overflow: "clip",
  });
  ctx.drawText(layout, narrow ? r.x : r.x + keyW, narrow ? r.y + 9 : r.y);
}

/** Lay controls left to right, wrapping onto a new line when the next won't fit. */
export function wrapRow(ctx: Context, widths: readonly number[], h: number, gap: number): Rect[] {
  const rects: Rect[] = [];
  const left = ctx.cursor.x;
  const right = ctx.bounds.x + ctx.bounds.w;
  let x = left;
  let y = ctx.cursor.y;
  for (const w of widths) {
    const width = Math.min(w, right - left);
    if (x > left && x + width > right) {
      x = left;
      y += h + gap;
    }
    rects.push({ x, y, w: width, h });
    x += width + gap;
  }
  ctx.place({ w: right - left, h: rects.length === 0 ? 0 : y - ctx.cursor.y + h });
  return rects;
}

/** An error line: red text after a red bar. */
export function errorLine(ctx: Context, text: string): void {
  const r = paragraph(ctx, text, { color: COLORS.bad, indent: 6 });
  ctx.vline(r.x + 1, r.y, r.h, COLORS.bad);
}

/**
 * Read-only text that can be selected and copied: drag to select, double-click,
 * Tab or Mod+A to select it all, then Mod+C. synth-ui copies whatever a focused
 * text widget reports as selected through the browser's copy event, which works
 * on plain HTTP too. Typing into it does nothing.
 */
export function selectableText(
  ctx: Context,
  opts: { key: string; label: string; text: string; color: number; font?: string },
): Rect {
  const font = opts.font ?? FONT.mixed;
  const width = ctx.bounds.w - (ctx.cursor.x - ctx.bounds.x);
  const layoutOptions = { font, color: opts.color, width, wrap: "char" as const, lineGap: 2 };
  const layout = ctx.layoutText(opts.text, layoutOptions);
  const r = ctx.place({ w: width, h: layout.bounds.h + 2 });
  const it = ctx.interaction(r, { key: opts.key, focusable: true, text: true, cursor: "text", hint: `${opts.label}: select it, then copy` });
  const sel = ctx.state(() => ({ anchor: 0, focus: 0, wasFocused: false, selectedAll: false }), { key: `${opts.key}:selection` });
  const at = (x: number, y: number) => layout.indexAt({ x: x - r.x, y: y - r.y - 1 });
  const all = () => {
    sel.anchor = 0;
    sel.focus = opts.text.length;
  };
  if (it.held && it.presses < 2 && !sel.selectedAll) {
    // A fast drag can move before its press is handled: the press was where the pointer
    // is now, less the travel since it.
    sel.anchor = at(ctx.pointer.x - it.dx, ctx.pointer.y - it.dy);
    sel.focus = at(ctx.pointer.x, ctx.pointer.y);
  }
  if (it.pressed) {
    sel.selectedAll = it.presses >= 2;
    if (sel.selectedAll) all();
  } else if (!it.held && it.focused && !sel.wasFocused) {
    all(); // Tabbed in.
  }
  if (it.focused && ctx.takeKey("Mod+A")) all();
  if (it.released) sel.selectedAll = false;
  sel.wasFocused = it.focused;
  const start = Math.min(sel.anchor, sel.focus);
  const end = Math.max(sel.anchor, sel.focus);
  if (it.focused) {
    focus.next = `${opts.label}, selectable text`;
    // Read-only: the typing, pasting and cutting it's handed are dropped.
    ctx.textInput(it, { caret: { x: r.x, y: r.y, w: 1, h: r.h }, selection: opts.text.slice(start, end) });
  }
  const attrs = it.focused && start < end ? [{ start, end, background: COLORS.accent, color: COLORS.void }] : [];
  ctx.drawText(ctx.layoutText({ text: opts.text, attrs }, layoutOptions), r.x, r.y + 1);
  return r;
}
