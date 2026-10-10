#!/usr/bin/env node
/**
 * Drafts in the Electron app (muted): unsaved work survives the app being killed.
 *
 * 1. A blank prototype from the welcome screen, a layer added over MCP, then SIGTERM (what ending a
 *    Claude Code background task sends): the app keeps the draft and exits with code 0 at once, with
 *    no unsaved-changes prompt left waiting.
 * 2. Relaunch: the welcome screen's Recovered section lists it (screenshots/drafts-recovered.png),
 *    list_documents offers draft:<id>, open_document on the draft's folder refuses (draft_folder),
 *    open_document brings it back, and more edits keep going to the same draft. Then SIGKILL, which
 *    nothing can catch.
 * 3. Relaunch: opening the draft's folder like a project (Show in Finder, then a double-click) brings
 *    it back as the draft, kept out of Recents, with both edits. save_document without a path refuses to name an
 *    Untitled folder (path_needed), with a path it saves there with no dialog, the draft goes away,
 *    and a path inside that project is refused (inside_project).
 * 4. An unsaved change to that project, then the editor's renderer crashes: a call it was working on
 *    fails at once (page_gone), the window reloads, an MCP call right after waits for the reloaded
 *    editor, and the draft comes back over its project. Save As through the (stubbed) Save panel
 *    refuses a folder inside the project and reopens next to it. Closing the window with Don't Save
 *    removes a draft.
 * 5. Restart to Update, with a stand-in updater (the test hook's fake driver; nothing is downloaded or
 *    installed): with an unsaved change, Cancel in the prompt keeps the app and the window, and the
 *    update stays ready. Keep Draft closes the window, writes down what was open and asks the updater
 *    to install. The next launch opens the project again with the unsaved change and no welcome screen,
 *    and an MCP call that arrives first waits for it instead of landing on the launch document.
 * 6. Quit with that unsaved change: Cancel in the prompt keeps the app and its window. Quit again and
 *    Don't Save: the app itself ends, not only its window (a quit that stopped to ask carries on once
 *    it's answered, which is what lets a downloaded update go in "the next time you quit").
 * 7. The app launched with the project's path: the editor is told before it renders and starts on the
 *    project, never on the demo. The renderer crashes with an unsaved change: the page that loads again
 *    is told nothing, starts as usual and offers the draft. With every window closed and the app still
 *    running, opening the project starts the new window on it too, with no welcome screen although a
 *    draft is waiting.
 * 8. SIGTERM during launch (a logout, or `kill`, in the app's first second), at sixteen moments from before
 *    `ready` to after the first window, launched with two prototypes: every launch ends on its own, without
 *    a crash, and leaves no mcp.json for the next `sonobe mcp` to trust.
 *
 * SONOBE_SMOKE_VERBOSE=1 shows the app's own log.
 *
 * Every path is in a temp folder; nothing is written to ~/Documents.
 *
 *   npm run build -w @sonobe/editor && node apps/desktop/scripts/build.mjs && node apps/desktop/tests/drafts-smoke.mjs
 */

import { _electron as electron } from "playwright";
import electronPath from "electron";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
// Updates are off twice over (a checkout never checks): part 5 drives the restart with the test hook's stand-in updater.
const env = { ...process.env, SONOBE_MUTE: "1", SONOBE_HOME: home, SONOBE_USER_DATA: userData, SONOBE_TEST: "1", SONOBE_UPDATES: "off" };
for (const key of ["SONOBE_DEV_URL", "SONOBE_MCP_PORT", "SONOBE_LAN", "SONOBE_LAN_PORT", "SONOBE_EDITOR_DIST", "SONOBE_UPDATE_FEED", "ELECTRON_RUN_AS_NODE"]) delete env[key];

let app = null;
let failed = false;
const watchdog = setTimeout(() => {
  console.error("[drafts-smoke] watchdog: exceeded 300 s");
  app?.process()?.kill("SIGKILL");
  process.exit(1);
}, 300_000);

const launch = async (args = []) => {
  rmSync(tokenFile, { force: true });
  const next = await electron.launch({ executablePath: electronPath, args: ["--mute-audio", appDir, ...args], cwd: appDir, env, timeout: 30_000 });
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
  const draftFolder = path.join(draftsDir, `${draftId}.sonobe`);
  const byPath = await mcp.call("open_document", { ref: draftFolder });
  assert(byPath.isError && byPath.text.includes("draft_folder") && byPath.text.includes(`draft:${draftId}`), "open_document on a draft's folder refuses and names draft:<id>", byPath.text);
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
  // Show in Finder on the Recovered row, then a double-click on the folder: it comes back as the draft, not as a project saved inside Drafts.
  await app.evaluate((_electron, dir) => globalThis.__sonobeTest.openProject(dir), draftFolder);
  const reopened = await poll(async () => {
    const r = await mcp.call("get_document_info");
    return r.structuredContent?.draft?.id === draftId ? r : null;
  }, { message: "the draft's folder to come back as the draft" });
  assert(!reopened.text.includes(draftsDir), "the draft's folder isn't the document's project", reopened.text);
  const recentsFile = path.join(userData, "recent-projects.json");
  assert(!existsSync(recentsFile) || !readFileSync(recentsFile, "utf8").includes(draftsDir), "the draft's folder stays out of Recents", existsSync(recentsFile) ? readFileSync(recentsFile, "utf8") : null);
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

  // ---------------------------------------------------------------------------------------------
  // 5. Restart to Update with unsaved changes: Cancel keeps everything, Keep Draft comes back
  // ---------------------------------------------------------------------------------------------

  ({ app, page } = await launch());
  mcp = await connectMcp();
  const openTarget = async () => {
    await app.evaluate((_electron, dir) => globalThis.__sonobeTest.openProject(dir), target);
    await poll(async () => (await mcp.call("get_document_info")).text.includes(`Path: ${target}`), { message: "the saved project to open" });
  };
  await openTarget();
  const off = await app.evaluate(() => ({ status: globalThis.__sonobeTest.updates.status(), item: globalThis.__sonobeTest.updates.menuItem(), loaded: globalThis.__sonobeTest.updates.driverLoaded() }));
  assert(off.status.mode === "off" && off.status.state === "idle" && off.item === null && off.loaded === false, "a checkout never checks for updates and has no update item in its menu", off);

  await app.evaluate(() => globalThis.__sonobeTest.updates.useFakeDriver({ version: "9.9.9" }));
  await app.evaluate(() => globalThis.__sonobeTest.updates.check());
  const ready = await poll(() => app.evaluate(() => (globalThis.__sonobeTest.updates.status().state === "ready" ? { status: globalThis.__sonobeTest.updates.status(), item: globalThis.__sonobeTest.updates.menuItem() } : null)), { message: "the stand-in update to be ready" });
  assert(ready.status.version === "9.9.9" && ready.status.mode === "install" && ready.item === "restart", "the update is ready and the menu reads Restart to Update", ready);
  const restartEdit = await mcp.call("add_layers", { label: "added a ribbon", layers: [{ type: "rectangle", name: "Unsaved before the update" }] });
  assert(!restartEdit.isError, "add_layers before the restart", restartEdit.text);
  const restartDraft = await poll(() => Object.entries(draftsOnDisk()).find(([, d]) => d.projectPath === target)?.[0], { message: "a draft of the unsaved change" });

  // The native dialogs, answered by a stub that records them: the confirmation about connected Claude sessions, then the prompt.
  const answerPrompts = (choice) =>
    app.evaluate(({ dialog }, pick) => {
      globalThis.__asked = [];
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1);
        globalThis.__asked.push({ message: options.message, detail: options.detail, buttons: options.buttons });
        const wanted = options.message.startsWith("Restart Sonobe") ? "Restart" : pick;
        return { response: Math.max(0, options.buttons.indexOf(wanted)), checkboxChecked: false };
      };
    }, choice);
  const recordFile = path.join(userData, "reopen-after-update.json");

  await answerPrompts("Cancel");
  const cancelled = await app.evaluate(() => globalThis.__sonobeTest.updates.restart());
  const afterCancel = await app.evaluate(({ BrowserWindow }) => ({ windows: BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length, status: globalThis.__sonobeTest.updates.status(), installs: globalThis.__sonobeTest.updates.installs(), asked: globalThis.__asked }));
  const unsavedPrompt = afterCancel.asked.find((q) => q.message.startsWith("Do you want to save"));
  assert(cancelled === false && afterCancel.windows === 1 && afterCancel.installs === 0 && !existsSync(recordFile), "Cancel keeps the app and its window, installs nothing and writes no record", afterCancel);
  assert(afterCancel.status.state === "ready" && afterCancel.status.restarting === false, "the update stays ready after a cancelled restart", afterCancel.status);
  assert(unsavedPrompt?.buttons.join() === "Save,Keep Draft,Cancel" && unsavedPrompt.detail.includes("opens it again after the update"), "the restart's prompt offers Save, Keep Draft or Cancel", afterCancel.asked);
  assert(afterCancel.asked[0].message === "Restart Sonobe to update to 9.9.9?" && afterCancel.asked[0].detail.includes("is connected"), "the restart says a Claude session is connected before it asks anything else", afterCancel.asked);
  assert(draftsOnDisk()[restartDraft], "the draft is still there after Cancel");
  log("Restart to Update, then Cancel: the app, the window and the ready update all stayed");

  await answerPrompts("Keep Draft");
  await mcp.close();
  void app.evaluate(() => void globalThis.__sonobeTest.updates.restart()).catch(() => undefined);
  await poll(() => app.evaluate(({ BrowserWindow }) => globalThis.__sonobeTest.updates.installs() === 1 && BrowserWindow.getAllWindows().length === 0), { message: "the window to close and the updater to be asked to install" });
  const record = JSON.parse(readFileSync(recordFile, "utf8"));
  assert(record.version === 1 && record.windows.length === 1 && record.windows[0].project === target && record.windows[0].draft === restartDraft, "the record names the project and the kept draft", record);
  assert(draftsOnDisk()[restartDraft]?.projectPath === target, "Keep Draft left the draft on disk", draftsOnDisk());
  // A real updater quits the app here. The stand-in doesn't, so the smoke does.
  await kill("SIGKILL", 5000);
  log("Restart to Update, then Keep Draft: the window closed, the record was written, and the updater was asked to install");

  rmSync(tokenFile, { force: true });
  app = await electron.launch({ executablePath: electronPath, args: ["--mute-audio", appDir], cwd: appDir, env, timeout: 30_000 });
  app.process().stderr?.on("data", (d) => process.stderr.write(`[app] ${d}`));
  // A relay that outlived the restart calls as soon as the endpoint answers, before the window exists.
  mcp = await connectMcp();
  const firstCall = await mcp.call("get_document_info");
  assert(firstCall.text.includes(`Path: ${target}`) && firstCall.structuredContent.draft?.id === restartDraft, "an MCP call that arrives first waits for the reopened work", firstCall.text);
  const backAfterUpdate = await mcp.call("get_outline", { detail: "compact" });
  assert(backAfterUpdate.text.includes("Unsaved before the update"), "the unsaved change is back after the restart", backAfterUpdate.text);
  assert(firstCall.text.includes("unsaved changes"), "the reopened document is still unsaved", firstCall.text);
  assert(!existsSync(recordFile), "the record is used once");
  page = await app.firstWindow();
  const told = await page.evaluate(async () => ({ launching: window.sonobeHost.launching, info: await window.sonobeHost.launch() }));
  assert(told.launching === true && told.info?.reopening === true && told.info.open?.kind === "draft" && told.info.open.id === restartDraft && told.info.open.project === target, "the editor is told what this launch reopens before it renders (sonobeHost.launch())", told);
  // The work is on screen with no welcome screen over it. (That the editor never shows one in this window, not even for a moment, is welcomeStore's unit test.)
  await page.locator(".sb-shell").waitFor({ timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 1500));
  assert((await page.getByRole("dialog", { name: "Welcome to Sonobe" }).count()) === 0, "no welcome screen is over the reopened work");
  await mcp.close();
  log("the next launch opened the project again with its unsaved change, and the first MCP call waited for it");

  // ---------------------------------------------------------------------------------------------
  // 6. Quit with unsaved changes: Cancel keeps the app, Don't Save ends it (not only its window)
  // ---------------------------------------------------------------------------------------------

  const quit = () => void app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  const visibleWindows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length);
  await answerPrompts("Cancel");
  quit();
  const quitPrompt = await poll(() => app.evaluate(() => globalThis.__asked[0] ?? null), { message: "the unsaved-changes prompt of a quit" });
  assert(quitPrompt.buttons.join() === "Save,Don't Save,Cancel" && quitPrompt.detail === "Your changes will be lost if you don't save them.", "quitting with an unsaved change asks Save, Don't Save or Cancel", quitPrompt);
  await new Promise((r) => setTimeout(r, 500));
  assert((await visibleWindows()) === 1 && draftsOnDisk()[restartDraft], "Cancel keeps the app, its window and the draft");

  await answerPrompts("Don't Save");
  const quitting = app.process();
  const ended = new Promise((resolve) => quitting.once("exit", (code, signal) => resolve({ code, signal })));
  quit();
  const quitOutcome = await Promise.race([ended, new Promise((resolve) => setTimeout(() => resolve(null), 10_000))]);
  assert(quitOutcome?.code === 0, "after Don't Save the quit carries on: the app ends, not only its window", quitOutcome ?? "still running 10 s after the prompt was answered");
  assert(Object.keys(draftsOnDisk()).length === 0, "Don't Save removed the draft on the way out", draftsOnDisk());
  await app.close().catch(() => undefined);
  app = null;
  log("Quit with an unsaved change: Cancel kept the app, and Don't Save ended it");

  // ---------------------------------------------------------------------------------------------
  // 7. A window opened for a project starts on it: at launch, and in a running app with no window
  // ---------------------------------------------------------------------------------------------

  // Every title a window's editor sets is its document's name: the demo's would show here if it were ever built.
  const recordTitles = () =>
    app.evaluate(({ ipcMain }) => {
      if (!globalThis.__titles) ipcMain.on("sonobe:window:set-title", (_event, title) => globalThis.__titles.push(String(title)));
      globalThis.__titles = [];
    });
  const inPage = (script) => app.evaluate(({ BrowserWindow }, code) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(code, true), script);
  const toldAtLaunch = "(async () => ({ launching: window.sonobeHost.launching, info: await window.sonobeHost.launch() }))()";
  const documentInfo = () => app.evaluate(() => globalThis.__sonobeTest.invokeRenderer("document.info"));

  ({ app, page } = await launch([target]));
  await recordTitles();
  const atLaunch = await inPage(toldAtLaunch);
  assert(atLaunch.launching === true && atLaunch.info?.reopening === false && atLaunch.info.open?.kind === "project" && atLaunch.info.open.path === target && atLaunch.info.problems.length === 0, "the editor is told which project it was launched with (sonobeHost.launch())", atLaunch);
  const launched = await documentInfo();
  assert(launched.projectPath === target && launched.name === "Placemark Deck" && launched.dirty === false, "the launch document is the project", launched);

  mcp = await connectMcp();
  const launchEdit = await mcp.call("add_layers", { label: "added a pin", layers: [{ type: "oval", name: "Unsaved after launch" }] });
  assert(!launchEdit.isError, "add_layers on the launch document", launchEdit.text);
  const launchDraft = await poll(() => Object.entries(draftsOnDisk()).find(([, d]) => d.projectPath === target)?.[0], { message: "a draft of the unsaved change" });
  await mcp.close();
  // The page that loads after a crash asks again and is told nothing: it starts as any launch does, and offers the draft.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  await poll(async () => (await app.evaluate(() => globalThis.__sonobeTest.hasRendererMethod("document.apply"))) === true && (await documentInfo().catch(() => null))?.projectPath === null, { timeout: 20_000, message: "the reloaded editor" });
  const afterReload = await inPage(toldAtLaunch);
  assert(afterReload.launching === true && afterReload.info === null, "a page that loads again is told nothing to start on", afterReload);
  const reloadedInfo = await documentInfo();
  assert(reloadedInfo.name === "Photo Zoom" && reloadedInfo.draft === null, "the reloaded editor starts as a plain launch does", reloadedInfo);
  const offered = await poll(() => inPage("document.querySelector('.sb-welcome[role=dialog] .sb-welcome__draft')?.textContent ?? null"), { message: "the Recovered offer after the crash" });
  assert(offered.includes("Placemark Deck"), "the welcome screen offers the draft the crash left", offered);
  log("launched with a project: the editor started on it, and after a crash the reloaded page started as usual and offered the draft");

  // Every window closed and the app still running (macOS): Finder or Open Recent opens the project in a new window.
  await app.evaluate(() => globalThis.__sonobeTest.destroyWindows());
  await poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 0), { message: "the window to go" });
  await recordTitles();
  await app.evaluate((_electron, dir) => globalThis.__sonobeTest.openProject(dir), target);
  await poll(() => app.evaluate(() => globalThis.__sonobeTest.hasRendererMethod("document.apply") === true), { timeout: 20_000, message: "the new window's editor" });
  const reopenedInfo = await documentInfo();
  assert(reopenedInfo.projectPath === target && reopenedInfo.dirty === false, "the new window shows the project", reopenedInfo);
  const titles = await app.evaluate(() => globalThis.__titles);
  assert(titles.length > 0 && titles.at(-1).startsWith("Placemark Deck") && !titles.some((title) => title.includes("Photo Zoom")), "the new window's editor never built the demo", titles);
  const toldNewWindow = await inPage(toldAtLaunch);
  assert(toldNewWindow.launching === true && toldNewWindow.info?.open?.path === target, "the new window's editor was told what it was opened for", toldNewWindow);
  await new Promise((r) => setTimeout(r, 1500));
  assert(draftsOnDisk()[launchDraft] && (await inPage("document.querySelector('.sb-welcome') === null")), "no welcome screen is over the project, although a draft is waiting");
  log("with no window open, opening the project started the new window on it");
  await app.evaluate(() => globalThis.__sonobeTest.destroyWindows());
  await app.close();
  app = null;

  // ---------------------------------------------------------------------------------------------
  // 8. SIGTERM during launch
  // ---------------------------------------------------------------------------------------------
  // Spawned directly: Playwright would wait for a window that a launch cut short never opens.
  const other = path.join(temp, "Projects", "Like Toggle.sonobe");
  cpSync(path.join(repoDir, "examples", "02-like-toggle"), other, { recursive: true });
  const quitHome = path.join(temp, "quit-home");
  const quitToken = path.join(quitHome, "mcp.json");
  /** One launch with both prototypes, SIGTERM `afterMs` after the spawn (never, when null): how it ended, and when mcp.json appeared. */
  const launchAndQuit = (afterMs) =>
    new Promise((resolve) => {
      rmSync(quitHome, { recursive: true, force: true });
      rmSync(path.join(temp, "quit-data"), { recursive: true, force: true });
      const spawned = Date.now();
      const child = spawn(electronPath, ["--mute-audio", appDir, target, other], { cwd: appDir, env: { ...env, SONOBE_HOME: quitHome, SONOBE_USER_DATA: path.join(temp, "quit-data") }, stdio: "ignore" });
      let endpointAt = null;
      const watch = setInterval(() => {
        if (endpointAt === null && existsSync(quitToken)) endpointAt = Date.now() - spawned;
        // The launch that is only timed: it ends once the endpoint is up.
        if (afterMs === null && endpointAt !== null) child.kill("SIGTERM");
      }, 5);
      const term = afterMs === null ? null : setTimeout(() => child.kill("SIGTERM"), afterMs);
      const giveUp = setTimeout(() => child.kill("SIGKILL"), afterMs === null ? 30_000 : afterMs + 6000);
      child.once("exit", (code, signal) => {
        clearInterval(watch);
        clearTimeout(term ?? undefined);
        clearTimeout(giveUp);
        resolve({ code, signal, endpointAt, ms: Date.now() - spawned });
      });
    });
  // The endpoint comes up between `ready` and the first window, so its time says where in the launch to aim.
  const timed = await launchAndQuit(null);
  assert(timed.endpointAt !== null, "a launch that isn't interrupted brings the MCP endpoint up", timed);
  const endings = [];
  for (let i = 0; i < 16; i++) {
    const afterMs = Math.max(50, Math.round(timed.endpointAt - 200 + i * 30));
    const outcome = await launchAndQuit(afterMs);
    // Before Chromium has its handler the signal's default ends the process, which is a quit too.
    const quit = (outcome.code === 0 && outcome.signal === null) || outcome.signal === "SIGTERM";
    assert(quit, `SIGTERM ${afterMs} ms into launch ends the app on its own, without a crash or a hang`, outcome);
    await new Promise((r) => setTimeout(r, 150));
    assert(!existsSync(quitToken), `SIGTERM ${afterMs} ms into launch leaves no mcp.json behind`, outcome);
    endings.push(outcome.signal === "SIGTERM" ? "early" : "quit");
  }
  log(`SIGTERM during launch, 16 moments around the endpoint coming up at ${timed.endpointAt} ms: ${endings.filter((how) => how === "quit").length} quit, ${endings.filter((how) => how === "early").length} ended before any handler; none hung, crashed or left mcp.json`);
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
