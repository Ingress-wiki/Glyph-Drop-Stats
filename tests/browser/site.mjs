// The whole site in a real browser: statistics, filters, search and sorting,
// then checking a file, the receipt, a lost answer and retry, lookups,
// withdrawal, the keyboard, and copying over plain HTTP (when `lan` is given).
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { checks } from "./checks.mjs";

export async function siteSuite({ browser, base: BASE, lan: LAN, dir: DIR, screens: SCREENS }) {
  const { check, report } = checks();
  const secret = () => "gds1_" + Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64url");

  async function submitByApi(file) {
    const s = secret();
    const response = await fetch(`${BASE}/api/submissions`, {
      method: "POST",
      headers: { authorization: `Receipt ${s}` },
      body: readFileSync(`${DIR}/${file}`),
    });
    if (response.status !== 201) throw new Error(`setup upload ${file}: ${response.status}`);
    return s;
  }

  const headlineValues = (page) => page.locator("[data-testid=headline] .value").allTextContents();
  /** Item names in table order, without their category tags. */
  const itemNames = (page) =>
    page.locator("[data-testid=items] tbody th").evaluateAll((cells) => cells.map((cell) => cell.firstChild?.textContent ?? ""));
  const itemCells = (page, name) =>
    page.locator("[data-testid=items] tbody tr").filter({ has: page.locator("th", { hasText: name }) }).locator("td").allTextContents();
  const receiptBox = (page) => page.getByRole("textbox", { name: "Receipt", exact: true });

  try {
    const secretA = await submitByApi("a.csv");
    await submitByApi("b.csv");

    const context = await browser.newContext({ locale: "en-US", acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const clipboard = (p) => p.evaluate(() => navigator.clipboard.readText());
    /** Whether the clipboard holds `text` within a few seconds: copying finishes after the click. */
    const clipboardBecomes = (p, text) =>
      p.waitForFunction((want) => navigator.clipboard.readText().then((got) => got === want), text, { timeout: 3000 }).then(() => true, () => false);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    // Statistics, the home page, behind the first-visit note.
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    const note = page.getByRole("dialog", { name: "An important note" });
    await note.waitFor();
    check("the first-visit note opens with its button focused", await note.getByRole("button", { name: "Got it" }).evaluate((b) => b === document.activeElement));
    await page.keyboard.press("Enter");
    await note.waitFor({ state: "hidden" });
    await page.locator("[data-testid=headline]").waitFor();
    const headline = await headlineValues(page);
    check("headline numbers", JSON.stringify(headline) === '["10","5 of 10","2.00","0%","0%"]', JSON.stringify(headline));
    check("few observations are marked", (await page.locator("[data-testid=headline] .few").count()) === 3);
    const resonator = await itemCells(page, "Resonator");
    check("Resonator row matches hand calculation", resonator.join(",") === "7,1.40,80%,1.75,0,0,0,0,3,4,0,0,2,3", resonator.join(","));

    // A chart's tooltip names its row and what the value is over.
    const chart = await page.locator(".ts-chart-host").first().boundingBox();
    await page.mouse.move(chart.x + 30, chart.y + chart.height / 2);
    const tip = await page
      .locator(".ts-chart-host")
      .first()
      .getByText(/eligible/)
      .first()
      .textContent({ timeout: 3000 })
      .catch(() => "");
    check("a chart's tooltip says what its value is over", /Items \/ \d+ eligible/.test(tip), tip);
    await page.mouse.move(0, 0);

    // Pickers, filters, search and sorting.
    await page.getByRole("combobox", { name: /^Items:/ }).selectOption("bonus");
    await page.waitForFunction(() => document.querySelector("[data-testid=items] caption")?.textContent?.includes("bonus panel"));
    check("panel picker", true);
    await page.getByRole("combobox", { name: /^Items:/ }).selectOption("portal");
    await page.waitForFunction(() => document.querySelector("[data-testid=items] caption")?.textContent?.includes("portal panel"));

    await page.keyboard.press("F3");
    await page.getByLabel("Portal level from").fill("6");
    await page.getByLabel("Portal level to").fill("6");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=headline] .value")?.textContent === "6");
    check("F3 opens the filters; the portal level filter applies", true);
    await page.getByLabel("Portal level to").fill("");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.getByText("portalLevelMin and portalLevelMax must be given together.").waitFor();
    check("half-given filter explained, not ignored", true);
    await page.getByRole("button", { name: "Clear" }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=headline] .value")?.textContent === "10");

    await page.getByRole("searchbox", { name: "Search items" }).fill("res");
    check("search narrows the rows", JSON.stringify(await itemNames(page)) === '["Resonator"]', JSON.stringify(await itemNames(page)));
    await page.getByRole("searchbox", { name: "Search items" }).fill("");
    await page.getByRole("button", { name: "levelled" }).first().click();
    check("a category tag searches for its category", (await page.getByRole("searchbox", { name: "Search items" }).inputValue()) === "levelled");
    await page.getByRole("searchbox", { name: "Search items" }).fill("");
    await page.getByRole("columnheader", { name: "Item" }).getByRole("button").click();
    const order = (await itemNames(page)).join(",");
    check("sorting by item", order === "Power Cube,Resonator,XMP Burster", order);
    check("the sorted column says so", (await page.getByRole("columnheader", { name: "Item" }).getAttribute("aria-sort")) === "ascending");
    check("the address records the view", new URL(page.url()).search === "?sort=item", page.url());
    await page.getByRole("button", { name: "Copy link" }).click();
    check("COPY LINK copies the view's address", await clipboardBecomes(page, page.url()), await clipboard(page));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    check("a reload keeps the view", (await itemNames(page)).join(",") === "Power Cube,Resonator,XMP Burster");

    const [tsvDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "TSV" }).click()]);
    const tsv = readFileSync(await tsvDownload.path(), "utf8");
    check("TSV download", tsv.split("\n").some((line) => line.startsWith("Resonator\t7\t5\t1.4\t")));

    await page.keyboard.press("F4");
    const guide = page.getByRole("dialog", { name: "About these numbers" });
    await guide.waitFor();
    await page.keyboard.press("F2");
    check("page shortcuts wait while a dialog is open", (await page.getByRole("button", { name: "Statistics" }).getAttribute("aria-current")) === "page");
    await page.keyboard.press("Escape");
    await guide.waitFor({ state: "hidden" });
    check("F4 opens the guide and Escape closes it", true);
    if (SCREENS) await page.screenshot({ path: `${SCREENS}/statistics.png`, fullPage: true });

    // Submit: check, receipt, a lost answer, then a retry with the same receipt.
    await page.keyboard.press("F2");
    await page.setInputFiles("#file", `${DIR}/a.csv`);
    check("the chosen file is named", (await page.locator("[data-testid=file]").textContent()) === "File: a.csv");
    await page.getByRole("button", { name: "Check file" }).click();
    await page.locator("[data-testid=preview]").waitFor({ state: "attached" });
    const preview = await page.locator("[data-testid=preview]").textContent();
    check("preview of the chosen file", preview.startsWith("8 rows; 6 valid records"), preview);
    await page.getByRole("button", { name: "Create my receipt" }).click();
    const receipt = (await page.locator("[data-testid=receipt]").textContent()) ?? "";
    check("receipt shown in exact case", /^gds1_[A-Za-z0-9_-]{43}$/.test(receipt) && /[a-z]/.test(receipt.slice(5)) && /[A-Z]/.test(receipt.slice(5)), receipt);
    await page.evaluate(() => navigator.clipboard.writeText("nothing yet"));
    await page.locator("[data-testid=receipt]").click();
    await page.keyboard.press("ControlOrMeta+c");
    check("one click selects the receipt, and Cmd/Ctrl+C copies it", await clipboardBecomes(page, receipt), await clipboard(page));
    await page.evaluate(() => navigator.clipboard.writeText("nothing yet"));
    await page.getByRole("button", { name: "Copy" }).click();
    await page.locator("#live", { hasText: "Receipt copied" }).waitFor();
    check("COPY copies the exact receipt and says so", await clipboardBecomes(page, receipt));
    const [receiptDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
    check("receipt download holds the secret", readFileSync(await receiptDownload.path(), "utf8").includes(`Receipt: ${receipt}`));

    const send = page.getByRole("button", { name: "Submit 6 records" });
    check("submitting waits until the receipt is saved", await send.isDisabled());
    await page.route("**/api/submissions", async (route) => {
      const real = await route.fetch();
      check("first attempt committed on the server", real.status() === 201, String(real.status()));
      await route.fulfill({ status: 201, contentType: "application/json", body: '{"ok":true,"repl' });
    });
    await page.getByLabel("I've saved my receipt").check();
    await send.click();
    await page.getByRole("alert").filter({ hasText: /^Couldn't confirm the submission/ }).waitFor();
    check("lost answer offers a retry", true);
    await page.unroute("**/api/submissions");
    await page.getByRole("button", { name: "Try again with the same receipt" }).click();
    await page.locator("[data-testid=submitted]").waitFor();
    check("retry reports the earlier confirmation", (await page.locator("[data-testid=submitted]").textContent()).includes("already been confirmed"));

    // Lookups: a slow answer for one receipt must not show under the next.
    await page.route("**/api/submission", async (route) => {
      if (route.request().headers().authorization === `Receipt ${receipt}`) await new Promise((r) => setTimeout(r, 1500));
      try {
        await route.continue();
      } catch {
        // Aborted when the receipt changed.
      }
    });
    await receiptBox(page).fill(receipt);
    await page.keyboard.press("Enter");
    await receiptBox(page).fill(secret());
    await page.keyboard.press("Enter");
    await page.getByText("No submission has this receipt.").waitFor();
    await page.waitForTimeout(2000);
    check("an earlier receipt's late answer isn't shown", (await page.locator("[data-testid=status]").count()) === 0);
    await page.unroute("**/api/submission");

    // Withdraw A (submitted by the setup), with a lost answer and a retry.
    await receiptBox(page).fill(secretA);
    await page.keyboard.press("Enter");
    await page.locator("[data-testid=status]").waitFor();
    check("lookup shows the submission active", (await page.locator("[data-testid=status]").textContent()).startsWith("Active"));
    await page.getByRole("button", { name: "Withdraw this submission" }).click();
    const confirm = page.getByRole("dialog", { name: "Withdraw this submission?" });
    await confirm.waitFor();
    check("the confirmation focuses the safe choice", await confirm.getByRole("button", { name: "Keep it" }).evaluate((b) => b === document.activeElement));
    await page.route("**/api/submission/withdraw", async (route) => {
      await route.fetch();
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"alr' });
    });
    await confirm.getByRole("button", { name: "Withdraw" }).click();
    await confirm.getByText(/^Couldn't confirm the withdrawal/).waitFor();
    check("lost withdrawal answer offers a retry", true);
    await page.unroute("**/api/submission/withdraw");
    await confirm.getByRole("button", { name: "Try again" }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.startsWith("Withdrawn"));
    await confirm.waitFor({ state: "hidden" });
    check("retry shows it withdrawn and closes the dialog", true);
    if (SCREENS) await page.screenshot({ path: `${SCREENS}/submit.png`, fullPage: true });

    // Statistics reflect the withdrawal at once. The UI upload of a.csv still supports h1-h6.
    await page.keyboard.press("F1");
    await page.waitForTimeout(800);
    check("statistics after withdrawal", (await headlineValues(page))[0] === "10", JSON.stringify(await headlineValues(page)));

    // A malformed statistics answer shows an error; the page keeps working.
    await page.route("**/api/statistics*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"statistics":{"records":{"total":1}}}' }),
    );
    await page.keyboard.press("F2");
    await page.keyboard.press("F1");
    await page.getByRole("alert").filter({ hasText: /^Couldn't load statistics/ }).waitFor();
    check("malformed answer shows an error", true);
    await page.unroute("**/api/statistics*");
    await page.keyboard.press("F2");
    await page.keyboard.press("F1");
    await page.locator("[data-testid=headline]").waitFor();
    check("page recovers on the next good answer", true);

    // Keyboard only: Tab reaches the views from the top of the page.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    check("the first-visit note shows only once", !(await page.getByRole("dialog", { name: "An important note" }).isVisible()));
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.hash === "#submit");
    check("Tab and Enter reach the Submit view", true);

    // COPY over plain HTTP (a LAN address), where the clipboard API isn't available.
    if (LAN) {
      const lan = await context.newPage();
      await lan.goto(`${LAN}/#submit`, { waitUntil: "domcontentloaded" });
      await lan.locator("[data-testid=file]").waitFor();
      check("LAN address isn't a secure context", !(await lan.evaluate(() => window.isSecureContext)));
      await lan.setInputFiles("#file", `${DIR}/a.csv`);
      await lan.getByRole("button", { name: "Check file" }).click();
      await lan.locator("[data-testid=preview]").waitFor({ state: "attached" });
      await lan.getByRole("button", { name: "Create my receipt" }).click();
      const lanReceipt = await lan.locator("[data-testid=receipt]").textContent();
      await page.evaluate(() => navigator.clipboard.writeText("nothing yet"));
      await lan.getByRole("button", { name: "Copy" }).click();
      await lan.locator("#live", { hasText: /Receipt copied|Couldn't copy/ }).waitFor();
      check("COPY works over plain HTTP", (await lan.locator("#live").textContent()) === "Receipt copied" && (await clipboardBecomes(page, lanReceipt)), await lan.locator("#live").textContent());
      await lan.close();
    }

    // Phones: no sideways page scroll, and the wide item table scrolls in its own box.
    await page.keyboard.press("F1");
    await page.locator("[data-testid=headline]").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("no horizontal page scroll at 390px", overflow <= 0, `${overflow}px`);
    if (SCREENS) await page.screenshot({ path: `${SCREENS}/statistics-390.png`, fullPage: true });

    check("no page errors", pageErrors.length === 0, pageErrors.join("; "));
  } catch (error) {
    const page = browser.contexts().at(-1)?.pages().at(-1);
    if (page && SCREENS) await page.screenshot({ path: `${SCREENS}/site-failure.png` }).catch(() => {});
    check("site suite ran to the end", false, String(error).slice(0, 400));
  }
  return report("site");
}
