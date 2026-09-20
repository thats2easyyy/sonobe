// @vitest-environment happy-dom
/**
 * Render benchmark: a 500-node frame (100 list rows × 5 layers) must reconcile in under 4 ms
 * and write only what changed. Timings use the median of many frames so GC pauses don't flake;
 * CI machines get a wider budget.
 *
 * happy-dom's CSSStyleDeclaration.setProperty re-serializes the whole declaration on every call
 * (tens of µs, far slower than a browser), so style writes are stubbed while timing: the budget
 * covers the renderer's own work, and write counts are still exact. End-to-end numbers with real
 * DOM writes and layout come from the Chromium stress view in `demo/screenshot.mjs`.
 */
import type { SceneFrame, SceneNode } from "@sonobe/engine";
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
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(times.length / 2)]!, writesPerFrame };
}

// Timing medians are sensitive to other test files running in parallel workers; each timed test primes
// its own starting frame, so a retry repeats it exactly (write counts stay exact) and the budget is unchanged.
describe("render performance (500 nodes)", { retry: 2 }, () => {
  let container: HTMLElement;
  let renderer: DomRenderer;
  const proto = CSSStyleDeclaration.prototype;
  const original = { setProperty: proto.setProperty, removeProperty: proto.removeProperty };

  beforeAll(() => {
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
    container = document.createElement("div");
    document.body.appendChild(container);
    const measurer = new DomTextMeasurer({ measureWidth: (t, _f, size) => t.length * size * 0.5, measureLineHeight: (_f, size) => size * 1.2 });
    renderer = createDomRenderer(container, { resolveAssetUrl: () => undefined, captureInput: false, textMeasurer: measurer });
    for (let i = 0; i < 20; i++) renderer.render(listFrame(i, i % 2));
  });

  afterAll(() => {
    renderer.dispose();
    container.remove();
    proto.setProperty = original.setProperty;
    proto.removeProperty = original.removeProperty;
  });

  it("builds a 500-node scene", () => {
    expect(countNodes(listFrame(0).roots)).toBe(500);
  });

  it("re-renders an identical frame with zero writes", () => {
    const f = listFrame(3);
    renderer.render(f);
    const { median, writesPerFrame } = measure(renderer, Array.from({ length: 40 }, () => structuredClone(f)));
    expect(writesPerFrame.every((w) => w === 0)).toBe(true);
    expect(median).toBeLessThan(BUDGET_MS);
  });

  it("scrolls by writing one transform per row", () => {
    renderer.render(listFrame(100));
    const { median, writesPerFrame } = measure(renderer, Array.from({ length: 40 }, (_, i) => listFrame(101 + i)));
    expect(writesPerFrame.every((w) => w === ROWS)).toBe(true);
    expect(median).toBeLessThan(BUDGET_MS);
  });

  it("moves every layer with one write per node", () => {
    renderer.render(listFrame(0, 0));
    const { median, writesPerFrame } = measure(renderer, Array.from({ length: 40 }, (_, i) => listFrame(i + 1, i + 1)));
    expect(writesPerFrame.every((w) => w === ROWS * 5)).toBe(true);
    expect(median).toBeLessThan(BUDGET_MS);
  });

  it("keeps zPosition ranks without writes: a static lifted list writes nothing, a scrolling one only transforms", () => {
    renderer.render(listFrame(3, 0, 0.5, true));
    const still = measure(renderer, Array.from({ length: 40 }, () => listFrame(3, 0, 0.5, true)));
    expect(still.writesPerFrame.every((w) => w === 0)).toBe(true);
    expect(still.median).toBeLessThan(BUDGET_MS);
    const moved = renderer.getStats().moved;
    const scrolled = measure(renderer, Array.from({ length: 40 }, (_, i) => listFrame(4 + i, 0, 0.5, true)));
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
