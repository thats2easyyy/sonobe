#!/usr/bin/env node
/**
 * Rehearses an update between two real, signed builds of Sonobe on this Mac. Nothing else shows that the
 * updater works before a release exists, and the updater in the first release is the one every person
 * keeps: run this on the commit you mean to tag.
 *
 *   node apps/desktop/tests/update-rehearsal.mjs --identity "Apple Development: Your Name"
 *
 * It builds version N (the tree's) and N+1 as rehearsal builds signed with that keychain certificate
 * (scripts/package.mjs --identity, never notarized), and one local ad-hoc build, all into a temp folder.
 * N goes into <temp>/Applications, which macOS counts as an Applications folder, and N+1's zip and
 * latest-mac.yml are served from 127.0.0.1:5250 (SONOBE_UPDATE_FEED). Then, each step its own PASS or FAIL:
 *
 *   A  Install. N finds N+1 by itself a few seconds after its window shows, downloads it and says it is
 *      ready only once macOS has staged it. With a Claude session connected through the app's own
 *      `sonobe mcp` and an unsaved change, Restart to Update asks about the session, then offers Save,
 *      Keep Draft or Cancel. Cancel keeps everything. Keep Draft quits; macOS installs N+1 and opens it;
 *      the project is open again with the unsaved change; a tool call sent while the app was down wasn't
 *      applied; and the same relay carries on.
 *   B  Install on a normal quit, and "Sonobe was updated" once at the next launch.
 *   C  Notify: the ad-hoc build only says a version is available, and Download opens its release page.
 *   D  An install build outside an Applications folder only notifies, says why, and offers the move.
 *   E  A zip macOS must refuse (re-signed ad hoc) ends in "failed" with the release page as the way out,
 *      and never shows "ready".
 *   F  An install build that this user can't replace only notifies.
 *
 *   --identity <name>   the certificate to sign both versions with (required)
 *   --only A,C          run only these scenarios
 *   --keep              leave the temp folder (builds, logs) when done
 *   --reuse <folder>    a folder a --keep run left: skip the builds
 *
 * What it touches outside its temp folder, and puts back: ~/Library/Caches/sonobe-updater (the download),
 * ~/Library/Caches/dev.sonobe.app.ShipIt with the launchd job dev.sonobe.app.ShipIt (macOS's installer),
 * and the caches macOS keeps for the installer's own request (~/Library/Caches/dev.sonobe.app,
 * ~/Library/HTTPStorages/dev.sonobe.app), because the bundle id decides those names. It refuses to start
 * while a download or an install is waiting, and removes the ones that weren't there before. Every app it
 * starts has its own data folder and SONOBE_HOME, muted, with the test cipher
 * (SONOBE_TEST=1), and the updated app is opened by macOS with the same folders, carried in its
 * Info.plist (package.mjs --launch-env). Afterwards every build is unregistered from LaunchServices and
 * deleted, and apps/desktop/dist is rebuilt as a normal build. Nothing is installed in /Applications,
 * and no request leaves this Mac.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { _electron as electron } from "playwright";
import { RELEASES_URL } from "../electron/commands.ts";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(appDir, "../..");
const { values } = parseArgs({ options: { identity: { type: "string" }, only: { type: "string" }, keep: { type: "boolean", default: false }, reuse: { type: "string" } } });

const started = Date.now();
const log = (message) => console.log(`[rehearsal +${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function expect(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail === undefined ? "" : `\n      got: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}
async function poll(fn, { timeout = 20_000, interval = 150, message = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`Timed out after ${Math.round(timeout / 1000)} s waiting for ${message} (last: ${JSON.stringify(last)})`);
}

if (process.platform !== "darwin") {
  console.error("[rehearsal] The rehearsal runs on macOS: it tries the update the way macOS installs it.");
  process.exit(1);
}
if (!values.identity) {
  console.error('[rehearsal] --identity is required: the certificate both versions are signed with, as `security find-identity -v -p codesigning` prints it (for example --identity "Apple Development: Your Name").');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8"));
const N = pkg.version;
const N1 = N.replace(/\d+$/, (patch) => String(Number(patch) + 1));
const ARCH = process.arch;
const FEED_PORT = 5250;
const TAMPERED_FEED_PORT = 5251;
const MCP_PORT = 39610;
const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const SHIPIT_JOB = "dev.sonobe.app.ShipIt";
const updaterCache = path.join(homedir(), "Library", "Caches", "sonobe-updater");
const shipItCache = path.join(homedir(), "Library", "Caches", SHIPIT_JOB);
const shipItState = path.join(shipItCache, "ShipItState.plist");

// --- Before anything is built: never run over an update that's really waiting ---------------------

const holds = (dir) => existsSync(dir) && readdirSync(dir).length > 0;
if (holds(path.join(updaterCache, "pending")) || holds(shipItCache)) {
  console.error(`[rehearsal] An update is already waiting on this Mac (${holds(shipItCache) ? shipItCache : path.join(updaterCache, "pending")} holds files).`);
  console.error("[rehearsal] That is an installed Sonobe's download, or what a rehearsal that was killed left behind. Quit Sonobe, delete that folder, and run this again.");
  process.exit(1);
}
/** Folders under the real home that an update creates, and that go again afterwards unless they were already there. */
const outside = [updaterCache, shipItCache, path.join(homedir(), "Library", "Caches", "dev.sonobe.app"), path.join(homedir(), "Library", "HTTPStorages", "dev.sonobe.app")].filter((dir) => !existsSync(dir));
const gitBefore = execFileSync("git", ["status", "--porcelain"], { cwd: repoDir, encoding: "utf8" });

const root = values.reuse ? realpathSync(path.resolve(values.reuse)) : realpathSync(mkdtempSync(path.join(tmpdir(), "sonobe-update-rehearsal-")));
const logs = path.join(root, "logs");
mkdirSync(logs, { recursive: true });
const builds = { n: path.join(root, "n"), n1: path.join(root, "n1"), adhoc: path.join(root, "adhoc") };
const installed = path.join(root, "Applications", "Sonobe.app");
const unpacked = (dir) => path.join(dir, `mac-${ARCH}`, "Sonobe.app");
const zipOf = (dir, version) => path.join(dir, `Sonobe-${version}-mac-${ARCH}-rehearsal.zip`);
/** Every app path this run started something from, to unregister afterwards. */
const appPaths = new Set([installed, unpacked(builds.n), unpacked(builds.n1), unpacked(builds.adhoc)]);

/** The shell's environment without anything that would steer Sonobe. */
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("SONOBE_") || key === "ELECTRON_RUN_AS_NODE") delete env[key];
  return env;
}
/** What one scenario's app runs with: its own data folder and home, muted, the test cipher, a local feed. */
const scenarioVars = (name, mcpPort, feedPort = FEED_PORT) => ({
  SONOBE_USER_DATA: path.join(root, name, "userData"),
  SONOBE_HOME: path.join(root, name, "home"),
  SONOBE_MUTE: "1",
  SONOBE_TEST: "1",
  SONOBE_MCP_PORT: String(mcpPort),
  SONOBE_UPDATE_FEED: `http://127.0.0.1:${feedPort}/`,
});
/** Scenario A's are also written into both signed builds' Info.plist: macOS opens the updated app with them. */
const baked = scenarioVars("a", MCP_PORT);

// --- Results ---------------------------------------------------------------------------------------

/** @type {{ id: string; ok: boolean; title: string; note?: string }[]} */
const results = [];
class Stopped extends Error {}
/** One assertion of the rehearsal, reported on its own line. A failure ends its scenario. */
async function step(id, title, fn) {
  try {
    const note = await fn();
    results.push({ id, ok: true, title, ...(typeof note === "string" ? { note } : {}) });
    log(`PASS ${id} ${title}${typeof note === "string" ? ` (${note})` : ""}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    results.push({ id, ok: false, title, note: reason });
    log(`FAIL ${id} ${title}\n      ${reason}`);
    throw new Stopped(id);
  }
}

// --- Processes -------------------------------------------------------------------------------------

/** @type {Set<import("playwright").ElectronApplication>} */
const running = new Set();
const closers = new Set();

/** Runs a tool to the end, its output in a log file. A timeout usually means a dialog is waiting for an answer. */
function run(label, command, args, { timeout = 120_000, cwd = repoDir, env = cleanEnv() } = {}) {
  return new Promise((resolve, reject) => {
    const file = path.join(logs, `${label}.log`);
    const out = createWriteStream(file);
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${label} didn't finish in ${Math.round(timeout / 1000)} s and was stopped. If it signs, a keychain dialog may be waiting on your screen: answer it (Always Allow), then run the rehearsal again. Its output: ${file}`));
    }, timeout);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      out.end();
      if (code === 0) resolve(file);
      else reject(new Error(`${label} failed (exit ${code}). Its last lines:\n${readFileSync(file, "utf8").trim().split("\n").slice(-12).join("\n")}`));
    });
  });
}

const plistVersion = (app) => execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", path.join(app, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
/** Pids of everything running out of an app under the temp folder: apps, their helpers, relays. */
function strays() {
  const found = spawnSync("pgrep", ["-f", `${root}/.*Sonobe\\.app/Contents/`], { encoding: "utf8" });
  return (found.stdout ?? "").split("\n").map((line) => Number(line.trim())).filter((pid) => pid > 0 && pid !== process.pid);
}
/** Pids of the app itself (not its helpers, not a relay) running out of `appPath`. */
function appProcesses(appPath) {
  const executable = path.join(appPath, "Contents", "MacOS", "Sonobe");
  const listed = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).stdout ?? "";
  return listed.split("\n").map((line) => /^\s*(\d+)\s+(.*)$/.exec(line)).filter((m) => m && m[2].startsWith(executable) && !m[2].includes("sonobe.mjs")).map((m) => Number(m[1]));
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Starts over between scenarios: no download waiting, no installer armed. */
function clearUpdateState() {
  spawnSync("launchctl", ["remove", SHIPIT_JOB], { stdio: "ignore" });
  rmSync(path.join(updaterCache, "pending"), { recursive: true, force: true });
  rmSync(path.join(updaterCache, "update.zip"), { force: true });
  rmSync(shipItCache, { recursive: true, force: true });
}

/** Unpacks a build's zip the way a download is unpacked, so the app is exactly what an update would install. */
function install(zip, into) {
  rmSync(path.join(into, "Sonobe.app"), { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  execFileSync("ditto", ["-x", "-k", zip, into]);
  appPaths.add(path.join(into, "Sonobe.app"));
  return path.join(into, "Sonobe.app");
}

/** A local update feed over a folder. Every request is kept, with the headers that matter. */
async function startFeed(dir, port, { bytesPerSecond = 0 } = {}) {
  /** @type {{ at: number; path: string; status: number; stagingId: string | null; userAgent: string | null; headers: Record<string, unknown> }[]} */
  const requests = [];
  const server = createServer((req, res) => {
    // electron-updater asks for latest-mac.yml?noCache=…: the file is the pathname.
    const pathname = new URL(req.url ?? "/", `http://127.0.0.1:${port}`).pathname;
    const name = decodeURIComponent(pathname.slice(1));
    const file = path.join(dir, name);
    const found = name !== "" && !name.includes("/") && !name.startsWith(".") && existsSync(file) && statSync(file).isFile();
    const header = (key) => (typeof req.headers[key] === "string" ? req.headers[key] : null);
    requests.push({ at: Date.now(), path: pathname, status: found ? 200 : 404, stagingId: header("x-user-staging-id"), userAgent: header("user-agent"), headers: req.headers });
    if (!found) {
      res.writeHead(404).end();
      return;
    }
    const size = statSync(file).size;
    res.writeHead(200, { "content-type": name.endsWith(".yml") ? "text/yaml" : "application/octet-stream", "content-length": size });
    const stream = createReadStream(file, { highWaterMark: 1 << 20 });
    res.on("close", () => stream.destroy());
    // Slowed down, so the download lasts long enough to report progress more than once.
    if (bytesPerSecond && size > 1 << 22) {
      stream.on("data", (chunk) => {
        stream.pause();
        res.write(chunk);
        setTimeout(() => stream.resume(), (chunk.length / bytesPerSecond) * 1000);
      });
      stream.on("end", () => res.end());
    } else stream.pipe(res);
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
  return { requests, since: (index) => requests.slice(index), close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))) };
}

/** Launches a packaged app as Playwright's child, and records every update status its page is sent. */
async function launch(label, appPath, vars, args = []) {
  appPaths.add(appPath);
  const app = await electron.launch({ executablePath: path.join(appPath, "Contents", "MacOS", "Sonobe"), args: ["--mute-audio", ...args], env: { ...cleanEnv(), ...vars }, timeout: 60_000 });
  running.add(app);
  const out = createWriteStream(path.join(logs, `${label}.log`), { flags: "a" });
  app.process().stdout?.pipe(out, { end: false });
  app.process().stderr?.pipe(out, { end: false });
  app.process().once("exit", () => running.delete(app));
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => {
    window.__seen = [];
    window.sonobeHost.updates.onStatus((status) => window.__seen.push({ state: status.state, progress: status.progress, version: status.version }));
  });
  await poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible())), { message: "the window to show" });
  return { app, page, shownAt: Date.now(), pid: app.process().pid };
}
const status = (app) => app.evaluate(() => globalThis.__sonobeTest.updates.status());
const seen = (page) => page.evaluate(() => window.__seen);
const notice = (page, title) => page.locator(".sb-toast").filter({ has: page.locator(".sb-toast__title", { hasText: title }) });
/** Waits for the app to stop on its own, then for nothing of it to be left. */
async function exited(app, timeout) {
  const child = app.process();
  if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(timeout)]);
  return child.exitCode !== null || child.signalCode !== null;
}
async function closeApp(app) {
  if (!running.has(app)) return;
  await app.evaluate(() => globalThis.__sonobeTest?.destroyWindows()).catch(() => undefined);
  await Promise.race([app.close().catch(() => undefined), sleep(8000)]);
  if (running.has(app)) app.process().kill("SIGKILL");
  running.delete(app);
}

/** The native dialogs of a restart, answered by a stub in the main process that keeps what was asked. */
const answerDialogs = (app, pick) =>
  app.evaluate(({ dialog }, choice) => {
    globalThis.__asked = [];
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1);
      globalThis.__asked.push({ message: options.message, detail: options.detail, buttons: options.buttons });
      const wanted = options.message.startsWith("Restart Sonobe") ? "Restart" : choice;
      return { response: Math.max(0, options.buttons.indexOf(wanted)), checkboxChecked: false };
    };
  }, pick);
const asked = (app) => app.evaluate(() => globalThis.__asked ?? []);

/** An MCP client's calls, with errors as answers. */
function calls(client) {
  return async (name, args = {}) => {
    try {
      const result = await client.callTool({ name, arguments: args });
      return { isError: result.isError === true, structured: result.structuredContent, text: (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n") };
    } catch (err) {
      return { isError: true, structured: undefined, text: err instanceof Error ? err.message : String(err) };
    }
  };
}
/** A Claude Code session, as Connect Claude sets one up: the app's own `sonobe mcp` relay over stdio. */
async function connectRelay(appPath, home) {
  const stderr = [];
  const transport = new StdioClientTransport({ command: path.join(appPath, "Contents", "Resources", "cli", "sonobe"), args: ["mcp"], env: { ...cleanEnv(), SONOBE_HOME: home }, stderr: "pipe" });
  transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const client = new Client({ name: "claude-code", version: "update-rehearsal" });
  await client.connect(transport);
  const close = () => client.close().catch(() => undefined);
  closers.add(close);
  return { call: calls(client), stderr: () => stderr.join(""), pid: transport.pid, close: () => (closers.delete(close), close()) };
}
/** Straight to the app's endpoint, to look at the document without going through the relay under test. */
async function connectHttp(home) {
  const conn = JSON.parse(readFileSync(path.join(home, "mcp.json"), "utf8"));
  const client = new Client({ name: "update-rehearsal", version: N });
  await client.connect(new StreamableHTTPClientTransport(new URL(conn.url), { requestInit: { headers: { Authorization: `Bearer ${conn.token}` } } }));
  return { call: calls(client), close: () => client.close().catch(() => undefined) };
}
function health(conn) {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port: conn.port, path: "/health", headers: { host: `127.0.0.1:${conn.port}`, authorization: `Bearer ${conn.token}` }, timeout: 3000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => req.destroy());
    req.end();
  });
}

/** Names and modification times of the person's own Sonobe files, which nothing here may change. */
function ownersFiles() {
  const listing = (dir) => (existsSync(dir) ? readdirSync(dir).sort().map((name) => `${name}:${lstatSync(path.join(dir, name)).mtimeMs}`) : null);
  const connection = path.join(homedir(), ".sonobe", "mcp.json");
  return JSON.stringify({ connection: existsSync(connection) ? `${statSync(connection).mtimeMs}:${readFileSync(connection, "utf8")}` : null, home: listing(path.join(homedir(), ".sonobe")), userData: listing(path.join(homedir(), "Library", "Application Support", "Sonobe")) });
}

/** Waits for an update to be ready or to fail, checking on every look that "ready" never comes before macOS has staged it. */
async function untilSettled(app, { timeout = 600_000 } = {}) {
  let readyBeforeStaged = false;
  const end = await poll(
    async () => {
      const staged = existsSync(shipItState);
      const now = await status(app);
      if (now.state === "ready" && !staged && !existsSync(shipItState)) readyBeforeStaged = true;
      return now.state === "ready" || now.state === "failed" ? now : null;
    },
    { timeout, interval: 100, message: "the update to be ready or to fail" },
  );
  return { end, readyBeforeStaged };
}

// --- The scenarios ---------------------------------------------------------------------------------

const only = values.only ? values.only.toUpperCase().split(",").map((letter) => letter.trim()) : null;
const wants = (letter) => !only || only.includes(letter);
async function scenario(letter, title, fn) {
  if (!wants(letter)) return;
  log(`--- ${letter}. ${title}`);
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof Stopped)) {
      const reason = err instanceof Error ? (err.stack ?? err.message) : String(err);
      results.push({ id: letter, ok: false, title: `${title}: stopped by an error outside its steps`, note: reason });
      log(`FAIL ${letter} stopped by an error outside its steps\n      ${reason}`);
    } else log(`--- ${letter} stopped at ${err.message}: its later steps did not run`);
  } finally {
    await settle();
  }
}
/** Ends whatever a scenario left running, the installer first so that ending an app doesn't install anything. */
async function settle() {
  spawnSync("launchctl", ["remove", SHIPIT_JOB], { stdio: "ignore" });
  for (const close of [...closers]) await close().catch(() => undefined);
  closers.clear();
  for (const app of [...running]) await closeApp(app);
  for (const pid of strays()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/** What the run leaves outside its temp folder goes back as it was: the installer's job, the two caches, LaunchServices. */
function restoreOutside() {
  clearUpdateState();
  for (const dir of outside) rmSync(dir, { recursive: true, force: true });
  for (const pid of strays()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  // Every app that ran was registered with LaunchServices as an owner of .sonobe files, under an installed Sonobe's bundle id.
  for (const app of appPaths) spawnSync(lsregister, ["-u", app], { stdio: "ignore" });
  const locked = path.join(root, "f", "Applications");
  if (existsSync(locked)) chmodSync(locked, 0o755);
}

let failed = false;
/** The feed N+1 is served from, shared by the scenarios. */
let feed = null;
const watchdog = setTimeout(() => {
  console.error(`[rehearsal] watchdog: exceeded 60 minutes. The temp folder is kept: ${root}`);
  restoreOutside();
  process.exit(1);
}, 3_600_000);
const owners = ownersFiles();
const realApp = existsSync("/Applications/Sonobe.app");

try {
  // 1. The three builds. Signing runs under a timeout: a keychain dialog would otherwise wait forever.
  const packageScript = path.join(appDir, "scripts", "package.mjs");
  const launchEnv = Object.entries(baked).flatMap(([name, value]) => ["--launch-env", `${name}=${value}`]);
  const build = async (label, dir, args, timeout) => {
    if (existsSync(unpacked(dir))) return log(`reusing ${path.relative(root, dir)}/`);
    const began = Date.now();
    await run(label, process.execPath, [packageScript, ...args, "--out", dir], { timeout });
    log(`built ${label} in ${Math.round((Date.now() - began) / 1000)} s`);
  };
  log(`temp folder ${root}`);
  log(`building Sonobe ${N} and ${N1}, signed with "${values.identity}", and an ad-hoc ${N}`);
  await build(`build-${N}`, builds.n, ["--identity", values.identity, ...launchEnv], 900_000);
  await build(`build-${N1}`, builds.n1, ["--identity", values.identity, "--version", N1, "--skip-editor-build", ...launchEnv], 600_000);
  // Last, so apps/desktop/dist is left without a stand-in version or required variables even if the cleanup is cut short.
  await build("build-adhoc", builds.adhoc, ["--skip-editor-build"], 600_000);
  for (const file of [zipOf(builds.n, N), zipOf(builds.n1, N1), path.join(builds.n1, "latest-mac.yml")]) expect(existsSync(file), `the build wrote ${path.relative(root, file)}`);
  expect(plistVersion(unpacked(builds.n)) === N && plistVersion(unpacked(builds.n1)) === N1, "the two signed builds are the two versions", [plistVersion(unpacked(builds.n)), plistVersion(unpacked(builds.n1))]);
  const signedAs = (app) => /Authority=([^\n]+)/.exec(spawnSync("codesign", ["-dv", "--verbose=4", app], { encoding: "utf8" }).stderr ?? "")?.[1] ?? "ad-hoc";

  const project = path.join(root, "Projects", "Like Toggle.sonobe");
  rmSync(path.join(root, "Projects"), { recursive: true, force: true });
  cpSync(path.join(repoDir, "examples", "02-like-toggle"), project, { recursive: true });
  for (const name of ["a", "b", "c", "d", "e", "f"]) rmSync(path.join(root, name), { recursive: true, force: true });

  feed = await startFeed(builds.n1, FEED_PORT, { bytesPerSecond: 24 << 20 });
  const zipPath = `/${path.basename(zipOf(builds.n1, N1))}`;

  // -----------------------------------------------------------------------------------------------
  await scenario("A", `an install build updates itself: ${N} finds ${N1}, downloads it, and restarts into it without losing work`, async () => {
    clearUpdateState();
    install(zipOf(builds.n, N), path.dirname(installed));
    const mark = feed.requests.length;
    const userData = baked.SONOBE_USER_DATA;
    const home = baked.SONOBE_HOME;
    const record = path.join(userData, "reopen-after-update.json");
    const { app, page, shownAt, pid } = await launch(`a-${N}`, installed, baked, [project]);

    await step("A1", `${N} runs from a folder macOS counts as Applications, signed with the identity, and loads no updater while it launches`, async () => {
      const at = await app.evaluate(({ app: electronApp }) => ({ version: electronApp.getVersion(), packaged: electronApp.isPackaged, inApplications: electronApp.isInApplicationsFolder(), loaded: globalThis.__sonobeTest.updates.driverLoaded() }));
      expect(at.version === N && at.packaged && at.inApplications, "the app is the installed build", at);
      expect(at.loaded === false && feed.since(mark).length === 0, "nothing about updates ran before the window showed", { loaded: at.loaded, requests: feed.since(mark) });
      return signedAs(installed);
    });

    await step("A2", `it checks by itself a few seconds after the window shows, and finds ${N1}`, async () => {
      await poll(() => feed.since(mark).length > 0, { timeout: 40_000, message: "the first request to the feed" });
      const waited = feed.since(mark)[0].at - shownAt;
      expect(waited >= 4500, "the first check comes at least 5 s after the window (1 s to start, 5 s to the check)", `${waited} ms`);
      const found = await poll(async () => ((await status(app)).version ? status(app) : null), { timeout: 30_000, message: "the check's answer" });
      expect(found.mode === "install" && found.version === N1 && found.manual === false, "an install build found the newer version on its own", found);
      return `first request ${(waited / 1000).toFixed(1)} s after the window showed`;
    });

    let ready;
    await step("A3", "it downloads in the background with rising progress, and the states arrive in order", async () => {
      const settled = await untilSettled(app);
      ready = settled;
      expect(settled.end.state === "ready", "the download ends ready to install", settled.end);
      const states = await seen(page);
      const order = states.map((s) => s.state).filter((state, i, all) => state !== all[i - 1]);
      expect(order.join() === "checking,downloading,ready", "checking, then downloading, then ready", order);
      const progress = states.filter((s) => s.state === "downloading").map((s) => s.progress);
      expect(progress.length >= 3 && progress.every((p, i) => i === 0 || p >= progress[i - 1]) && progress.at(-1) > 0.5, "progress only rises", progress);
      return `${progress.length} progress reports`;
    });

    await step("A4", "it says ready only once macOS has verified and staged the download (ShipItState.plist)", async () => {
      expect(!ready.readyBeforeStaged && existsSync(shipItState), "ShipItState.plist exists whenever the status is ready");
      // The ready notice is on screen, with the one action.
      await notice(page, `Sonobe ${N1} is ready`).getByRole("button", { name: "Restart to Update" }).waitFor({ timeout: 5000 });
    });

    await step("A5", "the feed was asked for latest-mac.yml and then the zip, and no request told this copy from another", async () => {
      const requests = feed.since(mark);
      const paths = requests.map((r) => r.path).filter((p, i, all) => p !== all[i - 1]);
      expect(paths[0] === "/latest-mac.yml" && paths.includes(zipPath) && requests.every((r) => r.status === 200), "latest-mac.yml first, then the zip", paths);
      expect(requests.every((r) => r.stagingId === "none"), "x-user-staging-id is the constant on every request", requests.map((r) => r.stagingId));
      return `user agent: ${requests[0].userAgent}`;
    });

    let relay;
    await step("A6", "a Claude session connects through the installed app's own sonobe mcp and reads what's open", async () => {
      relay = await connectRelay(installed, home);
      const listed = await relay.call("list_documents");
      expect(!listed.isError && listed.text.includes(project), "list_documents through the relay names the open project", listed.text);
    });

    let draft;
    await step("A7", "an edit over MCP leaves the prototype unsaved, with a draft", async () => {
      const edit = await relay.call("add_layers", { label: "added a ribbon", layers: [{ type: "rectangle", name: "Added before the update" }] });
      expect(!edit.isError, "add_layers", edit.text);
      const drafts = path.join(userData, "Drafts");
      draft = await poll(
        () => {
          if (!existsSync(drafts)) return null;
          for (const name of readdirSync(drafts)) {
            const manifest = path.join(drafts, name, "draft.json");
            if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).projectPath === project) return name.replace(/\.sonobe$/, "");
          }
          return null;
        },
        { message: "a draft of the unsaved change" },
      );
      const info = await relay.call("get_document_info");
      expect(info.text.includes(`Path: ${project}`) && info.text.includes("unsaved"), "the document is unsaved", info.text);
    });

    await step("A8", "Restart to Update names the connected session, then offers Save, Keep Draft or Cancel; Cancel keeps the app, the window and the ready update", async () => {
      await answerDialogs(app, "Cancel");
      await notice(page, `Sonobe ${N1} is ready`).getByRole("button", { name: "Restart to Update" }).click();
      const questions = await poll(async () => ((await asked(app)).length >= 2 && (await status(app)).restarting === false ? asked(app) : null), { message: "the confirmation and the unsaved-changes prompt" });
      expect(questions[0].message === `Restart Sonobe to update to ${N1}?` && /Claude Code is connected/.test(questions[0].detail), "the confirmation names the connected Claude session", questions[0]);
      expect(questions[1].buttons.join() === "Save,Keep Draft,Cancel" && /opens it again after the update/.test(questions[1].detail), "the prompt offers Save, Keep Draft or Cancel", questions[1]);
      const after = await app.evaluate(({ BrowserWindow }) => ({ windows: BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length, status: globalThis.__sonobeTest.updates.status() }));
      expect(after.windows === 1 && after.status.state === "ready" && !existsSync(record) && alive(pid), "the app and its window are still here, the update is still ready, and nothing was written down", after);
      await notice(page, `Sonobe ${N1} is ready`).getByRole("button", { name: "Restart to Update" }).waitFor({ timeout: 5000 });
      expect(plistVersion(installed) === N, `the app on disk is still ${N}`);
    });

    let quitAt = 0;
    await step("A9", "Keep Draft closes the window and the app quits to install", async () => {
      await answerDialogs(app, "Keep Draft");
      void notice(page, `Sonobe ${N1} is ready`).getByRole("button", { name: "Restart to Update" }).click().catch(() => undefined);
      expect(await exited(app, 60_000), "the app quit within a minute of Keep Draft", await status(app).catch(() => "the app no longer answers"));
      quitAt = Date.now();
    });

    let whileDown;
    await step("A10", "a tool call sent while Sonobe is down is refused, not kept for later", async () => {
      whileDown = await relay.call("add_layers", { label: "sent while Sonobe was down", layers: [{ type: "oval", name: "Sent while Sonobe was down" }] });
      expect(whileDown.isError && /wasn't run|Lost connection|may or may not/.test(whileDown.text), "the relay answers with an error that says what happened", whileDown.text);
      return whileDown.text.split(". ")[0];
    });

    let conn;
    await step("A11", `macOS installs ${N1} and opens it, with the first build's data folder (Info.plist carried it)`, async () => {
      const tokenFile = path.join(home, "mcp.json");
      let openedAt = 0;
      const read = () => {
        try {
          const next = JSON.parse(readFileSync(tokenFile, "utf8"));
          if (next.pid !== pid) return next;
        } catch {
          // Not written yet.
        }
        // An updated app that macOS opened without its data folder stops at an error box and waits there.
        if (appProcesses(installed).length) openedAt ||= Date.now();
        if (openedAt && Date.now() - openedAt > 30_000) throw new Error(`macOS opened the updated app (${plistVersion(installed)}) 30 s ago and it has written no mcp.json into the temp home: it didn't get the data folder from its Info.plist (LSEnvironment), and stopped at its error box. It was ended.`);
        return null;
      };
      try {
        conn = await poll(read, { timeout: 240_000, interval: 250, message: "the updated app's mcp.json in the temp home" });
      } catch (err) {
        throw new Error(`${err.message}\n      The app on disk is ${plistVersion(installed)}; ${appProcesses(installed).length ? "the app is running" : "the app isn't running, so macOS didn't open it again"}.`);
      }
      const answer = await poll(() => health(conn), { timeout: 30_000, message: "/health from the updated app" });
      expect(answer.version === N1, `/health says ${N1}`, answer);
      return `answering ${((Date.now() - quitAt) / 1000).toFixed(1)} s after the old app quit`;
    });

    await step("A12", `the app at the same path is ${N1}, and its signature verifies`, async () => {
      expect(plistVersion(installed) === N1, "Info.plist's version", plistVersion(installed));
      const verified = spawnSync("codesign", ["--verify", "--deep", "--strict", installed], { encoding: "utf8" });
      expect(verified.status === 0, "codesign --verify --deep --strict", verified.stderr);
      return signedAs(installed);
    });

    await step("A13", "the person's own ~/.sonobe and Sonobe data folder were not touched", async () => {
      expect(ownersFiles() === owners, "their names and modification times are what they were before the rehearsal", ownersFiles());
    });

    await step("A14", "the prototype is open again at its path, unsaved, with the change from before the update and not the refused one", async () => {
      const direct = await connectHttp(home);
      try {
        const info = await direct.call("get_document_info");
        expect(!info.isError && info.text.includes(`Path: ${project}`) && info.text.includes("unsaved"), "get_document_info: the same project, still unsaved", info.text);
        expect(info.structured?.draft?.id === draft, "it came back as the draft that was kept", info.structured?.draft);
        const outline = await direct.call("get_outline", { detail: "compact" });
        expect(outline.text.includes("Added before the update") && !outline.text.includes("Sent while Sonobe was down"), "the outline has the first change only", outline.text);
        expect(!existsSync(record), "the record of what was open is used once");
      } finally {
        await direct.close();
      }
    });

    await step("A15", `the updated app remembers it ran as ${N} before`, async () => {
      // Written when updates start, a moment after the window shows.
      const read = () => JSON.parse(readFileSync(path.join(userData, "updates.json"), "utf8"));
      const saved = await poll(() => (read().lastRunVersion === N1 ? read() : null), { timeout: 30_000, message: "updates.json to name the new version" }).catch(read);
      expect(saved.lastRunVersion === N1 && saved.previousVersion === N, "updates.json", saved);
    });

    await step("A16", "the relay that was started under the old version carries on with the new one, without a reconnect", async () => {
      const listed = await relay.call("list_documents");
      expect(!listed.isError && listed.text.includes(project), "list_documents through the same relay", listed.text);
      expect(alive(relay.pid), "it is the same relay process");
      return relay.stderr().trim().split("\n").at(-1);
    });

    // The updated app is macOS's child, not this script's: ask it to quit the way a signal does.
    await relay.close();
    process.kill(conn.pid, "SIGTERM");
    await poll(() => !alive(conn.pid), { timeout: 15_000, message: "the updated app to quit" }).catch(() => undefined);
  });

  // -----------------------------------------------------------------------------------------------
  await scenario("B", "a downloaded update also goes in on a normal quit, and the next launch says so once", async () => {
    clearUpdateState();
    install(zipOf(builds.n, N), path.dirname(installed));
    const vars = scenarioVars("b", MCP_PORT + 1);
    let { app, page } = await launch(`b-${N}`, installed, vars);

    await step("B1", `${N} downloads ${N1} and is ready`, async () => {
      const { end } = await untilSettled(app);
      expect(end.state === "ready" && end.version === N1, "ready", end);
    });

    await step("B2", "quitting the ordinary way just quits: nothing asks, nothing reopens", async () => {
      void app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
      expect(await exited(app, 30_000), "the app quit");
    });

    await step("B3", `macOS then replaces the app with ${N1} and leaves it closed`, async () => {
      await poll(() => plistVersion(installed) === N1, { timeout: 240_000, interval: 500, message: `the app on disk to become ${N1}` });
      // The installer's job stays listed after it has run; it is done when it has no process. The app must not have been opened.
      await poll(() => !/"PID" = \d+/.test(spawnSync("launchctl", ["list", SHIPIT_JOB], { encoding: "utf8" }).stdout ?? ""), { timeout: 60_000, message: "the installer to finish" });
      await sleep(3000);
      expect(appProcesses(installed).length === 0, "the app wasn't opened again", appProcesses(installed));
      expect(spawnSync("codesign", ["--verify", "--deep", "--strict", installed]).status === 0, "the installed app's signature verifies");
    });

    await step("B4", `the next launch says "Sonobe was updated to ${N1}", with its release notes`, async () => {
      ({ app, page } = await launch(`b-${N1}`, installed, vars));
      const first = await page.evaluate(() => window.sonobeHost.updates.status());
      expect(first.current === N1 && first.updatedFrom === N && first.notesUrl === `${RELEASES_URL}/tag/v${N1}`, "the status names the version it ran as before", first);
      const updated = notice(page, `Sonobe was updated to ${N1}`);
      await updated.waitFor({ timeout: 10_000 });
      await app.evaluate(({ shell }) => {
        globalThis.__opened = [];
        shell.openExternal = async (url) => void globalThis.__opened.push(url);
      });
      await updated.getByRole("button", { name: "Release notes" }).click();
      const opened = await poll(async () => ((await app.evaluate(() => globalThis.__opened)).length ? app.evaluate(() => globalThis.__opened) : null), { message: "the release notes to open" });
      expect(opened.join() === `${RELEASES_URL}/tag/v${N1}`, "Release notes opens this version's release page", opened);
    });

    await step("B5", "and the launch after that doesn't say it again", async () => {
      await closeApp(app);
      ({ app, page } = await launch(`b-${N1}-again`, installed, vars));
      const again = await page.evaluate(() => window.sonobeHost.updates.status());
      expect(again.updatedFrom === null, "updatedFrom is for one launch", again);
      await sleep(1500);
      expect((await notice(page, "Sonobe was updated").count()) === 0, "no notice");
    });
  });

  // -----------------------------------------------------------------------------------------------
  await scenario("C", "notify: an ad-hoc build only says a version is available", async () => {
    clearUpdateState();
    const mark = feed.requests.length;
    const { app, page } = await launch("c-adhoc", unpacked(builds.adhoc), scenarioVars("c", MCP_PORT + 2));

    await step("C1", `the ad-hoc build finds ${N1} and says why it can't install it`, async () => {
      const found = await poll(async () => ((await status(app)).state === "available" ? status(app) : null), { timeout: 60_000, message: "the check to find the newer version" });
      expect(found.mode === "notify" && found.version === N1 && /built locally/.test(found.reason ?? ""), "notify, with the reason", found);
      expect(signedAs(unpacked(builds.adhoc)) === "ad-hoc", "the build is ad-hoc signed", signedAs(unpacked(builds.adhoc)));
    });

    await step("C2", "the notice stays up with the reason, and Download opens the release page in the browser", async () => {
      const available = notice(page, `Sonobe ${N1} is available`);
      await available.waitFor({ timeout: 5000 });
      expect(/built locally/.test(await available.innerText()), "the notice says why", await available.innerText());
      await app.evaluate(({ shell }) => {
        globalThis.__opened = [];
        shell.openExternal = async (url) => void globalThis.__opened.push(url);
      });
      await available.getByRole("button", { name: "Download" }).click();
      const opened = await poll(async () => ((await app.evaluate(() => globalThis.__opened)).length ? app.evaluate(() => globalThis.__opened) : null), { message: "the release page to open" });
      expect(opened.join() === `${RELEASES_URL}/tag/v${N1}`, "the release page of the new version", opened);
    });

    await step("C3", "nothing was downloaded: the feed saw latest-mac.yml alone, and no update is waiting", async () => {
      await sleep(3000);
      const paths = feed.since(mark).map((r) => r.path);
      expect(paths.length > 0 && paths.every((p) => p === "/latest-mac.yml"), "only latest-mac.yml was asked for", paths);
      expect(!holds(path.join(updaterCache, "pending")) && !existsSync(path.join(updaterCache, "update.zip")) && !existsSync(shipItCache), "the update caches are empty");
      expect(feed.since(mark).every((r) => r.stagingId === "none"), "x-user-staging-id is the constant");
    });
  });

  // -----------------------------------------------------------------------------------------------
  await scenario("D", "an install build outside an Applications folder only notifies, says why, and offers the move", async () => {
    clearUpdateState();
    const mark = feed.requests.length;
    const elsewhere = install(zipOf(builds.n, N), path.join(root, "elsewhere"));
    const { app, page } = await launch("d-elsewhere", elsewhere, scenarioVars("d", MCP_PORT + 3));

    await step("D1", "it notifies instead of installing, and says it updates itself only from Applications", async () => {
      const found = await poll(async () => ((await status(app)).state === "available" ? status(app) : null), { timeout: 60_000, message: "the check to find the newer version" });
      expect(found.mode === "notify" && /Applications folder/.test(found.reason ?? "") && found.canMove === true && found.offerMove === true, "notify, with the Applications reason and the move on offer", found);
    });

    await step("D2", "the offer to move shows once, beside the notice; nothing is moved", async () => {
      await notice(page, "Move Sonobe to your Applications folder").getByRole("button", { name: "Move" }).waitFor({ timeout: 5000 });
      await notice(page, `Sonobe ${N1} is available`).waitFor({ timeout: 5000 });
      const saved = JSON.parse(readFileSync(path.join(root, "d", "userData", "updates.json"), "utf8"));
      expect(saved.moveOffered === true, "the offer is recorded, so it isn't made twice", saved);
      expect(existsSync(elsewhere) && existsSync("/Applications/Sonobe.app") === realApp, "the app stayed where it was, and nothing was put in /Applications");
    });

    await step("D3", "nothing was downloaded", async () => {
      await sleep(3000);
      const paths = feed.since(mark).map((r) => r.path);
      expect(paths.length > 0 && paths.every((p) => p === "/latest-mac.yml") && !existsSync(shipItCache), "only latest-mac.yml was asked for", paths);
    });
  });

  // -----------------------------------------------------------------------------------------------
  await scenario("E", "a download macOS refuses to install ends in failed, never in ready", async () => {
    clearUpdateState();
    install(zipOf(builds.n, N), path.dirname(installed));
    // N+1 with another signature: re-signed ad hoc, zipped as a release is, behind a feed of its own.
    const tampered = path.join(root, "tampered");
    const tamperedFeed = path.join(root, "tampered-feed");
    for (const dir of [tampered, tamperedFeed]) rmSync(dir, { recursive: true, force: true });
    mkdirSync(tamperedFeed, { recursive: true });
    execFileSync("ditto", [unpacked(builds.n1), path.join(tampered, "Sonobe.app")]);
    await run("resign-adhoc", "codesign", ["--force", "--deep", "--sign", "-", path.join(tampered, "Sonobe.app")], { timeout: 180_000 });
    const zipName = `Sonobe-${N1}-mac-${ARCH}-tampered.zip`;
    execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", path.join(tampered, "Sonobe.app"), path.join(tamperedFeed, zipName)]);
    const zipBytes = readFileSync(path.join(tamperedFeed, zipName));
    const sha512 = createHash("sha512").update(zipBytes).digest("base64");
    writeFileSync(path.join(tamperedFeed, "latest-mac.yml"), [`version: ${N1}`, "files:", `  - url: ${zipName}`, `    sha512: ${sha512}`, `    size: ${zipBytes.length}`, `path: ${zipName}`, `sha512: ${sha512}`, `releaseDate: '${new Date().toISOString()}'`, ""].join("\n"));
    const badFeed = await startFeed(tamperedFeed, TAMPERED_FEED_PORT);
    closers.add(badFeed.close);
    const { app, page } = await launch(`e-${N}`, installed, scenarioVars("e", MCP_PORT + 4, TAMPERED_FEED_PORT));

    let end;
    await step("E1", "the download arrives whole, macOS refuses it, and the state never reads ready", async () => {
      ({ end } = await untilSettled(app));
      const states = (await seen(page)).map((s) => s.state);
      expect(end.state === "failed" && !states.includes("ready"), "failed, and never ready", { end, states: states.filter((s, i, all) => s !== all[i - 1]) });
      expect(badFeed.requests.some((r) => r.path === `/${zipName}` && r.status === 200), "the zip was downloaded", badFeed.requests.map((r) => r.path));
    });

    await step("E2", "it says what happened and that the release page is the way out", async () => {
      expect(end.error?.kind === "rejected" && /release page/.test(end.error.hint), "the error is the refused signature, with the release page as the hint", end.error);
      const failedNotice = notice(page, "macOS wouldn't install the update");
      await failedNotice.getByRole("button", { name: "Open release page" }).waitFor({ timeout: 5000 });
      return end.error.message;
    });

    await step("E3", `after a quit the app is still ${N}`, async () => {
      void app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
      expect(await exited(app, 30_000), "the app quit");
      await sleep(8000);
      expect(plistVersion(installed) === N, "Info.plist's version", plistVersion(installed));
    });
  });

  // -----------------------------------------------------------------------------------------------
  await scenario("F", "an install build this user can't replace only notifies", async () => {
    clearUpdateState();
    const mark = feed.requests.length;
    const locked = path.join(root, "f", "Applications");
    const app0 = install(zipOf(builds.n, N), locked);
    chmodSync(locked, 0o555);
    try {
      const { app } = await launch("f-locked", app0, scenarioVars("f", MCP_PORT + 5));
      await step("F1", "it notifies, says replacing it takes an administrator, and doesn't offer a move", async () => {
        const found = await poll(async () => ((await status(app)).state === "available" ? status(app) : null), { timeout: 60_000, message: "the check to find the newer version" });
        expect(found.mode === "notify" && /administrator/.test(found.reason ?? "") && found.canMove === false, "notify, with the administrator reason", found);
        await sleep(3000);
        expect(feed.since(mark).every((r) => r.path === "/latest-mac.yml") && !existsSync(shipItCache), "nothing was downloaded", feed.since(mark).map((r) => r.path));
      });
    } finally {
      await settle();
      chmodSync(locked, 0o755);
    }
  });

} catch (err) {
  failed = true;
  console.error(`[rehearsal] FAIL: ${err?.stack ?? err}`);
} finally {
  clearTimeout(watchdog);
  await settle();
  await feed?.close().catch(() => undefined);
  if (feed) writeFileSync(path.join(logs, "feed-requests.json"), JSON.stringify(feed.requests, null, 1));
  restoreOutside();

  failed ||= results.some((result) => !result.ok) || results.length === 0;
  console.log("\n[rehearsal] Results");
  for (const result of results) console.log(`  ${result.ok ? "PASS" : "FAIL"} ${result.id} ${result.title}${result.note ? `\n         ${result.note.split("\n").join("\n         ")}` : ""}`);

  if (values.keep || values.reuse) log(`temp folder kept: ${root}`);
  else if (failed) {
    // The builds are big and signed with the person's certificate: they go. The logs stay to be read.
    for (const name of readdirSync(root)) if (name !== "logs") rmSync(path.join(root, name), { recursive: true, force: true });
    log(`logs kept: ${logs}`);
  } else rmSync(root, { recursive: true, force: true });

  // The last package.mjs run left apps/desktop/dist as its build. Put back what `npm run build` makes.
  try {
    execFileSync(process.execPath, [path.join(appDir, "scripts", "build.mjs")], { cwd: appDir, stdio: "ignore", env: cleanEnv() });
  } catch (err) {
    failed = true;
    console.error(`[rehearsal] apps/desktop/dist couldn't be rebuilt (${err.message}). Run node apps/desktop/scripts/build.mjs before the app or the smoke tests.`);
  }
  const gitAfter = execFileSync("git", ["status", "--porcelain"], { cwd: repoDir, encoding: "utf8" });
  if (gitAfter !== gitBefore) {
    failed = true;
    console.error(`[rehearsal] FAIL: the rehearsal changed tracked or untracked files in the repository:\n${gitAfter}`);
  }
  const left = strays();
  if (left.length) console.error(`[rehearsal] still running from the temp folder: ${left.join(", ")}`);
  log(failed ? "FAIL" : "PASS");
  process.exit(failed ? 1 : 0);
}
