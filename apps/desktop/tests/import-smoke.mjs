#!/usr/bin/env node
/**
 * Design import in the Electron app (muted): serves fixture pages from a local "dev server", launches
 * Sonobe with the built editor, and checks the whole path.
 *
 * - MCP import_design with a url: the hidden capture window loads the page, images download with the
 *   capture session, the bytes reach the live editor (assets.put), and the screen is one undo step.
 *   Saves the viewer (screenshots/import-viewer.png) and the page as the browser drew it
 *   (screenshots/import-source.png).
 * - MCP import_design with html: a long page gets a Scroll patch.
 * - A dead dev server explains itself.
 * - The editor's own bridge: window.sonobeHost.captureDesign for the Import dialog.
 * - Pasting a capture (from the Chrome extension) downloads its linked image through the main process.
 *
 *   npm run build -w @sonobe/editor && node apps/desktop/scripts/build.mjs && node apps/desktop/tests/import-smoke.mjs
 */

import { _electron as electron } from "playwright";
import electronPath from "electron";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(appDir, "../..");
const screenshotsDir = path.join(appDir, "screenshots");
const started = Date.now();
const log = (msg) => console.log(`[import-smoke +${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);
const assert = (condition, message, detail) => {
  if (!condition) throw new Error(`Assertion failed: ${message}${detail === undefined ? "" : `\n  got: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};
async function poll(fn, { timeout = 15_000, interval = 100, message = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

if (!existsSync(path.join(appDir, "dist", "main.cjs")) || !existsSync(path.join(repoDir, "apps", "editor", "dist", "index.html"))) {
  console.error("Build first: npm run build -w @sonobe/editor && node apps/desktop/scripts/build.mjs");
  process.exit(1);
}

// A tiny "dev server": the profile fixture, with its avatar served as a real PNG from this origin.
const AVATAR = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8Dwn4GBgYGJAQoAAAoXAQFrlYz2AAAAAElFTkSuQmCC", "base64");
const profile = readFileSync(path.join(repoDir, "packages/import/fixtures/profile.html"), "utf8").replace(/src="data:image\/svg\+xml;utf8,[^"]*"/, 'src="/avatar.png"');
const server = createServer((req, res) => {
  if (req.url === "/avatar.png") {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(AVATAR);
  } else if (req.url === "/profile") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(profile);
  } else {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const temp = mkdtempSync(path.join(tmpdir(), "sonobe-import-smoke-"));
const home = path.join(temp, "home");
const env = { ...process.env, SONOBE_MUTE: "1", SONOBE_HOME: home, SONOBE_USER_DATA: path.join(temp, "userData"), SONOBE_TEST: "1" };
for (const key of ["SONOBE_DEV_URL", "SONOBE_MCP_PORT", "SONOBE_LAN", "SONOBE_EDITOR_DIST", "ELECTRON_RUN_AS_NODE"]) delete env[key];

let app;
let failed = false;
const watchdog = setTimeout(() => {
  console.error("[import-smoke] watchdog: exceeded 180 s");
  app?.process()?.kill("SIGKILL");
  process.exit(1);
}, 180_000);

try {
  mkdirSync(screenshotsDir, { recursive: true });
  app = await electron.launch({ executablePath: electronPath, args: ["--mute-audio", appDir], cwd: appDir, env, timeout: 30_000 });
  app.process().stderr?.on("data", (d) => process.stderr.write(`[app] ${d}`));
  const win = await app.firstWindow();
  await poll(() => win.evaluate(() => typeof window.sonobeHost?.captureDesign === "function").catch(() => false), { message: "the editor with sonobeHost.captureDesign" });
  // First launch shows the welcome screen over the editor: mark it seen and reload.
  await win.evaluate(() => localStorage.setItem("sonobe.welcome.v1", "seen"));
  await win.reload();
  await poll(() => win.evaluate(() => typeof window.sonobeHost?.captureDesign === "function" && !!document.querySelector(".sb-cv__artboard")).catch(() => false), { message: "the editor after reload" });
  const tokenFile = path.join(home, "mcp.json");
  await poll(() => existsSync(tokenFile), { message: "mcp.json" });
  const conn = JSON.parse(readFileSync(tokenFile, "utf8"));
  const client = new Client({ name: "claude-code", version: "import-smoke" });
  await client.connect(new StreamableHTTPClientTransport(new URL(conn.url), { requestInit: { headers: { Authorization: `Bearer ${conn.token}` } } }));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    return { ...result, text };
  };
  await poll(async () => !(await call("list_documents")).isError, { message: "the editor connected to MCP" });

  log(`import_design url http://127.0.0.1:${port}/profile`);
  const imported = await call("import_design", { url: `http://127.0.0.1:${port}/profile`, screenshot: true });
  assert(!imported.isError, "import_design url succeeds", imported.text);
  assert(imported.text.includes('Imported "Profile" as layer'), "result names the screen", imported.text);
  assert(imported.text.includes('"Profile Card"') && imported.text.includes('"Follow Button"'), "result outline shows named layers", imported.text);
  const source = (imported.content ?? []).find((c) => c.type === "image");
  assert(source?.data, "the page screenshot comes back");
  writeFileSync(path.join(screenshotsDir, "import-source.png"), Buffer.from(source.data, "base64"));

  const doc = await app.evaluate(() => globalThis.__sonobeTest.invokeRenderer("document.get", {}));
  const assets = Object.values(doc.document.assets);
  assert(assets.some((a) => a.mime === "image/png"), "the avatar downloaded as a PNG asset", assets);
  assert(assets.filter((a) => a.mime === "image/svg+xml").length >= 4, "inline SVG icons became assets", assets.map((a) => a.mime));
  const history = await call("list_history", { limit: 3 });
  assert(history.text.includes("imported Profile"), "one attributed undo step", history.text);

  const shot = await call("get_screenshot", {});
  const image = (shot.content ?? []).find((c) => c.type === "image");
  assert(image?.data, "viewer screenshot", shot.text);
  writeFileSync(path.join(screenshotsDir, "import-viewer.png"), Buffer.from(image.data, "base64"));

  log("import_design html (a long page)");
  const rows = Array.from({ length: 24 }, (_, i) => `<div style="height:64px;border-bottom:1px solid #eee;display:flex;align-items:center;padding:0 16px">Row ${i + 1}</div>`).join("");
  const inbox = await call("import_design", { html: `<!doctype html><body style="margin:0;font-family:system-ui">${rows}</body>`, name: "Inbox", position: [402, 0] });
  assert(!inbox.isError && inbox.text.includes("Scroll patch"), "a long page scrolls", inbox.text);

  log("import_design with a dead dev server");
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const deadPort = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  const dead = await call("import_design", { url: `http://127.0.0.1:${deadPort}/` });
  assert(dead.isError && dead.text.includes("Nothing answered") && dead.text.includes("dev server"), "a dead dev server explains itself", dead.text);

  log("window.sonobeHost.captureDesign (the Import dialog's bridge)");
  const reply = await win.evaluate(() => window.sonobeHost.captureDesign({ html: '<body style="margin:0"><button data-name="Buy" style="margin:40px;padding:12px 20px;border:0;border-radius:12px;background:#277FFF;color:#fff">Buy</button></body>', width: 402, height: 874 }));
  assert(reply.ok && reply.capture.root.children.some((c) => c.name === "Buy"), "the editor bridge captures HTML", reply);

  log("paste a capture with a linked image");
  const capture = { format: "sonobe.design-capture", version: 1, source: { kind: "chrome", title: "Pasted" }, viewport: { width: 402, height: 874 }, root: { kind: "frame", name: "Pasted", box: [0, 0, 402, 300], fill: "#FFFFFFFF", children: [{ kind: "image", name: "Remote Avatar", image: "img1", fit: "cover", box: [20, 20, 64, 64] }] }, images: { img1: { url: `http://127.0.0.1:${port}/avatar.png` } } };
  await win.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, JSON.stringify(capture));
  const pasted = await poll(async () => {
    const d = await app.evaluate(() => globalThis.__sonobeTest.invokeRenderer("document.get", {}));
    const layers = JSON.stringify(d.document.components.main.layers);
    return layers.includes("Remote Avatar") ? layers : null;
  }, { message: "the pasted screen" });
  assert(/"image":\{"asset":"[a-z_0-9]+"\}/.test(pasted.slice(pasted.indexOf("Remote Avatar") - 400)), "the linked image downloaded as an asset", pasted.slice(pasted.indexOf("Remote Avatar") - 200, pasted.indexOf("Remote Avatar") + 200));

  await win.screenshot({ path: path.join(screenshotsDir, "import-editor.png") });
  await client.close();
  log("ok");
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  clearTimeout(watchdog);
  await app?.evaluate(() => globalThis.__sonobeTest?.destroyWindows()).catch(() => undefined);
  await app?.close().catch(() => undefined);
  server.close();
  rmSync(temp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
