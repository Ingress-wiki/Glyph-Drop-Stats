// Checks that vendor/synth-ui (a git submodule, for reading and diffing) is the
// source of the synth-ui packages the app installs from npm: same versions,
// same exact pins, identical sources. Run after moving either one.
//
// To update synth-ui: check out the commit a release was published from in
// vendor/synth-ui, install that release with `npm install -E`, and run this.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PACKAGES = ["core", "widgets", "backend"];
const problems = [];

const json = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

/** Every file under `dir`, relative to it, without tests. */
function files(dir, prefix = "") {
  return readdirSync(join(dir, prefix)).flatMap((name) => {
    const path = join(prefix, name);
    if (statSync(join(dir, path)).isDirectory()) return files(dir, path);
    return name.endsWith(".test.ts") ? [] : [path];
  });
}

let vendored;
try {
  vendored = Object.fromEntries(PACKAGES.map((name) => [name, json(`vendor/synth-ui/packages/${name}/package.json`)]));
} catch {
  console.error("vendor/synth-ui is empty: run `git submodule update --init`.");
  process.exit(1);
}

const app = json("package.json");
for (const name of PACKAGES) {
  const id = `@synth-ui/${name}`;
  const want = vendored[name].version;
  const pinned = app.dependencies?.[id] ?? app.devDependencies?.[id];
  const installed = json(`node_modules/${id}/package.json`).version;
  if (pinned !== want) problems.push(`package.json pins ${id} to "${pinned}"; the submodule is ${want} (pin it exactly).`);
  if (installed !== want) problems.push(`${id} ${installed} is installed; the submodule is ${want}.`);

  const published = join(ROOT, `node_modules/${id}/src`);
  const source = join(ROOT, `vendor/synth-ui/packages/${name}/src`);
  const a = new Set(files(published));
  const b = new Set(files(source));
  for (const path of new Set([...a, ...b])) {
    if (!a.has(path) || !b.has(path)) problems.push(`${id}: src/${path} is only in ${a.has(path) ? "the npm package" : "the submodule"}.`);
    else if (readFileSync(join(published, path), "utf8") !== readFileSync(join(source, path), "utf8")) {
      problems.push(`${id}: src/${path} differs between the npm package and the submodule.`);
    }
  }
}

if (problems.length > 0) {
  console.error(`vendor/synth-ui and the installed synth-ui differ:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`synth-ui ${vendored.core.version}: the submodule matches the installed packages.`);
