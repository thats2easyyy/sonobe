/**
 * Bundles the DOM walker (src/dom/entry.ts) into one script and writes it as a string constant to
 * src/dom/walkerSource.ts, so every host (Electron main, the editor, a browser extension, tests)
 * injects the same code without its own bundler step.
 *
 *   node packages/import/scripts/build-walker.ts          write the file
 *   node packages/import/scripts/build-walker.ts --check  exit 1 when the file is stale
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleWalker, walkerModule } from "./walker-bundle.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "src/dom/walkerSource.ts");

const source = walkerModule(await bundleWalker());
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (current !== source) {
    console.error("packages/import/src/dom/walkerSource.ts is out of date. Run: node packages/import/scripts/build-walker.ts");
    process.exit(1);
  }
} else {
  writeFileSync(target, source);
  console.log(`Wrote ${path.relative(process.cwd(), target)} (${Math.round(source.length / 1024)} KB)`);
}
