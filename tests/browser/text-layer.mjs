import { activate, checks, dialogsClosed } from "./keyboard.mjs";

/**
 * The transparent text layer over the canvas: selecting, copying and finding
 * canvas text, while controls, shortcuts and scrolling keep working.
 */
export async function textLayerSuite({ browser, base: BASE, upload: UPLOAD }) {
  const { check, report } = checks();
  try {
    const context = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 900 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    const run = (text) => page.locator("#canvas-text .canvas-text-run").filter({ hasText: new RegExp(`^${text}\\s*$`, "i") }).first();
    const clip = () => page.evaluate(() => navigator.clipboard.readText());
    const guideShown = async () => (await run("ABOUT THESE NUMBERS").count()) > 0;

    // First visit: the note is a dialog, and page shortcuts wait for it.
    await page.waitForTimeout(1200);
    await page.keyboard.press("F4");
    await page.waitForTimeout(800);
    check("F4 doesn't open the guide over the first-visit note", !(await guideShown()));
    await page.keyboard.press("Escape");
    await dialogsClosed(page);
    await page.keyboard.press("F4");
    await run("ABOUT THESE NUMBERS").waitFor();
    check("F4 opens the guide once the note is closed", true);
    await page.keyboard.press("Escape");
    await dialogsClosed(page);

    // Drag-select ordinary canvas text and copy it.
    const res = await run("Resonator").boundingBox();
    check("text layer has the item names", res !== null, JSON.stringify(res));
    await page.evaluate(() => navigator.clipboard.writeText("nothing yet"));
    await page.mouse.move(res.x + 1, res.y + res.height / 2);
    await page.mouse.down();
    await page.mouse.move(res.x + res.width - 1, res.y + res.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("ControlOrMeta+c");
    await page.waitForTimeout(200);
    check("drag-select an item name and copy it", (await clip()).trim() === "Resonator", JSON.stringify(await clip()));

    // A headline number, scaled 2x.
    const ten = await page.locator("#canvas-text .canvas-text-run").filter({ hasText: /^10\s*$/ }).first().boundingBox();
    await page.mouse.dblclick(ten.x + ten.width / 2, ten.y + ten.height / 2);
    await page.keyboard.press("ControlOrMeta+c");
    await page.waitForTimeout(200);
    check("double-click a headline number and copy it", (await clip()).trim() === "10", JSON.stringify(await clip()));

    // Selection survives hover-driven redraws.
    const before = await page.evaluate(() => getSelection().toString());
    await page.mouse.move(700, 120, { steps: 5 });
    await page.mouse.move(300, 250, { steps: 5 });
    await page.waitForTimeout(300);
    check("selection survives redraws while hovering", (await page.evaluate(() => getSelection().toString())) === before && before.trim() === "10");

    // Browser find sees canvas text.
    check("browser find sees canvas text", await page.evaluate(() => window.find("Power Cube")));

    // Controls still take clicks through the layer, and shortcuts work after selecting.
    const submitTab = await run("SUBMIT").boundingBox();
    await page.mouse.click(submitTab.x + submitTab.width / 2, submitTab.y + submitTab.height / 2);
    await page.waitForTimeout(500);
    check("clicking a tab label still switches views", (await page.locator("#mirror h2").first().textContent()) === "Submit");
    await page.keyboard.press("F1");
    await page.waitForTimeout(500);
    check("F1 works after selecting page text", (await page.locator("#mirror h2").first().textContent()) === "Statistics");
    const tsv = await run("TSV").boundingBox();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }).catch(() => null), page.mouse.click(tsv.x + tsv.width / 2, tsv.y + tsv.height / 2)]);
    check("clicking a button label still activates it (TSV download)", download !== null);

    // Wheel over text still scrolls the canvas: a short window and a long page.
    await page.setViewportSize({ width: 1440, height: 450 });
    await page.keyboard.press("F2");
    await page.waitForTimeout(400);
    await page.setInputFiles("#file", UPLOAD);
    await activate(page, "Check file");
    await page.locator("[data-testid=preview]").waitFor();
    await page.waitForTimeout(500);
    const lede = run("Check a DynamicGlyph gear export.*");
    const ledeBefore = await lede.boundingBox();
    await page.mouse.move(ledeBefore.x + 40, ledeBefore.y + ledeBefore.height / 2);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(800);
    const ledeAfter = (await lede.count()) > 0 ? await lede.boundingBox() : null;
    check("wheel over text scrolls the canvas", ledeAfter === null || ledeAfter.y < ledeBefore.y, `lede y ${ledeBefore.y} -> ${ledeAfter?.y ?? "scrolled out"}`);
    check("no page errors", errors.length === 0, errors.join("; "));
  } catch (error) {
    check("text layer check ran to the end", false, String(error).slice(0, 400));
  }
  return report("text layer");
}
