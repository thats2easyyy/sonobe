#!/usr/bin/env node
/**
 * Electron smoke test (muted). Builds the shell, launches it against a missing editor build so the
 * setup page renders, and checks: window + secure defaults, window.sonobeHost, native menus and
 * command delivery, main→renderer RPC, project IO + watching, the MCP endpoint and token file,
 * link handling, a screenshot, and a clean quit that removes mcp.json.
 *
 *   node apps/desktop/tests/smoke.mjs
 */

import { _electron as electron } from "playwright";
import electronPath from "electron";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotPath = path.join(appDir, "screenshots", "smoke.png");
const started = Date.now();

const log = (msg) => console.log(`[smoke +${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);
function assert(condition, message, detail) {
  if (!condition) {
    const err = new Error(`Assertion failed: ${message}${detail === undefined ? "" : `\n  got: ${JSON.stringify(detail)}`}`);
    throw err;
  }
}
async function poll(fn, { timeout = 10_000, interval = 100, message = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for ${message} (last: ${JSON.stringify(last)})`);
}
function http(port, { method = "GET", path: urlPath = "/health", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path: urlPath, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const temp = mkdtempSync(path.join(tmpdir(), "sonobe-smoke-"));
const home = path.join(temp, "home");
const userData = path.join(temp, "userData");
const projectDir = path.join(temp, "Smoke Test.sonobe");
const tokenFile = path.join(home, "mcp.json");

function makeFixtureProject() {
  mkdirSync(path.join(projectDir, "components"), { recursive: true });
  mkdirSync(path.join(projectDir, "assets"), { recursive: true });
  writeFileSync(path.join(projectDir, "project.json"), '{\n  "formatVersion": 1,\n  "name": "Smoke Test",\n  "root": "main"\n}\n');
  writeFileSync(path.join(projectDir, "components", "main.json"), '{\n  "id": "main"\n}\n');
  writeFileSync(path.join(projectDir, "assets", "assets.json"), "{}\n");
  writeFileSync(path.join(projectDir, "assets", "abc.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
}

let app;
let failed = false;
const watchdog = setTimeout(() => {
  console.error("[smoke] watchdog: exceeded 120 s");
  app?.process()?.kill("SIGKILL");
  process.exit(1);
}, 120_000);

try {
  log("building main + preload");
  execFileSync(process.execPath, [path.join(appDir, "scripts", "build.mjs")], { stdio: "inherit" });
  makeFixtureProject();

  const env = { ...process.env, SONOBE_MUTE: "1", SONOBE_HOME: home, SONOBE_USER_DATA: userData, SONOBE_EDITOR_DIST: path.join(temp, "no-editor-build"), SONOBE_TEST: "1" };
  delete env.SONOBE_DEV_URL;
  delete env.SONOBE_MCP_PORT;
  delete env.ELECTRON_RUN_AS_NODE;

  log("launching Electron (muted)");
  app = await electron.launch({ executablePath: electronPath, args: ["--mute-audio", appDir], cwd: appDir, env, timeout: 30_000 });
  app.process().stdout?.on("data", (d) => process.stdout.write(`[app] ${d}`));
  app.process().stderr?.on("data", (d) => process.stderr.write(`[app] ${d}`));

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.getByText("npm run build -w @sonobe/editor").first().waitFor({ timeout: 10_000 });
  log("placeholder page rendered");

  const windowInfo = await poll(
    () =>
      app.evaluate(({ BrowserWindow, app: electronApp }) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (!w || !w.isVisible()) return null;
        const prefs = w.webContents.getLastWebPreferences() ?? {};
        return {
          count: BrowserWindow.getAllWindows().length,
          bounds: w.getBounds(),
          minimum: w.getMinimumSize(),
          audioMuted: w.webContents.isAudioMuted(),
          muteSwitch: electronApp.commandLine.hasSwitch("mute-audio"),
          sandbox: prefs.sandbox,
          contextIsolation: prefs.contextIsolation,
          nodeIntegration: prefs.nodeIntegration,
          background: w.getBackgroundColor(),
        };
      }),
    { message: "window to show" },
  );
  assert(windowInfo.count === 1, "one window", windowInfo);
  assert(windowInfo.minimum[0] === 1024 && windowInfo.minimum[1] === 680, "minimum size 1024x680", windowInfo.minimum);
  assert(windowInfo.bounds.width >= 1024 && windowInfo.bounds.width <= 1440, "default width", windowInfo.bounds);
  assert(windowInfo.audioMuted && windowInfo.muteSwitch, "audio muted", windowInfo);
  assert(windowInfo.sandbox === true && windowInfo.contextIsolation === true && !windowInfo.nodeIntegration, "secure webPreferences", windowInfo);
  log(`window ${windowInfo.bounds.width}x${windowInfo.bounds.height}, muted, sandboxed`);

  const hostInfo = await win.evaluate(() => ({
    type: typeof window.sonobeHost,
    keys: Object.keys(window.sonobeHost ?? {}).sort(),
    platform: window.sonobeHost?.platform,
    version: window.sonobeHost?.version,
    commandCount: window.sonobeHost?.commands().length,
    restart: window.sonobeHost?.commands().find((c) => c.id === "viewer.restart"),
    nodeRequire: typeof globalThis.require,
    nodeProcess: typeof globalThis.process,
  }));
  assert(hostInfo.type === "object", "window.sonobeHost exists", hostInfo);
  for (const key of ["commands", "getMcpStatus", "onCommand", "onOpenProject", "openProjectDialog", "platform", "readProject", "recentProjects", "revealInFinder", "rpc", "saveProjectDialog", "setDocumentEdited", "setTitle", "version", "watchProject", "writeProject"]) {
    assert(hostInfo.keys.includes(key), `sonobeHost.${key}`, hostInfo.keys);
  }
  assert(hostInfo.platform === process.platform, "platform", hostInfo.platform);
  assert(hostInfo.restart?.accelerator === "CmdOrCtrl+R", "commands() lists accelerators", hostInfo.restart);
  assert(hostInfo.nodeRequire === "undefined" && hostInfo.nodeProcess === "undefined", "no Node globals in the page", hostInfo);
  log(`sonobeHost ok (${hostInfo.commandCount} commands)`);

  // MCP endpoint + token file.
  await poll(() => existsSync(tokenFile), { message: "mcp.json" });
  const conn = JSON.parse(readFileSync(tokenFile, "utf8"));
  assert(conn.url === `http://127.0.0.1:${conn.port}/mcp` && conn.token.length >= 43 && conn.pid === app.process().pid, "mcp.json contents", conn);
  if (process.platform !== "win32") assert((statSync(tokenFile).mode & 0o777) === 0o600, "mcp.json is 0600", (statSync(tokenFile).mode & 0o777).toString(8));
  const auth = { authorization: `Bearer ${conn.token}` };
  const health = await http(conn.port, { headers: auth });
  assert(health.status === 200 && JSON.parse(health.body).ok === true && JSON.parse(health.body).version === conn.version, "/health", health);
  assert((await http(conn.port)).status === 401, "/health requires the token");
  assert((await http(conn.port, { headers: { ...auth, host: `evil.example:${conn.port}` } })).status === 403, "bad Host rejected");
  assert((await http(conn.port, { headers: { ...auth, origin: "https://evil.example" } })).status === 403, "bad Origin rejected");
  const notWired = await http(conn.port, { method: "POST", path: "/mcp", headers: { ...auth, "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":7,"method":"tools/list"}' });
  assert(notWired.status === 501 && JSON.parse(notWired.body).error.message === "MCP tools not yet wired" && JSON.parse(notWired.body).id === 7, "/mcp placeholder", notWired);
  const status = await win.evaluate(() => window.sonobeHost.getMcpStatus());
  assert(status.running && status.port === conn.port && status.url === conn.url && status.tokenFile === tokenFile, "getMcpStatus", status);
  log(`MCP endpoint ok on ${conn.url}`);

  // Menus and command delivery.
  const menuLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? []);
  for (const label of ["File", "Edit", "View", "Layer", "Patch", "Viewer", "Window", "Help"]) assert(menuLabels.includes(label), `menu ${label}`, menuLabels);
  await win.evaluate(() => {
    window.__commands = [];
    window.sonobeHost.onCommand((id) => window.__commands.push(id));
  });
  await poll(
    async () => {
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("viewer.restart")?.click());
      return win.evaluate(() => window.__commands.includes("viewer.restart"));
    },
    { interval: 250, message: "menu command delivery" },
  );
  log("menu command reached the renderer");

  // Main → renderer RPC.
  await win.evaluate(() => {
    window.sonobeHost.rpc.handle("smoke.echo", async (params) => ({ echoed: params, from: "renderer" }));
    window.sonobeHost.rpc.handle("smoke.fail", async () => window.sonobeHost.rpc.fail("smoke_error", "Deliberate failure", { hint: "fail() keeps code + data" }));
    window.sonobeHost.rpc.handle("smoke.throw", () => {
      throw new Error("Thrown in the page");
    });
  });
  const echo = await app.evaluate(() => globalThis.__sonobeTest.invokeRenderer("smoke.echo", { n: 1, list: [1, 2] }));
  assert(echo?.from === "renderer" && echo.echoed.n === 1 && echo.echoed.list[1] === 2, "rpc round trip", echo);
  const failure = await app.evaluate(async () => {
    try {
      await globalThis.__sonobeTest.invokeRenderer("smoke.fail");
      return null;
    } catch (err) {
      return { code: err.code, message: err.message, data: err.data };
    }
  });
  assert(failure?.code === "smoke_error" && failure.message === "Deliberate failure" && failure.data?.hint, "rpc error propagation", failure);
  const missing = await app.evaluate(async () => globalThis.__sonobeTest.invokeRenderer("smoke.none").catch((err) => err.code));
  assert(missing === "no_handler", "rpc no_handler", missing);
  const thrown = await app.evaluate(async () => globalThis.__sonobeTest.invokeRenderer("smoke.throw").catch((err) => ({ code: err.code, message: err.message })));
  assert(thrown?.code === "handler_error" && thrown.message.includes("Thrown in the page"), "thrown errors keep their message", thrown);
  log("rpc round trip + error propagation ok");

  // Title + edited state.
  await win.evaluate(() => {
    window.sonobeHost.setTitle("Smoke Test");
    window.sonobeHost.setDocumentEdited(true);
  });
  await poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w.getTitle().includes("Smoke Test") && (process.platform !== "darwin" || w.isDocumentEdited());
  }), { message: "title + edited state" });
  await win.evaluate(() => window.sonobeHost.setDocumentEdited(false));
  await poll(() => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isDocumentEdited()), { message: "edited cleared" });

  // Project IO + watching.
  const read = await win.evaluate(async (dir) => {
    const r = await window.sonobeHost.readProject(dir);
    return { files: Object.keys(r.files), binaries: Object.keys(r.binaries), png: [...new Uint8Array(r.binaries["assets/abc.png"])], name: JSON.parse(r.files["project.json"]).name };
  }, projectDir);
  assert(read.name === "Smoke Test" && read.files.includes("components/main.json") && read.binaries.join() === "assets/abc.png" && read.png[1] === 0x50, "readProject", read);
  const denied = await win.evaluate((dir) => window.sonobeHost.readProject(dir).then(() => "allowed", (e) => e.message), temp);
  assert(denied !== "allowed", "readProject refuses non-project folders", denied);
  const recents = await win.evaluate(() => window.sonobeHost.recentProjects());
  assert(recents[0] === projectDir, "recentProjects", recents);

  await win.evaluate((dir) => {
    window.__changes = [];
    window.__unwatch = window.sonobeHost.watchProject(dir, (change) => window.__changes.push(...change.paths));
  }, projectDir);
  await new Promise((r) => setTimeout(r, 400));
  await win.evaluate(
    (dir) =>
      window.sonobeHost.writeProject(dir, {
        files: { "components/main.json": '{\n  "id": "main",\n  "saved": true\n}\n' },
        binaries: { "assets/def.png": new Uint8Array([7, 8, 9]).buffer },
        deleted: ["assets/abc.png"],
      }),
    projectDir,
  );
  assert(readFileSync(path.join(projectDir, "components", "main.json"), "utf8").includes('"saved": true'), "writeProject text");
  assert([...readFileSync(path.join(projectDir, "assets", "def.png"))].join() === "7,8,9", "writeProject binary");
  assert(!existsSync(path.join(projectDir, "assets", "abc.png")), "writeProject delete");
  await new Promise((r) => setTimeout(r, 800));
  const ownChanges = await win.evaluate(() => [...window.__changes]);
  assert(!ownChanges.some((p) => ["components/main.json", "assets/def.png", "assets/abc.png"].includes(p)), "own writes are not reported", ownChanges);
  writeFileSync(path.join(projectDir, "components", "external.json"), '{"from":"another tool"}\n');
  await poll(() => win.evaluate(() => window.__changes.includes("components/external.json")), { timeout: 5000, message: "external change notification" });
  await win.evaluate(() => window.__unwatch());
  log("project read/write/watch ok");

  // A second launch hands its project argument to the running instance and exits.
  await win.evaluate(() => {
    window.__openRequests = [];
    window.sonobeHost.onOpenProject((dir) => window.__openRequests.push(dir));
  });
  const { spawn } = await import("node:child_process");
  const secondExit = await new Promise((resolve) => {
    const child = spawn(electronPath, ["--mute-audio", appDir, projectDir], { cwd: appDir, env, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve("timeout");
    }, 15_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert(secondExit === 0, "second instance exits", secondExit);
  await poll(() => win.evaluate((dir) => window.__openRequests.includes(dir), projectDir), { message: "second-instance open request" });
  const windowsAfterSecond = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  assert(windowsAfterSecond === 1, "second instance reused the window", windowsAfterSecond);
  log("single-instance forwarding ok");

  await win.getByText("MCP endpoint on").first().waitFor({ timeout: 5000 });
  mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await win.screenshot({ path: screenshotPath });
  log(`screenshot → ${path.relative(process.cwd(), screenshotPath)}`);

  // Links open externally; navigation stays put. (Last page interaction: a blocked navigation
  // leaves Playwright waiting on the page, so later checks go through the main process.)
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (url) => {
      globalThis.__opened.push(url);
    };
  });
  await win.evaluate(() => window.open("https://example.com/docs", "_blank"));
  await win.evaluate(() => {
    location.href = "https://example.com/elsewhere";
  });
  const opened = await poll(() => app.evaluate(() => (globalThis.__opened.length >= 2 ? globalThis.__opened : null)), { message: "external links" });
  assert(opened.includes("https://example.com/docs") && opened.includes("https://example.com/elsewhere"), "external links", opened);
  const currentUrl = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL());
  assert(currentUrl.startsWith("data:"), "navigation guard kept the app page", currentUrl.slice(0, 40));
  const windowCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  assert(windowCount === 1, "window.open didn't create a window", windowCount);
  log("link handling ok");

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1280, height: 800 }));

  log("quitting");
  await app.close();
  app = null;
  assert(!existsSync(tokenFile), "mcp.json removed on quit");
  assert(existsSync(path.join(userData, "window-state.json")), "window state persisted");

  const relaunch = async (overrides) => {
    const next = await electron.launch({ executablePath: electronPath, args: ["--mute-audio", appDir], cwd: appDir, env: { ...env, ...overrides }, timeout: 30_000 });
    next.process().stderr?.on("data", (d) => process.stderr.write(`[app] ${d}`));
    return next;
  };

  log("relaunching against a stub editor build");
  const editorDist = path.join(temp, "editor-dist");
  mkdirSync(editorDist, { recursive: true });
  writeFileSync(
    path.join(editorDist, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><title>Editor stub</title></head><body><p id="out">waiting</p><script>window.sonobeHost.getMcpStatus().then((s) => { document.getElementById("out").textContent = "mcp:" + s.running; }, (e) => { document.getElementById("out").textContent = "error:" + e.message; });</script></body></html>\n',
  );
  app = await relaunch({ SONOBE_EDITOR_DIST: editorDist });
  const stubWin = await app.firstWindow();
  const stubStatus = await poll(
    async () => {
      const text = await stubWin.locator("#out").textContent().catch(() => null);
      return text && text !== "waiting" ? text : null;
    },
    { message: "stub editor IPC" },
  );
  assert(stubStatus === "mcp:true", "file-loaded editor is trusted for IPC", stubStatus);
  const restored = await poll(
    () =>
      app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        return w?.isVisible() ? { bounds: w.getBounds(), url: w.webContents.getURL() } : null;
      }),
    { message: "stub window" },
  );
  assert(restored.bounds.width === 1280 && restored.bounds.height === 800, "window size restored", restored.bounds);
  assert(restored.url.startsWith("file:") && restored.url.endsWith("/index.html"), "loads the editor build", restored.url);
  await app.close();
  app = null;
  log("editor build loads, IPC trusted, window state restored");

  log("relaunching with an unreachable dev server and MCP off");
  const net = await import("node:net");
  const closedPort = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  app = await relaunch({ SONOBE_DEV_URL: `http://127.0.0.1:${closedPort}`, SONOBE_MCP: "0" });
  const devWin = await app.firstWindow();
  await devWin.getByText("Can't reach the editor dev server").first().waitFor({ timeout: 15_000 });
  await devWin.getByText("MCP endpoint is off").first().waitFor({ timeout: 5000 });
  assert(!existsSync(tokenFile), "no mcp.json when MCP is disabled");
  await app.close();
  app = null;
  log("dev-server fallback + MCP off ok");
  log("PASS");
} catch (err) {
  failed = true;
  console.error(`[smoke] FAIL: ${err?.stack ?? err}`);
  try {
    await app?.close();
  } catch {
    app?.process()?.kill("SIGKILL");
  }
} finally {
  clearTimeout(watchdog);
  if (failed) console.error(`[smoke] temp files kept at ${temp}`);
  else rmSync(temp, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
}
