import { checks, seenContext } from "./checks.mjs";

/** The page in Firefox: statistics with their charts, the native dialogs, and checking a file. */
export async function firefoxSuite({ browser, base: BASE, upload }) {
  const { check, report } = checks();
  try {
    const context = await seenContext(browser, { locale: "en-US", viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    check("statistics load", (await page.locator("[data-testid=headline] .value").first().textContent()) !== "");
    check("charts draw", (await page.locator(".ts-chart-host svg").count()) >= 3);

    await page.keyboard.press("F4");
    const guide = page.getByRole("dialog", { name: "About these numbers" });
    await guide.waitFor();
    await page.keyboard.press("Escape");
    await guide.waitFor({ state: "hidden" });
    check("the guide opens and closes", true);

    await page.keyboard.press("F2");
    await page.setInputFiles("#file", upload);
    await page.getByRole("button", { name: "Check file" }).click();
    await page.locator("[data-testid=preview]").waitFor({ state: "attached" });
    check("a file is checked", (await page.locator("[data-testid=preview]").textContent()).includes("valid records"));
    check("no page errors", errors.length === 0, errors.join("; "));
  } catch (error) {
    check("Firefox check ran to the end", false, String(error).slice(0, 400));
  }
  return report("firefox");
}
