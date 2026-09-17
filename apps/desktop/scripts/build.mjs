#!/usr/bin/env node
/**
 * Bundles the Electron main process, the preload, the phone/pop-out web player, the scene renderer
 * for simulation screenshots, and the `sonobe` CLI with esbuild, and copies the MCP agent guides next
 * to main.cjs.
 *
 *   node scripts/build.mjs           one-off build into dist/
 *   node scripts/build.mjs --watch   rebuild on change (skips the CLI bundle)
 *
 * At runtime the main process loads ../editor/dist/index.html, or SONOBE_DEV_URL when set.
 *
 * The CLI lands in dist/cli: sonobe.mjs (one ESM file), guides/, and `sonobe` / `sonobe.cmd`
 * launchers that run it with the app's own runtime (Electron in Node mode), so a packaged app needs no
 * separate Node install. When packages/cli ships a prebuilt bundle (its package.json `bin` points
 * into dist/), that bundle is copied instead of bundling from source.
 */

import { build, context } from "esbuild";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/** @type {import("esbuild").BuildOptions} */
const browserPage = {
  ...common,
  platform: "browser",
  format: "iife",
  target: ["es2022", "safari16"],
  external: [],
  minify: !watch,
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
  { ...browserPage, entryPoints: ["player/player.ts"], outfile: "dist/player/player.js" },
  { ...browserPage, entryPoints: ["scene/scene.ts"], outfile: "dist/scene/scene.js" },
];

function copyStatic() {
  mkdirSync(path.join(dist, "player"), { recursive: true });
  mkdirSync(path.join(dist, "scene"), { recursive: true });
  for (const file of ["index.html", "player.css"]) cpSync(path.join(root, "player", file), path.join(dist, "player", file));
  cpSync(path.join(root, "scene", "index.html"), path.join(dist, "scene", "index.html"));
  cpSync(path.join(repo, "packages", "mcp", "guides"), path.join(dist, "guides"), { recursive: true });
}

const POSIX_LAUNCHER = `#!/bin/sh
# Runs the bundled Sonobe CLI. Uses SONOBE_NODE when set, else the app's own runtime (Electron in
# Node mode) when this file is inside an installed Sonobe app, else \`node\` from PATH.
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -n "$SONOBE_NODE" ]; then
  exec "$SONOBE_NODE" "$DIR/sonobe.mjs" "$@"
fi
for APP_EXE in "$DIR/../../MacOS/Sonobe" "$DIR/../../sonobe"; do
  if [ -x "$APP_EXE" ] && [ ! -d "$APP_EXE" ]; then
    ELECTRON_RUN_AS_NODE=1 exec "$APP_EXE" "$DIR/sonobe.mjs" "$@"
  fi
done
exec node "$DIR/sonobe.mjs" "$@"
`;

const WINDOWS_LAUNCHER = `@echo off\r
rem Runs the bundled Sonobe CLI with the app's own runtime (Electron in Node mode), else node.\r
setlocal\r
if defined SONOBE_NODE (\r
  "%SONOBE_NODE%" "%~dp0sonobe.mjs" %*\r
  exit /b %ERRORLEVEL%\r
)\r
if exist "%~dp0..\\..\\Sonobe.exe" (\r
  set ELECTRON_RUN_AS_NODE=1\r
  "%~dp0..\\..\\Sonobe.exe" "%~dp0sonobe.mjs" %*\r
  exit /b %ERRORLEVEL%\r
)\r
node "%~dp0sonobe.mjs" %*\r
`;

/** A prebuilt CLI bundle from packages/cli, when its `bin` points into dist/. */
function prebuiltCli() {
  const cliPkgPath = path.join(repo, "packages", "cli", "package.json");
  if (!existsSync(cliPkgPath)) return null;
  const cliPkg = JSON.parse(readFileSync(cliPkgPath, "utf8"));
  const bin = typeof cliPkg.bin === "string" ? cliPkg.bin : cliPkg.bin?.sonobe;
  if (typeof bin !== "string" || !/^(\.\/)?dist\//.test(bin)) return null;
  const entry = path.join(repo, "packages", "cli", bin);
  return existsSync(entry) ? entry : null;
}

async function buildCli() {
  const out = path.join(dist, "cli");
  mkdirSync(out, { recursive: true });
  const prebuilt = prebuiltCli();
  if (prebuilt) {
    cpSync(path.dirname(prebuilt), out, { recursive: true });
    const name = path.basename(prebuilt);
    if (name !== "sonobe.mjs") writeFileSync(path.join(out, "sonobe.mjs"), `import ${JSON.stringify(`./${name}`)};\n`);
  } else {
    await build({
      absWorkingDir: repo,
      entryPoints: [path.join(repo, "packages", "cli", "src", "main.ts")],
      outfile: path.join(out, "sonobe.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      minify: false,
      sourcemap: false,
      legalComments: "none",
      logLevel: "warning",
      // CommonJS dependencies bundled into ESM still call require() for Node built-ins. (esbuild keeps
      // main.ts's own #! line above the banner.)
      banner: { js: "import { createRequire as __sonobeCreateRequire } from 'node:module';\nconst require = __sonobeCreateRequire(import.meta.url);" },
      external: ["bufferutil", "utf-8-validate"],
    });
  }
  cpSync(path.join(repo, "packages", "mcp", "guides"), path.join(out, "guides"), { recursive: true });
  writeFileSync(path.join(out, "sonobe"), POSIX_LAUNCHER);
  chmodSync(path.join(out, "sonobe"), 0o755);
  writeFileSync(path.join(out, "sonobe.cmd"), WINDOWS_LAUNCHER);
  return prebuilt ? `cli (prebuilt ${path.relative(repo, prebuilt)})` : `cli/sonobe.mjs ${(statSync(path.join(out, "sonobe.mjs")).size / 1024).toFixed(1)} KB`;
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyStatic();

if (watch) {
  const contexts = await Promise.all(targets.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("[sonobe] watching electron/, player/ and scene/ for changes…");
} else {
  const started = performance.now();
  const [, cli] = await Promise.all([Promise.all(targets.map((options) => build(options))), buildCli()]);
  const sizes = targets.map((t) => `${path.relative(dist, path.join(root, t.outfile))} ${(statSync(path.join(root, t.outfile)).size / 1024).toFixed(1)} KB`);
  console.log(`[sonobe] built ${[...sizes, cli].join(", ")} in ${Math.round(performance.now() - started)} ms`);
}
