#!/usr/bin/env node
/**
 * Bundles the Electron main process and preload with esbuild.
 *
 *   node scripts/build.mjs           one-off build into dist/
 *   node scripts/build.mjs --watch   rebuild on change
 *
 * At runtime the main process loads ../editor/dist/index.html, or SONOBE_DEV_URL when set.
 */

import { build, context } from "esbuild";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

/** @type {import("esbuild").BuildOptions} */
const common = {
  absWorkingDir: root,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  sourcemap: true,
  logLevel: watch ? "info" : "warning",
  define: { __SONOBE_VERSION__: JSON.stringify(pkg.version) },
};

const targets = [
  { ...common, entryPoints: ["electron/main.ts"], outfile: "dist/main.cjs" },
  { ...common, entryPoints: ["electron/preload.ts"], outfile: "dist/preload.cjs" },
];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

if (watch) {
  const contexts = await Promise.all(targets.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("[sonobe] watching electron/ for changes…");
} else {
  const started = performance.now();
  await Promise.all(targets.map((options) => build(options)));
  const sizes = targets.map((t) => `${path.basename(t.outfile)} ${(statSync(path.join(root, t.outfile)).size / 1024).toFixed(1)} KB`);
  console.log(`[sonobe] built ${sizes.join(", ")} in ${Math.round(performance.now() - started)} ms`);
}
