// The interaction suite: the same gestures on a bundled example and on the stress document, each
// recorded as frame times, long tasks and main-thread time. The prototype is playing throughout.
import type { Browser, CDPSession, Page } from "@playwright/test";
import path from "node:path";
import { buildStress, frameDeltas, loadExample, metrics, newPage, openEditor, replaceDocument, sleep, traceBreakdown, withProfile } from "./lib.ts";

export type DocumentName = "example" | "stress";

/** One recorded run of one interaction. */
export interface Run {
  /** Frame-to-frame times in ms. */
  deltas: number[];
  wallMs: number;
  /** Main-thread time while it ran, in ms: all tasks, and the script, layout and style parts. */
  taskMs: number;
  scriptMs: number;
  layoutMs: number;
  styleMs: number;
  /** Tasks of 50 ms or more. */
  longTasks: number;
  /** Animation frames the app asked for, and frames the prototype stepped, per second. Near 0 for a prototype at rest. */
  rafPerSec: number;
  stepsPerSec: number;
  /** Timeline self time per event in ms per second, with --trace. */
  trace?: { name: string; msPerSec: number }[];
}

export interface ScenarioOptions {
  /** Recorded runs of each interaction. */
  reps: number;
  /** Run one unrecorded pass of each gesture first (a fresh page per build has cold code). */
  warm: boolean;
  /** Only interactions whose name contains one of these. */
  filter: readonly string[];
  /** Chromium's CPU throttle: 4 stands in for a machine about four times slower. */
  throttle: number;
  /** Write one CPU profile per interaction into this folder. */
  profileDir: string | null;
  /** Prefix for profile files (which build this is). */
  label: string;
  trace: boolean;
}

/** Wait `n` animation frames, with the browser's own function so the app's count (lib.ts) leaves them out. */
const frames = (page: Page, n: number) =>
  page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const raf = (window as any).__perf.raf as typeof requestAnimationFrame;
        const step = () => (--n <= 0 ? resolve() : raf(step));
        raf(step);
      }),
    n,
  );

/** Run `fn` while recording frame times, long tasks and main-thread time. */
async function record(page: Page, cdp: CDPSession, fn: () => Promise<void>): Promise<Run> {
  await frames(page, 3);
  const before = await metrics(cdp);
  const { t0, raf0, step0 } = await page.evaluate(() => {
    (window as any).__perf.startFrames();
    return { t0: performance.now(), raf0: (window as any).__perf.rafRequests as number, step0: (window as any).__sonobe.frame() as number };
  });
  await frames(page, 2);
  await fn();
  await frames(page, 3);
  const { stamps, t1, raf1, step1 } = await page.evaluate(() => ({
    stamps: (window as any).__perf.stopFrames() as number[],
    t1: performance.now(),
    raf1: (window as any).__perf.rafRequests as number,
    step1: (window as any).__sonobe.frame() as number,
  }));
  const after = await metrics(cdp);
  await sleep(120); // long tasks are reported a little late
  const longTasks = await page.evaluate(({ t0, t1 }) => (window as any).__perf.longTasks.filter((l: { start: number; duration: number }) => l.start + l.duration >= t0 && l.start <= t1).length, { t0, t1 });
  const ms = (key: string) => (after[key]! - before[key]!) * 1000;
  const perSecond = (n: number) => (1000 * n) / (t1 - t0);
  return {
    deltas: frameDeltas(stamps),
    wallMs: t1 - t0,
    taskMs: ms("TaskDuration"),
    scriptMs: ms("ScriptDuration"),
    layoutMs: ms("LayoutDuration"),
    styleMs: ms("RecalcStyleDuration"),
    longTasks,
    rafPerSec: perSecond(raf1 - raf0),
    stepsPerSec: perSecond(step1 - step0),
  };
}

// ---------- The patch editor's view ----------

async function paneBox(page: Page) {
  const box = await page.locator(".sb-pe .react-flow__pane").boundingBox();
  if (!box) throw new Error("The patch editor isn't on screen. The benchmark needs the default split layout.");
  return box;
}

async function patchZoom(page: Page): Promise<number> {
  const label = await page.locator('[aria-label^="Patches zoom"]').first().getAttribute("aria-label");
  return Number(/(\d+)%/.exec(label ?? "")?.[1] ?? NaN) / 100;
}

/** Zoom the patch editor about the pane's center with Control+wheel until it reaches `target`. */
async function zoomPatchesTo(page: Page, target: number): Promise<void> {
  const box = await paneBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  for (let i = 0; i < 200; i++) {
    const zoom = await patchZoom(page);
    if (Math.abs(zoom - target) < 0.04) break;
    await page.mouse.wheel(0, zoom < target ? -12 : 12);
    await sleep(20);
  }
  await page.keyboard.up("Control");
  await sleep(400);
}

async function fitPatches(page: Page): Promise<void> {
  await page.locator('[aria-label="Zoom to fit"]').first().click();
  await sleep(900);
}

// ---------- Gestures ----------
// Each one finds its target first and returns the gesture, so the lookup stays out of the recording.

type Gesture = () => Promise<void>;

/** Drag the patch nearest the pane's center by `dx` in 60 steps. */
async function dragPatch(page: Page, dx: number): Promise<Gesture> {
  const node = await page.evaluate((dx) => {
    const pane = document.querySelector(".sb-pe .react-flow__pane")!.getBoundingClientRect();
    const cx = pane.x + pane.width / 2 - dx / 2;
    const cy = pane.y + pane.height / 2;
    let best: { d: number; x: number; y: number } | null = null;
    for (const node of document.querySelectorAll(".sb-pe .react-flow__node")) {
      const r = (node.querySelector(".sb-pe-node__header") ?? node).getBoundingClientRect();
      const x = r.x + Math.min(r.width / 2, 30);
      const y = r.y + r.height / 2;
      if (x < pane.x + 20 || x + dx > pane.right - 20 || x + dx < pane.x + 20 || y < pane.y + 20 || y > pane.bottom - 20) continue;
      if (document.elementFromPoint(x, y)?.closest(".react-flow__node") !== node) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (!best || d < best.d) best = { d, x, y };
    }
    return best;
  }, dx);
  if (!node) throw new Error("No patch has room to be dragged in the patch editor.");
  return async () => {
    await page.mouse.move(node.x, node.y);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) await page.mouse.move(node.x + (dx * i) / 60, node.y + (i % 2));
    await page.mouse.up();
  };
}

/** Drag a cable out of an output port in 60 steps, let go over empty canvas, and close the search that opens. */
async function dragCable(page: Page): Promise<Gesture> {
  const path = await page.evaluate(() => {
    const pane = document.querySelector(".sb-pe .react-flow__pane")!.getBoundingClientRect();
    // Stay clear of the pane's edges, where a cable drag pans the view.
    const inside = (x: number, y: number) => x > pane.x + 80 && x < pane.right - 80 && y > pane.y + 80 && y < pane.bottom - 80;
    const cx = pane.x + pane.width / 2;
    const cy = pane.y + pane.height / 2;
    let from: { x: number; y: number; d: number } | null = null;
    for (const handle of document.querySelectorAll(".sb-pe .sb-pe-handle--out")) {
      const r = handle.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (inside(x, y) && (!from || d < from.d) && document.elementFromPoint(x, y)?.closest(".sb-pe-handle--out") === handle) from = { x, y, d };
    }
    // Somewhere empty to let go, as far from the port as the pane allows.
    let to: { x: number; y: number; d: number } | null = null;
    for (let x = pane.x + 90; from && x < pane.right - 90; x += 30) {
      for (let y = pane.y + 90; y < pane.bottom - 90; y += 30) {
        const d = Math.hypot(x - from.x, y - from.y);
        if ((!to || d > to.d) && document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) to = { x, y, d };
      }
    }
    return from && to ? { from, to } : null;
  });
  if (!path) throw new Error("No output port with empty canvas to drag its cable to is on screen.");
  const { from, to } = path;
  return async () => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 60, from.y + ((to.y - from.y) * i) / 60);
    await page.mouse.up();
    await page.keyboard.press("Escape");
  };
}

/** Pan with 60 wheel events, then zoom in and out with 40. */
async function panAndZoom(page: Page): Promise<Gesture> {
  const box = await paneBox(page);
  return async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(14, 10);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(-14, -10);
    await page.keyboard.down("Control");
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -6);
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 6);
    await page.keyboard.up("Control");
  };
}

/** Drag the layer at an artboard point in 60 steps. `undo` puts the last drag back first, so every run moves the same layer from the same place. */
async function dragLayer(page: Page, at: readonly [number, number], undo: boolean): Promise<Gesture> {
  const p = await page.evaluate(
    ({ at, undo }) => {
      const s = (window as any).__sonobe;
      if (undo) s.session.document.getState().undo();
      const r = document.querySelector(".sb-cv__artboard")!.getBoundingClientRect();
      const size = s.doc().components[s.doc().project.root].size;
      return { x: r.x + (at[0] / size[0]) * r.width, y: r.y + (at[1] / size[1]) * r.height };
    },
    { at, undo },
  );
  return async () => {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) await page.mouse.move(p.x + 2 * i, p.y + i);
    await page.mouse.up();
  };
}

/** Scrub the Inspector's Position X by its label in 60 steps. */
async function scrub(page: Page, direction: number): Promise<Gesture> {
  const field = await page.evaluate(() => {
    for (const field of document.querySelectorAll(".sb-insp .sb-scrub")) {
      const input = field.querySelector<HTMLInputElement>(".sb-scrub__input");
      if (!input || input.disabled || input.readOnly || field.querySelector(".sb-scrub__link") || input.getAttribute("aria-label") !== "Position X") continue;
      const r = (field.querySelector(".sb-scrub__label") ?? field).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    return null;
  });
  if (!field) throw new Error("The Inspector has no Position X to scrub. Is a layer that no patch drives selected?");
  return async () => {
    await page.mouse.move(field.x, field.y);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) await page.mouse.move(field.x + direction * i * 2, field.y);
    await page.mouse.up();
  };
}

/** Click 20 Layers rows one after another. */
async function selectLayers(page: Page): Promise<Gesture> {
  const rows = await page.evaluate(() => {
    const tree = document.querySelector(".sb-layerspanel")!.getBoundingClientRect();
    return [...document.querySelectorAll(".sb-layerspanel .sb-tree__row")]
      .map((row) => row.getBoundingClientRect())
      .filter((r) => r.y > tree.y + 60 && r.bottom < tree.bottom - 8)
      .map((r) => ({ x: r.x + Math.min(120, r.width / 2), y: r.y + r.height / 2 }));
  });
  if (rows.length < 3) throw new Error("The Layers panel has too few rows to click through.");
  return async () => {
    for (let i = 0; i < 20; i++) await page.mouse.click(rows[(i * 7) % rows.length]!.x, rows[(i * 7) % rows.length]!.y);
  };
}

/** Open the patch picker and type "transition", 40 ms a key. */
async function typeInPicker(page: Page): Promise<Gesture> {
  return async () => {
    await page.locator('[aria-label="Insert patch"]').first().click();
    await page.locator(".sb-pe-picker input").first().waitFor({ state: "visible", timeout: 5000 });
    await frames(page, 2);
    for (const key of "transition") {
      await page.keyboard.type(key);
      await sleep(40);
    }
    await page.keyboard.press("Escape");
    await page.locator(".sb-pe-picker").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  };
}

const idle: () => Promise<Gesture> = async () => () => sleep(3000);

/** Three seconds paused: the floor an idle prototype is compared with. */
const pausedIdle = (page: Page) => async () => async () => {
  await page.evaluate(() => (window as any).__sonobe.session.runtime.pause());
  await sleep(3000);
  await page.evaluate(() => (window as any).__sonobe.session.runtime.play());
};

// ---------- Scenario ----------

/** Open `base`, load the document, and run every interaction `reps` times. Returns the runs by interaction name. */
export async function runScenario(browser: Browser, base: string, name: DocumentName, options: ScenarioOptions): Promise<Map<string, Run[]>> {
  const { context, page, cdp, problems } = await newPage(browser);
  const results = new Map<string, Run[]>();
  try {
    await openEditor(page, base);
    // The layer the canvas drag picks up (by a point on the artboard) and the Inspector scrubs: one no patch drives.
    let layerPoint: readonly [number, number] = [201, 300];
    let layerId = "post";
    if (name === "example") {
      await replaceDocument(page, loadExample("02-like-toggle"));
    } else {
      const built = await buildStress(page);
      if (!built.ok) throw new Error(`The stress document didn't build: ${JSON.stringify(built.errors)}`);
      layerPoint = [200, 30];
      layerId = "st_drag";
    }
    await sleep(1500);
    await fitPatches(page);
    if (options.throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: options.throttle });

    const wanted = (key: string) => options.filter.length === 0 || options.filter.some((f) => key.includes(f));
    const run = async (key: string, prepare: (i: number) => Promise<Gesture>, settle = 250) => {
      if (!wanted(key)) return;
      if (options.warm && !key.endsWith(".idle")) {
        await (await prepare(-1))();
        await sleep(settle);
      }
      const runs: Run[] = [];
      for (let i = 0; i < options.reps; i++) {
        runs.push(await record(page, cdp, await prepare(i)));
        await sleep(settle);
      }
      if (options.profileDir) {
        const gesture = await prepare(options.reps);
        await withProfile(cdp, path.join(options.profileDir, `${options.label}-${name}-${key}.cpuprofile`), async () => {
          await frames(page, 2);
          await gesture();
          await frames(page, 3);
        });
        await sleep(settle);
      }
      if (options.trace) {
        const gesture = await prepare(options.reps + 1);
        runs[0]!.trace = await traceBreakdown(browser, page, gesture);
        await sleep(settle);
      }
      results.set(key, runs);
    };
    const side = (i: number) => (i % 2 ? -1 : 1);

    // The whole graph on screen (Zoom to Fit).
    await run("fit.idle", idle);
    await run("fit.dragPatch", (i) => dragPatch(page, side(i) * 300));
    await run("fit.panZoom", () => panAndZoom(page));

    // A working zoom: part of the graph on screen.
    await fitPatches(page);
    await zoomPatchesTo(page, 0.65);
    await run("close.idle", idle);
    await run("paused.idle", pausedIdle(page));
    await run("close.dragPatch", (i) => dragPatch(page, side(i) * 300));
    await run("close.dragCable", () => dragCable(page));
    await run("close.panZoom", () => panAndZoom(page));

    let dragged = false;
    await run("canvas.dragLayer", async () => {
      const gesture = await dragLayer(page, layerPoint, dragged);
      dragged = true;
      return gesture;
    });
    await page.evaluate((id) => (window as any).__sonobe.session.selection.getState().selectItem("layer", id), layerId);
    await sleep(300);
    await run("inspector.scrub", (i) => scrub(page, side(i)));
    await run("layers.selectQuickly", () => selectLayers(page));
    await page.evaluate(() => (window as any).__sonobe.session.selection.getState().clear());
    await run("picker.type", () => typeInPicker(page), 400);
    if (problems.length) throw new Error(`The editor at ${base} logged errors during the ${name} interactions:\n${problems.join("\n")}`);
  } finally {
    await context.close();
  }
  return results;
}
