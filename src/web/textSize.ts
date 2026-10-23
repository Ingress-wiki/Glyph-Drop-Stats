/** The pixel sizes Chinese, Japanese and Korean text can be drawn at. */
export const CJK_SIZES = [8, 10, 12] as const;
export type CjkSize = (typeof CJK_SIZES)[number];

/** 8px packs complex Han characters too tightly to read easily in running text. */
export const DEFAULT_CJK_SIZE: CjkSize = 10;

export const CJK_SIZE_KEY = "glyph-drop-stats:cjk-size";

export function isCjkSize(value: number): value is CjkSize {
  return (CJK_SIZES as readonly number[]).includes(value);
}
