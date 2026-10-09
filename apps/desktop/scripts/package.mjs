#!/usr/bin/env node
/**
 * Packages the desktop app with electron-builder (config: electron-builder.yml). Builds the editor, the
 * desktop bundles and the CLI (scripts/build.mjs), and the icons (scripts/icons.mjs), then packages.
 * How the app is signed is decided here, never in the yml (scripts/signing.ts):
 *
 *   npm run package -w @sonobe/desktop                   a local build for this machine: on a Mac an ad-hoc
 *                                                        signed DMG. No credentials needed, and none used.
 *   node scripts/package.mjs --release                   the build to distribute: Developer ID signed,
 *                                                        hardened runtime, notarized; arm64 and x64 DMGs
 *                                                        and zips with one update feed (latest-mac.yml).
 *                                                        It refuses to build anything less.
 *   node scripts/package.mjs --identity "<name>"         a rehearsal: signed with that keychain certificate,
 *                                                        not notarized, named -rehearsal. Not distributable.
 *
 *   --arch x64            another architecture (downloads that Electron, and builds the SF Symbols helper
 *                         for it); arm64,x64 builds both in one run, universal one app with both
 *   --dir                 an unpacked app only, no installer
 *   --skip-editor-build   reuse apps/editor/dist as is
 *
 * A local build reuses the previous apps/editor/dist with a warning when the editor build fails. A
 * release or rehearsal stops instead, and also stops without the SF Symbols helper.
 *
 * Output: apps/desktop/release/ (e.g. Sonobe-<version>-mac-arm64.dmg and mac-arm64/Sonobe.app). A release
 * or rehearsal also writes the zips, their blockmaps and latest-mac.yml (what an update downloads), and
 * Sonobe-<version>-sourcemaps.tar.gz (the editor's and the app's source maps, which stay out of the app).
 * Nothing is ever published from here. Verify with `npm run package:verify -w @sonobe/desktop`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { SigningError, checkArtifacts, checkHelper, checkSignature, helperArch, macSigningOptions, planSigning, readIdentities, readSignature, withLibraryValidationDisabled } from "./signing.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const require = createRequire(path.join(root, "package.json"));

const { values } = parseArgs({
  options: {
    arch: { type: "string" },
    dir: { type: "boolean", default: false },
    "skip-editor-build": { type: "boolean", default: false },
    release: { type: "boolean", default: false },
    identity: { type: "string" },
  },
});

const started = Date.now();
const step = (message) => console.log(`[package +${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
/** Stops the build with a message for people and what to do about it. */
function fail(err) {
  console.error(`[package] ${err.message}`);
  if (err.hint) console.error(`[package] ${err.hint}`);
  process.exit(1);
}

// 1. The signing plan, before anything is built: a release that can't be signed and notarized stops here.
/** Certificate names in this Mac's keychains; none when `security` can't say. */
function keychainIdentities() {
  if (process.platform !== "darwin") return [];
  const found = spawnSync("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8", timeout: 15_000 });
  return readIdentities(found.stdout ?? "");
}

let plan;
try {
  plan = planSigning({
    platform: process.platform,
    hostArch: process.arch,
    release: values.release,
    identity: values.identity,
    arch: values.arch,
    dir: values.dir,
    skipEditorBuild: values["skip-editor-build"],
    env: process.env,
    identities: keychainIdentities(),
    fileExists: existsSync,
  });
} catch (err) {
  if (!(err instanceof SigningError)) throw err;
  fail(err);
}
step(plan.label);
// electron-builder reads these itself, so a local or rehearsal build is cut off from the shell's certificates.
for (const name of plan.scrubEnv) delete process.env[name];
Object.assign(process.env, plan.setEnv);

// 2. Editor build.
const editorIndex = path.join(repo, "apps", "editor", "dist", "index.html");
if (values["skip-editor-build"] && existsSync(editorIndex)) {
  step("reusing apps/editor/dist");
} else {
  step("building the editor (npm run build -w @sonobe/editor)");
  try {
    execFileSync(npm, ["run", "build", "-w", "@sonobe/editor"], { cwd: repo, stdio: "inherit", shell: process.platform === "win32" });
  } catch (err) {
    if (plan.strict) {
      const message = `The editor build failed, and a ${plan.mode} build never packages an older apps/editor/dist.`;
      fail(new SigningError(message, "Fix the errors above (npm run build -w @sonobe/editor shows them alone), then package again."));
    }
    if (!existsSync(editorIndex)) throw err;
    console.warn(`[package] WARN the editor build failed; packaging the previous apps/editor/dist (${new Date(statSync(editorIndex).mtimeMs).toISOString()})`);
  }
}

// 3. Desktop bundles + CLI, 4. icons.
step("building main, preload, player, scene renderer and CLI");
execFileSync(process.execPath, [path.join(root, "scripts", "build.mjs"), "--arch", helperArch(plan.archs), "--licenses"], { cwd: root, stdio: "inherit" });
if (plan.strict) {
  // build.mjs only warns without the helper; a build other people get must have it, for every architecture it holds.
  const helper = path.join(root, "dist", "bin", "sfsymbol");
  const slices = existsSync(helper) ? execFileSync("lipo", ["-archs", helper], { encoding: "utf8" }).trim().split(/\s+/) : [];
  const problem = checkHelper(plan, slices);
  if (problem) fail(problem);
}
step("generating icons");
execFileSync(process.execPath, [path.join(root, "scripts", "icons.mjs")], { cwd: root, stdio: "inherit" });

// 5. electron-builder.
const { build, Platform, Arch } = await import("electron-builder");
// electron-builder's own @electron/osx-sign, found from where it finds it: a local build signs with it (scripts/signing.ts).
const builderLib = createRequire(require.resolve("electron-builder/package.json")).resolve("app-builder-lib/package.json");
const { signAsync } = createRequire(builderLib)("@electron/osx-sign");
const electronPackage = require.resolve("electron/package.json");
const electronVersion = JSON.parse(readFileSync(electronPackage, "utf8")).version;
const localDist = path.join(path.dirname(electronPackage), "dist");
// A release takes both architectures from electron-builder's checksum-verified download.
const useLocalElectron = plan.mode !== "release" && plan.archs.length === 1 && plan.archs[0] === process.arch && existsSync(localDist);

const platform = process.platform === "darwin" ? Platform.MAC : process.platform === "win32" ? Platform.WINDOWS : Platform.LINUX;
step(`electron-builder: ${platform.name} ${plan.targets.join(" + ")} ${plan.archs.join(" + ")} (Electron ${electronVersion}${useLocalElectron ? ", local" : ", downloaded"})`);

const release = path.join(root, "release");
/** What a release uploads. After a failed release none may stay behind for a later upload to find. */
const distributable = (name) => /\.(dmg|zip|blockmap|yml|tar\.gz)$/.test(name);
// Only this run's artifacts may be in release/ when a release is uploaded.
if (plan.mode === "release") rmSync(release, { recursive: true, force: true });

// Entitlements: the committed files, plus library validation off for an ad-hoc signature (it has no Team ID
// for the hardened runtime to match the app's own frameworks against). Absolute paths, because codesign
// resolves them against wherever this script was started.
const committed = { app: path.join(root, "build", "entitlements.mac.plist"), inherit: path.join(root, "build", "entitlements.mac.inherit.plist") };
const temp = mkdtempSync(path.join(tmpdir(), "sonobe-package-"));
process.on("exit", () => rmSync(temp, { recursive: true, force: true }));
let entitlements = committed;
if (plan.disableLibraryValidation) {
  entitlements = { app: path.join(temp, "entitlements.mac.plist"), inherit: path.join(temp, "entitlements.mac.inherit.plist") };
  for (const key of ["app", "inherit"]) writeFileSync(entitlements[key], withLibraryValidationDisabled(readFileSync(committed[key], "utf8")));
}

/** Electron's and Chromium's licenses, as the Electron download names them and as the app ships them. */
const ELECTRON_LICENSES = [["LICENSE", "LICENSE.electron.txt"], ["LICENSES.chromium.html", "LICENSES.chromium.html"]];

/**
 * Runs on the Electron that electron-builder just unpacked, before it measures the asar files for
 * Info.plist. Electron's default_app.asar (the "drop your app here" page) is never loaded by a packaged
 * app. electron-builder deletes it from a downloaded Electron but not from the local one, so it goes here
 * and every build ships the same files. A downloaded Electron also unpacks its licenses beside the app,
 * where electron-builder removes them on macOS before the app is finished: they are kept for afterPack.
 */
function afterExtract(context) {
  const macResources = () => path.join(context.appOutDir, context.packager.info.framework.distMacOsAppName, "Contents", "Resources");
  const resources = context.electronPlatformName === "darwin" ? macResources() : path.join(context.appOutDir, "resources");
  rmSync(path.join(resources, "default_app.asar"), { force: true });
  for (const [from] of ELECTRON_LICENSES) if (existsSync(path.join(context.appOutDir, from))) cpSync(path.join(context.appOutDir, from), path.join(temp, from));
}

/**
 * Runs once the app's files are in place and before it is signed. A Mac app carries Electron's and
 * Chromium's licenses in Resources/licenses (on Windows and Linux they sit beside the executable), and
 * they come from the Electron being packaged: the download's own (afterExtract), or the local one's in
 * node_modules/electron/dist. Electron fetches its binary on first use, so a fresh install (CI, the
 * release runner) has no local one to read them from.
 */
function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const licenses = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources", "licenses");
  for (const [from, to] of ELECTRON_LICENSES) {
    const source = [path.join(temp, from), path.join(localDist, from)].find((file) => existsSync(file));
    if (!source) {
      const hint = "Neither the Electron download nor node_modules/electron/dist has it. Fetch Electron with `node node_modules/electron/install.js` from the repository root, then package again.";
      throw new SigningError(`Electron's ${from} isn't in the Electron being packaged, and the app has to ship it.`, hint);
    }
    cpSync(source, path.join(licenses, to));
  }
}

/**
 * Runs after electron-builder has signed (and, in a release, notarized) each app and before it makes any
 * DMG or zip. electron-builder doesn't fail when it skips signing or signs with another certificate than
 * the one asked for, so the signature is read back and held to the plan here.
 */
function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const described = spawnSync("codesign", ["-dv", "--verbose=4", app], { encoding: "utf8" });
  const problem = checkSignature(plan, readSignature(described.stderr ?? ""));
  if (problem) throw problem;
  if (plan.notarize && spawnSync("xcrun", ["stapler", "validate", app], { stdio: "ignore" }).status !== 0) {
    const hint = 'electron-builder notarizes right after signing; its log above says why it didn\'t (look for "skipped macOS notarization"). Nothing was packaged for download.';
    throw new SigningError("The release build has no notarization ticket stapled to it.", hint);
  }
  step(`signature checked: ${path.relative(root, app)}`);
}

/** Stops after electron-builder has started: nothing a release would upload may stay behind. */
function abandon(err) {
  if (plan.mode === "release" && existsSync(release)) for (const name of readdirSync(release).filter(distributable)) rmSync(path.join(release, name), { force: true });
  if (!(err instanceof SigningError)) throw err;
  fail(err);
}

let artifacts;
try {
  artifacts = await build({
    projectDir: root,
    targets: platform.createTarget(plan.targets, ...plan.archs.map((arch) => Arch[arch])),
    publish: "never",
    config: {
      electronVersion,
      ...(useLocalElectron ? { electronDist: localDist } : {}),
      forceCodeSigning: plan.forceCodeSigning,
      // What this build can do with an update, in the packaged package.json for the app to read (scripts/signing.ts).
      extraMetadata: { sonobe: plan.build },
      afterExtract,
      afterPack,
      afterSign,
      mac: macSigningOptions(plan, entitlements, signAsync),
      // A rehearsal's files say so, so none can be mistaken for a release.
      ...(plan.mode === "rehearsal" ? { artifactName: "${productName}-${version}-${os}-${arch}-rehearsal.${ext}" } : {}),
    },
  });
} catch (err) {
  abandon(err);
}

// 6. What goes beside the installers of a release (and of a rehearsal, so one can be tried end to end).
if (plan.targets.includes("zip")) {
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const suffix = plan.mode === "rehearsal" ? "-rehearsal" : "";
  // The source maps the app doesn't carry: with this archive a stack trace from this version can be read.
  const maps = path.join(temp, "sourcemaps");
  const onlyMaps = (file) => statSync(file).isDirectory() || file.endsWith(".map");
  cpSync(path.join(repo, "apps", "editor", "dist"), path.join(maps, "editor"), { recursive: true, filter: onlyMaps });
  cpSync(path.join(root, "dist"), path.join(maps, "desktop"), { recursive: true, filter: onlyMaps });
  const archive = path.join(release, `Sonobe-${version}-sourcemaps${suffix}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", maps, "editor", "desktop"], { stdio: "inherit", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  artifacts.push(archive);
  // What an update downloads must all be there before anything is uploaded (checkArtifacts).
  const feed = existsSync(path.join(release, "latest-mac.yml")) ? readFileSync(path.join(release, "latest-mac.yml"), "utf8") : "";
  const incomplete = checkArtifacts(plan, version, readdirSync(release), feed);
  if (incomplete) abandon(incomplete);
}

const unpacked = readdirSync(release).filter((name) => statSync(path.join(release, name)).isDirectory() && !name.startsWith("."));
step(`done: ${[...artifacts.map((file) => path.relative(root, file)), ...unpacked.map((name) => `release/${name}/`)].join(", ")}`);
if (plan.mode === "rehearsal") console.log("[package] signed for rehearsal, not notarized: do not distribute");
