#!/usr/bin/env node
/**
 * Electron smoke test (muted). Builds the shell, then:
 *
 * 1. Launches against a missing editor build (setup page): window + secure defaults,
 *    window.sonobeHost, native menus and command delivery, main→renderer RPC, project IO + watching,
 *    keychain secrets (with the test cipher), the MCP endpoint (token file, Host/Origin guards, tools
 *    explaining that no editor is connected), connected sessions (a real `sonobe mcp` relay listed with
 *    its folder, pushed to the window, and gone after its goodbye), openExternal and link handling, a
 *    screenshot, and a clean quit that removes mcp.json.
 * 2. Builds the editor (npm run build -w @sonobe/editor) and launches it with SONOBE_LAN=1. When the
 *    build doesn't mount the MCP bridge, it says so and uses an editor harness instead (the real
 *    editor session, RPC handlers and viewer from apps/editor/src). Then runs the whole loop over
 *    Streamable HTTP with the token file: list tools, build an ISAT chain with add_patches + connect on
 *    the demo document, simulate it, screenshot the viewer (screenshots/mcp-screenshot.png) and the
 *    simulation (screenshots/mcp-sim-screenshot.png, when @sonobe/mcp exposes scenes), check MCP
 *    resource notifications, the renderer's history (AI Activity), presence, reveal and undo. Then the
 *    phone preview: HTTP, live sync over WebSocket (polling, then revisions pushed with
 *    notifyDocumentChanged), the player rendering in a browser window (screenshots/lan-player.png), the
 *    pop-out viewer window (screenshots/viewer-window.png), and the "no window" error.
 * 3. Relaunches for window-state restore, file-loaded IPC trust, and the dev-server fallback.
 *
 *   node apps/desktop/tests/smoke.mjs
 *   SONOBE_SMOKE_SKIP_EDITOR_BUILD=1 node apps/desktop/tests/smoke.mjs    reuse apps/editor/dist
 *   SONOBE_SMOKE_HARNESS=1 node apps/desktop/tests/smoke.mjs              always use the harness
 */

import { _electron as electron } from "playwright";
import electronPath from "electron";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { build as esbuild } from "esbuild";
import { WebSocket } from "ws";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(appDir, "../..");
const screenshotsDir = path.join(appDir, "screenshots");
const screenshotPath = path.join(screenshotsDir, "smoke.png");
const mcpScreenshotPath = path.join(screenshotsDir, "mcp-screenshot.png");
const editorScreenshotPath = path.join(screenshotsDir, "mcp-editor.png");
const lanScreenshotPath = path.join(screenshotsDir, "lan-player.png");
const simScreenshotPath = path.join(screenshotsDir, "mcp-sim-screenshot.png");
const viewerWindowScreenshotPath = path.join(screenshotsDir, "viewer-window.png");
const started = Date.now();

const log = (msg) => console.log(`[smoke +${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);
function assert(condition, message, detail) {
  if (!condition) {
    const err = new Error(`Assertion failed: ${message}${detail === undefined ? "" : `\n  got: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
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
/** Like poll, but resolves the last value instead of throwing. */
async function settle(fn, { timeout = 10_000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
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

/**
 * An MCP client over Streamable HTTP with the bearer token from mcp.json. Error checks use tools
 * without an output schema (get_outline): the SDK client rejects error results of tools that have
 * one, because @sonobe/mcp attaches a structuredContent that doesn't match it.
 */
async function connectMcp(conn) {
  const client = new Client({ name: "claude-code", version: "smoke" });
  const transport = new StreamableHTTPClientTransport(new URL(conn.url), { requestInit: { headers: { Authorization: `Bearer ${conn.token}` } } });
  await client.connect(transport);
  return {
    client,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
      return { ...result, text };
    },
    close: () => client.close().catch(() => undefined),
  };
}

/** Width and height from a PNG's IHDR chunk (get_screenshot returns only the image block). */
function pngSize(png) {
  if (png.length < 24 || png.subarray(1, 4).toString("latin1") !== "PNG") return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** A WebSocket whose messages are buffered from the start. */
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    const waiters = new Set();
    ws.on("message", (data) => {
      inbox.push(JSON.parse(String(data)));
      for (const wake of [...waiters]) wake();
    });
    const next = (predicate, timeoutMs = 5000) =>
      new Promise((resolveMessage, rejectMessage) => {
        const check = () => {
          const index = inbox.findIndex(predicate);
          if (index < 0) return;
          const message = inbox.splice(0, index + 1).at(-1);
          waiters.delete(check);
          clearTimeout(timer);
          resolveMessage(message);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          rejectMessage(new Error(`Timed out waiting for a preview message (inbox: ${JSON.stringify(inbox.map((m) => m.type))})`));
        }, timeoutMs);
        waiters.add(check);
        check();
      });
    ws.once("open", () => resolve({ ws, next }));
    ws.once("error", reject);
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

/** Bundle tests/harness (real editor modules, no React shell) into a loadable editor build. */
async function buildHarness() {
  const dir = path.join(temp, "editor-harness");
  mkdirSync(dir, { recursive: true });
  await esbuild({
    absWorkingDir: appDir,
    entryPoints: [path.join(appDir, "tests", "harness", "editor-harness.ts")],
    outfile: path.join(dir, "harness.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    logLevel: "warning",
    loader: { ".css": "empty" },
    define: { "import.meta.env": JSON.stringify({ DEV: false, PROD: true, MODE: "production" }), "process.env.NODE_ENV": '"production"' },
  });
  cpSync(path.join(appDir, "tests", "harness", "index.html"), path.join(dir, "index.html"));
  return dir;
}

let app;
let failed = false;
const watchdog = setTimeout(() => {
  console.error("[smoke] watchdog: exceeded 420 s");
  app?.process()?.kill("SIGKILL");
  process.exit(1);
}, 420_000);

const env = { ...process.env, SONOBE_MUTE: "1", SONOBE_HOME: home, SONOBE_USER_DATA: userData, SONOBE_EDITOR_DIST: path.join(temp, "no-editor-build"), SONOBE_TEST: "1" };
delete env.SONOBE_DEV_URL;
delete env.SONOBE_MCP_PORT;
delete env.SONOBE_LAN;
delete env.SONOBE_LAN_PORT;
delete env.ELECTRON_RUN_AS_NODE;

const launch = async (launchEnv, { pipeStdout = false } = {}) => {
  const next = await electron.launch({ executablePath: electronPath, args: ["--mute-audio", appDir], cwd: appDir, env: launchEnv, timeout: 30_000 });
  if (pipeStdout) next.process().stdout?.on("data", (d) => process.stdout.write(`[app] ${d}`));
  next.process().stderr?.on("data", (d) => process.stderr.write(`[app] ${d}`));
  return next;
};

const readConnection = async () => {
  await poll(() => existsSync(tokenFile), { message: "mcp.json" });
  return JSON.parse(readFileSync(tokenFile, "utf8"));
};

/** Quit even when a document has unsaved changes (destroying windows skips the prompt). */
const quit = async () => {
  await app.evaluate(() => globalThis.__sonobeTest?.destroyWindows()).catch(() => undefined);
  await app.close();
  app = null;
};

/** Interaction → Switch → Pop Animation → Transition, pressing the demo's Next Card. */
const PRESS_PATCHES = [
  { id: "press_next", type: "interaction", name: "Press Next Card", inputs: { layer: { layer: "next_card" } }, ui: { x: 40, y: 700 } },
  { id: "next_pressed", type: "switch", name: "Next Card Pressed", ui: { x: 260, y: 700 } },
  { id: "press_spring", type: "popAnimation", name: "Press Spring", typeParam: "number", inputs: { bounciness: 8, speed: 14 }, ui: { x: 480, y: 700 } },
  { id: "press_scale", type: "transition", name: "Press Scale", typeParam: "number", inputs: { start: 1, end: 0.95 }, ui: { x: 720, y: 700 } },
];
const PRESS_CONNECTIONS = [
  { from: "press_next.tap", to: "next_pressed.flip" },
  { from: "next_pressed.on", to: "press_spring.number" },
  { from: "press_spring.output", to: "press_scale.progress" },
  { from: "press_scale.output", to: "@next_card.scale" },
];

try {
  log("building main + preload + player");
  execFileSync(process.execPath, [path.join(appDir, "scripts", "build.mjs")], { stdio: "inherit" });
  makeFixtureProject();
  mkdirSync(screenshotsDir, { recursive: true });

  // ---------------------------------------------------------------------------------------------
  // 1. Setup page (no editor build)
  // ---------------------------------------------------------------------------------------------

  log("launching Electron (muted)");
  app = await launch(env, { pipeStdout: true });

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
  for (const key of ["closeViewerWindow", "commands", "drafts", "getMcpStatus", "onMcpStatus", "getPreviewStatus", "getViewerWindowStatus", "notifyDocumentChanged", "onCommand", "onOpenProject", "onPreviewStatus", "onViewerWindowStatus", "openExternal", "openProjectDialog", "platform", "popOutViewer", "readProject", "readProjectIfExists", "recentProjects", "revealInFinder", "rpc", "saveProjectDialog", "secrets", "setDocumentEdited", "setTitle", "startPreview", "stopPreview", "version", "watchProject", "writeProject"]) {
    assert(hostInfo.keys.includes(key), `sonobeHost.${key}`, hostInfo.keys);
  }
  assert(hostInfo.platform === process.platform, "platform", hostInfo.platform);
  assert(hostInfo.restart?.accelerator === "CmdOrCtrl+R", "commands() lists accelerators", hostInfo.restart);
  assert(hostInfo.nodeRequire === "undefined" && hostInfo.nodeProcess === "undefined", "no Node globals in the page", hostInfo);
  log(`sonobeHost ok (${hostInfo.commandCount} commands)`);

  // Secrets (SONOBE_TEST=1 swaps safeStorage for a test cipher, so the keychain is never touched).
  const secretRun = await win.evaluate(async () => {
    const s = window.sonobeHost.secrets;
    const status = await s.status();
    const missing = await s.get("anthropic.apiKey");
    await s.set("anthropic.apiKey", "sk-ant-smoke-123");
    const stored = await s.get("anthropic.apiKey");
    const badName = await s.set("../escape", "x").then(() => "allowed", (e) => e.message);
    const removed = await s.delete("anthropic.apiKey");
    const afterDelete = await s.get("anthropic.apiKey");
    await s.set("smoke.kept", "still here");
    return { status, missing, stored, badName, removed, afterDelete };
  });
  assert(secretRun.status.available === true && ["keychain", "dpapi", "test"].includes(secretRun.status.backend), "secrets status", secretRun.status);
  assert(secretRun.missing === null && secretRun.stored === "sk-ant-smoke-123" && secretRun.removed === true && secretRun.afterDelete === null, "secrets round trip", secretRun);
  assert(secretRun.badName.startsWith("Secret names") && !secretRun.badName.includes("invoking remote method"), "secret errors keep a clean message", secretRun.badName);
  const secretsFile = readFileSync(path.join(userData, "secrets.json"), "utf8");
  assert(secretsFile.includes("smoke.kept") && !secretsFile.includes("still here"), "secrets.json holds ciphertext only", secretsFile);
  if (process.platform !== "win32") assert((statSync(path.join(userData, "secrets.json")).mode & 0o777) === 0o600, "secrets.json is 0600");
  const viewerOff = await win.evaluate(() => window.sonobeHost.getViewerWindowStatus());
  assert(viewerOff.open === false, "no viewer window by default", viewerOff);
  log("secrets ok (encrypted file, clean errors)");

  // MCP endpoint + token file.
  const conn = await readConnection();
  assert(conn.url === `http://127.0.0.1:${conn.port}/mcp` && conn.token.length >= 43 && conn.pid === app.process().pid, "mcp.json contents", conn);
  if (process.platform !== "win32") assert((statSync(tokenFile).mode & 0o777) === 0o600, "mcp.json is 0600", (statSync(tokenFile).mode & 0o777).toString(8));
  const auth = { authorization: `Bearer ${conn.token}` };
  const health = await http(conn.port, { headers: auth });
  assert(health.status === 200 && JSON.parse(health.body).ok === true && JSON.parse(health.body).version === conn.version, "/health", health);
  assert((await http(conn.port)).status === 401, "/health requires the token");
  assert((await http(conn.port, { headers: { ...auth, host: `evil.example:${conn.port}` } })).status === 403, "bad Host rejected");
  assert((await http(conn.port, { headers: { ...auth, origin: "https://evil.example" } })).status === 403, "bad Origin rejected");
  const anonymous = await http(conn.port, { method: "POST", path: "/mcp", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":7,"method":"tools/list"}' });
  assert(anonymous.status === 401, "/mcp requires the token", anonymous);
  const status = await win.evaluate(() => window.sonobeHost.getMcpStatus());
  assert(status.running && status.port === conn.port && status.url === conn.url && status.tokenFile === tokenFile, "getMcpStatus", status);

  const setupMcp = await connectMcp(conn);
  const setupTools = await setupMcp.client.listTools();
  assert(setupTools.tools.length >= 39 && setupTools.tools.some((t) => t.name === "get_screenshot"), "MCP lists every tool", setupTools.tools.map((t) => t.name));
  const guide = await setupMcp.call("get_guide", { topic: "start-here" });
  assert(!guide.isError && guide.text.length > 200, "bundled guides load", guide.text.slice(0, 200));
  const notConnected = await setupMcp.call("get_outline");
  assert(notConnected.isError && notConnected.text.includes("editor_not_connected"), "tools explain that no editor is connected", notConnected.text);
  await setupMcp.close();
  const previewOff = await win.evaluate(() => window.sonobeHost.getPreviewStatus());
  assert(previewOff.running === false && previewOff.url === null, "phone preview is off by default", previewOff);
  log(`MCP endpoint ok on ${conn.url} (${setupTools.tools.length} tools; setup page answers editor_not_connected)`);

  // Sessions: `sonobe mcp` names its session, so Connect Claude lists it with its folder, and marks it
  // gone when the client closes stdin. The direct client above has no relay: one anonymous row.
  await win.evaluate(() => {
    window.__mcpPushes = [];
    window.sonobeHost.onMcpStatus((s) => window.__mcpPushes.push(s));
  });
  const sessionFolder = path.join(temp, "noddit");
  mkdirSync(sessionFolder, { recursive: true });
  const relay = spawn(process.execPath, [path.join(repoDir, "packages/cli/src/main.ts"), "mcp"], { cwd: temp, env: { ...process.env, SONOBE_HOME: home, CLAUDE_PROJECT_DIR: sessionFolder }, stdio: ["pipe", "pipe", "pipe"] });
  let relayOut = "";
  relay.stdout.on("data", (d) => (relayOut += d));
  const relaySend = (message) => relay.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  relaySend({ id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "claude-code", title: "Claude Code", version: "smoke" } } });
  await poll(() => relayOut.includes('"id":1'), { message: "the relay's initialize answer" });
  relaySend({ method: "notifications/initialized" });
  relaySend({ id: 2, method: "tools/call", params: { name: "get_guide", arguments: { topic: "loops" } } });
  await poll(() => relayOut.includes('"id":2'), { message: "the relayed tool call" });
  const sessionStatus = await poll(async () => {
    const s = await win.evaluate(() => window.sonobeHost.getMcpStatus());
    return s.clients.find((c) => c.folder === sessionFolder && c.toolCalls >= 1) ? s : null;
  }, { message: "the relay's session in getMcpStatus" });
  const listedSession = sessionStatus.clients.find((c) => c.folder === sessionFolder);
  assert(listedSession.label === "Claude Code" && listedSession.via === "relay" && listedSession.state === "connected" && listedSession.lastTool === "get_guide" && listedSession.relayVersion, "the relay's session", listedSession);
  assert(sessionStatus.clients.some((c) => c.via === "http" && c.toolCalls === 2), "the direct client (get_guide, get_outline) shows as one anonymous row", sessionStatus.clients);
  await poll(() => win.evaluate(() => window.__mcpPushes.some((s) => s.clients.some((c) => c.lastTool === "get_guide" && c.via === "relay"))), { message: "a pushed MCP status" });
  relay.stdin.end();
  await new Promise((resolve) => relay.once("exit", resolve));
  await poll(async () => {
    const s = await win.evaluate(() => window.sonobeHost.getMcpStatus());
    return s.clients.find((c) => c.id === listedSession.id)?.state === "gone";
  }, { message: "the session marked gone after its goodbye" });
  log(`sessions ok (${listedSession.label} in ${path.basename(sessionFolder)}, pushed to the window, gone after its goodbye)`);

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
  const externalResults = await win.evaluate(async () => [
    await window.sonobeHost.openExternal("https://example.com/help"),
    await window.sonobeHost.openExternal("mailto:hello@example.com"),
    await window.sonobeHost.openExternal("file:///etc/passwd"),
    await window.sonobeHost.openExternal("javascript:alert(1)"),
  ]);
  assert(externalResults.join() === "true,true,false,false", "openExternal allows only http(s) and mailto", externalResults);
  await win.evaluate(() => window.open("https://example.com/docs", "_blank"));
  await win.evaluate(() => {
    location.href = "https://example.com/elsewhere";
  });
  const opened = await poll(() => app.evaluate(() => (globalThis.__opened.includes("https://example.com/elsewhere") ? globalThis.__opened : null)), { message: "external links" });
  assert(opened.includes("https://example.com/docs") && opened.includes("https://example.com/help") && opened.includes("mailto:hello@example.com") && !opened.some((u) => u.startsWith("file:") || u.startsWith("javascript:")), "external links", opened);
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

  // ---------------------------------------------------------------------------------------------
  // 2. The built editor (or the harness): the whole MCP loop and phone preview
  // ---------------------------------------------------------------------------------------------

  if (process.env.SONOBE_SMOKE_SKIP_EDITOR_BUILD === "1" && existsSync(path.join(repoDir, "apps", "editor", "dist", "index.html"))) {
    log("reusing apps/editor/dist");
  } else {
    log("building the editor (npm run build -w @sonobe/editor)");
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "-w", "@sonobe/editor"], { cwd: repoDir, stdio: "inherit", shell: process.platform === "win32" });
  }

  let mode = "editor";
  let page;
  if (process.env.SONOBE_SMOKE_HARNESS !== "1") {
    const editorEnv = { ...env, SONOBE_USER_DATA: path.join(temp, "userData-editor"), SONOBE_LAN: "1" };
    delete editorEnv.SONOBE_EDITOR_DIST;
    app = await launch(editorEnv);
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const editorUrl = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL());
    assert(editorUrl.startsWith("file:") && editorUrl.includes("/editor/dist/index.html"), "loads apps/editor/dist", editorUrl);
    const bridged = await settle(() => app.evaluate(() => globalThis.__sonobeTest.hasRendererMethod("document.apply") === true), { timeout: 20_000 });
    if (bridged) {
      log("the built editor mounts the MCP bridge");
      // Fresh user data means a first launch: dismiss the welcome screen so it doesn't cover the editor.
      const welcome = page.getByRole("dialog", { name: "Welcome to Sonobe" });
      if (await welcome.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
        const keepWorking = welcome.getByRole("button", { name: /Keep working on/ });
        if (!(await keepWorking.click({ timeout: 3000 }).then(() => true, () => false))) await page.keyboard.press("Escape");
        await welcome.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
        log("dismissed the first-launch welcome screen");
      }
    } else {
      const probe = await connectMcp(await readConnection());
      const outline = await probe.call("get_outline");
      assert(outline.isError && outline.text.includes("editor_not_connected"), "an editor without the bridge is explained", outline.text);
      await probe.close();
      await quit();
      log("WARN the built editor doesn't mount the MCP bridge; using the editor harness from apps/editor/src");
      mode = "harness";
    }
  } else {
    mode = "harness";
  }
  if (mode === "harness") {
    const harnessDir = await buildHarness();
    app = await launch({ ...env, SONOBE_EDITOR_DIST: harnessDir, SONOBE_USER_DATA: path.join(temp, "userData-harness"), SONOBE_LAN: "1" });
    page = await app.firstWindow();
    await page.getByText("Ready · Photo Zoom").first().waitFor({ timeout: 20_000 });
    await poll(() => app.evaluate(() => globalThis.__sonobeTest.hasRendererMethod("document.apply") === true), { timeout: 15_000, message: "harness MCP bridge" });
  }

  const mcp = await connectMcp(await readConnection());
  const { tools } = await mcp.client.listTools();
  for (const name of ["get_document_info", "get_outline", "add_patches", "connect", "apply_ops", "sim_reset", "sim_dispatch", "sim_step", "sim_get_values", "get_screenshot", "begin_work", "finish_work", "reveal", "list_history", "undo"]) {
    assert(tools.some((t) => t.name === name), `tool ${name}`, tools.map((t) => t.name));
  }
  const info = await mcp.call("get_document_info");
  assert(!info.isError && info.structuredContent.name === "Photo Zoom" && info.structuredContent.host.kind === "app" && info.structuredContent.host.screenshots === true, "get_document_info on the demo", info.text);
  const outline = await mcp.call("get_outline", { detail: "compact" });
  assert(outline.text.includes("patch tap_photo interaction"), "get_outline", outline.text.slice(0, 300));
  log(`MCP (${mode}): ${tools.length} tools; ${info.text.split("\n")[0]}`);

  const begun = await mcp.call("begin_work", { intent: "Adding press feedback to the next card", ids: ["next_card"] });
  assert(!begun.isError, "begin_work", begun.text);
  if (mode === "harness") await page.getByText("Claude — Adding press feedback to the next card").first().waitFor({ timeout: 5000 });

  const added = await mcp.call("add_patches", { label: "added press feedback", patches: PRESS_PATCHES });
  assert(!added.isError && added.structuredContent.ok === true, "add_patches", added.text);
  const wired = await mcp.call("connect", { label: "wired press feedback", connections: PRESS_CONNECTIONS });
  assert(!wired.isError && wired.structuredContent.ok === true, "connect", wired.text);
  const diagnostics = await mcp.call("get_diagnostics");
  assert(!diagnostics.isError && !/\b[1-9]\d* errors?\b/.test(diagnostics.text), "no diagnostic errors after wiring", diagnostics.text);
  // The live viewer's runtime problems (viewer.diagnostics RPC), read fresh on every call.
  assert(/Live viewer \(frame [\d,]+, (playing|paused)\)/.test(diagnostics.text) && Array.isArray(diagnostics.structuredContent.runtime?.diagnostics), "get_diagnostics has a Live viewer section", diagnostics.text);
  log(`ISAT chain built (revision ${wired.structuredContent.revision})`);

  const reset = await mcp.call("sim_reset", { seed: 1 });
  assert(!reset.isError && typeof reset.structuredContent.simId === "string", "sim_reset", reset.text);
  const simId = reset.structuredContent.simId;
  const dispatched = await mcp.call("sim_dispatch", { simId, events: [{ kind: "tap", target: "@next_card" }] });
  assert(!dispatched.isError && dispatched.structuredContent.events[0].hit.handledBy.includes("press_next"), "sim_dispatch taps the next card", dispatched.text);
  const stepped = await mcp.call("sim_step", { simId, until: "idle", maxMs: 5000 });
  assert(!stepped.isError && stepped.structuredContent.settled === true, "sim_step until idle", stepped.text);
  const values = await mcp.call("sim_get_values", { simId, targets: ["next_pressed.on", "@next_card.scale"] });
  assert(values.structuredContent.values["next_pressed.on"] === true && Math.abs(values.structuredContent.values["@next_card.scale"] - 0.95) < 0.01, "the tap flipped the switch and sprang the card to 0.95", values.text);
  log(`simulated: ${values.text.split("\n").slice(1).join("; ").trim()}`);

  const shot = await mcp.call("get_screenshot", { target: "viewer", maxWidth: 800 });
  const image = (shot.content ?? []).find((c) => c.type === "image");
  assert(!shot.isError && image?.mimeType === "image/png", "get_screenshot returns a PNG", shot.text);
  const png = Buffer.from(image.data, "base64");
  const shotSize = pngSize(png);
  assert(shotSize && shotSize.width >= 200 && shotSize.height >= 400, "screenshot size", shotSize);
  writeFileSync(mcpScreenshotPath, png);
  log(`MCP screenshot ${shotSize.width}×${shotSize.height} → ${path.relative(process.cwd(), mcpScreenshotPath)}`);

  // A simulation's frame (drawn in a hidden window) when @sonobe/mcp exposes SimulationManager.scene.
  if (await app.evaluate(() => globalThis.__sonobeTest.simulationScreenshots())) {
    const simShot = await mcp.call("get_screenshot", { simId, target: "viewer", maxWidth: 402 });
    const simImage = (simShot.content ?? []).find((c) => c.type === "image");
    const simPng = simImage ? Buffer.from(simImage.data, "base64") : Buffer.alloc(0);
    const simSize = pngSize(simPng);
    assert(!simShot.isError && simImage?.mimeType === "image/png" && simSize?.width === 402, "get_screenshot with simId", simShot.text);
    writeFileSync(simScreenshotPath, simPng);
    const layerShot = await mcp.call("get_screenshot", { simId, target: "@next_card" });
    const layerImage = (layerShot.content ?? []).find((c) => c.type === "image");
    const layerSize = layerImage ? pngSize(Buffer.from(layerImage.data, "base64")) : null;
    assert(!layerShot.isError && layerSize && layerSize.width >= 50, "get_screenshot of a layer in a simulation", layerShot.text);
    log(`simulation screenshot ${simSize.width}×${simSize.height}, layer ${layerSize.width}×${layerSize.height} → ${path.relative(process.cwd(), simScreenshotPath)}`);

    // Overrides and isolated layers draw in the hidden window too, and never reach the editor's history.
    const historyBefore = (await app.evaluate(() => globalThis.__sonobeTest.invokeRenderer("history.list", { limit: 50 }))).entries.length;
    const override = await mcp.call("sim_override", { simId, set: [{ target: "@next_card.opacity", value: 0 }] });
    assert(!override.isError && override.structuredContent.overrides.length === 1, "sim_override", override.text);
    const isolated = await mcp.call("get_screenshot", { simId, target: "@card", isolate: true, atMs: 500 });
    const isolatedImage = (isolated.content ?? []).find((c) => c.type === "image");
    const isolatedSize = isolatedImage ? pngSize(Buffer.from(isolatedImage.data, "base64")) : null;
    assert(!isolated.isError && isolatedSize && isolatedSize.width >= 50 && isolated.text.includes("(isolated)") && isolated.text.includes("has 1 override"), "get_screenshot of an isolated layer with an override", isolated.text);
    const historyAfter = (await app.evaluate(() => globalThis.__sonobeTest.invokeRenderer("history.list", { limit: 50 }))).entries.length;
    assert(historyAfter === historyBefore, "sim_override leaves the editor's history alone", { historyBefore, historyAfter });
    log(`simulation override and isolated layer ${isolatedSize.width}×${isolatedSize.height}`);
  } else {
    log("WARN @sonobe/mcp doesn't expose SimulationManager.scene yet; simulation screenshots stay unavailable");
  }

  const notifications = await app.evaluate(() => globalThis.__sonobeTest.notifications());
  const outlineUri = `sonobe://documents/${info.structuredContent.docId}/outline`;
  assert(notifications.includes("resources/list_changed") && notifications.includes(`resources/updated ${outlineUri}`) && notifications.includes(`resources/updated sonobe://documents/${info.structuredContent.docId}/diagnostics`), "MCP resource notifications on new revisions", notifications);
  log(`MCP resource notifications published (${notifications.length})`);

  const listed = await mcp.call("list_history");
  assert(listed.text.includes("Claude: added press feedback") && listed.text.includes("Claude: wired press feedback"), "list_history", listed.text);
  const rendererHistory = await app.evaluate(() => globalThis.__sonobeTest.invokeRenderer("history.list", { limit: 10 }));
  assert(
    rendererHistory.entries[0]?.author.kind === "agent" && rendererHistory.entries[0].description.startsWith("Claude: wired press feedback") && rendererHistory.entries[1]?.description.startsWith("Claude: added press feedback"),
    "the renderer's history has Claude's changes",
    rendererHistory.entries.slice(0, 3),
  );
  if (mode === "harness") await page.getByText("Claude: wired press feedback").first().waitFor({ timeout: 5000 });
  const finished = await mcp.call("finish_work", { summary: "Pressing the next card now shrinks it with a spring." });
  assert(!finished.isError, "finish_work", finished.text);
  if (mode === "harness") await page.getByText("Nobody is working right now.").first().waitFor({ timeout: 5000 });
  const selectionBefore = await mcp.call("get_selection");
  const revealed = await mcp.call("reveal", { ids: ["press_spring", "next_card"] });
  assert(revealed.structuredContent.revealed === true, "reveal", revealed.text);
  const selection = await mcp.call("get_selection");
  assert(!selection.isError && selection.text === selectionBefore.text, "reveal shows items without changing the person's selection", { before: selectionBefore.text, after: selection.text });
  if (mode === "editor") {
    const tab = page.getByRole("tab", { name: /AI Activity/ }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click({ timeout: 5000 }).catch(() => undefined);
      const listedInPanel = await page.getByText(/wired press feedback/).first().waitFor({ timeout: 3000 }).then(() => true, () => false);
      log(listedInPanel ? "the AI Activity panel lists Claude's changes" : "opened AI Activity (entries weren't found by text)");
    }
  }
  await page.screenshot({ path: editorScreenshotPath });
  log(`renderer history has Claude's changes; presence, reveal and selection ok; window → ${path.relative(process.cwd(), editorScreenshotPath)}`);

  // Phone preview (SONOBE_LAN=1).
  const preview = await poll(() => app.evaluate(() => {
    const s = globalThis.__sonobeTest.previewStatus();
    return s.running ? s : null;
  }), { message: "phone preview to start" });
  assert(/^http:\/\/[^/]+:\d+\/p\/[A-Za-z0-9_-]{16,}\/$/.test(preview.url), "phone preview URL", preview);
  const rendererPreview = await page.evaluate(() => window.sonobeHost.getPreviewStatus());
  assert(rendererPreview.url === preview.url, "getPreviewStatus in the renderer", rendererPreview);
  const playerPage = await fetch(preview.url);
  assert(playerPage.status === 200 && (await playerPage.text()).includes("player.js"), "player page", playerPage.status);
  assert((await fetch(preview.url.replace(/\/p\/[^/]+\//, "/p/not-the-token/"))).status === 404, "player requires the token");
  const docJson = await (await fetch(`${preview.url}document.json`)).json();
  assert(docJson.type === "document" && docJson.doc.components.main.patches.press_scale, "document.json has Claude's patches", Object.keys(docJson.doc?.components?.main?.patches ?? {}));

  const socket = await openSocket(`${preview.url.replace(/^http/, "ws")}sync`);
  const firstSync = await socket.next((m) => m.type === "document");
  const tweak = await mcp.call("apply_ops", { label: "tuned press scale", ops: [{ op: "setInput", target: "press_scale.end", value: 0.9 }] });
  assert(!tweak.isError, "apply_ops", tweak.text);
  const synced = await socket.next((m) => m.type === "document" && m.revision === tweak.structuredContent.revision);
  assert(synced.doc.components.main.patches.press_scale.inputs.end === 0.9 && synced.revision > firstSync.revision, "live sync pushes the new revision", { from: firstSync.revision, to: synced.revision });

  // Revisions pushed by the editor (sonobeHost.notifyDocumentChanged) replace polling.
  await page.evaluate((revision) => window.sonobeHost.notifyDocumentChanged(revision), synced.revision);
  assert(await poll(() => app.evaluate(() => globalThis.__sonobeTest.previewPushUpdates() === true), { message: "push mode" }), "players switch to pushed revisions");
  const direct = await app.evaluate(() =>
    globalThis.__sonobeTest.invokeRenderer("document.apply", { ops: [{ op: "setInput", target: "press_scale.end", value: 0.92 }], label: "tuned press scale again", author: { kind: "agent", name: "Claude" } }),
  );
  assert(direct?.result?.ok === true && typeof direct.revision === "number", "a direct renderer edit", direct);
  // An editor that calls notifyDocumentChanged itself syncs the edit on its own; otherwise nothing polls,
  // so the edit only arrives once the revision is pushed (electron/lan-preview.test.ts covers no-polling exactly).
  let pushed = await socket.next((m) => m.type === "document" && m.revision === direct.revision, 1500).catch(() => null);
  const editorPushes = pushed !== null;
  if (!pushed) {
    await page.evaluate((revision) => window.sonobeHost.notifyDocumentChanged(revision), direct.revision);
    pushed = await socket.next((m) => m.type === "document" && m.revision === direct.revision);
  }
  assert(pushed.doc.components.main.patches.press_scale.inputs.end === 0.92, "pushed revisions sync players", pushed.revision);
  socket.ws.close();
  log(`phone preview on ${preview.url}${preview.lanReachable ? "" : " (loopback only)"}; live sync ${firstSync.revision} → ${synced.revision} → ${pushed.revision} (pushed ${editorPushes ? "by the editor itself" : "with notifyDocumentChanged"})`);

  // Pop-out viewer window: the live prototype in its own sandboxed window.
  const popped = await page.evaluate(() => window.sonobeHost.popOutViewer({ alwaysOnTop: false }));
  assert(popped.open === true && popped.error === null, "popOutViewer", popped);
  const viewerWindow = await poll(
    () =>
      app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith("http://127.0.0.1:"));
        if (!w || !w.isVisible()) return null;
        const layers = await w.webContents.executeJavaScript("document.querySelectorAll('.sonobe-layer').length");
        if (layers <= 5) return null;
        const prefs = w.webContents.getLastWebPreferences() ?? {};
        return { layers, title: w.getTitle(), muted: w.webContents.isAudioMuted(), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, size: w.getContentSize() };
      }),
    { timeout: 15_000, interval: 250, message: "the pop-out viewer to render" },
  );
  assert(viewerWindow.muted && viewerWindow.sandbox === true && viewerWindow.contextIsolation === true, "viewer window is muted and sandboxed", viewerWindow);
  const noHostInViewer = await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith("http://127.0.0.1:")).webContents.executeJavaScript("typeof window.sonobeHost"));
  assert(noHostInViewer === "undefined", "the viewer window has no host API", noHostInViewer);
  const refocused = await page.evaluate(() => window.sonobeHost.popOutViewer());
  const windowTotal = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible()).length);
  assert(refocused.open === true && windowTotal === 2, "popOutViewer reuses its window", { refocused, windowTotal });
  const viewerPng = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith("http://127.0.0.1:"));
    await new Promise((r) => setTimeout(r, 400));
    const image = await w.webContents.capturePage();
    return image.isEmpty() ? null : image.toPNG().toString("base64");
  });
  if (viewerPng) writeFileSync(viewerWindowScreenshotPath, Buffer.from(viewerPng, "base64"));
  const closedViewer = await page.evaluate(() => window.sonobeHost.closeViewerWindow());
  assert(closedViewer.open === false, "closeViewerWindow", closedViewer);
  log(`pop-out viewer rendered ${viewerWindow.layers} layers at ${viewerWindow.size.join("×")}${viewerPng ? ` → ${path.relative(process.cwd(), viewerWindowScreenshotPath)}` : ""}`);

  const player = await app.evaluate(async ({ BrowserWindow }, url) => {
    const w = new BrowserWindow({ show: false, width: 402, height: 874, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true } });
    w.webContents.setAudioMuted(true);
    const errors = [];
    w.webContents.on("console-message", (...args) => {
      const e = args[0];
      const level = e?.level ?? args[1];
      const message = e?.message ?? args[2];
      if (level === "error" || level === 3) errors.push(String(message));
    });
    await w.loadURL(url);
    let layers = 0;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      layers = await w.webContents.executeJavaScript("document.querySelectorAll('.sonobe-layer').length");
      if (layers > 5) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, 500));
    const statusText = await w.webContents.executeJavaScript("document.getElementById('status').textContent");
    const capture = await w.webContents.capturePage(undefined, { stayHidden: true });
    w.destroy();
    return { layers, errors, statusText, png: capture.isEmpty() ? null : capture.toPNG().toString("base64") };
  }, preview.url);
  assert(player.layers > 5 && player.errors.length === 0 && player.statusText.includes("Photo Zoom"), "the phone player renders the live prototype", { layers: player.layers, errors: player.errors, status: player.statusText });
  if (player.png) {
    writeFileSync(lanScreenshotPath, Buffer.from(player.png, "base64"));
    log(`phone player rendered ${player.layers} layers → ${path.relative(process.cwd(), lanScreenshotPath)}`);
  } else {
    log(`phone player rendered ${player.layers} layers (hidden-window capture was empty; no image saved)`);
  }
  const stopped = await app.evaluate(() => globalThis.__sonobeTest.stopPreview());
  assert(stopped.running === false, "stopPreview", stopped);
  assert(await fetch(preview.url).then(() => false, () => true), "the preview server stopped listening");

  const undoneDirect = await mcp.call("undo");
  assert(!undoneDirect.isError && undoneDirect.text.includes("tuned press scale again"), "undo the pushed edit", undoneDirect.text);
  const undone = await mcp.call("undo");
  assert(!undone.isError && undone.text.includes("tuned press scale") && !undone.text.includes("again"), "undo Claude's newest change", undone.text);
  const afterUndo = await app.evaluate(() => globalThis.__sonobeTest.invokeRenderer("history.list", { limit: 3 }));
  assert(afterUndo.entries[0]?.description.startsWith("Claude: wired press feedback"), "undo went through the renderer's history", afterUndo.entries[0]);
  log("undo ok");

  await app.evaluate(() => globalThis.__sonobeTest.destroyWindows());
  if (process.platform === "darwin") {
    await poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 0), { message: "windows destroyed" });
    const orphan = await mcp.call("get_outline");
    assert(orphan.isError && orphan.text.includes("no_window"), "tools explain that no window is open", orphan.text);
    log("no-window error ok");
  }
  await mcp.close();
  await app.close().catch(() => undefined);
  app = null;

  // ---------------------------------------------------------------------------------------------
  // 3. Relaunches
  // ---------------------------------------------------------------------------------------------

  log("relaunching against a stub editor build");
  const editorDist = path.join(temp, "editor-dist");
  mkdirSync(editorDist, { recursive: true });
  writeFileSync(
    path.join(editorDist, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><title>Editor stub</title></head><body><p id="out">waiting</p><script>window.sonobeHost.getMcpStatus().then((s) => { document.getElementById("out").textContent = "mcp:" + s.running; }, (e) => { document.getElementById("out").textContent = "error:" + e.message; });</script></body></html>\n',
  );
  app = await launch({ ...env, SONOBE_EDITOR_DIST: editorDist });
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
  app = await launch({ ...env, SONOBE_DEV_URL: `http://127.0.0.1:${closedPort}`, SONOBE_MCP: "0" });
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
    await app?.evaluate(() => globalThis.__sonobeTest?.destroyWindows()).catch(() => undefined);
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
