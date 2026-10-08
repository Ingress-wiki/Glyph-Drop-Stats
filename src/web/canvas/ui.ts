import type { Context, Interaction, Rect } from "@synth-ui/core";
import { useTheme } from "@synth-ui/widgets";
import { en, type Messages } from "../i18n/en.ts";
import { COLORS, FONT } from "./theme.ts";

/**
 * Widgets this site needs beyond synth-ui's: controls that take keyboard
 * focus (synth-ui's buttons don't), wrapped prose, and a record of what has
 * focus for the accessible mirror to announce.
 */

/** What has keyboard focus, refreshed every frame. */
export const focus = { label: "", next: "" };

/** The current frame's messages, for what these widgets announce. */
let strings: Messages = en;

export function beginFrame(s: Messages): void {
  focus.next = "";
  strings = s;
}

/** After a frame: the focused control's name, if it changed since the last frame. */
export function endFrame(): string | null {
  if (focus.next === focus.label) return null;
  focus.label = focus.next;
  return focus.label;
}

const PAD = 5;

/** A face's line height: every size below follows from it, so taller CJK faces get room. */
export function lineHeight(ctx: Context, font: string): number {
  return ctx.fontMetrics(font).height;
}

/** A button's height: its label and three pixels above and below. */
export function buttonHeight(ctx: Context): number {
  return lineHeight(ctx, FONT.caps) + 6;
}

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
  opts: { key: string; label: string; hint?: string; disabled?: boolean; takeFocus?: boolean },
): Pressable {
  if (opts.disabled) {
    const it = ctx.interaction(rect, { key: opts.key, click: false, hover: false });
    return { it, activated: false };
  }
  const it = ctx.interaction(rect, { key: opts.key, focusable: true, cursor: "pointer", hint: opts.hint ?? opts.label });
  if (opts.takeFocus) ctx.focus(it);
  const keyed = it.focused && (ctx.takeKey("Enter") || ctx.takeKey("Space"));
  if (it.focused) focus.next = strings.a11y.button(opts.label);
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
  /** A face other than the current caps face: a language's name in its own script. */
  font?: string;
  /** Move the keyboard focus here, as a dialog opens or closes. */
  takeFocus?: boolean;
}

const CARET_W = 8;

export function buttonWidth(ctx: Context, label: string, caret = false, font: string = FONT.caps): number {
  return ctx.measureText(label, { font }) + PAD * 2 + (caret ? CARET_W : 0);
}

/** A 5×3 triangle, pointing down or up, its top left at (x, y). */
function drawCaret(ctx: Context, x: number, y: number, direction: "down" | "up", color: number): void {
  for (let i = 0; i < 3; i++) {
    const row = direction === "down" ? i : 2 - i;
    ctx.hline(x + i, y + row, 5 - i * 2, color);
  }
}

/** An outlined button in the caps face. Returns true when activated. */
export function actionButton(ctx: Context, opts: ButtonOptions, rect?: Rect): boolean {
  const { colors: c } = useTheme(ctx);
  const font = opts.font ?? FONT.caps;
  const r = rect ?? ctx.place({ w: opts.w ?? buttonWidth(ctx, opts.label, Boolean(opts.caret), font), h: buttonHeight(ctx) });
  const { it, activated } = pressable(ctx, r, opts);
  const sink = it.held ? 1 : 0;
  const box = { x: r.x, y: r.y + sink, w: r.w, h: r.h };
  const lit = opts.on && !opts.disabled;
  ctx.fillRect(box, lit ? c.accent : it.hovered || it.focused ? c.raised : c.control);
  ctx.strokeRect(box, opts.disabled ? c.line : lit ? c.flame : c.border);
  const ink = opts.disabled ? c.dim : lit ? c.void : it.held ? c.accent : it.hovered ? c.paper : c.text;
  const tw = ctx.measureText(opts.label, { font }) + (opts.caret ? CARET_W : 0);
  const tx = box.x + Math.floor((box.w - tw) / 2);
  const ty = box.y + Math.floor((box.h - lineHeight(ctx, font)) / 2);
  ctx.text(opts.label, tx, ty, { color: ink, font });
  if (opts.caret) drawCaret(ctx, tx + tw - 5, box.y + Math.floor(box.h / 2) - 1, opts.caret, ink);
  if (it.focused) drawFocusRing(ctx, r);
  return activated;
}

/** A check box and label in one focusable control. Returns true when activated; the caller flips it. */
export function toggle(ctx: Context, opts: { key: string; label: string; checked: boolean }, rect?: Rect): boolean {
  const { colors: c } = useTheme(ctx);
  const w = 9 + 4 + ctx.measureText(opts.label, { font: FONT.mixed });
  const h = Math.max(9, lineHeight(ctx, FONT.mixed) + 2);
  const r = rect ?? ctx.place({ w, h });
  const { it, activated } = pressable(ctx, r, { key: opts.key, label: strings.a11y.checkbox(opts.label, opts.checked) });
  const box = { x: r.x, y: r.y + Math.floor((h - 9) / 2), w: 9, h: 9 };
  ctx.fillRect(box, c.control);
  ctx.strokeRect(box, it.hovered || it.focused ? c.ash : c.border);
  if (opts.checked) ctx.fillRect({ x: box.x + 2, y: box.y + 2, w: 5, h: 5 }, c.accent);
  ctx.text(opts.label, r.x + 13, r.y + Math.floor((h - lineHeight(ctx, FONT.mixed)) / 2), { color: it.hovered ? c.paper : c.text, font: FONT.mixed });
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
  const dotY = Math.floor(lineHeight(ctx, FONT.mixed) / 2) - 1;
  for (const item of items) {
    const r = paragraph(ctx, item, { indent: 8, color });
    ctx.fillRect({ x: r.x + 2, y: r.y + dotY, w: 2, h: 2 }, c.accent);
  }
}

/** A text field's focus announcement, in the current language. */
export function announceField(label: string): void {
  focus.next = strings.a11y.textField(label);
}

/** A section heading in the caps face, with a rule under it. */
export function heading(ctx: Context, text: string, right?: string): void {
  const { colors: c } = useTheme(ctx);
  const capsH = lineHeight(ctx, FONT.caps);
  const r = ctx.place({ w: ctx.bounds.w, h: capsH + 4 });
  ctx.text(text, r.x, r.y, { color: c.paper, font: FONT.caps });
  if (right) {
    const w = ctx.measureText(right, { font: FONT.small });
    ctx.text(right, r.x + r.w - w, r.y + capsH - lineHeight(ctx, FONT.small), { color: c.muted, font: FONT.small });
  }
  ctx.hline(r.x, r.y + capsH + 2, r.w, c.border);
}

/** A small muted label, then a value, on one line or (narrow) two. */
export function keyValue(ctx: Context, key: string, value: string, opts: { color?: number } = {}): void {
  const { colors: c } = useTheme(ctx);
  const keyW = 96;
  const narrow = ctx.bounds.w < 260;
  const line = Math.max(lineHeight(ctx, FONT.mixed), lineHeight(ctx, FONT.small)) + 2;
  const r = ctx.place({ w: ctx.bounds.w, h: narrow ? line * 2 : line });
  ctx.text(key, r.x, r.y + line - 2 - lineHeight(ctx, FONT.small), { color: c.muted, font: FONT.small });
  const layout = ctx.layoutText(value, {
    font: FONT.mixed,
    color: opts.color ?? c.text,
    width: narrow ? r.w : r.w - keyW,
    overflow: "clip",
  });
  ctx.drawText(layout, narrow ? r.x : r.x + keyW, narrow ? r.y + line : r.y);
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
  const it = ctx.interaction(r, { key: opts.key, focusable: true, text: true, cursor: "text", hint: opts.label });
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
    focus.next = strings.a11y.selectable(opts.label);
    // Read-only: the typing, pasting and cutting it's handed are dropped.
    ctx.textInput(it, { caret: { x: r.x, y: r.y, w: 1, h: r.h }, selection: opts.text.slice(start, end) });
  }
  const attrs = it.focused && start < end ? [{ start, end, background: COLORS.accent, color: COLORS.void }] : [];
  ctx.drawText(ctx.layoutText({ text: opts.text, attrs }, layoutOptions), r.x, r.y + 1);
  return r;
}
