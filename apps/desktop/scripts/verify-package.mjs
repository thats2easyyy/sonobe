#!/usr/bin/env node
/**
 * Checks a packaged Sonobe app (muted, with its own user data and SONOBE_HOME, so it never touches the
 * person's settings or a running Sonobe):
 *
 * - the bundle's signature (ad-hoc for local builds) and the files inside app.asar and Resources
 * - the app launches, shows the editor build from Resources/editor, and exposes window.sonobeHost
 * - the MCP endpoint answers /health with the token from mcp.json, and quitting removes mcp.json
 * - the bundled CLI runs with the app's own runtime (Resources/cli/sonobe --version)
 * - on macOS, the SF Symbols helper (Resources/bin/sfsymbol) draws a symbol
 *
 *   node scripts/verify-package.mjs                release/mac-<arch>/Sonobe.app
 *   node scripts/verify-package.mjs --dmg          mount the newest DMG read-only and check the app inside
 *   node scripts/verify-package.mjs --app <path>   any Sonobe.app (or the unpacked app folder on Windows/Linux)
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const { values } = parseArgs({ options: { dmg: { type: "boolean", default: false }, app: { type: "string" } } });
const started = Date.now();
const log = (message) => console.log(`[verify +${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);
function assert(condition, message, detail) {
  if (!condition) throw new Error(`Assertion failed: ${message}${detail === undefined ? "" : `\n  got: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}
async function poll(fn, { timeout = 20_000, interval = 150, message = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for ${message} (last: ${JSON.stringify(last)})`);
}
function health(port, token) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/health", headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${token}` } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const temp = mkdtempSync(path.join(tmpdir(), "sonobe-verify-"));
const release = path.join(root, "release");
let mountPoint = null;
let app = null;
let failed = false;

try {
  let appPath = values.app ? path.resolve(values.app) : null;
  if (!appPath && values.dmg) {
    const dmgs = readdirSync(release).filter((f) => f.endsWith(".dmg")).map((f) => path.join(release, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    assert(dmgs.length > 0, "a DMG in release/");
    mountPoint = path.join(temp, "mount");
    mkdirSync(mountPoint);
    execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mountPoint, dmgs[0]], { stdio: "pipe" });
    appPath = path.join(mountPoint, "Sonobe.app");
    log(`mounted ${path.relative(root, dmgs[0])} (${(statSync(dmgs[0]).size / 1024 / 1024).toFixed(1)} MB)`);
  }
  if (!appPath) {
    const candidates = process.platform === "darwin" ? [`mac-${process.arch}`, "mac", "mac-universal"].map((d) => path.join(release, d, "Sonobe.app")) : [path.join(release, `${process.platform === "win32" ? "win" : "linux"}-unpacked`)];
    appPath = candidates.find((p) => existsSync(p)) ?? null;
  }
  assert(appPath && existsSync(appPath), "a packaged app (run npm run package -w @sonobe/desktop first)", appPath);

  const mac = process.platform === "darwin";
  const resources = mac ? path.join(appPath, "Contents", "Resources") : path.join(appPath, "resources");
  const executable = mac ? path.join(appPath, "Contents", "MacOS", "Sonobe") : path.join(appPath, process.platform === "win32" ? "Sonobe.exe" : "sonobe");
  assert(existsSync(executable), "app executable", executable);
  log(`checking ${appPath}`);

  // Bundle contents.
  for (const file of ["app.asar", "editor/index.html", "cli/sonobe.mjs", "cli/sonobe", "cli/guides/start-here.md", "cli/examples/README.md", "cli/examples/16-placemark-deck/design/capture.json"]) assert(existsSync(path.join(resources, file)), `Resources/${file}`);
  if (mac) assert(existsSync(path.join(resources, "icon.icns")), "Resources/icon.icns");
  const { listPackage } = await import("@electron/asar");
  const asarFiles = listPackage(path.join(resources, "app.asar")).map((f) => f.replaceAll("\\", "/"));
  for (const file of ["/package.json", "/dist/main.cjs", "/dist/preload.cjs", "/dist/player/index.html", "/dist/player/player.js", "/dist/scene/index.html", "/dist/scene/scene.js", "/dist/guides/start-here.md", "/dist/examples/README.md", "/dist/examples/16-placemark-deck/design/capture.json"]) assert(asarFiles.includes(file), `app.asar${file}`, asarFiles.slice(0, 20));
  assert(!asarFiles.some((f) => f.startsWith("/node_modules/") || f.endsWith(".map")), "no node_modules or source maps in app.asar", asarFiles.filter((f) => f.startsWith("/node_modules/")).slice(0, 5));
  log(`app.asar holds ${asarFiles.length} entries; editor, CLI and guides are in Resources`);
  if (mac) {
    // The SF Symbols helper for design imports runs from Resources/bin: a binary can't run from inside app.asar.
    const helper = path.join(resources, "bin", "sfsymbol");
    assert(existsSync(helper), "Resources/bin/sfsymbol (the SF Symbols helper; build.mjs needs Xcode's command line tools)", helper);
    assert(!asarFiles.some((f) => f.startsWith("/dist/bin/")), "no SF Symbols helper inside app.asar");
    const svg = execFileSync(helper, ["heart.fill", "--size", "17", "--color", "#F24D47"], { encoding: "utf8" });
    assert(svg.startsWith("<svg") && svg.includes('fill="#F24D47"'), "Resources/bin/sfsymbol draws heart.fill as SVG", svg.slice(0, 200));
    log("Resources/bin/sfsymbol draws SF Symbols");
  }

  if (mac) {
    // codesign -d prints its report on stderr.
    const info = spawnSync("codesign", ["-dv", appPath], { encoding: "utf8" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "pipe" });
    const signature = /Signature=(\S+)/.exec(`${info.stdout}\n${info.stderr}`)?.[1] ?? "unknown";
    log(`codesign --verify passes (signature: ${signature})`);
  }

  // The bundled CLI with the app's own runtime.
  const cliVersion = execFileSync(path.join(resources, "cli", process.platform === "win32" ? "sonobe.cmd" : "sonobe"), ["--version"], { encoding: "utf8", env: { ...process.env, SONOBE_NODE: "" } }).trim();
  assert(cliVersion.includes(pkg.version), "bundled CLI --version", cliVersion);
  const described = execFileSync(path.join(resources, "cli", process.platform === "win32" ? "sonobe.cmd" : "sonobe"), ["describe", "switch"], { encoding: "utf8", env: { ...process.env, SONOBE_NODE: "" } });
  assert(/switch/i.test(described), "bundled CLI describe", described.slice(0, 200));
  log(`bundled CLI runs with the app runtime (${cliVersion})`);

  // Launch muted with isolated state.
  const home = path.join(temp, "home");
  const env = { ...process.env, SONOBE_MUTE: "1", SONOBE_HOME: home, SONOBE_USER_DATA: path.join(temp, "userData") };
  for (const key of ["ELECTRON_RUN_AS_NODE", "SONOBE_DEV_URL", "SONOBE_EDITOR_DIST", "SONOBE_MCP", "SONOBE_MCP_PORT", "SONOBE_LAN", "SONOBE_LAN_PORT", "SONOBE_TEST"]) delete env[key];
  app = await electron.launch({ executablePath: executable, args: ["--mute-audio"], env, timeout: 60_000 });
  app.process().stderr?.on("data", (d) => process.stderr.write(`[app] ${d}`));
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on("pageerror", (err) => pageErrors.push(err.message));
  win.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await win.waitForLoadState("domcontentloaded");

  const tokenFile = path.join(home, "mcp.json");
  await poll(() => existsSync(tokenFile), { message: "mcp.json" });
  const conn = JSON.parse(readFileSync(tokenFile, "utf8"));
  const reply = await health(conn.port, conn.token);
  const body = JSON.parse(reply.body);
  assert(reply.status === 200 && body.ok === true && body.version === pkg.version, "/health", reply);
  log(`MCP endpoint ${conn.url} answers /health (version ${body.version})`);

  const state = await poll(
    () =>
      app.evaluate(({ BrowserWindow, app: electronApp }) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (!w || !w.isVisible()) return null;
        return { url: w.webContents.getURL(), muted: w.webContents.isAudioMuted(), muteSwitch: electronApp.commandLine.hasSwitch("mute-audio"), packaged: electronApp.isPackaged, name: electronApp.getName() };
      }),
    { message: "the window" },
  );
  assert(state.packaged && state.name === "Sonobe", "packaged app", state);
  assert(state.muted && state.muteSwitch, "audio muted", state);
  assert(state.url.startsWith("file:") && state.url.includes("/Resources/editor/index.html".replace("/Resources", mac ? "/Resources" : "/resources")), "loads the bundled editor", state.url);
  const host = await win.evaluate(() => ({ keys: Object.keys(window.sonobeHost ?? {}).sort(), version: window.sonobeHost?.version }));
  for (const key of ["getMcpStatus", "notifyDocumentChanged", "openExternal", "popOutViewer", "secrets"]) assert(host.keys.includes(key), `sonobeHost.${key}`, host.keys);
  assert(host.version === pkg.version, "sonobeHost.version", host.version);
  // The editor build mounts into #root; a blank window means the bundled editor threw at startup.
  const mounted = await poll(() => win.evaluate(() => (document.getElementById("root")?.childElementCount ?? 0) > 0), { timeout: 15_000, message: "the editor to mount" }).catch(() => false);
  await new Promise((r) => setTimeout(r, 1500));
  mkdirSync(path.join(root, "screenshots"), { recursive: true });
  await win.screenshot({ path: path.join(root, "screenshots", "packaged.png") });
  assert(mounted, "the bundled editor renders (#root has content)", pageErrors.length ? pageErrors.slice(0, 5).join("\n  ") : "no page errors reported");
  log(`window loads and renders the bundled editor; sonobeHost v${host.version}; screenshot → screenshots/packaged.png`);

  await app.close();
  app = null;
  await poll(() => !existsSync(tokenFile), { timeout: 5000, message: "mcp.json removal" });
  log("quit cleanly (mcp.json removed)");
  log("PASS");
} catch (err) {
  failed = true;
  console.error(`[verify] FAIL: ${err?.stack ?? err}`);
  try {
    await app?.close();
  } catch {
    app?.process()?.kill("SIGKILL");
  }
} finally {
  if (mountPoint) {
    try {
      execFileSync("hdiutil", ["detach", mountPoint], { stdio: "pipe" });
    } catch {
      execFileSync("hdiutil", ["detach", "-force", mountPoint], { stdio: "pipe" });
    }
  }
  if (!failed) rmSync(temp, { recursive: true, force: true });
  else {
    writeFileSync(path.join(temp, "FAILED"), "");
    console.error(`[verify] temp files kept at ${temp}`);
  }
  process.exitCode = failed ? 1 : 0;
}
