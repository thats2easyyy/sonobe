/**
 * The startup benchmark's side of the main process (tests/startup-bench.mjs). It is loaded before the app's own
 * entry: by a stub entry in the benchmark's copy of a packaged app, or with `electron -r` for a checkout. It
 * only listens: it notes when the main bundle is compiled and evaluated, `ready`, the first window and its
 * events, which IPC channels were registered after the turn that created that window, and what the page
 * reports (startup-bench/page.cjs). Then it writes one JSON file and quits the app.
 *
 * Every mark is wall-clock milliseconds, so the benchmark can subtract the instant it spawned the app.
 */
"use strict";

const OUT = process.env.SONOBE_BENCH_OUT;
if (!process.env.SONOBE_USER_DATA || !process.env.SONOBE_HOME || !OUT) {
  process.stderr.write("[bench] The startup hook only runs isolated, with SONOBE_USER_DATA, SONOBE_HOME and SONOBE_BENCH_OUT set. Start it with: npm run bench:startup -w @sonobe/desktop\n");
  process.exit(3);
}

const fs = require("node:fs");
const Module = require("node:module");
const { performance } = require("node:perf_hooks");

const wall = () => performance.timeOrigin + performance.now();
const marks = {};
const mark = (name) => {
  if (!(name in marks)) marks[name] = wall();
};
mark("start");

// The main bundle: from the moment Node has read it to the end of its top level.
const compile = Module.prototype._compile;
Module.prototype._compile = function (content, filename, ...rest) {
  if (!/[\\/]dist[\\/]main\.cjs$/.test(filename)) return compile.call(this, content, filename, ...rest);
  Module.prototype._compile = compile;
  mark("mainCompileStart");
  try {
    return compile.call(this, content, filename, ...rest);
  } finally {
    mark("mainEvaluated");
  }
};

const { app, ipcMain, session } = require("electron");

// A page can ask as soon as it loads, so every handler has to exist by the end of the turn that creates the
// first window. One registered later is reported, and the benchmark fails the run.
let turnOver = false;
const late = [];
const listen = ipcMain.on.bind(ipcMain);
for (const method of ["handle", "on"]) {
  const register = ipcMain[method].bind(ipcMain);
  ipcMain[method] = (channel, listener) => {
    if (turnOver && String(channel).startsWith("sonobe:")) late.push(String(channel));
    return register(channel, listener);
  };
}

const errors = [];
let finished = false;
function finish(why, page) {
  if (finished) return;
  finished = true;
  const cacheDir = typeof Module.getCompileCacheDir === "function" ? (Module.getCompileCacheDir() ?? null) : null;
  fs.writeFileSync(OUT, JSON.stringify({ why, packaged: app.isPackaged, electron: process.versions.electron, marks, late, errors, compileCache: cacheDir, page }));
  // app.exit() skips Node's own write of the compile cache at exit, and the app's comes a second after the window shows.
  try {
    Module.flushCompileCache?.();
  } catch {
    // The app may have no cache.
  }
  app.exit(0);
}

app.once("ready", () => {
  mark("ready");
  try {
    session.defaultSession.registerPreloadScript({ type: "frame", id: "sonobe-bench", filePath: process.env.SONOBE_BENCH_PAGE });
  } catch (err) {
    errors.push(`The page script wasn't registered: ${err && err.message}`);
  }
  listen("sonobe-bench:result", (_event, page) => finish("page", page));
  // Nothing may be left running, whatever the page does.
  setTimeout(() => finish("timeout", null), 45_000).unref();
});

app.on("browser-window-created", (_event, win) => {
  if ("windowCreated" in marks) return;
  mark("windowCreated");
  // Runs once the code that created the window, and everything it awaited that was already settled, is done.
  process.nextTick(() => (turnOver = true));
  const wc = win.webContents;
  win.once("ready-to-show", () => mark("readyToShow"));
  win.once("show", () => mark("shown"));
  wc.once("did-navigate", () => mark("navigated"));
  wc.once("did-fail-load", (_e, code, description) => errors.push(`The page didn't load: ${code} ${description}`));
  wc.on("render-process-gone", (_e, details) => errors.push(`The page's process exited: ${details.reason}`));
  wc.on("console-message", (event) => {
    if (event.level === "error") errors.push(String(event.message ?? "").slice(0, 300));
  });
});
