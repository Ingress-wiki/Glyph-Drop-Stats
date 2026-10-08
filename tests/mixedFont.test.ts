import { describe, expect, it } from "vitest";
import { MIXED_5X7 } from "../src/web/canvas/mixedFont.ts";

describe("the mixed-case face", () => {
  const glyphs = MIXED_5X7.glyphs;

  it("covers printable ASCII, so any receipt or item name can be drawn exactly", () => {
    for (let code = 0x20; code <= 0x7e; code++) expect(glyphs[String.fromCharCode(code)]).toBeDefined();
  });

  it("keeps upper and lower case apart", () => {
    expect(glyphs.a).not.toBe(glyphs.A);
    expect(glyphs.z).not.toBe(glyphs.Z);
  });

  it("has every symbol the site's text uses", () => {
    for (const char of "·–—…÷×↑↓▲▼") expect(glyphs[char]).toBeDefined();
  });

  it("is a 5×7 grid of # and . in every glyph", () => {
    for (const rows of Object.values(glyphs)) {
      const lines = rows.split(" ");
      expect(lines).toHaveLength(7);
      for (const line of lines) expect(line).toMatch(/^[#.]{5}$/);
    }
  });

  it("doesn't upper-case text", () => {
    expect(MIXED_5X7.caps).toBeUndefined();
  });
});
