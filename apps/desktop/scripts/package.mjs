#!/usr/bin/env node
/**
 * Unsigned local package with electron-builder (config: electron-builder.yml). Builds the editor (or
 * reuses apps/editor/dist when its build fails and a previous one exists), the desktop bundles and the
 * CLI (scripts/build.mjs), and the icons (scripts/icons.mjs), then packages with the locally installed
 * Electron when the target matches this machine.
 *
 *   npm run package -w @sonobe/desktop                   this platform; on a Mac an arm64 or x64 DMG
 *   node scripts/package.mjs --arch x64                  another architecture (downloads that Electron)
 *   node scripts/package.mjs --dir                       an unpacked app only, no installer
 *   node scripts/package.mjs --skip-editor-build         reuse apps/editor/dist as is
 *
 * Output: apps/desktop/release/ (e.g. Sonobe-0.1.0-mac-arm64.dmg and mac-arm64/Sonobe.app).
 * Verify with `npm run package:verify -w @sonobe/desktop`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const require = createRequire(path.join(root, "package.json"));

const { values } = parseArgs({
  options: {
    arch: { type: "string" },
    dir: { type: "boolean", default: false },
    "skip-editor-build": { type: "boolean", default: false },
  },
});

const arch = values.arch ?? (process.arch === "arm64" ? "arm64" : "x64");
if (!["arm64", "x64", "universal"].includes(arch)) {
  console.error(`[package] --arch must be arm64, x64 or universal (got ${arch})`);
  process.exit(1);
}
const started = Date.now();
const step = (message) => console.log(`[package +${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

// 1. Editor build.
const editorIndex = path.join(repo, "apps", "editor", "dist", "index.html");
if (values["skip-editor-build"] && existsSync(editorIndex)) {
  step("reusing apps/editor/dist");
} else {
  step("building the editor (npm run build -w @sonobe/editor)");
  try {
    execFileSync(npm, ["run", "build", "-w", "@sonobe/editor"], { cwd: repo, stdio: "inherit", shell: process.platform === "win32" });
  } catch (err) {
    if (!existsSync(editorIndex)) throw err;
    console.warn(`[package] WARN the editor build failed; packaging the previous apps/editor/dist (${new Date(statSync(editorIndex).mtimeMs).toISOString()})`);
  }
}

// 2. Desktop bundles + CLI, 3. icons.
step("building main, preload, player, scene renderer and CLI");
execFileSync(process.execPath, [path.join(root, "scripts", "build.mjs")], { cwd: root, stdio: "inherit" });
step("generating icons");
execFileSync(process.execPath, [path.join(root, "scripts", "icons.mjs")], { cwd: root, stdio: "inherit" });

// 4. electron-builder.
const { build, Platform, Arch } = await import("electron-builder");
const electronPackage = require.resolve("electron/package.json");
const electronVersion = JSON.parse(readFileSync(electronPackage, "utf8")).version;
const localDist = path.join(path.dirname(electronPackage), "dist");
const useLocalElectron = arch === process.arch && existsSync(localDist);

const platform = process.platform === "darwin" ? Platform.MAC : process.platform === "win32" ? Platform.WINDOWS : Platform.LINUX;
const targetName = values.dir ? "dir" : process.platform === "darwin" ? "dmg" : process.platform === "win32" ? "nsis" : "AppImage";
step(`electron-builder: ${platform.name} ${targetName} ${arch} (Electron ${electronVersion}${useLocalElectron ? ", local" : ", downloaded"})`);

const artifacts = await build({
  projectDir: root,
  targets: platform.createTarget(targetName, Arch[arch]),
  publish: "never",
  config: {
    electronVersion,
    ...(useLocalElectron ? { electronDist: localDist } : {}),
  },
});

const release = path.join(root, "release");
const unpacked = readdirSync(release).filter((name) => statSync(path.join(release, name)).isDirectory() && !name.startsWith("."));
step(`done: ${[...artifacts.map((file) => path.relative(root, file)), ...unpacked.map((name) => `release/${name}/`)].join(", ")}`);
