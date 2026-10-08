import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ISSUE_MESSAGES, placeholders, type IssueKey } from "../src/domain/issueMessages.ts";
import { CJK_JA } from "../src/web/canvas/fonts/cjkJa.ts";
import { CJK_KO } from "../src/web/canvas/fonts/cjkKo.ts";
import { CJK_ZH_HANS } from "../src/web/canvas/fonts/cjkZhHans.ts";
import { CJK_ZH_HANT } from "../src/web/canvas/fonts/cjkZhHant.ts";
import { en } from "../src/web/i18n/en.ts";
import { detectLocale, issueText, LOCALES, messages, problemText, type Locale } from "../src/web/i18n/index.ts";

const TRANSLATED = LOCALES.filter((locale): locale is Exclude<Locale, "en"> => locale !== "en");

type Leaf = string | readonly unknown[] | ((...args: never[]) => string) | { [key: string]: Leaf };

/** Every leaf of a catalogue, by its dotted path. */
function leaves(node: Leaf, path = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof node === "object" && node !== null && !Array.isArray(node)) {
    for (const [key, child] of Object.entries(node)) {
      for (const [p, v] of leaves(child as Leaf, path ? `${path}.${key}` : key)) out.set(p, v);
    }
  } else {
    out.set(path, node);
  }
  return out;
}

/**
 * Arguments to call each message with: distinct markers, so a translation
 * that drops one the English shows is caught. A few messages take a word
 * from a fixed set rather than free text.
 */
function argsFor(path: string, arity: number): unknown[] {
  // The direction is a word from a fixed set, which a translation names its own way.
  if (path === "a11y.sortBy") return ["«0»", null];
  return Array.from({ length: arity }, (_, i) => (i % 2 === 0 ? `«${i}»` : 7000 + i));
}

describe("catalogues", () => {
  const english = leaves(en as unknown as Leaf);

  // Filter fields are named in the English by their own parameter names, so English has no labels for them.
  const ownKeys = (catalogue: Map<string, unknown>) => [...catalogue.keys()].filter((path) => !path.startsWith("terms.filter.")).sort();

  it.each(TRANSLATED)("%s has every English message, and no others", (locale) => {
    const translated = leaves(messages(locale) as unknown as Leaf);
    expect(ownKeys(translated)).toEqual(ownKeys(english));
  });

  it.each(TRANSLATED)("%s is a translation, not the English", (locale) => {
    const translated = leaves(messages(locale) as unknown as Leaf);
    const same = [...english].filter(([path, value]) => typeof value === "string" && translated.get(path) === value && /[a-z]{4}/.test(value));
    // Only names that stay as they are (the site's title) may match.
    expect(same.map(([path]) => path).filter((path) => !path.startsWith("issues.") && path !== "app.title")).toEqual([]);
  });

  it.each(TRANSLATED)("%s's messages show every value the English ones do", (locale) => {
    const translated = leaves(messages(locale) as unknown as Leaf);
    for (const [path, value] of english) {
      const other = translated.get(path);
      if (typeof value === "function") {
        expect(typeof other, path).toBe("function");
        const fn = other as (...args: unknown[]) => string;
        expect(fn.length, path).toBe(value.length);
        const args = argsFor(path, value.length);
        const want = (value as (...args: unknown[]) => string)(...args);
        const got = fn(...args);
        expect(typeof got, path).toBe("string");
        expect(got, path).not.toMatch(/undefined|NaN|\[object/);
        for (const arg of args) {
          if (want.includes(String(arg))) expect(got, path).toContain(String(arg));
        }
      } else if (Array.isArray(value)) {
        expect(other, path).toHaveLength(value.length);
      } else {
        expect(typeof other, path).toBe("string");
        expect((other as string).length, path).toBeGreaterThan(0);
      }
    }
  });

  it.each(TRANSLATED)("%s's server messages take the same parameters as the English", (locale) => {
    const issues = messages(locale).issues;
    for (const key of Object.keys(ISSUE_MESSAGES) as IssueKey[]) {
      expect(placeholders(issues[key]), key).toEqual(placeholders(ISSUE_MESSAGES[key]));
    }
  });

  it("every catalogue names its language in its own script", () => {
    expect(LOCALES.map((locale) => messages(locale).language.name)).toEqual(["English", "简体中文", "繁體中文", "日本語", "한국어"]);
  });
});

describe("pixel faces", () => {
  const FACES = { "zh-Hans": CJK_ZH_HANS, "zh-Hant": CJK_ZH_HANT, ja: CJK_JA, ko: CJK_KO } as const;

  it.each(TRANSLATED)("%s's face has every character its catalogue uses", (locale) => {
    const source = readFileSync(new URL(`../src/web/i18n/${locale}.ts`, import.meta.url), "utf8");
    const used = new Set([...source].filter((c) => c.codePointAt(0)! > 0x7e && !/\s/.test(c)));
    const missing = [...used].filter((c) => !(c in FACES[locale].glyphs));
    // Run `node scripts/cjk-faces.mjs <fusion pixel bdf dir>` after changing a translation.
    expect(missing).toEqual([]);
  });

  it.each(TRANSLATED)("%s's face draws ASCII, for receipts, numbers and item names", (locale) => {
    for (let code = 0x20; code < 0x7f; code++) expect(String.fromCharCode(code) in FACES[locale].glyphs).toBe(true);
  });
});

describe("choosing a language", () => {
  it.each([
    [["en-GB"], "en"],
    [["ja-JP", "en"], "ja"],
    [["ko-KR"], "ko"],
    [["zh-CN"], "zh-Hans"],
    [["zh"], "zh-Hans"],
    [["zh-SG"], "zh-Hans"],
    [["zh-TW"], "zh-Hant"],
    [["zh-HK"], "zh-Hant"],
    [["zh-MO"], "zh-Hant"],
    [["zh-Hant-CN"], "zh-Hant"],
    [["zh-Hans-HK"], "zh-Hans"],
    [["fr-FR", "ko"], "ko"],
    [["fr-FR"], "en"],
    [[], "en"],
  ] as [string[], Locale][])("%j gives %s", (languages, locale) => {
    expect(detectLocale(languages)).toBe(locale);
  });
});

describe("server messages", () => {
  const ja = messages("ja");

  it("are shown in the page's language by key, with panels named in it too", () => {
    const issue = { code: "invalid_record", key: "panel.slotTwice", params: { panel: "bonus", slot: 3 }, message: "The bonus panel has slot 3 twice." };
    expect(issueText(en, issue)).toBe("The bonus panel has slot 3 twice.");
    const text = issueText(ja, issue);
    expect(text).not.toBe(issue.message);
    expect(text).toContain("3");
    expect(text).toContain(ja.terms.panel.bonus);
  });

  it("add the line a message is about", () => {
    const issue = { code: "invalid_csv", key: "file.empty", message: "The file is empty.", line: 4 };
    expect(issueText(en, issue)).toBe("The file is empty. (line 4)");
    expect(issueText(ja, issue)).toContain("4");
  });

  it("fall back to the server's English for a key the page doesn't know", () => {
    const issue = { code: "new_rule", key: "record.fromTheFuture", message: "Something new." };
    expect(issueText(ja, issue)).toBe("Something new.");
    expect(issueText(ja, { code: "old_server", message: "No key." })).toBe("No key.");
  });

  it("name filter fields the way the page's language does", () => {
    const zh = messages("zh-Hans");
    const issue = { code: "invalid_filter", key: "filter.pair", params: { first: "utcFrom", second: "utcTo" }, message: "utcFrom and utcTo must be given together." };
    const text = issueText(zh, issue);
    expect(text).toContain(zh.terms.filter.utcFrom ?? "utcFrom");
    expect(text).toContain(zh.terms.filter.utcTo ?? "utcTo");
  });

  it("describe a failed request in the page's language", () => {
    expect(problemText(en, { kind: "network", detail: "Failed to fetch" })).toBe("the connection failed: Failed to fetch");
    expect(problemText(ja, { kind: "unclear", status: 502 })).toContain("502");
  });
});
