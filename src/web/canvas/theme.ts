import { Palette, type Context, type FontSet } from "@synth-ui/core";
import { THEME, THEME_COLORS, THEME_FONTS, themeFor } from "@synth-ui/widgets";
import type { Locale } from "../i18n/index.ts";
import { CJK_JA } from "./fonts/cjkJa.ts";
import { CJK_KO } from "./fonts/cjkKo.ts";
import { CJK_ZH_HANS } from "./fonts/cjkZhHans.ts";
import { CJK_ZH_HANT } from "./fonts/cjkZhHant.ts";
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

/**
 * Every face the host draws with: synth-ui's capitals and labels, a
 * mixed-case 5×7, and one pixel face per CJK language (Han characters take
 * different forms in Simplified, Traditional and Japanese).
 */
export const FONTS: FontSet = {
  ...THEME_FONTS,
  mixed: MIXED_5X7,
  "cjk-zh-hans": CJK_ZH_HANS,
  "cjk-zh-hant": CJK_ZH_HANT,
  "cjk-ja": CJK_JA,
  "cjk-ko": CJK_KO,
};

/** Which face draws which kind of text: headings and buttons, small labels, everything else. */
export interface FontRoles {
  caps: string;
  small: string;
  mixed: string;
}

const CJK_FACE: Record<Exclude<Locale, "en">, string> = {
  "zh-Hans": "cjk-zh-hans",
  "zh-Hant": "cjk-zh-hant",
  ja: "cjk-ja",
  ko: "cjk-ko",
};

/** English uses the capitals and 5×7 faces; the other languages use their one pixel face throughout. */
export function fontRoles(locale: Locale): FontRoles {
  if (locale === "en") return { caps: "text", small: "small", mixed: "mixed" };
  const face = CJK_FACE[locale];
  return { caps: face, small: face, mixed: face };
}

/** The current frame's faces. `useLocale` sets them as each frame begins. */
export const FONT: FontRoles = fontRoles("en");

/**
 * Draw this frame in `locale`'s faces: this site's widgets read `FONT`, and
 * synth-ui's (menus, sheets, text fields, the status line) read the theme.
 */
export function useLocale(ctx: Context, locale: Locale): void {
  Object.assign(FONT, fontRoles(locale));
  const theme = themeFor(ctx.palette);
  ctx.provide(THEME, { ...theme, fonts: { text: FONT.caps, small: FONT.small } });
}

const SHADES = [0, COLORS.shade1, COLORS.shade2, COLORS.shade3, COLORS.shade4, COLORS.shade5] as const;

/** A shade step's fill (0: none). */
export function shadeFill(step: number): number | null {
  return step <= 0 ? null : SHADES[Math.min(step, 5)];
}

/** The more legible of the light and dark text colours on a fill. */
export function inkOn(fill: number): number {
  return PALETTE.contrast(COLORS.paper, fill) >= PALETTE.contrast(COLORS.void, fill) ? COLORS.paper : COLORS.void;
}
