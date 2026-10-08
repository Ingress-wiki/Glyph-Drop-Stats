// Browser tests: `npm run test:browser` (builds first). Starts the built Worker
// on a throwaway local D1, runs every suite in the installed Chrome, and always
// stops the server. CHROME_CHANNEL picks another Chromium channel.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright-core";
import { datasetRecords } from "../helpers/dataset.ts";
import { csv } from "../helpers/export.ts";
import { canvasSuite } from "./canvas.mjs";
import { firefoxSuite } from "./firefox.mjs";
import { languageSuite } from "./language.mjs";
import { textLayerSuite } from "./text-layer.mjs";

const PORT = Number(process.env.BROWSER_TEST_PORT ?? 8799);
const CONFIG = "dist/glyph_drop_stats/wrangler.json";
const dir = mkdtempSync(join(tmpdir(), "gds-browser-"));
const state = join(dir, "state");
/** Screenshots outlive the run, for a look at each language; SCREENSHOT_DIR picks where. */
const screenshots = process.env.SCREENSHOT_DIR ?? mkdtempSync(join(tmpdir(), "gds-screens-"));

/** The overlapping synthetic uploads the suites expect: h1–h6, and h4 onwards. */
const records = datasetRecords();
writeFileSync(join(dir, "a.csv"), csv(records.slice(0, 6).flat()));
writeFileSync(join(dir, "b.csv"), csv(records.slice(3).flat()));

/** An address other devices could use: plain HTTP, so not a secure context. */
function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) if (address.family === "IPv4" && !address.internal) return address.address;
  }
  return null;
}

const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "glyph-drop-stats", "--local", "--persist-to", state, "-c", CONFIG], { stdio: "ignore" });
if (migrate.status !== 0) throw new Error("couldn't apply migrations; run `npm run build` first");

const server = spawn("npx", ["wrangler", "dev", "-c", CONFIG, "--ip", "0.0.0.0", "--port", String(PORT), "--persist-to", state], { stdio: "ignore", detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
};

let passed = false;
try {
  const base = `http://localhost:${PORT}`;
  for (let i = 0; ; i++) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    if (i > 120) throw new Error("the server didn't start");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const lan = lanAddress();
  // CI runners have no GPU: WebGL2 there comes from SwiftShader, which Chrome only allows when asked.
  const args = process.env.CI ? ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] : [];
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL ?? "chrome", headless: true, args });
  try {
    const canvas = await canvasSuite({ browser, base, lan: lan ? `http://${lan}:${PORT}` : undefined, dir });
    const textLayer = await textLayerSuite({ browser, base, upload: join(dir, "b.csv") });
    const languages = await languageSuite({ browser, base, dir: screenshots });
    passed = canvas && textLayer && languages;
  } finally {
    await browser.close();
  }
  // Playwright's own Firefox (`npx playwright-core install firefox`); CI always has it.
  const gecko = await firefox.launch({ headless: true }).catch(() => null);
  if (gecko) {
    try {
      passed = (await firefoxSuite({ browser: gecko, base })) && passed;
    } finally {
      await gecko.close();
    }
  } else if (process.env.CI) {
    throw new Error("Firefox isn't installed: run `npx playwright-core install firefox`");
  } else {
    console.log("NOTE  no Playwright Firefox: the Firefox checks were skipped");
  }
  if (!lan) console.log("NOTE  no LAN address: the plain-HTTP copy checks were skipped");
  console.log(`NOTE  language screenshots in ${screenshots}`);
} finally {
  stopServer();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(passed ? 0 : 1);
