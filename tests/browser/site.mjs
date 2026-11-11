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
    check("items come from both panels unless chosen otherwise", (await page.getByRole("combobox", { name: /^Items:/ }).inputValue()) === "both");
    check("multiplied observations are left out unless chosen otherwise", (await page.getByRole("combobox", { name: /^Multiplied:/ }).inputValue()) === "exclude");
    // The hand calculations below read the portal panel alone and count multiplied quantities.
    await page.getByRole("combobox", { name: /^Items:/ }).selectOption("portal");
    await page.waitForFunction(() => document.querySelector("[data-testid=items] caption")?.textContent?.includes("portal panel"));
    await page.getByRole("combobox", { name: /^Multiplied:/ }).selectOption("include");
    await page.waitForFunction(() => document.querySelector("[data-testid=items] caption")?.textContent?.includes("over 5 eligible"));
    const headline = await headlineValues(page);
    check("headline numbers", JSON.stringify(headline) === '["10","5 of 10","2.00","0%","0%"]', JSON.stringify(headline));
    check("few observations are marked", (await page.locator("[data-testid=headline] .few").count()) === 3);
    const resonator = await itemCells(page, "Resonator");
    check("Resonator row matches hand calculation", resonator.join(",") === "7,1.40,80%,1.75,0,0,0,0,3,4,0,0,—,—,—,—,2,3", resonator.join(","));

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

    // Leaving out the hacks with a red or unread quantity keeps 3 of the 5 eligible observations.
    await page.getByRole("combobox", { name: /^Multiplied:/ }).selectOption("exclude");
    await page.waitForFunction(() => document.querySelector("[data-testid=items] caption")?.textContent?.includes("over 3 eligible"));
    const plain = (await itemNames(page)).sort().join(",");
    check("leaving out multiplied observations", plain === "Power Cube,Resonator", plain);
    check("the address leaves the default out", new URL(page.url()).searchParams.get("multiplied") === null, page.url());
    await page.getByRole("combobox", { name: /^Multiplied:/ }).selectOption("include");
    await page.waitForFunction(() => document.querySelector("[data-testid=items] caption")?.textContent?.includes("over 5 eligible"));

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
    check("the address records the view", new URL(page.url()).search === "?panels=portal&multiplied=include&sort=item", page.url());
    await page.getByRole("button", { name: "Copy link" }).click();
    check("COPY LINK copies the view's address", await clipboardBecomes(page, page.url()), await clipboard(page));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=headline]").waitFor();
    check("a reload keeps the view", (await itemNames(page)).join(",") === "Power Cube,Resonator,XMP Burster");

    // Count distributions: no shields in this dataset, so the first item, Resonator (2, 3, 0, 1, 1).
    const figures = () => page.locator("[data-testid=distribution] dd").allTextContents();
    check("count distribution figures match hand calculation", (await figures()).join(",") === "5,1.40,1.30,0.93", (await figures()).join(","));
    await page.getByRole("combobox", { name: "Item", exact: true }).selectOption("Power Cube");
    check("choosing another item shows its counts", (await figures()).join(",") === "5,0.40,0.80,2.00", (await figures()).join(","));
    check("the address records the item", new URL(page.url()).searchParams.get("item") === "Power Cube", page.url());

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

    // A read-only agent key: made in the page, shown once, usable over MCP until revoked.
    const mcpCall = (key, tool) =>
      fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: {} } }),
      }).then((response) => response.json());
    await page.getByRole("button", { name: "Create a key" }).click();
    const keyValue = page.locator("[data-testid=agent-key-value]");
    await keyValue.waitFor();
    const agentKey = (await keyValue.textContent()) ?? "";
    check("a new agent key is shown once, in its own alphabet", /^gdsr_[A-Za-z0-9_-]{43}$/.test(agentKey), agentKey);
    check("the page says how many submissions the key covers", (await page.locator("[data-testid=agent-key-covers]").textContent()) === "This key covers 1 submission.");
    check("no second key replaces one still on screen", (await page.getByRole("button", { name: "Create a key" }).count()) === 0);
    await page.locator("[data-testid=agent-key]").getByRole("button", { name: "Copy" }).click();
    check("COPY copies the exact agent key", await clipboardBecomes(page, agentKey));
    const mine = await mcpCall(agentKey, "get_my_submissions");
    const counted = JSON.parse(mine.result?.content?.[0]?.text ?? "{}").countedRecords;
    check("an agent reads the submission's records with the key", counted === 6, JSON.stringify(mine).slice(0, 200));
    await page.getByRole("textbox", { name: "Agent key", exact: true }).fill(agentKey);
    await page.getByRole("button", { name: "Revoke key" }).click();
    await page.getByText("Key revoked.", { exact: false }).waitFor();
    check("revoking clears the field", (await page.getByRole("textbox", { name: "Agent key", exact: true }).inputValue()) === "");
    const revoked = await mcpCall(agentKey, "get_my_submissions");
    check("a revoked key reads nothing", revoked.result?.isError === true && revoked.result.content[0].text.includes("No agent key matches"), JSON.stringify(revoked).slice(0, 200));
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

    // The AI agents page: reached from the top bar and from the footer, its addresses copied as written.
    await page.locator("footer").getByRole("link", { name: "how to connect" }).click();
    const agentsHeading = page.getByRole("heading", { name: "Analyze drops with your AI agent" });
    await agentsHeading.waitFor();
    check("the footer opens the AI agents page at its top", (await page.evaluate(() => window.scrollY)) === 0 && page.url().endsWith("#agents"), page.url());
    check("the top bar marks the AI agents tab", (await page.getByRole("navigation").getByRole("button", { name: "AI agents" }).getAttribute("aria-current")) === "page");
    const serverAddress = (await page.locator(".agents .receipt code").textContent()) ?? "";
    check("the page shows this site's own MCP address", serverAddress === `${BASE}/mcp`, serverAddress);
    await page.getByRole("button", { name: "Copy: Server address" }).click();
    check("the server address is copied as written", await clipboardBecomes(page, `${BASE}/mcp`));
    check("the setup commands use the same address", (await page.locator(".agents .copyable code").allTextContents()).every((text) => text.includes(`${BASE}/mcp`)));
    await page.getByRole("button", { name: "Go to Submit" }).click();
    await page.getByRole("heading", { name: "Check or withdraw a submission" }).waitFor();
    check("the page leads on to making a key", page.url().endsWith("#submit"), page.url());
    await page.getByRole("navigation").getByRole("button", { name: "AI agents" }).click();
    await agentsHeading.waitFor();
    await page.goBack();
    await page.goForward();
    // Going back and forward fires hashchange after navigation settles: wait for the view, don't sample it.
    const keptThroughHistory = await agentsHeading.waitFor({ timeout: 5000 }).then(() => true, () => false);
    check("the AI agents page has its own address, kept through history", keptThroughHistory, page.url());

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

    // Time and event splits, opened from links. Every hack is on 2026-10-02 UTC; the drop's local day crosses midnight.
    const compareRows = () => page.locator("[data-testid=compare] tbody th").allTextContents();
    await page.goto(`${BASE}/?split=day`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=compare]").waitFor();
    check("by UTC day, with a crossing interval unknown", (await compareRows()).join(",") === "2026-10-02,Unknown", (await compareRows()).join(","));
    const trend = page.locator("section.block", { has: page.locator("[data-testid=compare]") }).locator(".ts-chart-host");
    check("a time split draws trends, not bars", (await trend.count()) === 3 && (await trend.first().locator("path").count()) > 0);
    await page.goto(`${BASE}/?split=week`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=compare]").waitFor();
    check("by UTC week from Monday", (await compareRows()).join(",") === "Week of 2026-09-28", (await compareRows()).join(","));
    await page.goto(`${BASE}/?split=event`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid=compare]").waitFor();
    check("by event, all outside while none are listed", (await compareRows()).join(",") === "Outside events", (await compareRows()).join(","));

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
