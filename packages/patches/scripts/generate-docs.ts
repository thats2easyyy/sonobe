/**
 * Writes the generated patch reference (docs/patches) from the catalog. Node-only dev script:
 *
 *   node packages/patches/scripts/generate-docs.ts           write docs/patches
 *   node packages/patches/scripts/generate-docs.ts --check   exit 1 when docs/patches is out of date
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderReferenceFiles } from "../src/infra/reference.ts";

const outDir = fileURLToPath(new URL("../../../docs/patches/", import.meta.url));
const check = process.argv.includes("--check");

const files = renderReferenceFiles();
const names = Object.keys(files);
const existing = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith(".md")) : [];
const stale = existing.filter((f) => !Object.hasOwn(files, f));
const changed = names.filter((name) => {
  const path = join(outDir, name);
  return !existsSync(path) || readFileSync(path, "utf8") !== files[name];
});

if (check) {
  if (changed.length || stale.length) {
    const list = [...changed.map((f) => `  changed: ${f}`), ...stale.map((f) => `  stale:   ${f}`)];
    console.error(`docs/patches is out of date (${changed.length} changed, ${stale.length} stale):\n${list.slice(0, 20).join("\n")}${list.length > 20 ? "\n  …" : ""}`);
    console.error("Run: node packages/patches/scripts/generate-docs.ts");
    process.exit(1);
  }
  console.log(`docs/patches is up to date (${names.length} files).`);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const name of changed) writeFileSync(join(outDir, name), files[name]!);
  for (const name of stale) rmSync(join(outDir, name));
  console.log(`docs/patches: ${names.length} files (${changed.length} written, ${stale.length} removed).`);
}
