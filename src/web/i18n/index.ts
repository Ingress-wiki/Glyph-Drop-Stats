import { formatTemplate } from "../../domain/issueMessages.ts";
import type { ApiIssue, Problem } from "../api.ts";
import { en, type Messages } from "./en.ts";
import { ja } from "./ja.ts";
import { ko } from "./ko.ts";
import { zhHans } from "./zh-Hans.ts";
import { zhHant } from "./zh-Hant.ts";

/** The languages DynamicGlyph reads the game in, and so the ones this site speaks. */
export const LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_KEY = "glyph-drop-stats:locale";

const CATALOGS: Record<Locale, Messages> = { en, "zh-Hans": zhHans, "zh-Hant": zhHant, ja, ko };

export function messages(locale: Locale): Messages {
  return CATALOGS[locale];
}

export function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

/**
 * The first of the browser's languages this site speaks. Chinese follows its
 * script: Taiwan, Hong Kong and Macau use Traditional, the rest Simplified,
 * unless the tag names a script itself.
 */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const lower = tag.toLowerCase();
    const [language] = lower.split("-");
    if (language === "en") return "en";
    if (language === "ja") return "ja";
    if (language === "ko") return "ko";
    if (language === "zh") {
      if (lower.includes("-hant")) return "zh-Hant";
      if (lower.includes("-hans")) return "zh-Hans";
      return /-(tw|hk|mo)\b/.test(lower) ? "zh-Hant" : "zh-Hans";
    }
  }
  return "en";
}

/**
 * A server message in the page's language: its key's template, with panel
 * stages and filter fields named in that language too. Without a key the
 * page knows, the server's English is shown as it is.
 */
export function issueText(s: Messages, issue: ApiIssue): string {
  const template = issue.key !== undefined && issue.key in s.issues ? s.issues[issue.key as keyof Messages["issues"]] : null;
  let text = issue.message;
  if (template !== null) {
    const params: Record<string, string | number> = { ...issue.params };
    if (typeof params.panel === "string") params.panel = s.terms.panel[params.panel] ?? params.panel;
    if (issue.key?.startsWith("filter.")) {
      for (const name of ["name", "first", "second"]) {
        if (typeof params[name] === "string") params[name] = s.terms.filter[params[name] as string] ?? params[name];
      }
    }
    text = formatTemplate(template, params);
  }
  return issue.line === undefined ? text : s.issueLine(text, issue.line);
}

export function issuesText(s: Messages, issues: readonly ApiIssue[]): string {
  return issues.map((issue) => issueText(s, issue)).join(" ");
}

export function problemText(s: Messages, problem: Problem): string {
  return problem.kind === "network" ? s.problems.network(problem.detail) : s.problems[problem.kind](problem.status);
}
