import { UI, type Context } from "@synth-ui/core";
import { SceneRecorder } from "@synth-ui/core/backend";
import { describe, expect, it } from "vitest";
import { visibleText, type TextRun } from "../src/web/canvas/textRuns.ts";
import { PALETTE } from "../src/web/canvas/theme.ts";

function frame(draw: (ctx: Context) => void) {
  const backend = new SceneRecorder({
    defaultFont: "mixed",
    hasFont: () => true,
    fontMetrics: () => ({ height: 7, spacing: 1 }),
    measureText: (text, _font, scale) => Math.max(0, text.length * 6 - 1) * scale,
  });
  const runs: TextRun[] = [];
  const text = backend.text.bind(backend);
  backend.text = (layer, clip, font, value, x, y, color, scale) => {
    runs.push({ layer, clip, font, text: value, x, y, scale });
    text(layer, clip, font, value, x, y, color, scale);
  };
  const ui = new UI({ backend, palette: PALETTE });
  backend.reset(320, 200, PALETTE);
  ui.frame({ width: 320, height: 200, time: 0, events: [] }, draw);
  return visibleText(ui, runs);
}

describe("canvas native text layer", () => {
  it("follows scroll offsets and excludes text outside the viewport", () => {
    const visible = frame((ctx) => {
      ctx.allocate({ x: 20, y: 30, w: 100, h: 40 }, (view) => {
        view.region({ x: -10, y: -15, w: 200, h: 200 }).text("scrolled text", 0, 20, { color: 1 });
        view.text("below viewport", 0, 50, { color: 1 });
      }, { clip: true });
    });
    expect(visible.map(({ run }) => run.text)).toEqual(["scrolled text"]);
    expect(visible[0].rect).toMatchObject({ x: 10, y: 35 });
    expect(visible[0].clip).toEqual({ x: 20, y: 30, w: 100, h: 40 });
  });

  it("keeps buttons and editable text fields clickable", () => {
    const visible = frame((ctx) => {
      ctx.text("copy this", 0, 0, { color: 1 });
      ctx.interaction({ x: 0, y: 20, w: 100, h: 15 }, { key: "button", focusable: true });
      ctx.text("BUTTON", 5, 24, { color: 1 });
      ctx.interaction({ x: 0, y: 40, w: 100, h: 15 }, { key: "input", text: true, focusable: true });
      ctx.text("editable", 5, 44, { color: 1 });
    });
    expect(visible.map(({ run, interactive }) => [run.text, interactive])).toEqual([
      ["copy this", false], ["BUTTON", true], ["editable", true],
    ]);
  });

  it("selects modal prose without exposing text covered by the backdrop", () => {
    const visible = frame((ctx) => {
      ctx.text("covered page", 0, 0, { color: 1 });
      ctx.overlay((modal) => {
        modal.interaction(modal.screen, { key: "sheet:backdrop" });
        modal.interaction({ x: 20, y: 20, w: 240, h: 120 }, { key: "sheet:panel" });
        modal.text("selectable modal prose", 30, 30, { color: 1 });
        modal.interaction({ x: 30, y: 60, w: 80, h: 15 }, { key: "close", focusable: true });
        modal.text("CLOSE", 35, 64, { color: 1 });
      });
    });
    expect(visible.map(({ run, interactive }) => [run.text, interactive])).toEqual([
      ["selectable modal prose", false], ["CLOSE", true],
    ]);
  });

  it("retains exact mixed-case text and scaled headline dimensions", () => {
    const visible = frame((ctx) => ctx.text("gds1_aAbB", 4, 8, { color: 1, scale: 2 }));
    expect(visible[0].run.text).toBe("gds1_aAbB");
    expect(visible[0].rect).toEqual({ x: 4, y: 8, w: 106, h: 14 });
  });
});
