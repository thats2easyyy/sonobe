/**
 * Bundles the DOM walker (src/dom/entry.ts) and the SF Symbol page scripts (src/dom/symbols.ts) into
 * scripts and writes them as string constants to src/dom/walkerSource.ts and src/dom/symbolSource.ts, so
 * every host (Electron main, the editor, a browser extension, tests) injects the same code without its
 * own bundler step.
 *
 *   node packages/import/scripts/build-walker.ts          write the files
 *   node packages/import/scripts/build-walker.ts --check  exit 1 when a file is stale
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleSymbols, bundleWalker, symbolModule, walkerModule } from "./walker-bundle.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputs = [
  { target: path.join(root, "src/dom/walkerSource.ts"), source: walkerModule(await bundleWalker()) },
  { target: path.join(root, "src/dom/symbolSource.ts"), source: symbolModule(await bundleSymbols()) },
];

if (process.argv.includes("--check")) {
  let stale = false;
  for (const { target, source } of outputs) {
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch {
      // Missing counts as stale.
    }
    if (current !== source) {
      console.error(`${path.relative(process.cwd(), target)} is out of date. Run: node packages/import/scripts/build-walker.ts`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
} else {
  for (const { target, source } of outputs) {
    writeFileSync(target, source);
    console.log(`Wrote ${path.relative(process.cwd(), target)} (${Math.round(source.length / 1024)} KB)`);
  }
}
