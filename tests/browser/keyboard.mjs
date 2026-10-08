/**
 * The canvas has no DOM to click, so tests drive it by keyboard: Tab until the
 * accessible focus announcement names exactly `label`, then press `key`.
 */
export async function activate(page, label, key = "Enter", max = 60) {
  for (let i = 0; i < max; i++) {
    const focused = (await page.locator("#focus-live").textContent()) ?? "";
    // The announcement is "NAME, role…": match the whole name, not a prefix of a longer one.
    if (focused === label || focused.startsWith(`${label},`)) {
      await page.keyboard.press(key);
      await page.waitForTimeout(150);
      return;
    }
    await page.keyboard.press("Tab");
    await page.waitForTimeout(60);
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
