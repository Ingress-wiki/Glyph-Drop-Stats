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

/** A context whose pages skip the first-visit note, for suites that don't test it. */
export async function seenContext(browser, options) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    try {
      localStorage.setItem("glyph-drop-stats:disclaimer-seen", "1");
    } catch {
      // Storage blocked: the note shows and the suite closes it.
    }
  });
  return context;
}
