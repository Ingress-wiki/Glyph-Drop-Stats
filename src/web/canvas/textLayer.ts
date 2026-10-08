import type { UI } from "@synth-ui/core";
import type { Backend } from "@synth-ui/core/backend";
import { visibleText, type TextRun } from "./textRuns.ts";

/**
 * Transparent native text over the bitmap glyphs gives the browser real text
 * to select. Observe the backend's public drawing API so widgets, scrolling,
 * clipping and popups all use the same positions as the canvas.
 *
 * With `smooth` on, the canvas draws no glyphs and this text is shown
 * instead, in the system's font: each character keeps its bitmap glyph's
 * cell, so nothing moves or overlaps.
 */
/** The smooth font, shared by the stylesheet's rule and the width measurement below. */
const SMOOTH_FONT =
  'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "PingFang SC", "Microsoft YaHei", "Malgun Gothic", "Noto Sans CJK SC", sans-serif';

/** synth-ui's own faces draw capitals only; smooth text keeps their headings and labels in capitals. */
const CAPITALS_ONLY: ReadonlySet<string> = new Set(["text", "small"]);

export class TextLayer {
  smooth = false;
  private nodes: HTMLDivElement[] = [];
  private measure: CanvasRenderingContext2D | null = null;
  private canvas: HTMLCanvasElement;
  private root: HTMLElement;

  constructor(canvas: HTMLCanvasElement, root: HTMLElement) {
    this.canvas = canvas;
    this.root = root;
    root.addEventListener("pointerdown", () => {
      // The canvas host uses a hidden input for editing. Native selection must
      // own the keyboard while the user is selecting page text.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    root.addEventListener("wheel", (event) => {
      event.preventDefault();
      canvas.dispatchEvent(new WheelEvent("wheel", event));
    }, { passive: false });
    document.addEventListener("copy", (event) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return;
      if (!event.clipboardData) return;
      event.clipboardData.setData("text/plain", selection.toString());
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a") return;
      if (document.body.classList.contains("text-view") || document.body.classList.contains("fallback")) return;
      // Keep Select All inside the canvas's native text editor when it is in use.
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
      if (!root.childNodes.length) return;
      const range = document.createRange();
      range.selectNodeContents(root);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  paint(ui: UI, draw: () => void): void {
    const runs: TextRun[] = [];
    const backend = ui.backend;
    const text = backend.text;
    const record: Backend["text"] = (layer, clip, font, value, x, y, color, scale) => {
      runs.push({ layer, clip, font, text: value, color, x, y, scale });
      if (!this.smooth) text.call(backend, layer, clip, font, value, x, y, color, scale);
    };
    backend.text = record;
    try {
      draw();
    } finally {
      backend.text = text;
    }
    this.render(ui, runs);
  }

  private render(ui: UI, runs: readonly TextRun[]): void {
    const box = this.canvas.getBoundingClientRect();
    const sx = box.width / ui.width;
    const sy = box.height / ui.height;
    this.root.style.left = `${box.left}px`;
    this.root.style.top = `${box.top}px`;
    this.root.style.width = `${box.width}px`;
    this.root.style.height = `${box.height}px`;
    this.root.classList.toggle("smooth", this.smooth);
    this.root.style.fontFamily = this.smooth ? SMOOTH_FONT : "";
    const visible = visibleText(ui, runs).sort((a, b) => a.run.layer - b.run.layer || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    visible.forEach(({ run, rect, clip, interactive }, index) => {
      let node = this.nodes[index];
      if (!node) {
        node = document.createElement("div");
        node.className = "canvas-text-run";
        this.nodes.push(node);
        this.root.append(node);
      }
      // Never replace unchanged text nodes: hover and animation frames must
      // preserve the browser's selection and its drag anchor.
      const signature = `${this.smooth}:${run.font}:${run.scale}:${sx}:${run.text}`;
      if (node.dataset.text !== signature && this.smooth) {
        // Shown text is selected as itself: natural spacing, no glyph cells.
        node.replaceChildren(document.createTextNode(`${run.text}\n`));
        node.dataset.text = signature;
        const caps = CAPITALS_ONLY.has(run.font);
        node.classList.toggle("caps", caps);
        node.dataset.fit = String(this.fit(caps ? run.text.toUpperCase() : run.text, rect.w * sx, rect.h * sy));
      } else if (node.dataset.text !== signature) {
        const spacing = ui.fontMetrics(run.font).spacing * run.scale;
        node.replaceChildren(...Array.from(run.text, (char) => {
          const glyph = document.createElement("span");
          glyph.textContent = char;
          glyph.style.width = `${(ui.measureText(char, { font: run.font, scale: run.scale }) + spacing) * sx}px`;
          return glyph;
        }), document.createTextNode("\n"));
        node.dataset.text = signature;
      }
      node.style.setProperty("--ink", ui.palette.hex(run.color));
      // System text is narrower than the pixel faces: labels on controls stay centred in
      // the pixel text's place; other text keeps its left edge.
      node.style.width = this.smooth ? `${rect.w * sx}px` : "";
      node.style.textAlign = this.smooth && interactive ? "center" : "";
      node.style.left = `${rect.x * sx}px`;
      node.style.top = `${rect.y * sy}px`;
      node.style.height = `${rect.h * sy}px`;
      node.style.lineHeight = `${rect.h * sy}px`;
      node.style.fontSize = `${this.smooth ? Number(node.dataset.fit) : rect.h * sy}px`;
      node.style.pointerEvents = interactive ? "none" : "auto";
      node.style.clipPath = `inset(${Math.max(0, clip.y - rect.y) * sy}px ${Math.max(0, rect.x + rect.w - clip.x - clip.w) * sx}px ${Math.max(0, rect.y + rect.h - clip.y - clip.h) * sy}px ${Math.max(0, clip.x - rect.x) * sx}px)`;
    });
    while (this.nodes.length > visible.length) this.nodes.pop()?.remove();
  }

  /**
   * The size for smooth text: the pixel line's height, or less when the
   * system's glyphs would run past the pixel text's width (wide CJK glyphs,
   * capitals) and be cut off.
   */
  private fit(text: string, width: number, height: number): number {
    this.measure ??= document.createElement("canvas").getContext("2d");
    if (!this.measure) return height;
    this.measure.font = `${height}px ${SMOOTH_FONT}`;
    const natural = this.measure.measureText(text).width;
    return natural > width ? Math.max(height * 0.6, (height * width) / natural) : height;
  }
}
