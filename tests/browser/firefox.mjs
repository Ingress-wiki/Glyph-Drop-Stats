import { checks } from "./keyboard.mjs";

/**
 * Selecting canvas text in Firefox, whose word boundaries differ from
 * Chrome's: a word split into fixed-width boxes double-clicks as one letter.
 */
export async function firefoxSuite({ browser, base: BASE }) {
  const { check, report } = checks();
  try {
    const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => localStorage.setItem("glyph-drop-stats:disclaimer-seen", "1"));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    await page.waitForTimeout(1500);
    check("the canvas started (no fallback)", !(await page.evaluate(() => document.body.classList.contains("fallback"))));
    const run = (re) => page.locator("#canvas-text .canvas-text-run").filter({ hasText: re }).first();
    const selected = () => page.evaluate(() => getSelection().toString());

    const name = await run(/^Resonator\s*$/).boundingBox();
    await page.mouse.move(name.x + 1, name.y + name.height / 2);
    await page.mouse.down();
    await page.mouse.move(name.x + name.width - 1, name.y + name.height / 2, { steps: 8 });
    await page.mouse.up();
    check("drag selects an item name", (await selected()).trim() === "Resonator", JSON.stringify(await selected()));

    const number = await run(/^10\s*$/).boundingBox();
    await page.mouse.dblclick(number.x + number.width / 4, number.y + number.height / 2);
    check("double-click selects a whole number", (await selected()).trim() === "10", JSON.stringify(await selected()));

    const prose = await run(/^Each counted once\s*$/i).boundingBox();
    await page.mouse.dblclick(prose.x + prose.width * 0.85, prose.y + prose.height / 2);
    check("double-click selects a whole word", (await selected()).trim() === "once", JSON.stringify(await selected()));
    check("no page errors", errors.length === 0, errors.join("; "));
  } catch (error) {
    check("Firefox check ran to the end", false, String(error).slice(0, 400));
  }
  return report("firefox");
}
