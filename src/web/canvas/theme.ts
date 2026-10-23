import { Palette, type Context, type FontSet } from "@synth-ui/core";
import { THEME, THEME_COLORS, THEME_FONTS, themeFor } from "@synth-ui/widgets";
import type { Locale } from "../i18n/index.ts";
import type { CjkSize } from "../textSize.ts";
import { CJK_JA_8 } from "./fonts/cjkJa8.ts";
import { CJK_JA_10 } from "./fonts/cjkJa10.ts";
import { CJK_JA_12 } from "./fonts/cjkJa12.ts";
import { CJK_KO_8 } from "./fonts/cjkKo8.ts";
import { CJK_KO_10 } from "./fonts/cjkKo10.ts";
import { CJK_KO_12 } from "./fonts/cjkKo12.ts";
import { CJK_ZH_HANS_8 } from "./fonts/cjkZhHans8.ts";
import { CJK_ZH_HANS_10 } from "./fonts/cjkZhHans10.ts";
import { CJK_ZH_HANS_12 } from "./fonts/cjkZhHans12.ts";
import { CJK_ZH_HANT_8 } from "./fonts/cjkZhHant8.ts";
import { CJK_ZH_HANT_10 } from "./fonts/cjkZhHant10.ts";
import { CJK_ZH_HANT_12 } from "./fonts/cjkZhHant12.ts";
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
 * mixed-case 5×7, and a pixel face per CJK language (Han characters take
 * different forms in Simplified, Traditional and Japanese) at each size a
 * visitor can choose. synth-ui takes its faces once, when it starts, so all
 * of them are here.
 */
export const FONTS: FontSet = {
  ...THEME_FONTS,
  mixed: MIXED_5X7,
  "cjk-zh-hans-8": CJK_ZH_HANS_8,
  "cjk-zh-hans-10": CJK_ZH_HANS_10,
  "cjk-zh-hans-12": CJK_ZH_HANS_12,
  "cjk-zh-hant-8": CJK_ZH_HANT_8,
  "cjk-zh-hant-10": CJK_ZH_HANT_10,
  "cjk-zh-hant-12": CJK_ZH_HANT_12,
  "cjk-ja-8": CJK_JA_8,
  "cjk-ja-10": CJK_JA_10,
  "cjk-ja-12": CJK_JA_12,
  "cjk-ko-8": CJK_KO_8,
  "cjk-ko-10": CJK_KO_10,
  "cjk-ko-12": CJK_KO_12,
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

/**
 * English uses the capitals and 5×7 faces; the other languages use their
 * pixel face, at the chosen size, throughout.
 */
export function fontRoles(locale: Locale, size: CjkSize): FontRoles {
  if (locale === "en") return { caps: "text", small: "small", mixed: "mixed" };
  const face = `${CJK_FACE[locale]}-${size}`;
  return { caps: face, small: face, mixed: face };
}

/** The current frame's faces. `useLocale` sets them as each frame begins. */
export const FONT: FontRoles = fontRoles("en", 10);

/**
 * Draw this frame in `locale`'s faces: this site's widgets read `FONT`, and
 * synth-ui's (menus, sheets, text fields, the status line) read the theme.
 */
export function useLocale(ctx: Context, locale: Locale, size: CjkSize): void {
  Object.assign(FONT, fontRoles(locale, size));
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
