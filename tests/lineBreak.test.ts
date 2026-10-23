import { describe, expect, it } from "vitest";
import { breakLines } from "../src/web/canvas/lineBreak.ts";

/** One unit per character, like a monospaced face. */
const measure = (text: string) => [...text].length;

describe("breaking lines", () => {
  it("breaks English at spaces", () => {
    expect(breakLines("each counts once as its accepted version", 16, measure)).toEqual(["each counts once", "as its accepted", "version"]);
  });

  it("fills a line with Chinese after an English word instead of moving the sentence down", () => {
    expect(breakLines("记录是玩家提交的 Hack 和掉落组。每条记录只计一次", 12, measure)).toEqual([
      "记录是玩家提交的",
      "Hack 和掉落组。每条",
      "记录只计一次",
    ]);
  });

  it("never starts a line with closing punctuation", () => {
    // "。" would start the second line; it stays with the character before it.
    expect(breakLines("一二三四五。六七", 5, measure)).toEqual(["一二三四", "五。六七"]);
  });

  it("never ends a line with opening punctuation", () => {
    expect(breakLines("一二三四（五六）", 5, measure)).toEqual(["一二三四", "（五六）"]);
  });

  it("keeps small kana and the long vowel mark with what comes before", () => {
    expect(breakLines("あいうえおっか", 5, measure)).toEqual(["あいうえ", "おっか"]);
    expect(breakLines("あいうえデータ", 5, measure)).toEqual(["あいうえ", "データ"]);
  });

  it("breaks Korean at spaces, like English", () => {
    expect(breakLines("집계 대상 관측 기준입니다", 8, measure)).toEqual(["집계 대상 관측", "기준입니다"]);
  });

  it("keeps the text's own newlines", () => {
    expect(breakLines("first\nsecond", 40, measure)).toEqual(["first", "second"]);
  });

  it("splits a word too long for any line by character", () => {
    expect(breakLines("gds1_abcdefghij", 6, measure)).toEqual(["gds1_a", "bcdefg", "hij"]);
  });
});
