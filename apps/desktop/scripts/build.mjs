#!/usr/bin/env node
/**
 * Bundles the Electron main process, the preload, and the phone web player with esbuild, and
 * copies the MCP agent guides next to main.cjs.
 *
 *   node scripts/build.mjs           one-off build into dist/
 *   node scripts/build.mjs --watch   rebuild on change
 *
 * At runtime the main process loads ../editor/dist/index.html, or SONOBE_DEV_URL when set.
 */

import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
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
  {
    ...common,
    entryPoints: ["electron/main.ts"],
    outfile: "dist/main.cjs",
    // ws' optional native speedups aren't installed; it falls back to JavaScript.
    external: [...common.external, "bufferutil", "utf-8-validate"],
    // Bundled ESM (guides loader) reads import.meta.url; give CommonJS a real one.
    banner: { js: "var __sonobe_import_meta_url = require('url').pathToFileURL(__filename).href;" },
    define: { ...common.define, "import.meta.url": "__sonobe_import_meta_url" },
  },
  { ...common, entryPoints: ["electron/preload.ts"], outfile: "dist/preload.cjs" },
  {
    ...common,
    platform: "browser",
    format: "iife",
    target: ["es2022", "safari16"],
    external: [],
    minify: !watch,
    entryPoints: ["player/player.ts"],
    outfile: "dist/player/player.js",
  },
];

function copyStatic() {
  mkdirSync(path.join(dist, "player"), { recursive: true });
  for (const file of ["index.html", "player.css"]) cpSync(path.join(root, "player", file), path.join(dist, "player", file));
  cpSync(path.join(repo, "packages", "mcp", "guides"), path.join(dist, "guides"), { recursive: true });
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyStatic();

if (watch) {
  const contexts = await Promise.all(targets.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("[sonobe] watching electron/ and player/ for changes…");
} else {
  const started = performance.now();
  await Promise.all(targets.map((options) => build(options)));
  const sizes = targets.map((t) => `${path.relative(dist, path.join(root, t.outfile))} ${(statSync(path.join(root, t.outfile)).size / 1024).toFixed(1)} KB`);
  console.log(`[sonobe] built ${sizes.join(", ")} in ${Math.round(performance.now() - started)} ms`);
}
