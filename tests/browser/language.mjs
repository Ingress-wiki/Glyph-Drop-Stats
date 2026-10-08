import { writeFileSync } from "node:fs";
import { LOCALES, messages } from "../../src/web/i18n/index.ts";
import { SOURCE_URL } from "../../src/web/site.ts";
import { checks } from "./keyboard.mjs";

/** Tab until the focus announcement is exactly `announced`, then press `key`. */
async function activateExactly(page, announced, key = "Enter", max = 60) {
  for (let i = 0; i < max; i++) {
    if ((await page.locator("#focus-live").textContent()) === announced) {
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
      return;
    }
    await page.keyboard.press("Tab");
    await page.waitForTimeout(60);
  }
  throw new Error(`never reached "${announced}" by Tab; last focus: ${await page.locator("#focus-live").textContent()}`);
}

/**
 * The page's languages: the first visit follows the browser, the switch in
 * the top bar changes everything (canvas, mirror, page text, server
 * messages) and is remembered. Saves a screenshot per language to `dir`.
 */
export async function languageSuite({ browser, base: BASE, dir: DIR }) {
  const { check, report } = checks();
  try {
    const ja = messages("ja");
    const ko = messages("ko");
    const context = await browser.newContext({ locale: "ja-JP", viewport: { width: 1024, height: 720 } });
    // The first-visit note is covered by the canvas suite; here it would only take the keyboard.
    await context.addInitScript(() => localStorage.setItem("glyph-drop-stats:disclaimer-seen", "1"));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    check(
      "a Japanese browser gets Japanese",
      (await page.evaluate(() => document.documentElement.lang)) === "ja" && (await page.locator("#mirror h2").first().textContent()) === ja.app.statistics,
    );
    check("the page's own text follows", (await page.locator("#canvas-view").textContent()) === ja.app.backToCanvas);
    check("item names stay as the game prints them", (await page.locator("[data-testid=items] tbody th").allTextContents()).includes("Resonator"));

    await page.waitForTimeout(800);
    await activateExactly(page, ja.a11y.button(ja.app.language));
    await page.waitForTimeout(300);
    const focusedInPicker = await page.locator("#focus-live").textContent();
    check("opening the picker focuses the current language", focusedInPicker === ja.a11y.button(ja.language.name), focusedInPicker);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(150);
    await activateExactly(page, ja.a11y.button(ko.language.name), "Enter", 1);
    await page.waitForFunction(() => document.documentElement.lang === "ko");
    check("the switch changes the language", (await page.locator("#mirror h2").first().textContent()) === ko.app.statistics);
    await page.waitForTimeout(600);
    const focusedAfter = await page.locator("#focus-live").textContent();
    check("closing the picker returns the focus to the switch", focusedAfter === ko.a11y.button(ko.app.language), focusedAfter);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    check("the choice is remembered over the browser's", (await page.evaluate(() => document.documentElement.lang)) === "ko");

    // A server message, translated by its key.
    await page.waitForTimeout(1000);
    await page.keyboard.press("F2");
    await page.locator("[data-testid=file]").waitFor();
    await page.waitForTimeout(300);
    writeFileSync(`${DIR}/not-an-export.csv`, "name,value\nx,1\n");
    await page.setInputFiles("#file", `${DIR}/not-an-export.csv`);
    await activateExactly(page, ko.a11y.button(ko.submit.checkFile));
    const translated = await page
      .locator("#mirror li", { hasText: ko.issues["file.notGearExport"] })
      .waitFor({ state: "attached", timeout: 10000 })
      .then(() => true, () => false);
    check("server messages are shown in the page's language", translated, translated ? "" : (await page.locator("#mirror").textContent()).slice(0, 300));

    // The smooth font: the text layer shows the text, and the choice is remembered.
    await page.keyboard.press("F1");
    await page.locator("[data-testid=headline]").waitFor();
    await page.waitForTimeout(500);
    const inkOf = () =>
      page.evaluate(() => {
        const run = [...document.querySelectorAll("#canvas-text .canvas-text-run")].find((node) => node.textContent?.trim() === "Resonator");
        return run ? getComputedStyle(run).color : null;
      });
    check("pixel font: the text layer is transparent", (await inkOf()) === "rgba(0, 0, 0, 0)", await inkOf());
    await activateExactly(page, ko.a11y.button(ko.app.fontPixel));
    await page.waitForTimeout(300);
    const smoothInk = await inkOf();
    check("smooth font: the text layer shows the text", smoothInk !== null && smoothInk !== "rgba(0, 0, 0, 0)", smoothInk);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    await page.waitForTimeout(1000);
    check("the font choice is remembered", (await inkOf()) !== "rgba(0, 0, 0, 0)");
    await activateExactly(page, ko.a11y.button(ko.app.fontSmooth));
    await page.waitForTimeout(300);
    check("back to the pixel font", (await inkOf()) === "rgba(0, 0, 0, 0)");

    // The code's link: the top bar opens it, and the text view has it as a link.
    await context.route("https://github.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "ok" }));
    const [popup] = await Promise.all([context.waitForEvent("page"), activateExactly(page, ko.a11y.button(ko.app.source))]);
    await popup.waitForURL(SOURCE_URL);
    check("GitHub opens the repository in a new tab", popup.url() === SOURCE_URL, popup.url());
    await popup.close();
    check("the text view links to the repository", (await page.locator(`#mirror a[href="${SOURCE_URL}"]`).count()) === 1);

    // Every language draws without errors; screenshots for a look.
    await page.keyboard.press("F1");
    for (const locale of LOCALES) {
      await page.evaluate((value) => localStorage.setItem("glyph-drop-stats:locale", value), locale);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("[data-testid=headline]").waitFor();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${DIR}/language-${locale}.png` });
      check(`${locale} draws`, (await page.locator("#mirror h1").textContent()) === messages(locale).app.title);
    }
    check("no page errors", errors.length === 0, errors.join("; "));
  } catch (error) {
    check("language check ran to the end", false, String(error).slice(0, 400));
  }
  return report("languages");
}
