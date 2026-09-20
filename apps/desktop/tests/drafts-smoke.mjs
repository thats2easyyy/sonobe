#!/usr/bin/env node
/**
 * Drafts in the Electron app (muted): unsaved work survives the app being killed.
 *
 * 1. A blank prototype from the welcome screen, a layer added over MCP, then SIGTERM (what ending a
 *    Claude Code background task sends): the app keeps the draft and exits with code 0 at once, with
 *    no unsaved-changes prompt left waiting.
 * 2. Relaunch: the welcome screen's Recovered section lists it (screenshots/drafts-recovered.png),
 *    list_documents offers draft:<id>, open_document brings it back, and more edits keep going to
 *    the same draft. Then SIGKILL, which nothing can catch.
 * 3. Relaunch: the draft is there with both edits. save_document without a path refuses to name an
 *    Untitled folder (path_needed), with a path it saves there with no dialog, the draft goes away,
 *    and a path inside that project is refused (inside_project).
 * 4. An unsaved change to that project, then the editor's renderer crashes: a call it was working on
 *    fails at once (page_gone), the window reloads, an MCP call right after waits for the reloaded
 *    editor, and the draft comes back over its project. Save As through the (stubbed) Save panel
 *    refuses a folder inside the project and reopens next to it. Closing the window with Don't Save
 *    removes a draft.
 *
 * SONOBE_SMOKE_VERBOSE=1 shows the app's own log.
 *
 * Every path is in a temp folder; nothing is written to ~/Documents.
 *
 *   npm run build -w @sonobe/editor && node apps/desktop/scripts/build.mjs && node apps/desktop/tests/drafts-smoke.mjs
 */

import { _electron as electron } from "playwright";
import electronPath from "electron";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(appDir, "../..");
const screenshotsDir = path.join(appDir, "screenshots");
const started = Date.now();
const log = (msg) => console.log(`[drafts-smoke +${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);
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
  throw new Error(`Timed out waiting for ${message} (last: ${JSON.stringify(last)})`);
}

if (!existsSync(path.join(appDir, "dist", "main.cjs")) || !existsSync(path.join(repoDir, "apps", "editor", "dist", "index.html"))) {
  console.error("Build first: npm run build -w @sonobe/editor && node apps/desktop/scripts/build.mjs");
  process.exit(1);
}

const temp = mkdtempSync(path.join(tmpdir(), "sonobe-drafts-smoke-"));
const home = path.join(temp, "home");
const userData = path.join(temp, "userData");
const draftsDir = path.join(userData, "Drafts");
const tokenFile = path.join(home, "mcp.json");
const env = { ...process.env, SONOBE_MUTE: "1", SONOBE_HOME: home, SONOBE_USER_DATA: userData, SONOBE_TEST: "1" };
for (const key of ["SONOBE_DEV_URL", "SONOBE_MCP_PORT", "SONOBE_LAN", "SONOBE_LAN_PORT", "SONOBE_EDITOR_DIST", "ELECTRON_RUN_AS_NODE"]) delete env[key];

let app = null;
let failed = false;
const watchdog = setTimeout(() => {
  console.error("[drafts-smoke] watchdog: exceeded 240 s");
  app?.process()?.kill("SIGKILL");
  process.exit(1);
}, 240_000);

const launch = async () => {
  rmSync(tokenFile, { force: true });
  const next = await electron.launch({ executablePath: electronPath, args: ["--mute-audio", appDir], cwd: appDir, env, timeout: 30_000 });
  next.process().stderr?.on("data", (d) => process.stderr.write(`[app] ${d}`));
  if (process.env.SONOBE_SMOKE_VERBOSE === "1") next.process().stdout?.on("data", (d) => process.stdout.write(`[app] ${d}`));
  const page = await next.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await poll(() => next.evaluate(() => globalThis.__sonobeTest?.hasRendererMethod("document.apply") === true), { timeout: 20_000, message: "the editor's MCP bridge" });
  return { app: next, page };
};

async function connectMcp() {
  await poll(() => existsSync(tokenFile), { message: "mcp.json" });
  const conn = JSON.parse(readFileSync(tokenFile, "utf8"));
  const client = new Client({ name: "claude-code", version: "drafts-smoke" });
  await client.connect(new StreamableHTTPClientTransport(new URL(conn.url), { requestInit: { headers: { Authorization: `Bearer ${conn.token}` } } }));
  return {
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      return { ...result, text: (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n") };
    },
    close: () => client.close().catch(() => undefined),
  };
}

/** Drafts on disk: id → draft.json. */
function draftsOnDisk() {
  if (!existsSync(draftsDir)) return {};
  const out = {};
  for (const name of readdirSync(draftsDir)) {
    const manifest = path.join(draftsDir, name, "draft.json");
    if (existsSync(manifest)) out[name.replace(/\.sonobe$/, "")] = JSON.parse(readFileSync(manifest, "utf8"));
  }
  return out;
}

/** Send `signal` to the main process and wait for it to exit. */
async function kill(signal, withinMs) {
  const child = app.process();
  const exited = new Promise((resolve) => child.once("exit", (code, sig) => resolve({ code, signal: sig, afterMs: Date.now() - sent })));
  const sent = Date.now();
  process.kill(child.pid, signal);
  const outcome = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(null), withinMs))]);
  if (!outcome) child.kill("SIGKILL");
  await app.close().catch(() => undefined);
  app = null;
  return outcome;
}

try {
  mkdirSync(screenshotsDir, { recursive: true });

  // ---------------------------------------------------------------------------------------------
  // 1. Untitled work, then SIGTERM
  // ---------------------------------------------------------------------------------------------

  let page;
  ({ app, page } = await launch());
  const welcome = page.getByRole("dialog", { name: "Welcome to Sonobe" });
  await welcome.waitFor({ state: "visible", timeout: 20_000 });
  await welcome.getByRole("button", { name: "Create" }).click();
  await welcome.waitFor({ state: "hidden" });
  let mcp = await connectMcp();
  const added = await mcp.call("add_layers", { label: "added the hero card", layers: [{ ref: "hero", type: "rectangle", name: "An hour of Claude's work", props: { size: [200, 120] } }] });
  assert(!added.isError, "add_layers", added.text);
  const kept = await poll(async () => {
    const info = await mcp.call("get_document_info");
    return info.text.includes("kept as a draft") ? info : null;
  }, { message: "the draft to be written" });
  assert(kept.text.startsWith("Untitled · docId untitled") && kept.structuredContent.draft?.id, "get_document_info says the work is kept as a draft", kept.text);
  const draftId = kept.structuredContent.draft.id;
  assert(draftsOnDisk()[draftId]?.name === "Untitled", "the draft is in <userData>/Drafts", draftsOnDisk());
  await mcp.close();
  log(`draft ${draftId} written; sending SIGTERM`);

  // Usually well under a second; at worst the 1.5 s flush limit plus the 2 s quit fallback. The old
  // behavior never exited: the unsaved-changes prompt waited for an answer.
  const term = await kill("SIGTERM", 8000);
  assert(term && term.code === 0 && term.afterMs < 5000, "SIGTERM quits with code 0 on its own, with no prompt waiting", term);
  assert(!existsSync(tokenFile), "the quit cleaned up mcp.json");
  log(`SIGTERM: exited with code ${term.code} after ${term.afterMs} ms`);

  // ---------------------------------------------------------------------------------------------
  // 2. Recover it, edit more, then SIGKILL
  // ---------------------------------------------------------------------------------------------

  ({ app, page } = await launch());
  const recovered = page.getByRole("dialog", { name: "Welcome to Sonobe" });
  await recovered.waitFor({ state: "visible", timeout: 20_000 });
  const row = recovered.locator(".sb-welcome__draft").filter({ hasText: "Untitled" });
  await row.waitFor({ timeout: 10_000 });
  const rowText = await row.innerText();
  assert(/Not saved · (just now|\d+ min ago) · 1 layer/.test(rowText), "the Recovered section describes the draft", rowText);
  await page.screenshot({ path: path.join(screenshotsDir, "drafts-recovered.png") });
  mcp = await connectMcp();
  const listed = await mcp.call("list_documents");
  assert(listed.text.includes(`draft:${draftId} "Untitled" · never saved`), "list_documents offers the draft", listed.text);
  const opened = await mcp.call("open_document", { ref: `draft:${draftId}` });
  assert(!opened.isError && opened.text.startsWith("Recovered the draft"), "open_document brings the draft back", opened.text);
  await recovered.waitFor({ state: "hidden", timeout: 5000 });
  const outline = await mcp.call("get_outline", { detail: "compact" });
  assert(outline.text.includes("An hour of Claude's work"), "the recovered document has the layer", outline.text);
  const again = await mcp.call("list_documents");
  assert(!again.text.includes("draft:"), "an open draft isn't offered again", again.text);

  const before = draftsOnDisk()[draftId].updatedAt;
  const second = await mcp.call("add_layers", { label: "added a second card", layers: [{ type: "rectangle", name: "Work after the restart" }] });
  assert(!second.isError, "add_layers after recovering", second.text);
  await poll(() => draftsOnDisk()[draftId]?.updatedAt > before && draftsOnDisk()[draftId]?.counts.layers === 2, { message: "the same draft to be written again" });
  assert(Object.keys(draftsOnDisk()).length === 1, "edits after recovering keep going to the same draft", Object.keys(draftsOnDisk()));
  await mcp.close();
  log("recovered over MCP; more edits went to the same draft; sending SIGKILL");
  const hard = await kill("SIGKILL", 5000);
  assert(hard && hard.signal === "SIGKILL", "SIGKILL", hard);

  // ---------------------------------------------------------------------------------------------
  // 3. Recover after SIGKILL, and save it as a project without a dialog
  // ---------------------------------------------------------------------------------------------

  ({ app, page } = await launch());
  mcp = await connectMcp();
  const afterKill = await mcp.call("list_documents");
  assert(afterKill.text.includes(`draft:${draftId}`), "the draft survived SIGKILL", afterKill.text);
  assert(!afterKill.text.includes("its last changes may be missing"), "the draft isn't torn", afterKill.text);
  const reopened = await mcp.call("open_document", { ref: `draft:${draftId}` });
  assert(!reopened.isError, "open_document after SIGKILL", reopened.text);
  const both = await mcp.call("get_outline", { detail: "compact" });
  assert(both.text.includes("An hour of Claude's work") && both.text.includes("Work after the restart"), "both edits came back", both.text);

  const untitled = await mcp.call("save_document");
  assert(untitled.isError && untitled.text.includes("path_needed"), "an Untitled prototype needs a path", untitled.text);
  const target = path.join(temp, "Projects", "Placemark Deck.sonobe");
  const saved = await mcp.call("save_document", { path: target });
  assert(!saved.isError && saved.text.includes(`to ${target}: wrote`), "save_document({ path }) saves with no dialog", saved.text);
  assert(JSON.parse(readFileSync(path.join(target, "project.json"), "utf8")).name === "Placemark Deck", "the project takes the folder's name");
  await poll(() => Object.keys(draftsOnDisk()).length === 0 && !existsSync(path.join(draftsDir, `${draftId}.sonobe`)), { message: "the draft to go once the work is saved" });
  const nested = await mcp.call("create_document", { path: path.join(target, "Nested.sonobe") });
  assert(nested.isError && nested.text.includes("inside_project"), "create_document refuses a folder inside a project", nested.text);
  const info = await mcp.call("get_document_info");
  assert(info.text.includes(`Path: ${target}`) && !info.text.includes("unsaved"), "the document is the saved project now", info.text);
  log(`saved to ${target}; the draft is gone`);

  // ---------------------------------------------------------------------------------------------
  // 4. Unsaved changes to that project: the editor crashes, then the window closes with Don't Save
  // ---------------------------------------------------------------------------------------------

  const edit = await mcp.call("add_layers", { label: "added a badge", layers: [{ type: "oval", name: "Badge after saving" }] });
  assert(!edit.isError, "add_layers on the saved project", edit.text);
  await poll(() => Object.values(draftsOnDisk()).some((d) => d.projectPath === target && d.counts.layers === 3), { message: "a draft of the unsaved changes to the project" });
  // A call the editor is still working on when it crashes fails at once and says why, instead of timing out.
  await page.evaluate(() => window.sonobeHost.rpc.handle("smoke.hang", () => new Promise(() => undefined)));
  await poll(() => app.evaluate(() => globalThis.__sonobeTest.hasRendererMethod("smoke.hang") === true), { message: "the handler that never answers" });
  const inFlight = app.evaluate(() => globalThis.__sonobeTest.invokeRenderer("smoke.hang", undefined, { timeoutMs: 30_000 }).then(() => "answered", (err) => err.code));
  const crashedAt = Date.now();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  const cutOff = await inFlight;
  assert(cutOff === "page_gone" && Date.now() - crashedAt < 5000, "a call in flight fails with page_gone when the editor crashes", { cutOff, afterMs: Date.now() - crashedAt });
  // The window reloads its editor: a call right after the crash waits for it, and the draft it held is free to recover.
  const reloaded = await mcp.call("get_document_info");
  assert(!reloaded.isError, "get_document_info right after the crash waits for the reloaded editor", reloaded.text);
  log(`the call in flight failed with page_gone; the next one waited ${Date.now() - crashedAt} ms for the reloaded editor`);
  const afterCrash = await poll(async () => {
    const r = await mcp.call("list_documents");
    return r.text.includes(`unsaved changes to ${target}`) ? r : null;
  }, { message: "the crashed window's draft to be recoverable" });
  const crashedId = /^\s+draft:(\S+) /m.exec(afterCrash.text)[1];
  const back = await mcp.call("open_document", { ref: `draft:${crashedId}` });
  assert(!back.isError && back.text.includes(`Path: ${target}`) && back.text.includes("unsaved changes"), "the draft comes back over its project", back.text);
  const three = await mcp.call("get_outline", { detail: "compact" });
  assert(three.text.includes("Badge after saving"), "the unsaved change came back", three.text);
  log("recovered unsaved changes to a saved project after a renderer crash");

  // The person's Save As panel (stubbed): a folder inside the project is refused and the panel reopens next to it.
  const copy = path.join(temp, "Projects", "Copy.sonobe");
  await app.evaluate(({ dialog }, choices) => {
    globalThis.__panels = [];
    globalThis.__messages = [];
    dialog.showSaveDialog = async (_win, options) => {
      globalThis.__panels.push(options.defaultPath);
      return { canceled: false, filePath: choices.shift() };
    };
    dialog.showMessageBox = async (_win, options) => {
      globalThis.__messages.push(options.message);
      return { response: 0, checkboxChecked: false };
    };
  }, [path.join(target, "Nested.sonobe"), copy]);
  const savedAs = await app.evaluate(() => globalThis.__sonobeTest.invokeRenderer("document.save", { saveAs: true }, { timeoutMs: 20_000 }));
  const panels = await app.evaluate(() => ({ panels: globalThis.__panels, messages: globalThis.__messages }));
  assert(savedAs?.path === copy && existsSync(path.join(copy, "project.json")), "Save As saved to the second choice", savedAs);
  assert(panels.messages.length === 1 && panels.messages[0].includes("would be inside the project") && panels.panels[1] === path.join(temp, "Projects", "Nested.sonobe"), "the panel refused the nested folder and reopened next to the project", panels);
  assert(!existsSync(path.join(target, "Nested.sonobe")), "nothing was written inside the project");
  await poll(() => Object.keys(draftsOnDisk()).length === 0, { message: "saving to remove the draft" });
  log("the Save panel refused a folder inside a project and reopened next to it");

  // Closing the window with Don't Save (the native prompt answered by a stub) removes the draft.
  const badge = await mcp.call("add_layers", { label: "added another badge", layers: [{ type: "oval", name: "Unsaved again" }] });
  assert(!badge.isError, "add_layers before closing", badge.text);
  await poll(() => Object.keys(draftsOnDisk()).length === 1, { message: "a draft of the new edit" });
  await mcp.close();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await poll(() => Object.keys(draftsOnDisk()).length === 0 && readdirSync(draftsDir).length === 0, { message: "Don't Save to remove the draft" });
  log("Don't Save removed the draft");

  await app.evaluate(() => globalThis.__sonobeTest?.destroyWindows());
  await app.close();
  app = null;
  log("PASS");
} catch (err) {
  failed = true;
  console.error(`[drafts-smoke] FAIL: ${err?.stack ?? err}`);
  try {
    await app?.evaluate(() => globalThis.__sonobeTest?.destroyWindows()).catch(() => undefined);
    await app?.close();
  } catch {
    app?.process()?.kill("SIGKILL");
  }
} finally {
  clearTimeout(watchdog);
  if (failed) console.error(`[drafts-smoke] temp files kept at ${temp}`);
  else rmSync(temp, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
}
