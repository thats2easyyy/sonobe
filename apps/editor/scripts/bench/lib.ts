// Shared pieces of the editor benchmark (run.ts): the page recorders, the two test documents and the
// statistics. Pages are opened with ?sonobeTest, so window.__sonobe (src/app/testHook.ts) is there.
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocumentFiles, type Op, type SonobeDocument } from "../../../../packages/core/src/index.ts";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Full Chromium in new-headless mode: the real GPU and a 60 Hz frame clock, with no window on screen. */
export async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true, channel: "chromium", args: ["--mute-audio"] });
  } catch (error) {
    if (/Executable doesn't exist|playwright install/i.test(String(error))) throw new Error("Playwright's Chromium isn't installed. Run `npx playwright install chromium`, then run this again.");
    throw error;
  }
}

/** Runs before any page script: test-friendly storage, plus the recorders the measurements read. */
function initScript({ seenWelcome }: { seenWelcome: boolean }) {
  Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
  try {
    if (seenWelcome && !sessionStorage.getItem("bench.init")) {
      sessionStorage.setItem("bench.init", "1");
      localStorage.setItem("sonobe.welcome.v1", "seen");
    }
  } catch {}
  const perf: any = { longTasks: [], events: [], marks: {}, frames: [], recording: false, rafRequests: 0 };
  (window as any).__perf = perf;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) perf.events.push({ name: e.name, start: e.startTime, duration: e.duration });
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  } catch {}
  // Animation frames the app asks for are counted: a prototype at rest should ask for none. The
  // recorders here use the browser's own function (perf.raf), so they aren't in the count.
  const raf = window.requestAnimationFrame.bind(window);
  perf.raf = raf;
  window.requestAnimationFrame = (callback) => {
    perf.rafRequests++;
    return raf(callback);
  };
  perf.startFrames = () => {
    perf.frames = [];
    perf.recording = true;
    const tick = (t: number) => {
      if (!perf.recording) return;
      perf.frames.push(t);
      raf(tick);
    };
    raf(tick);
  };
  perf.stopFrames = () => {
    perf.recording = false;
    return perf.frames;
  };
  // Boot marks, read once a frame until the editor is usable: the first prototype frames and panel contents.
  // A prototype where nothing moves stops after two or three frames, so "frame4" is also reached
  // when it has drawn and come to rest (builds from before rest have no resting()).
  const mark = (name: string) => {
    if (perf.marks[name] === undefined) perf.marks[name] = performance.now();
  };
  const selectors = { layersRow: ".sb-tree__row", patchNode: ".react-flow__node", patchShell: ".sb-pe" };
  const poll = () => {
    const hook = (window as any).__sonobe;
    if (hook) {
      try {
        if (hook.frame() > 0) mark("frame1");
        if (hook.frame() > 3 || (hook.frame() >= 0 && hook.resting?.())) mark("frame4");
      } catch {}
    }
    for (const [name, selector] of Object.entries(selectors)) if (perf.marks[name] === undefined && document.querySelector(selector)) mark(name);
    // The loading label is in the DOM from the start and hidden for its first 150 ms (workspace.css): count it once it can be seen.
    const loading = document.querySelector(".sb-app-loading");
    if (loading && getComputedStyle(loading).visibility !== "hidden") mark("loadingShown");
    if (perf.marks.frame4 !== undefined && perf.marks.patchNode !== undefined && perf.marks.layersRow !== undefined) return mark("usable");
    raf(poll);
  };
  const start = () => {
    raf(poll);
    // Exact times for the first commit and, on a first launch, the welcome dialog. It stops watching once it has them.
    const observer = new MutationObserver(() => {
      if (document.getElementById("root")?.childElementCount) mark("rootFilled");
      if (!seenWelcome && document.querySelector("[role=dialog]")) mark("dialog");
      if (perf.marks.rootFilled !== undefined && (seenWelcome || perf.marks.dialog !== undefined)) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

export interface BenchPage {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  /** Console errors and uncaught exceptions. */
  problems: string[];
}

export async function newPage(browser: Browser, { seenWelcome = true } = {}): Promise<BenchPage> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404/.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(`${e.name}: ${e.message}`));
  await page.addInitScript(initScript, { seenWelcome });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  return { context, page, cdp, problems };
}

/** Open the editor and wait until it's usable: the prototype past frame 3 or at rest, Layers rows, a patch node. */
export async function openEditor(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/?sonobeTest`);
  await page.waitForFunction(() => (window as any).__perf?.marks.usable !== undefined, undefined, { timeout: 30_000 });
}

/** Chromium's own counters (seconds of main-thread task, script, layout and style time so far). */
export async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

export interface Stats {
  n: number;
  min: number;
  median: number;
  p95: number;
  max: number;
}

export function stats(values: readonly number[]): Stats {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0, min: NaN, median: NaN, p95: NaN, max: NaN };
  const mid = v.length >> 1;
  return { n: v.length, min: v[0]!, median: v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2, p95: v[Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1)]!, max: v.at(-1)! };
}

/** Frame-to-frame times from requestAnimationFrame timestamps. */
export function frameDeltas(frames: readonly number[]): number[] {
  const deltas: number[] = [];
  for (let i = 1; i < frames.length; i++) deltas.push(frames[i]! - frames[i - 1]!);
  return deltas;
}

// ---------- Documents ----------

/** A bundled example as a document, parsed by @sonobe/core the way the editor does. */
export function loadExample(name: string): SonobeDocument {
  const dir = path.join(REPO, "examples", name);
  const files: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(p);
      else if (/^(project\.json|knobs\.json|components\/[^/]+\.json|scripts\/[^/]+\.js|assets\/assets\.json)$/.test(p)) files[p] = fs.readFileSync(path.join(dir, p), "utf8");
    }
  };
  walk("");
  return parseDocumentFiles(files);
}

/**
 * Ops for the stress document: 302 patches in 30 chains of 10 hanging off one Time patch, and 302
 * layers (a background, 30 groups of 9 children, and one static rectangle), every group moving and
 * its first child fading and turning on every frame.
 */
export function stressOps(chains = 30): Op[] {
  const ops: any[] = [];
  const colors = ["#FF375FFF", "#0A84FFFF", "#30D158FF", "#FF9F0AFF", "#BF5AF2FF", "#64D2FFFF"];
  ops.push({ op: "addLayer", layer: { id: "st_bg", type: "colorFill", name: "Stress Background", props: { color: "#101014FF" } } });
  for (let i = 0; i < chains; i++) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const children = [];
    for (let k = 0; k < 9; k++) {
      children.push(
        k === 8
          ? { id: `st_l${i}_${k}`, type: "text", name: `Label ${i}`, props: { text: `#${i}`, position: [4, 44], fontSize: 10, textColor: "#FFFFFFFF" } }
          : { id: `st_l${i}_${k}`, type: k % 2 ? "oval" : "rectangle", name: `Cell ${i}.${k}`, props: { position: [(k % 4) * 16, Math.floor(k / 4) * 20], size: [14, 18], color: colors[(i + k) % colors.length] } },
      );
    }
    ops.push({ op: "addLayer", layer: { id: `st_g${i}`, type: "group", name: `Cluster ${i}`, props: { position: [12 + col * 78, 70 + row * 130], size: [66, 60] }, children } });
  }
  // One layer no patch drives, in front of the rest: the one the canvas drag and the inspector scrub use.
  ops.push({ op: "addLayer", layer: { id: "st_drag", type: "rectangle", name: "Draggable", props: { position: [140, 8], size: [120, 44], cornerRadius: 10, color: "#FFFFFFFF" } } });
  const patch = (id: string, type: string, x: number, y: number, inputs?: Record<string, unknown>) => ops.push({ op: "addPatch", patch: { id, type, name: id, ui: { x, y }, ...(inputs ? { inputs } : {}) } });
  const X0 = 40;
  patch("st_time", "time", X0, 0);
  patch("st_speed", "multiply", X0 + 260, 0, { value2: 90 });
  ops.push({ op: "connect", from: "st_time.time", to: "st_speed.value1" });
  for (let i = 0; i < chains; i++) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    // Chains sit three across so Zoom to Fit shows the whole graph above the minimum zoom.
    const y = 240 + Math.floor(i / 3) * 330;
    const x = (k: number) => X0 + (i % 3) * 1760 + k * 270;
    const p = (k: number) => `st_c${i}_${k}`;
    patch(p(0), "add", x(0), y, { value2: i * 12 });
    patch(p(1), "sine", x(1), y);
    patch(p(2), "multiply", x(2), y, { value2: 10 });
    patch(p(3), "add", x(3), y, { value2: 12 + col * 78 });
    patch(p(4), "cosine", x(1), y + 130);
    patch(p(5), "multiply", x(2), y + 130, { value2: 8 });
    patch(p(6), "add", x(3), y + 130, { value2: 70 + row * 130 });
    patch(p(7), "point", x(4), y);
    patch(p(8), "remap", x(5), y, { fromStart: -1, fromEnd: 1, toStart: 0.35, toEnd: 1 });
    patch(p(9), "multiply", x(5), y + 170, { value2: 30 });
    const c = (from: string, to: string) => ops.push({ op: "connect", from, to });
    c("st_speed.output", `${p(0)}.value1`);
    c(`${p(0)}.output`, `${p(1)}.angle`);
    c(`${p(1)}.output`, `${p(2)}.value1`);
    c(`${p(2)}.output`, `${p(3)}.value1`);
    c(`${p(0)}.output`, `${p(4)}.angle`);
    c(`${p(4)}.output`, `${p(5)}.value1`);
    c(`${p(5)}.output`, `${p(6)}.value1`);
    c(`${p(3)}.output`, `${p(7)}.x`);
    c(`${p(6)}.output`, `${p(7)}.y`);
    c(`${p(7)}.output`, `@st_g${i}.position`);
    c(`${p(1)}.output`, `${p(8)}.value`);
    c(`${p(8)}.output`, `@st_l${i}_0.opacity`);
    c(`${p(1)}.output`, `${p(9)}.value1`);
    c(`${p(9)}.output`, `@st_l${i}_0.rotation`);
  }
  return ops;
}

/** Replace the open document through the session, as examples and lessons do. */
export async function replaceDocument(page: Page, doc: SonobeDocument): Promise<void> {
  await page.evaluate((d) => {
    const s = (window as any).__sonobe.session;
    s.document.getState().replaceDocument(d, { projectPath: null, saved: true, label: "Benchmark document" });
    s.selection.getState().setComponentPath([d.project.root]);
  }, doc as any);
}

/** Clear the demo and build the stress document through the test hook (applyOps). */
export async function buildStress(page: Page): Promise<{ ok: boolean; errors: unknown }> {
  return page.evaluate((ops) => {
    const s = (window as any).__sonobe;
    const main = s.doc().components[s.doc().project.root];
    const clear = [...Object.keys(main.patches).map((id) => ({ op: "removePatch", id })), ...main.comments.map((c: any) => ({ op: "removeComment", id: c.id })), ...main.layers.map((l: any) => ({ op: "removeLayer", id: l.id }))];
    s.apply(clear, "Clear demo");
    const built = s.apply(ops, "Stress document");
    return { ok: built.ok, errors: built.errors?.slice(0, 5) };
  }, stressOps() as any);
}

// ---------- Profiles and traces ----------

/** Record a CPU profile (200 µs sampling) while `fn` runs. Open the file in DevTools' Performance panel. */
export async function withProfile<T>(cdp: CDPSession, file: string, fn: () => Promise<T>): Promise<T> {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  try {
    return await fn();
  } finally {
    const { profile } = await cdp.send("Profiler.stop");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(profile));
  }
}

/**
 * Main-thread self time per timeline event while `fn` runs, in ms per second: what a CPU profile
 * lumps into "(program)" (style, layout, paint, layerize, hit testing).
 */
export async function traceBreakdown(browser: Browser, page: Page, fn: () => Promise<unknown>, top = 8): Promise<{ name: string; msPerSec: number }[]> {
  await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing"] });
  await page.evaluate(() => performance.mark("bench-trace-start"));
  let buffer: Buffer;
  try {
    await fn();
  } finally {
    await page.evaluate(() => performance.mark("bench-trace-end")).catch(() => {});
    buffer = await browser.stopTracing();
  }
  const parsed = JSON.parse(buffer.toString());
  const events: any[] = parsed.traceEvents ?? parsed;
  const start = events.find((e) => e.name === "bench-trace-start");
  const end = events.find((e) => e.name === "bench-trace-end");
  if (!start || !end) return [];
  const main = events.filter((e) => e.ph === "X" && e.pid === start.pid && e.tid === start.tid && e.ts >= start.ts && e.ts <= end.ts && typeof e.dur === "number").sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = new Map<string, number>();
  const stack: any[] = [];
  const close = (e: any) => self.set(e.name, (self.get(e.name) ?? 0) + Math.max(0, e.self));
  for (const e of main) {
    e.self = Math.min(e.dur, end.ts - e.ts);
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) close(stack.pop());
    if (stack.length) stack.at(-1).self -= e.self;
    stack.push(e);
  }
  while (stack.length) close(stack.pop());
  const seconds = (end.ts - start.ts) / 1e6;
  return [...self]
    .map(([name, us]) => ({ name, msPerSec: Math.round(us / 1000 / seconds) }))
    .sort((a, b) => b.msPerSec - a.msPerSec)
    .slice(0, top);
}
