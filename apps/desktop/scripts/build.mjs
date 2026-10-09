#!/usr/bin/env node
/**
 * Bundles the Electron main process and the small entry that loads it (boot.cjs, package.json's "main"), the
 * preload, the updater, the phone/pop-out web player, the scene renderer for simulation screenshots, and the
 * `sonobe` CLI with esbuild, copies the MCP agent guides and the examples' READMEs and tests next to main.cjs,
 * and on macOS compiles the SF Symbols helper into dist/bin (scripts/sfsymbol.ts).
 *
 *   node scripts/build.mjs               one-off build into dist/
 *   node scripts/build.mjs --watch       rebuild on change (skips the CLI bundle)
 *   node scripts/build.mjs --arch x64    the SF Symbols helper for another architecture (arm64, x64 or
 *                                        universal; scripts/package.mjs passes the app's)
 *   node scripts/build.mjs --version 0.1.1 --require-env SONOBE_USER_DATA,SONOBE_HOME
 *                                        for an update rehearsal's builds (scripts/package.mjs passes them): the
 *                                        version the app claims to be, and the variables it refuses to run without
 *   node scripts/build.mjs --licenses    also write dist/licenses, which a packaged app ships: Sonobe's
 *                                        license, the notices of every npm package in the bundles and the
 *                                        editor build, and of the packages those carry inside their own
 *                                        files (scripts/notices.ts)
 *
 * At runtime the main process loads ../editor/dist/index.html, or SONOBE_DEV_URL when set.
 *
 * The CLI lands in dist/cli: sonobe.mjs (one ESM file), relay.mjs (the `sonobe mcp` relay alone, a few
 * kilobytes, because every Claude session keeps one running), guides/, examples/, and `sonobe` / `sonobe.cmd`
 * launchers (scripts/cli-launchers.ts) that run them with the app's own runtime (Electron in Node mode), so
 * a packaged app needs no separate Node install. It is always bundled here from packages/cli/src, whatever
 * packages/cli/dist holds, and nothing native is copied beside it: the packaged CLI has no headless
 * screenshot renderer (@resvg/resvg-js), and its hint says to open the project in the app, which draws
 * screenshots itself.
 */

import { build, context } from "esbuild";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyExampleTexts } from "../../../packages/mcp/src/examples.ts";
import { posixLauncher, windowsLauncher } from "./cli-launchers.ts";
import { metafileInputs, noticePackages, renderNotices, sourceMapInputs } from "./notices.ts";
import { externalLottiePlugin, leanCatalogPlugin } from "./player-bundle.ts";
import { buildSymbolHelper } from "./sfsymbol.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");
const licenses = process.argv.includes("--licenses");
const archFlag = process.argv.indexOf("--arch");
const helperArch = archFlag < 0 ? undefined : process.argv[archFlag + 1];
if (archFlag >= 0 && !["arm64", "x64", "universal"].includes(helperArch)) {
  console.error(`[sonobe] --arch must be arm64, x64 or universal (got ${helperArch ?? "nothing"})`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
/** The value after a flag, or undefined without the flag. */
const flagValue = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const version = flagValue("--version") ?? pkg.version;
const requiredEnv = (flagValue("--require-env") ?? "").split(",").filter(Boolean);

/** @type {import("esbuild").BuildOptions} */
const common = {
  absWorkingDir: root,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  sourcemap: true,
  // The metafiles say which npm packages each bundle holds (writeLicenses).
  metafile: true,
  logLevel: watch ? "info" : "warning",
  // __SONOBE_LAUNCH_ENV__: the variables a rehearsal build must be launched with, comma-separated (electron/env.ts
  // launchEnvProblem); empty otherwise. A string, so esbuild inlines it.
  define: { __SONOBE_VERSION__: JSON.stringify(version), __SONOBE_LAUNCH_ENV__: JSON.stringify(requiredEnv.join(",")) },
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
  // The app's entry: it turns on Node's compile cache and requires main.cjs, which a module can't do for itself
  // (electron/compile-cache.ts). main.cjs stays a file of its own, so it is what the cache holds.
  { ...common, entryPoints: ["electron/boot.ts"], outfile: "dist/boot.cjs" },
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
  // electron-updater and its driver, in a file of their own: main requires it when the first update check starts,
  // so launch never reads or compiles it (inside main.cjs it cost 8 ms of every launch).
  { ...common, entryPoints: ["electron/updater-driver.ts"], outfile: "dist/updater.cjs" },
  // The phone player: no patch docs, and lottie-web in its own file that loads on first use.
  { ...browserPage, entryPoints: ["player/player.ts"], outfile: "dist/player/player.js", plugins: [leanCatalogPlugin(), externalLottiePlugin()] },
  { ...browserPage, entryPoints: ["player/lottie.ts"], outfile: "dist/player/lottie.js" },
  { ...browserPage, entryPoints: ["scene/scene.ts"], outfile: "dist/scene/scene.js" },
];

function copyStatic() {
  mkdirSync(path.join(dist, "player"), { recursive: true });
  mkdirSync(path.join(dist, "scene"), { recursive: true });
  for (const file of ["index.html", "player.css"]) cpSync(path.join(root, "player", file), path.join(dist, "player", file));
  cpSync(path.join(root, "scene", "index.html"), path.join(dist, "scene", "index.html"));
  cpSync(path.join(repo, "packages", "mcp", "guides"), path.join(dist, "guides"), { recursive: true });
  copyExampleTexts(path.join(dist, "examples"), path.join(repo, "examples"));
}

async function buildCli() {
  const out = path.join(dist, "cli");
  mkdirSync(out, { recursive: true });
  /** @type {import("esbuild").BuildOptions} */
  const bundle = {
    absWorkingDir: repo,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    minify: false,
    sourcemap: false,
    legalComments: "none",
    metafile: true,
    logLevel: "warning",
    // CommonJS dependencies bundled into ESM still call require() for Node built-ins. (esbuild keeps
    // main.ts's own #! line above the banner.)
    banner: { js: "import { createRequire as __sonobeCreateRequire } from 'node:module';\nconst require = __sonobeCreateRequire(import.meta.url);" },
    external: ["bufferutil", "utf-8-validate"],
  };
  // The relay is an entry of its own, not a chunk of the CLI: a Claude session that runs `sonobe mcp` loads
  // these few kilobytes and never the 9 MB beside them.
  const built = await Promise.all([
    build({ ...bundle, entryPoints: [path.join(repo, "packages", "cli", "src", "main.ts")], outfile: path.join(out, "sonobe.mjs") }),
    build({ ...bundle, entryPoints: [path.join(repo, "packages", "cli", "src", "relay-main.ts")], outfile: path.join(out, "relay.mjs") }),
  ]);
  cpSync(path.join(repo, "packages", "mcp", "guides"), path.join(out, "guides"), { recursive: true });
  copyExampleTexts(path.join(out, "examples"), path.join(repo, "examples"));
  writeFileSync(path.join(out, "sonobe"), posixLauncher(version));
  chmodSync(path.join(out, "sonobe"), 0o755);
  writeFileSync(path.join(out, "sonobe.cmd"), windowsLauncher(version));
  const kb = (file) => `cli/${file} ${(statSync(path.join(out, file)).size / 1024).toFixed(1)} KB`;
  return { metafiles: built.map((result) => result.metafile), summary: `${kb("sonobe.mjs")}, ${kb("relay.mjs")}` };
}

/**
 * dist/licenses, which electron-builder ships as Resources/licenses: Sonobe's own license, the notices of
 * the npm packages bundled into main, the preload, the player and scene pages, the CLI and the editor build,
 * and of the packages those carry inside their own files (read from what the bundlers report,
 * scripts/notices.ts). Electron's and Chromium's licenses join them when the app is packaged, from the
 * Electron being packaged (scripts/package.mjs).
 */
function writeLicenses(bundled) {
  const out = path.join(dist, "licenses");
  mkdirSync(out, { recursive: true });
  const editor = path.join(repo, "apps", "editor", "dist");
  const editorFiles = sourceMapInputs(editor);
  if (!editorFiles.length) console.warn("[sonobe] no source maps in apps/editor/dist, so the third-party notices leave out the editor's packages. Build the editor first (npm run build -w @sonobe/editor).");
  const packages = noticePackages([...bundled, ...editorFiles]);
  const notices = renderNotices(packages);
  // A package another one carries inside its published files, read from the copy installed here. Without one there is nothing to read.
  const unread = packages.filter((pkg) => pkg.carriedBy);
  if (unread.length) {
    const names = unread.map((pkg) => `${pkg.name} (inside ${pkg.carriedBy})`).join(", ");
    console.warn(`[sonobe] no license for ${names}: it isn't installed, so the notices can only name it.`);
    console.warn("[sonobe] Add it to apps/desktop's devDependencies, and its license text is read from there.");
  }
  const noFile = notices.missing.filter((name) => !unread.some((pkg) => pkg.name === name));
  if (noFile.length) console.warn(`[sonobe] no license file in ${noFile.join(", ")}: the notices give the license's name and the package's source instead.`);
  writeFileSync(path.join(out, "THIRD-PARTY-NOTICES.txt"), notices.text);
  cpSync(path.join(repo, "LICENSE"), path.join(out, "LICENSE.txt"));
  return `licenses (${notices.text.match(/^License: /gm)?.length ?? 0} packages)`;
}

/** The SF Symbols helper in dist/bin on macOS (scripts/sfsymbol.ts). Without it imports keep placeholders, so it only warns. */
function symbolHelper() {
  const warn = (why) => console.warn(`[sonobe] no SF Symbols helper: ${why}. Design imports will show SF Symbols as gray placeholders.`);
  try {
    const helper = buildSymbolHelper({ out: path.join(dist, "bin", "sfsymbol"), arch: helperArch });
    if (helper.skipped) {
      if (process.platform === "darwin") warn(helper.skipped);
      return [];
    }
    return [`bin/sfsymbol${helperArch ? ` ${helperArch}` : ""}${helper.cached ? " (cached)" : ""}`];
  } catch (err) {
    warn(`swiftc failed (${String(err.message ?? err).split("\n")[0]})`);
    return [];
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyStatic();

if (watch) {
  symbolHelper();
  const contexts = await Promise.all(targets.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("[sonobe] watching electron/, player/ and scene/ for changes…");
} else {
  const started = performance.now();
  const [built, cli] = await Promise.all([Promise.all(targets.map((options) => build(options))), buildCli()]);
  const helper = symbolHelper();
  const notices = licenses ? [writeLicenses([...built.flatMap((result) => metafileInputs(result.metafile, root)), ...cli.metafiles.flatMap((metafile) => metafileInputs(metafile, repo))])] : [];
  const sizes = targets.map((t) => `${path.relative(dist, path.join(root, t.outfile))} ${(statSync(path.join(root, t.outfile)).size / 1024).toFixed(1)} KB`);
  console.log(`[sonobe] built ${[...sizes, cli.summary, ...helper, ...notices].join(", ")} in ${Math.round(performance.now() - started)} ms`);
}
