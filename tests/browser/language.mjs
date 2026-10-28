import { writeFileSync } from "node:fs";
import { LOCALES, messages } from "../../src/web/i18n/index.ts";
import { SOURCE_URL } from "../../src/web/site.ts";
import { checks, seenContext } from "./checks.mjs";

/**
 * The page's languages: the first visit follows the browser, the switch in
 * the top bar changes everything (page text, dialogs, server messages) and is
 * remembered. Saves a screenshot per language to `dir`.
 */
export async function languageSuite({ browser, base: BASE, dir: DIR }) {
  const { check, report } = checks();
  try {
    const ja = messages("ja");
    const ko = messages("ko");
    const context = await seenContext(browser, { locale: "ja-JP", viewport: { width: 1024, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const tab = (name) => page.getByRole("navigation").getByRole("button", { name });

    // Counting multiplied quantities, so this small dataset has item rows to name.
    await page.goto(`${BASE}/?multiplied=include`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    check(
      "a Japanese browser gets Japanese",
      (await page.evaluate(() => document.documentElement.lang)) === "ja" && (await tab(ja.app.statistics).getAttribute("aria-current")) === "page",
    );
    check("item names stay as the game prints them", (await page.locator("[data-testid=items] tbody th").allTextContents()).some((name) => name.startsWith("Resonator")));

    await page.getByRole("combobox", { name: ja.app.language }).selectOption("ko");
    await page.waitForFunction(() => document.documentElement.lang === "ko");
    check("the switch changes the language", (await tab(ko.app.statistics).count()) === 1);
    check("the live region names the new language", (await page.locator("#live").textContent()) === ko.language.name);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    check("the choice is remembered over the browser's", (await page.evaluate(() => document.documentElement.lang)) === "ko");

    // A server message, translated by its key.
    await page.keyboard.press("F2");
    writeFileSync(`${DIR}/not-an-export.csv`, "name,value\nx,1\n");
    await page.setInputFiles("#file", `${DIR}/not-an-export.csv`);
    await page.getByRole("button", { name: ko.submit.checkFile }).click();
    const translated = await page
      .getByText(ko.issues["file.notGearExport"])
      .waitFor({ timeout: 10000 })
      .then(() => true, () => false);
    check("server messages are shown in the page's language", translated);

    check("GitHub links to the repository in a new tab", (await page.locator(`a[href="${SOURCE_URL}"][target=_blank]`).count()) === 1);

    // Every language renders without errors; screenshots for a look.
    for (const locale of LOCALES) {
      await page.evaluate((value) => localStorage.setItem("glyph-drop-stats:locale", value), locale);
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.locator("[data-testid=headline]").waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${DIR}/language-${locale}.png`, fullPage: true });
      check(`${locale} renders`, (await page.title()) === messages(locale).app.title && (await page.evaluate(() => document.documentElement.lang)) === locale);
    }
    check("no page errors", errors.length === 0, errors.join("; "));
  } catch (error) {
    check("language check ran to the end", false, String(error).slice(0, 400));
  }
  return report("languages");
}
