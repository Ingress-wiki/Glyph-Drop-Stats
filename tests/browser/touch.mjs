import { checks, newContext } from "./keyboard.mjs";

/**
 * A phone: a finger scrolls the canvas, a tap still presses a control and a
 * swipe that starts on one doesn't, the switches that don't fit beside the
 * title are in a menu, and every section fits the screen.
 */
export async function touchSuite({ browser, base: BASE, dir: DIR }) {
  const { check, report } = checks();
  try {
    const context = await newContext(browser, { locale: "en-US", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await context.addInitScript(() => localStorage.setItem("glyph-drop-stats:disclaimer-seen", "1"));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    await page.waitForTimeout(1500);

    const cdp = await context.newCDPSession(page);
    const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    const swipe = async (x, fromY, toY) => {
      const step = toY < fromY ? -20 : 20;
      await touch("touchStart", x, fromY);
      for (let y = fromY + step; step < 0 ? y >= toY : y <= toY; y += step) {
        await touch("touchMove", x, y);
        await page.waitForTimeout(16);
      }
      await touch("touchEnd", x, toY);
      await page.waitForTimeout(1200);
    };
    const run = (re) => page.locator("#canvas-text .canvas-text-run").filter({ hasText: re }).first();
    const yOf = async (re) => ((await run(re).count()) > 0 ? (await run(re).boundingBox()).y : null);
    const tapAt = (x, y) => page.touchscreen.tap(x, y);
    const tap = async (re) => {
      const box = await run(re).boundingBox();
      await tapAt(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(600);
    };
    const toTop = async () => {
      for (let i = 0; i < 8 && (await yOf(/^Records\s*$/i)) === null; i++) await swipe(200, 250, 800);
    };

    check("no F-key shortcuts on a touch screen", (await run(/^F1\s*$/).count()) === 0);

    const before = await yOf(/^Records\s*$/i);
    await swipe(200, 700, 300);
    const after = await yOf(/^Records\s*$/i);
    check("a swipe scrolls the canvas", before !== null && (after === null || after < before - 100), `${before} -> ${after}`);
    await toTop();

    const about = await run(/^About\s*$/i).boundingBox();
    await swipe(about.x + about.width / 2, about.y + about.height / 2, about.y + about.height / 2 - 200);
    check("a swipe that starts on a button doesn't press it", (await run(/^About these numbers\s*$/i).count()) === 0);
    await toTop();
    await tap(/^About\s*$/i);
    check("a tap presses a button", (await run(/^About these numbers\s*$/i).count()) > 0);
    await page.keyboard.press("Escape");
    await run(/^About these numbers\s*$/i).waitFor({ state: "detached" });
    await page.waitForTimeout(600);

    // The menu button sits right of the language switch: 4 px of padding, a 4 px gap, then its middle.
    check("only the language switch stays beside the title", (await run(/^Text view\s*$/i).count()) === 0 && (await run(/^EN\s*$/).count()) > 0);
    const language = await run(/^EN\s*$/).boundingBox();
    await tapAt(language.x + language.width + 15 * 2.4, language.y + language.height / 2);
    await page.waitForTimeout(600);
    const inMenu = (await run(/^Text view\s*$/i).count()) > 0;
    check("the menu holds the other switches", inMenu);
    if (inMenu) {
      await tap(/^Text view\s*$/i);
      check("a menu item does what its switch did", await page.evaluate(() => document.body.classList.contains("text-view")));
      await page.getByRole("button", { name: "Back to the canvas view (F9)" }).tap();
      await page.waitForFunction(() => !document.body.classList.contains("text-view"));
      await page.waitForTimeout(800);
    }

    for (let i = 0; i < 12 && (await run(/^Sort: /).count()) === 0; i++) await swipe(200, 700, 300);
    check("the item table is a list with a sort picker", (await run(/^Sort: /).count()) > 0);
    await page.screenshot({ path: `${DIR}/touch-390.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("no sideways page scroll", overflow <= 0, `${overflow}px`);
    check("no page errors", errors.length === 0, errors.join("; "));
  } catch (error) {
    check("touch check ran to the end", false, String(error).slice(0, 400));
  }
  return report("touch");
}
