#!/usr/bin/env node
/**
 * Build the Sonobe Capture Chrome extension into dist/: the service worker, popup, element picker and
 * offscreen clipboard page bundled with esbuild, the DOM walker from @sonobe/import as walker.js, the
 * manifest, and icons. Load dist/ with chrome://extensions → Developer mode → Load unpacked.
 *
 *   node integrations/chrome-extension/build.ts [--out <dir>] [--test]
 *
 * --test grants access to every site up front, for automated runs that can't click the toolbar button
 * (which is what grants a real install access to the tab).
 */

import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { WALKER_SOURCE } from "../../packages/import/src/dom/walkerSource.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const { values } = parseArgs({ options: { out: { type: "string" }, test: { type: "boolean" } } });
const out = path.resolve(values.out ?? path.join(here, "dist"));

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "icons"), { recursive: true });
await build({
  absWorkingDir: here,
  entryPoints: { background: "src/background.ts", popup: "src/popup.ts", picker: "src/picker.ts", offscreen: "src/offscreen.ts" },
  outdir: out,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  logLevel: "warning",
});
await writeFile(path.join(out, "walker.js"), WALKER_SOURCE);
for (const file of ["popup.html", "popup.css", "offscreen.html"]) await cp(path.join(here, "src", file), path.join(out, file));
const manifest = JSON.parse(await readFile(path.join(here, "src", "manifest.json"), "utf8")) as Record<string, unknown>;
if (values.test) manifest.host_permissions = ["<all_urls>"];
await writeFile(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
for (const size of [16, 32, 48, 128]) await cp(path.join(repo, "apps/desktop/build/icons", `${size}x${size}.png`), path.join(out, "icons", `${size}.png`));
console.log(`Built Sonobe Capture in ${out}. Load it from chrome://extensions (Developer mode → Load unpacked).`);
