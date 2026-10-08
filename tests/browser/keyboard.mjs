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
    .waitForFunction((previous) => document.getElementById("focus-live")?.textContent !== previous, before, { timeout: 10000 })
    .catch(() => {}); // Only one control to focus: the announcement stays.
}

/**
 * The canvas has no DOM to click, so tests drive it by keyboard: Tab until the
 * accessible focus announcement names `label` (or matches `matches`), then press `key`.
 */
export async function activate(page, label, key = "Enter", max = 80, matches = (focused) => focused === label || focused.startsWith(`${label},`)) {
  for (let i = 0; i < max; i++) {
    // The announcement is "NAME, role…": match the whole name, not a prefix of a longer one.
    const focused = (await page.locator("#focus-live").textContent()) ?? "";
    if (matches(focused)) {
      // synth-ui hands a text widget's keys (typing, Mod+C) to a hidden textarea it focuses
      // once the frame is drawn: keys sent before that go nowhere.
      if (/(text field|selectable text)$/.test(focused)) {
        await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA", null, { timeout: 10000 }).catch(() => {});
      }
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

/**
 * A browser context for the suites: the CRT effect off. It's a full-screen
 * shader, and with software rendering (CI) it slows frames to seconds; no
 * suite tests how it looks.
 */
export async function newContext(browser, options) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    try {
      localStorage.setItem("glyph-drop-stats:crt", "off");
    } catch {
      // Storage blocked: the CRT stays on, only slower.
    }
  });
  return context;
}

/**
 * Wait until a frame has taken the keys sent so far. synth-ui moves the focus
 * for Tab as soon as it reads a frame's input but gives typed text to
 * whatever is focused when it draws, so text and a Tab in one frame would
 * land in the next field. Two animation frames include one drawn after the keys.
 */
export async function framesDrawn(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
