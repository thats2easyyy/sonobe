// @vitest-environment happy-dom
/**
 * Render benchmark: a 500-node frame (100 list rows × 5 layers) must reconcile in under 4 ms
 * and write only what changed. Timings use the median of many frames so GC pauses don't flake;
 * CI machines get a wider budget. Each timed case prints its median.
 *
 * happy-dom's CSSStyleDeclaration.setProperty re-serializes the whole declaration on every call
 * (tens of µs, far slower than a browser), so style writes are stubbed while timing: the budget
 * covers the renderer's own work, and write counts are still exact. End-to-end numbers with real
 * DOM writes and layout come from the Chromium stress view in `demo/screenshot.mjs`.
 */
import type { Runtime, SceneFrame, SceneNode } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, defineMock, port } from "@sonobe/engine/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDomRenderer } from "./renderer.ts";
import type { DomRenderer } from "./renderer.ts";
import { DomTextMeasurer } from "./textMeasurer.ts";

const BUDGET_MS = process.env.CI ? 12 : 4;
const ROWS = 100;

const mat = (x: number, y: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];

function leaf(key: string, type: string, x: number, y: number, w: number, h: number, props: Record<string, unknown>, parent: string, parentY: number, shift = 0): SceneNode {
  return { key, layerId: key, type, parentKey: parent, x: x + shift, y, width: w, height: h, transform: mat(x + shift, y), worldTransform: mat(16 + x + shift, parentY + y), opacity: 1, visible: true, clip: false, props, children: [] };
}

/** `scroll` moves every row; `shift` moves every leaf inside its row; `lifted` stacks row 0 in front (zPosition −index). */
function listFrame(scroll: number, shift = 0, progress = 0.5, lifted = false): SceneFrame {
  const roots: SceneNode[] = [];
  for (let i = 0; i < ROWS; i++) {
    const key = `row${i}`;
    const y = 16 + i * 72 - scroll;
    roots.push({
      key, layerId: key, type: "group", parentKey: null, x: 16, y, width: 358, height: 64, transform: mat(16, y), worldTransform: mat(16, y), opacity: 1, visible: true, clip: false,
      ...(lifted ? { zPosition: -i } : {}),
      props: { color: "#FFFFFFFF", cornerRadius: 16, shadowOpacity: 0.08, shadowRadius: 8, ...(lifted ? { zPosition: -i } : {}) },
      children: [
        leaf(`${key}_avatar`, "oval", 12, 12, 40, 40, { color: "#0A84FFFF" }, key, y, shift),
        leaf(`${key}_title`, "text", 64, 12, 220, 20, { text: `Event ${i}`, fontSize: 16, fontWeight: 600, lineHeight: 20 }, key, y, shift),
        leaf(`${key}_detail`, "text", 64, 34, 220, 18, { text: "Tonight · 214 going", fontSize: 13, lineHeight: 18, textColor: "#8E8E93FF" }, key, y, shift),
        leaf(`${key}_bar`, "rectangle", 296, 28, 50 * progress, 8, { color: "#30D158FF", cornerRadius: 4 }, key, y, shift),
      ],
    });
  }
  return { frame: 1, time: scroll, size: [390, 844], background: { r: 0.95, g: 0.95, b: 0.97, a: 1 }, roots };
}

const countNodes = (nodes: readonly SceneNode[]): number => nodes.reduce((n, c) => n + 1 + countNodes(c.children), 0);

const medianOf = (times: number[]) => times.sort((a, b) => a - b)[Math.floor(times.length / 2)]!;

/** Vitest prints this under the test's name. */
const report = (name: string, ms: number, note = `budget ${BUDGET_MS}`) => console.log(`renderer: ${name} ${ms.toFixed(3)} ms/frame (${note})`);

function measure(renderer: DomRenderer, frames: SceneFrame[]): { median: number; writesPerFrame: number[] } {
  const times: number[] = [];
  const writesPerFrame: number[] = [];
  for (const f of frames) {
    const before = renderer.getStats();
    const t0 = performance.now();
    renderer.render(f);
    times.push(performance.now() - t0);
    const after = renderer.getStats();
    writesPerFrame.push(after.styleWrites + after.attrWrites - before.styleWrites - before.attrWrites);
  }
  return { median: medianOf(times), writesPerFrame };
}

/** A whole frame as a host runs it: the engine's step, then the draw. Medians of each, and the writes per frame. */
function measureLive(runtime: Runtime, renderer: DomRenderer, frames: number): { step: number; draw: number; writesPerFrame: number[] } {
  const steps: number[] = [];
  const draws: number[] = [];
  const writesPerFrame: number[] = [];
  for (let i = 0; i < frames; i++) {
    const before = renderer.getStats();
    const t0 = performance.now();
    const frame = runtime.step();
    const t1 = performance.now();
    renderer.render(frame);
    draws.push(performance.now() - t1);
    steps.push(t1 - t0);
    const after = renderer.getStats();
    writesPerFrame.push(after.styleWrites + after.attrWrites - before.styleWrites - before.attrWrites);
  }
  return { step: medianOf(steps), draw: medianOf(draws), writesPerFrame };
}

/** happy-dom's style writes are far slower than a browser's (see the file comment): remember them in a map instead. Returns the undo. */
function stubStyleWrites(): () => void {
  const proto = CSSStyleDeclaration.prototype;
  const original = { setProperty: proto.setProperty, removeProperty: proto.removeProperty };
  const values = new WeakMap<CSSStyleDeclaration, Map<string, string>>();
  proto.setProperty = function (this: CSSStyleDeclaration, name: string, value: string | null) {
    let map = values.get(this);
    if (!map) values.set(this, (map = new Map()));
    map.set(name, value ?? "");
  };
  proto.removeProperty = function (this: CSSStyleDeclaration, name: string) {
    const map = values.get(this);
    const prev = map?.get(name) ?? "";
    map?.delete(name);
    return prev;
  };
  return () => {
    proto.setProperty = original.setProperty;
    proto.removeProperty = original.removeProperty;
  };
}

const testMeasurer = () => new DomTextMeasurer({ measureWidth: (t, _f, size) => t.length * size * 0.5, measureLineHeight: (_f, size) => size * 1.2 });

// Timing medians are sensitive to other test files running in parallel workers; each timed test primes
// its own starting frame, so a retry repeats it exactly (write counts stay exact) and the budget is unchanged.
describe("render performance (500 nodes)", { retry: 2 }, () => {
  let container: HTMLElement;
  let renderer: DomRenderer;
  let restoreStyleWrites: () => void;

  beforeAll(() => {
    restoreStyleWrites = stubStyleWrites();
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = createDomRenderer(container, { resolveAssetUrl: () => undefined, captureInput: false, textMeasurer: testMeasurer() });
    for (let i = 0; i < 20; i++) renderer.render(listFrame(i, i % 2));
  });

  afterAll(() => {
    renderer.dispose();
    container.remove();
    restoreStyleWrites();
  });

  it("builds a 500-node scene", () => {
    expect(countNodes(listFrame(0).roots)).toBe(500);
  });

  it("re-renders an identical frame with zero writes", () => {
    const f = listFrame(3);
    renderer.render(f);
    const { median, writesPerFrame } = measure(renderer, Array.from({ length: 40 }, () => structuredClone(f)));
    report("identical frame", median);
    expect(writesPerFrame.every((w) => w === 0)).toBe(true);
    expect(median).toBeLessThan(BUDGET_MS);
  });

  it("scrolls by writing one transform per row", () => {
    renderer.render(listFrame(100));
    const { median, writesPerFrame } = measure(renderer, Array.from({ length: 40 }, (_, i) => listFrame(101 + i)));
    report("scroll, one transform per row", median);
    expect(writesPerFrame.every((w) => w === ROWS)).toBe(true);
    expect(median).toBeLessThan(BUDGET_MS);
  });

  it("moves every layer with one write per node", () => {
    renderer.render(listFrame(0, 0));
    const { median, writesPerFrame } = measure(renderer, Array.from({ length: 40 }, (_, i) => listFrame(i + 1, i + 1)));
    report("move every layer", median);
    expect(writesPerFrame.every((w) => w === ROWS * 5)).toBe(true);
    expect(median).toBeLessThan(BUDGET_MS);
  });

  it("keeps zPosition ranks without writes: a static lifted list writes nothing, a scrolling one only transforms", () => {
    renderer.render(listFrame(3, 0, 0.5, true));
    const still = measure(renderer, Array.from({ length: 40 }, () => listFrame(3, 0, 0.5, true)));
    report("static lifted list", still.median);
    expect(still.writesPerFrame.every((w) => w === 0)).toBe(true);
    expect(still.median).toBeLessThan(BUDGET_MS);
    const moved = renderer.getStats().moved;
    const scrolled = measure(renderer, Array.from({ length: 40 }, (_, i) => listFrame(4 + i, 0, 0.5, true)));
    report("scrolling lifted list", scrolled.median);
    expect(scrolled.writesPerFrame.every((w) => w === ROWS)).toBe(true);
    expect(renderer.getStats().moved).toBe(moved);
    renderer.render(listFrame(0));
  });

  it("creates no elements on animated frames", () => {
    const created = renderer.getStats().created;
    measure(renderer, Array.from({ length: 10 }, (_, i) => listFrame(i, 0, i / 10)));
    expect(renderer.getStats().created).toBe(created);
  });
});

/**
 * Frames the engine built, which the hand-written frames above can't stand in for: props inherit
 * their layer type's defaults, and patch outputs arrive as new values every frame. One box turns
 * on a clock, so every frame is a real one, and everything else holds still.
 */
describe("render performance (engine frames, 500 layers)", { retry: 2 }, () => {
  let container: HTMLElement;
  let restoreStyleWrites: () => void;
  const open: { dispose(): void }[] = [];

  const PARAGRAPH = "The quick brown fox jumps over the lazy dog, then turns around and does it again, because a pangram is only useful when there is enough of it to wrap over several lines of a narrow column.";
  /** A color that is a new object with the same channels on every frame, as Transition and Pop Animation output while they hold still. */
  const tint = defineMock({
    type: "tint",
    name: "Tint",
    inputs: [],
    outputs: [port("output", "color")],
    evaluate(ctx) {
      ctx.output("output", { r: 0.04, g: 0.52, b: 1, a: 1 });
    },
  });
  const reg = createMockRegistry([tint]);
  /**
   * 300 boxes (one turning), then 200 texts: one line each, or a paragraph wrapped at 180 pt.
   * `tinted`: every box's color and every text's color come from the tint patch.
   */
  const screen = (wrapped: boolean, tinted = false) => {
    const color = tinted ? { link: "tint.output" } : "#0A84FFFF";
    const layers: { id: string; type: string; name: string; props: Record<string, unknown> }[] = [];
    for (let i = 0; i < 300; i++) {
      layers.push({ id: `box${i}`, type: i % 3 === 0 ? "oval" : "rectangle", name: `Box ${i}`, props: { position: [(i % 20) * 19, Math.floor(i / 20) * 20], size: [16, 16], color, ...(i === 0 ? { rotation: { link: "clock.frame" } } : {}) } });
    }
    for (let i = 0; i < 200; i++) {
      const position = [(i % 4) * 96, 310 + Math.floor(i / 4) * 10];
      layers.push({
        id: `text${i}`,
        type: "text",
        name: `Text ${i}`,
        props: wrapped ? { position, text: `${i}. ${PARAGRAPH}`, fontSize: 11, widthMode: "fixed", size: [180, 60] } : { position, text: `Event ${i}`, fontSize: 13, textColor: tinted ? color : "#8E8E93FF" },
      });
    }
    const measurer = testMeasurer();
    const runtime = createTestRuntime(buildDoc({ layers: layers as never, patches: { clock: { type: "time" }, tint: { type: "tint" } } }, reg), reg, { textMeasurer: measurer });
    const renderer = createDomRenderer(container, { resolveAssetUrl: () => undefined, captureInput: false, textMeasurer: measurer });
    open.push(runtime, renderer);
    for (let i = 0; i < 20; i++) renderer.render(runtime.step());
    return { runtime, renderer };
  };

  beforeAll(() => {
    restoreStyleWrites = stubStyleWrites();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterAll(() => {
    for (const o of open) o.dispose();
    container.remove();
    restoreStyleWrites();
  });

  it("draws 300 boxes and 200 texts while one box turns, writing its transform only", () => {
    const { runtime, renderer } = screen(false);
    const { step, draw, writesPerFrame } = measureLive(runtime, renderer, 60);
    report("300 boxes + 200 texts, one box turning: draw", draw);
    report("300 boxes + 200 texts, one box turning: engine step", step, "not budgeted here");
    expect(writesPerFrame.every((w) => w === 1)).toBe(true);
    expect(draw).toBeLessThan(BUDGET_MS);
  });

  it("draws layers whose colors a patch makes anew on every frame, the same each time, as cheaply", () => {
    const { runtime, renderer } = screen(false, true);
    const { draw, writesPerFrame } = measureLive(runtime, renderer, 60);
    report("300 boxes + 200 texts, every color from a patch, one box turning: draw", draw);
    expect(writesPerFrame.every((w) => w === 1)).toBe(true);
    expect(draw).toBeLessThan(BUDGET_MS);
  });

  it("steps and draws 200 wrapped paragraphs while one box turns", () => {
    const { runtime, renderer } = screen(true);
    const { step, draw, writesPerFrame } = measureLive(runtime, renderer, 60);
    report("300 boxes + 200 wrapped paragraphs, one box turning: draw", draw);
    // The measurer keeps a wrapped layout, so a paragraph is wrapped once, not on every frame (that took over 4 ms here).
    report("300 boxes + 200 wrapped paragraphs, one box turning: engine step (lays the text out)", step, `budget ${BUDGET_MS / 2}`);
    expect(writesPerFrame.every((w) => w === 1)).toBe(true);
    expect(draw).toBeLessThan(BUDGET_MS);
    expect(step).toBeLessThan(BUDGET_MS / 2);
  });
});
