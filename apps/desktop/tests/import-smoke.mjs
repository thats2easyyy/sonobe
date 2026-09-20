#!/usr/bin/env node
/**
 * Design import in the Electron app (muted): serves fixture pages from a local "dev server", launches
 * Sonobe with the built editor, and checks the whole path.
 *
 * - MCP import_design with a url: the hidden capture window loads the page, images download with the
 *   capture session, the bytes reach the live editor (assets.put), and the screen is one undo step.
 *   Saves the viewer (screenshots/import-viewer.png) and the page as the browser drew it
 *   (screenshots/import-source.png).
 * - MCP import_design with html: a long page gets a Scroll patch, and <svg data-sf-symbol> placeholders
 *   become real SF Symbols when the app has its helper (macOS), or gray placeholders with a note.
 * - A dead dev server explains itself.
 * - The editor's own bridge: window.sonobeHost.captureDesign for the Import dialog.
 * - Pasting a capture (from the Chrome extension) downloads its linked image through the main process.
 * - Long calls: an import reports progress; colorScheme with a screenshot works for url and html (the
 *   page reads prefers-color-scheme while it parses); a page stuck in a loop stops at the deadline
 *   with an error naming the step; a client cancel and a disconnect after a forced GC close the
 *   capture window at once and change nothing; the dialog's bridge follows progress and cancels;
 *   no capture window or debugger is left at the end.
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
// The title says which color scheme the page saw while it parsed, so it proves the scheme was set first.
const schemePage = (label) => `<!doctype html><style>body{margin:0;background:#fff}@media (prefers-color-scheme: dark){body{background:#000;color:#fff}}</style><body><button data-name="Buy" style="margin:40px;padding:12px 20px">Buy ${label}</button><script>document.title = matchMedia("(prefers-color-scheme: dark)").matches ? "Dark" : "Light"</script></body>`;
const BUSY = '<!doctype html><title>Busy</title><body>busy<script>addEventListener("load", () => setTimeout(() => { for (;;) {} }, 0))</script></body>';
const server = createServer((req, res) => {
  if (req.url === "/avatar.png") {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(AVATAR);
  } else if (req.url === "/scheme") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(schemePage("url"));
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
  // --expose-gc: the disconnect check forces a garbage collection in the main process first.
  app = await electron.launch({ executablePath: electronPath, args: ["--js-flags=--expose-gc", "--mute-audio", appDir], cwd: appDir, env, timeout: 30_000 });
  app.process().stderr?.on("data", (d) => process.stderr.write(`[app] ${d}`));
  // Track every window after the editor's, so the checks can see capture windows open and close.
  await app.evaluate(({ app: electronApp }) => {
    globalThis.__captureWindows = { created: 0, destroyed: [] };
    electronApp.on("browser-window-created", (_event, w) => {
      globalThis.__captureWindows.created++;
      w.webContents.once("destroyed", () => globalThis.__captureWindows.destroyed.push(Date.now()));
    });
  });
  const win = await app.firstWindow();
  await poll(() => win.evaluate(() => typeof window.sonobeHost?.captureDesign === "function").catch(() => false), { message: "the editor with sonobeHost.captureDesign" });
  // First launch shows the welcome screen over the editor: mark it seen and reload.
  await win.evaluate(() => localStorage.setItem("sonobe.welcome.v1", "seen"));
  await win.reload();
  await poll(() => win.evaluate(() => typeof window.sonobeHost?.captureDesign === "function" && !!document.querySelector(".sb-cv__artboard")).catch(() => false), { message: "the editor after reload" });
  const tokenFile = path.join(home, "mcp.json");
  await poll(() => existsSync(tokenFile), { message: "mcp.json" });
  const conn = JSON.parse(readFileSync(tokenFile, "utf8"));
  const connect = async () => {
    const c = new Client({ name: "claude-code", version: "import-smoke" });
    const transport = new StreamableHTTPClientTransport(new URL(conn.url), { requestInit: { headers: { Authorization: `Bearer ${conn.token}` } } });
    await c.connect(transport);
    return { client: c, transport };
  };
  const { client } = await connect();
  const call = async (name, args = {}, options = undefined) => {
    const result = await client.callTool({ name, arguments: args }, undefined, options);
    const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    return { ...result, text };
  };
  await poll(async () => !(await call("list_documents")).isError, { message: "the editor connected to MCP" });
  const windowsAtStart = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const captureWindows = () => app.evaluate(() => ({ created: globalThis.__captureWindows.created, destroyed: globalThis.__captureWindows.destroyed.length, last: globalThis.__captureWindows.destroyed.at(-1) }));
  const revision = async () => Number((await call("get_document_info")).structuredContent?.revision);

  log(`import_design url http://127.0.0.1:${port}/profile`);
  const progress = [];
  const imported = await call("import_design", { url: `http://127.0.0.1:${port}/profile`, screenshot: true }, { onprogress: (p) => progress.push(p.message), resetTimeoutOnProgress: true });
  assert(!imported.isError, "import_design url succeeds", imported.text);
  assert(progress.includes(`Loading http://127.0.0.1:${port}/profile`) && progress.includes("Reading the page's layers") && progress.some((m) => /^Downloading images: \d+ of \d+/.test(m)) && progress.includes("Taking the page screenshot"), "the import reports its steps as progress", progress);
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

  log("import_design html with SF Symbol placeholders");
  {
    // The app draws SF Symbols with dist/bin/sfsymbol on macOS 13+ (build.mjs skips it without Xcode's tools).
    const helper = existsSync(path.join(appDir, "dist", "bin", "sfsymbol"));
    const info = await call("get_document_info");
    assert(info.structuredContent?.host?.sfSymbols === helper, "get_document_info says whether imports draw SF Symbols", info.text);
    const html = `<!doctype html><body style="margin:0;font-family:system-ui"><div data-name="Actions" style="display:flex;gap:24px;align-items:center;padding:80px 16px"><div data-name="Like Button" style="display:flex;width:56px;height:56px;border-radius:28px;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,.15);align-items:center;justify-content:center"><svg data-sf-symbol="heart.fill" style="font-size:26px;color:#F24D47"></svg></div><svg data-sf-symbol="not.a.symbol" style="font-size:20px"></svg></div></body>`;
    const steps = [];
    const r = await call("import_design", { html, name: "Symbols", position: [1206, 0] }, { onprogress: (p) => steps.push(p.message), resetTimeoutOnProgress: true });
    assert(!r.isError, "import_design with SF Symbols succeeds", r.text);
    if (helper) {
      assert(r.text.includes('layer heart_fill image "heart.fill"'), "the placeholder became the real symbol, named after it", r.text);
      assert(steps.some((m) => /^Drawing SF Symbols: \d+ of \d+$/.test(m)), "drawing SF Symbols is a progress step", steps);
      assert(r.text.includes("“not.a.symbol” isn't an SF Symbol on this Mac") && r.text.includes("gray placeholder"), "an unknown name is a placeholder with a note", r.text);
      const symbolDoc = await app.evaluate(() => globalThis.__sonobeTest.invokeRenderer("document.get", {}));
      assert(Object.values(symbolDoc.document.assets).some((a) => a.name === "heart.fill" && a.mime === "image/svg+xml"), "the symbol is an SVG asset", Object.values(symbolDoc.document.assets).map((a) => a.name));
    } else {
      assert(r.text.includes("gray placeholder"), "without the helper, symbols are placeholders with a note", r.text);
    }
  }

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

  log("colorScheme with a screenshot (url and html)");
  for (const [source, args] of [
    ["url", { url: `http://127.0.0.1:${port}/scheme` }],
    ["html", { html: schemePage("html") }],
  ]) {
    for (const colorScheme of ["dark", "light"]) {
      const started = Date.now();
      const r = await call("import_design", { ...args, colorScheme, screenshot: true, position: [804, 0] });
      const expected = colorScheme === "dark" ? "Dark" : "Light";
      assert(!r.isError && r.text.includes(`Imported "${expected}"`), `${source} with colorScheme ${colorScheme} imports the ${colorScheme} page`, r.text);
      assert((r.content ?? []).some((c) => c.type === "image"), `${source} with colorScheme ${colorScheme} returns the screenshot`);
      assert(Date.now() - started < 10_000, `${source} with colorScheme ${colorScheme} answers quickly`, `${Date.now() - started} ms`);
    }
  }

  log("a page stuck in a loop stops at the deadline (lowered to 8 s for this run)");
  await app.evaluate(() => globalThis.__sonobeTest.setCaptureDeadline(8_000));
  {
    const started = Date.now();
    const stuck = await call("import_design", { html: BUSY });
    const ms = Date.now() - started;
    assert(stuck.isError && stuck.text.includes("capture_timeout") && stuck.text.includes("didn't finish within 8 seconds") && stuck.text.includes("reading the page's layers"), "a stuck page fails with a teaching timeout naming the step", stuck.text);
    assert(ms < 12_000, "the deadline holds", `${ms} ms`);
    const w = await poll(async () => {
      const c = await captureWindows();
      return c.created === c.destroyed ? c : null;
    }, { timeout: 3_000, message: "the stuck page's window to close" });
    assert(w, "the stuck page's window is gone");
  }
  await app.evaluate(() => globalThis.__sonobeTest.setCaptureDeadline(null));

  log("the client cancels an import (notifications/cancelled over stateless HTTP)");
  {
    const before = await revision();
    const controller = new AbortController();
    const pending = client.callTool({ name: "import_design", arguments: { html: BUSY, name: "Cancelled Import" } }, undefined, { signal: controller.signal }).then(
      () => "resolved",
      (err) => `rejected: ${err.message}`,
    );
    await poll(async () => {
      const c = await captureWindows();
      return c.created > c.destroyed;
    }, { message: "the capture window to open" });
    await new Promise((r) => setTimeout(r, 500));
    const cancelledAt = Date.now();
    controller.abort("the person pressed Esc");
    assert((await pending).startsWith("rejected"), "the cancelled call rejects on the client");
    const c = await poll(async () => {
      const w = await captureWindows();
      return w.created === w.destroyed ? w : null;
    }, { timeout: 3_000, message: "the capture window to close after the cancel" });
    assert(c.last - cancelledAt < 1_500, "the cancel closes the capture window promptly", `${c.last - cancelledAt} ms`);
    await new Promise((r) => setTimeout(r, 300));
    assert((await revision()) === before, "a cancelled import changes nothing", { before, after: await revision() });
    assert(!(await call("list_history", { limit: 5 })).text.includes("Cancelled Import"), "a cancelled import leaves no history entry");
  }

  log("the client disconnects after a garbage collection");
  {
    const before = await revision();
    const other = await connect();
    const pending = other.client.callTool({ name: "import_design", arguments: { html: BUSY } }).then(
      () => "resolved",
      (err) => `rejected: ${err.message}`,
    );
    await poll(async () => {
      const c = await captureWindows();
      return c.created > c.destroyed;
    }, { message: "the capture window to open" });
    await new Promise((r) => setTimeout(r, 500));
    await app.evaluate(() => {
      for (let i = 0; i < 3; i++) globalThis.gc?.();
    });
    const closedAt = Date.now();
    await other.transport.close();
    await pending;
    const c = await poll(async () => {
      const w = await captureWindows();
      return w.created === w.destroyed ? w : null;
    }, { timeout: 3_000, message: "the capture window to close after the disconnect" });
    assert(c.last - closedAt < 1_500, "a disconnect closes the capture window promptly", `${c.last - closedAt} ms`);
    assert((await revision()) === before, "a disconnected import changes nothing");
  }

  log("the Import dialog's bridge: dark mode, progress, and cancel");
  {
    const dark = await win.evaluate((html) => window.sonobeHost.captureDesign({ html, width: 402, height: 874, colorScheme: "dark" }), schemePage("dialog"));
    assert(dark.ok && dark.capture.root.name === "Dark" && dark.capture.root.fill === "#000000FF", "sonobeHost.captureDesign with colorScheme dark", dark);
    const cancelled = await win.evaluate(async (html) => {
      const captureId = "smoke-cancel";
      const seen = [];
      const off = window.sonobeHost.onCaptureDesignProgress((p) => {
        if (p.captureId === captureId) seen.push(p.message);
      });
      const pending = window.sonobeHost.captureDesign({ html, width: 402, height: 874, captureId });
      await new Promise((r) => setTimeout(r, 1_000));
      const at = Date.now();
      window.sonobeHost.cancelCaptureDesign(captureId);
      const reply = await pending;
      off();
      return { reply, seen, ms: Date.now() - at };
    }, BUSY);
    assert(!cancelled.reply.ok && cancelled.reply.code === "cancelled", "cancelCaptureDesign stops the dialog's capture", cancelled);
    assert(cancelled.ms < 1_500, "the dialog's cancel is prompt", cancelled.ms);
    assert(cancelled.seen.includes("Rendering the HTML") && cancelled.seen.includes("Reading the page's layers"), "the dialog receives the capture's progress", cancelled.seen);
  }

  const left = await app.evaluate(({ BrowserWindow, webContents }) => ({ windows: BrowserWindow.getAllWindows().length, attached: webContents.getAllWebContents().filter((w) => w.debugger.isAttached()).length }));
  const counts = await captureWindows();
  assert(left.windows === windowsAtStart && left.attached === 0 && counts.created === counts.destroyed, "no capture window or debugger is left", { ...left, windowsAtStart, ...counts });

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
