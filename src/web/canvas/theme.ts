import { Palette, type FontSet } from "@synth-ui/core";
import { THEME_COLORS, THEME_FONTS } from "@synth-ui/widgets";
import { MIXED_5X7 } from "./mixedFont.ts";

/**
 * synth-ui's warm greys and orange accent, plus the colours this site
 * needs: a five-step ramp for "more" in the item table (dim ember up to full
 * flame) and a red for errors.
 */
export const PALETTE = new Palette([
  ...THEME_COLORS,
  ["shade1", "#2E1A0F"],
  ["shade2", "#4F2412"],
  ["shade3", "#7A3415"],
  ["shade4", "#B8481A"],
  ["shade5", "#FF9150"],
  ["bad", "#FF6B5B"],
] as const);

export const COLORS = PALETTE.index;

/** The widgets' faces, plus a mixed-case face for text whose case matters. */
export const FONTS: FontSet = { ...THEME_FONTS, mixed: MIXED_5X7 };

/** Font names: `text` 5×7 capitals, `small` labels, `mixed` mixed case. */
export const FONT = { caps: "text", small: "small", mixed: "mixed" } as const;

const SHADES = [0, COLORS.shade1, COLORS.shade2, COLORS.shade3, COLORS.shade4, COLORS.shade5] as const;

/** A shade step's fill (0: none). */
export function shadeFill(step: number): number | null {
  return step <= 0 ? null : SHADES[Math.min(step, 5)];
}

/** The more legible of the light and dark text colours on a fill. */
export function inkOn(fill: number): number {
  return PALETTE.contrast(COLORS.paper, fill) >= PALETTE.contrast(COLORS.void, fill) ? COLORS.paper : COLORS.void;
}
