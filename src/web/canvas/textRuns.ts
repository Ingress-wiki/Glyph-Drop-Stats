import type { Rect, UI } from "@synth-ui/core";

export interface TextRun {
  layer: number;
  clip: number;
  font: string;
  text: string;
  x: number;
  y: number;
  scale: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Only expose text actually visible in the frame, and leave canvas controls clickable. */
export function visibleText(ui: UI, runs: readonly TextRun[]): { run: TextRun; rect: Rect; clip: Rect; interactive: boolean }[] {
  return runs.flatMap((run) => {
    const rect = {
      x: run.x, y: run.y,
      w: ui.measureText(run.text, { font: run.font, scale: run.scale }),
      h: ui.fontMetrics(run.font).height * run.scale,
    };
    const clip = ui.clips[run.clip];
    if (!run.text.trim() || !clip || !overlaps(rect, clip)) return [];
    const visible = {
      x: Math.max(rect.x, clip.x), y: Math.max(rect.y, clip.y),
      w: Math.min(rect.x + rect.w, clip.x + clip.w) - Math.max(rect.x, clip.x),
      h: Math.min(rect.y + rect.h, clip.y + clip.h) - Math.max(rect.y, clip.y),
    };
    // Modal backdrops register a higher-layer hit over the entire page.
    if (ui.hits.some((hit) => hit.layer > run.layer && overlaps(visible, hit.rect))) return [];
    // synth-ui sheets and menus register structural panel/backdrop hits;
    // those should not prevent selecting the prose inside the panel.
    const interactive = ui.hits.some((hit) => hit.click && hit.layer === run.layer &&
      !hit.key.endsWith(":backdrop") && !hit.key.endsWith(":panel") && overlaps(visible, hit.rect));
    return [{ run, rect, clip, interactive }];
  });
}

