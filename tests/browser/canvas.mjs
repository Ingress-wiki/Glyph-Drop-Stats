// Browser smoke test for the canvas UI. The canvas has no DOM to query, so the
// test drives it by keyboard (Tab until the focus announcement names a control,
// then Enter) and reads results from the accessible mirror.
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { activate, checks, dialogsClosed } from "./keyboard.mjs";

/**
 * The whole flow: statistics, filters, search and sorting, then checking a
 * file, the receipt, a lost answer and retry, lookups, withdrawal, the text
 * view and copying over plain HTTP (when `lan` is given).
 */
export async function canvasSuite({ browser, base: BASE, lan: LAN, dir: DIR, screens: SCREENS }) {
  const { check, report } = checks();
  const secret = () =>
    "gds1_" + Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64url");

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

  const mirrorText = (page, id) => page.locator(`[data-testid=${id}]`).textContent();
  const headline = (page) => mirrorText(page, "headline");
  const itemRows = async (page) =>
    (await page.locator("[data-testid=items] tbody tr").allTextContents()).map((row) => row.trim());

  async function typeInto(page, label, text) {
    await activate(page, label, "End");
    for (let i = 0; i < 80; i++) await page.keyboard.press("Backspace");
    if (text) await page.keyboard.type(text, { delay: 10 });
  }

  try {
    const secretA = await submitByApi("a.csv");
    await submitByApi("b.csv");

    const context = await browser.newContext({ locale: "en-US", acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const clipboard = (p) => p.evaluate(() => navigator.clipboard.readText());
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    // Statistics, the home page.
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    check("the canvas started (no fallback)", !(await page.evaluate(() => document.body.classList.contains("fallback"))));
    await activate(page, "Got it");
    await dialogsClosed(page);
    check("headline numbers", (await headline(page)) === "Records10Eligible observations5 of 10Items10Per observation2.00", await headline(page));
    const resonator = (await itemRows(page)).find((row) => row.startsWith("Resonator"));
    check("Resonator row matches hand calculation", resonator === "Resonator71.400000340023", resonator);

    // Pickers, filters, search and sorting, all by keyboard.
    await activate(page, "Items: portal");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-testid=items] caption")?.textContent?.includes("bonus panel"));
    check("panel picker by keyboard", true);
    await activate(page, "Items: bonus");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-testid=items] caption")?.textContent?.includes("portal panel"));
    check("panel picker back by keyboard", true);

    await page.keyboard.press("F3");
    await typeInto(page, "Portal level from", "6");
    await typeInto(page, "Portal level to", "6");
    await activate(page, "Apply");
    await page.waitForFunction(() => document.querySelector("[data-testid=headline] dd")?.textContent === "6");
    check("portal level filter", true);
    await typeInto(page, "Portal level to", "");
    await activate(page, "Apply");
    await page.locator("#mirror").getByText("portalLevelMin and portalLevelMax must be given together.").waitFor();
    check("half-given filter explained, not ignored", true);
    await activate(page, "Clear");
    await page.waitForFunction(() => document.querySelector("[data-testid=headline] dd")?.textContent === "10");

    await typeInto(page, "Search items", "res");
    await page.waitForTimeout(200);
    check("search narrows the rows", JSON.stringify((await itemRows(page)).map((r) => r.split(/\d/)[0])) === '["Resonator"]');
    await typeInto(page, "Search items", "");
    await activate(page, "Sort by Item");
    await page.waitForTimeout(200);
    const order = (await itemRows(page)).map((r) => r.split(/\d/)[0]).join(",");
    check("sorting by item", order === "Power Cube,Resonator,XMP Burster", order);

    const [tsvDownload] = await Promise.all([page.waitForEvent("download"), activate(page, "TSV")]);
    const tsv = readFileSync(await tsvDownload.path(), "utf8");
    check("TSV download", tsv.split("\n").some((line) => line.startsWith("Resonator\t7\t5\t1.4\t")));

    await page.screenshot({ path: `${DIR}/smoke-stats.png` });

    // Submit: check, receipt, a lost answer, then a retry with the same receipt.
    await page.keyboard.press("F2");
    await page.setInputFiles("#file", `${DIR}/a.csv`);
    await activate(page, "Check file");
    await page.locator("[data-testid=preview]").waitFor();
    check("preview of the chosen file", (await mirrorText(page, "preview")).startsWith("8 rows; 6 valid records"), await mirrorText(page, "preview"));
    await activate(page, "Create my receipt");
    const receipt = (await mirrorText(page, "receipt")).replace("Your receipt: ", "");
    check("receipt shown in exact case", /^gds1_[A-Za-z0-9_-]{43}$/.test(receipt) && /[a-z]/.test(receipt.slice(5)) && /[A-Z]/.test(receipt.slice(5)));
    // Select the receipt (Tab selects it all) and copy it with the keyboard.
    await page.evaluate(() => navigator.clipboard.writeText("nothing yet"));
    await activate(page, "Your receipt", "ControlOrMeta+c");
    check("receipt selected and copied with Cmd/Ctrl+C", (await clipboard(page)) === receipt, await clipboard(page));
    await page.evaluate(() => navigator.clipboard.writeText("nothing yet"));
    await activate(page, "Copy");
    await page.locator("#live", { hasText: "Receipt copied" }).waitFor();
    check("COPY button copies the exact receipt", (await clipboard(page)) === receipt);
    const [receiptDownload] = await Promise.all([page.waitForEvent("download"), activate(page, "Download")]);
    check("receipt download holds the secret", readFileSync(await receiptDownload.path(), "utf8").includes(`Receipt: ${receipt}`));

    await page.route("**/api/submissions", async (route) => {
      const real = await route.fetch();
      check("first attempt committed on the server", real.status() === 201, String(real.status()));
      await route.fulfill({ status: 201, contentType: "application/json", body: '{"ok":true,"repl' });
    });
    await activate(page, "I've saved my receipt");
    await activate(page, "Submit 6 records");
    await page.locator("#mirror").getByText(/^Couldn't confirm the submission/).waitFor();
    check("lost answer offers a retry", true);
    await page.unroute("**/api/submissions");
    await activate(page, "Try again with the same receipt");
    await page.locator("[data-testid=submitted]").waitFor();
    check("retry reports the earlier confirmation", (await mirrorText(page, "submitted")).includes("already been confirmed"));

    // Lookups: a slow answer for A must not show under B.
    await page.route("**/api/submission", async (route) => {
      if (route.request().headers().authorization === `Receipt ${receipt}`) await new Promise((r) => setTimeout(r, 1500));
      try {
        await route.continue();
      } catch {
        // Aborted when the receipt changed.
      }
    });
    await typeInto(page, "Receipt", receipt);
    await page.keyboard.press("Enter");
    await typeInto(page, "Receipt", secret());
    await page.keyboard.press("Enter");
    await page.locator("#mirror").getByText("No submission has this receipt.").waitFor();
    await page.waitForTimeout(2000);
    check("an earlier receipt's late answer isn't shown", (await page.locator("[data-testid=status]").count()) === 0);
    await page.unroute("**/api/submission");

    // Withdraw A (submitted by the setup), with a lost answer and a retry.
    await typeInto(page, "Receipt", secretA);
    await page.keyboard.press("Enter");
    await page.locator("[data-testid=status]").waitFor();
    check("lookup shows the submission active", (await mirrorText(page, "status")).startsWith("Active"));
    await activate(page, "Withdraw this submission");
    await page.route("**/api/submission/withdraw", async (route) => {
      await route.fetch();
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"alr' });
    });
    await activate(page, "Withdraw");
    await page.locator("#mirror").getByText(/^Couldn't confirm the withdrawal/).waitFor();
    check("lost withdrawal answer offers a retry", true);
    await page.unroute("**/api/submission/withdraw");
    await activate(page, "Try again");
    await page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.startsWith("Withdrawn"));
    check("retry shows it withdrawn", true);
    await page.screenshot({ path: `${DIR}/smoke-submit.png` });

    // Statistics reflect the withdrawal at once. The UI upload of a.csv still supports h1-h6.
    await dialogsClosed(page);
    await page.keyboard.press("F1");
    await page.waitForTimeout(800);
    check("statistics after withdrawal", (await headline(page)).startsWith("Records10"), await headline(page));

    // A malformed statistics answer shows an error; the page keeps working.
    await page.route("**/api/statistics*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"statistics":{"records":{"total":1}}}' }),
    );
    await page.keyboard.press("F2");
    await page.waitForTimeout(150);
    await page.keyboard.press("F1");
    await page.locator("#mirror").getByText(/^Couldn't load statistics/).waitFor();
    check("malformed answer shows an error", true);
    await page.unroute("**/api/statistics*");
    await page.keyboard.press("F2");
    await page.waitForTimeout(150);
    await page.keyboard.press("F1");
    await page.locator("[data-testid=headline]").waitFor();
    check("page recovers on the next good answer", true);

    // The text view: the mirror on screen, where text can be selected, copied and found.
    await page.waitForTimeout(200);
    await page.keyboard.press("F9");
    await page.waitForFunction(() => document.body.classList.contains("text-view"));
    const shown = await page.evaluate(() => {
      const headline = document.querySelector("[data-testid=headline]");
      const range = document.createRange();
      range.selectNodeContents(headline);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return {
        canvas: getComputedStyle(document.getElementById("screen")).display,
        width: headline.getBoundingClientRect().width,
        selected: getSelection().toString(),
      };
    });
    check("text view shows real, selectable text instead of the canvas", shown.canvas === "none" && shown.width > 100 && shown.selected.startsWith("Records"), JSON.stringify(shown));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    await page.waitForTimeout(1000);
    check("text view is remembered", await page.evaluate(() => document.body.classList.contains("text-view")));
    await page.getByRole("button", { name: "Back to the canvas view (F9)" }).click();
    await page.waitForFunction(() => !document.body.classList.contains("text-view"));
    check("back to the canvas", (await page.evaluate(() => getComputedStyle(document.getElementById("screen")).display)) === "block");
    await page.waitForTimeout(300);
    await page.keyboard.press("F9");
    await page.waitForFunction(() => document.body.classList.contains("text-view"));
    await page.keyboard.press("F9");
    await page.waitForFunction(() => !document.body.classList.contains("text-view"));
    check("F9 toggles the text view both ways", true);

    // COPY over plain HTTP (a LAN address), where the clipboard API isn't available.
    if (LAN) {
      const lan = await context.newPage();
      await lan.goto(`${LAN}/#submit`, { waitUntil: "domcontentloaded" });
      await lan.locator("[data-testid=file]").waitFor();
      check("LAN address isn't a secure context", !(await lan.evaluate(() => window.isSecureContext)));
      await lan.waitForTimeout(1500);
      await lan.setInputFiles("#file", `${DIR}/a.csv`);
      await activate(lan, "Check file");
      await lan.locator("[data-testid=preview]").waitFor();
      await activate(lan, "Create my receipt");
      const lanReceipt = (await lan.locator("[data-testid=receipt]").textContent()).replace("Your receipt: ", "");
      await page.evaluate(() => navigator.clipboard.writeText("nothing yet"));
      await activate(lan, "Copy");
      await lan.locator("#live", { hasText: /Receipt copied|Couldn't copy/ }).waitFor();
      check("COPY works over plain HTTP", (await lan.locator("#live").textContent()) === "Receipt copied" && (await clipboard(page)) === lanReceipt, await lan.locator("#live").textContent());
      await page.evaluate(() => navigator.clipboard.writeText("nothing yet"));
      await activate(lan, "Your receipt", "ControlOrMeta+c");
      check("Cmd/Ctrl+C on the receipt works over plain HTTP", (await clipboard(page)) === lanReceipt);
      await lan.close();
    }

    // The first-visit note shows once; phones get no horizontal page scroll.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    await page.keyboard.press("Tab");
    await page.waitForTimeout(200);
    check("first-visit note shows only once", !((await page.locator("#focus-live").textContent()) ?? "").startsWith("Got it"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("no horizontal page scroll at 390px", overflow <= 0, `${overflow}px`);
    await page.screenshot({ path: `${DIR}/smoke-390.png` });

    check("no page errors", pageErrors.length === 0, pageErrors.join("; "));
  } catch (error) {
    // Where it stopped: the focused control, and a picture for the CI artifact.
    const page = browser.contexts().at(-1)?.pages().at(-1);
    const focused = page ? await page.locator("#focus-live").textContent().catch(() => "?") : "?";
    if (page && SCREENS) await page.screenshot({ path: `${SCREENS}/canvas-failure.png` }).catch(() => {});
    check("smoke test ran to the end", false, `${String(error).slice(0, 400)}; focus: ${focused}`);
  }
  return report("canvas");
}
