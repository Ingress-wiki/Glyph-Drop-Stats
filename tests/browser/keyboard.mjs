/**
 * Press Tab and wait for the focus announcement to move on. A frame can lag
 * behind the key (software WebGL on CI runners), and reading the
 * announcement before it is drawn would skip past controls.
 */
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 100);

export async function tabOnce(page) {
  const before = (await page.locator("#focus-live").textContent()) ?? "";
  await page.keyboard.press("Tab");
  await page
    .waitForFunction((previous) => document.getElementById("focus-live")?.textContent !== previous, before, { timeout: 2000 })
    .catch(() => {}); // Only one control to focus: the announcement stays.
}

/**
 * The canvas has no DOM to click, so tests drive it by keyboard: Tab until the
 * accessible focus announcement names `label` (or matches `matches`), then press `key`.
 */
export async function activate(page, label, key = "Enter", max = 80, matches = (focused) => focused === label || focused.startsWith(`${label},`)) {
  for (let i = 0; i < max; i++) {
    // The announcement is "NAME, role…": match the whole name, not a prefix of a longer one.
    if (matches((await page.locator("#focus-live").textContent()) ?? "")) {
      await page.waitForTimeout(SETTLE_MS);
      await page.keyboard.press(key);
      await page.waitForTimeout(150);
      return;
    }
    await tabOnce(page);
  }
  throw new Error(`never reached "${label}" by Tab; last focus: ${await page.locator("#focus-live").textContent()}`);
}

/** A results list: `check(name, ok, detail)` records, `report()` prints and says whether all passed. */
export function checks() {
  const results = [];
  return {
    check: (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail }),
    report(suite) {
      for (const { name, ok, detail } of results) console.log(`${ok ? "PASS" : "FAIL"}  ${suite}: ${name}${detail ? ` (${detail})` : ""}`);
      return results.length > 0 && results.every((r) => r.ok);
    },
  };
}

/**
 * Wait until no sheet is showing. synth-ui sheets keep the keyboard until they
 * have slid shut (longer when frames are slow), and while one shows the text
 * layer leaves out the page under it: the top bar's F1 label returns once it's gone.
 */
export async function dialogsClosed(page, timeout = 15000) {
  await page.waitForFunction(
    () => [...document.querySelectorAll("#canvas-text .canvas-text-run")].some((node) => node.textContent?.trim() === "F1"),
    null,
    { timeout },
  );
}
