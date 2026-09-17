// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { rectsOverlap, type Rect } from "./geometry.ts";
import { documentObstacles, estimatePatchSize, findFreePosition, freeInsertPosition } from "./placement.ts";

const registry = createPatchRegistry();
const size = { width: 180, height: 100 };

function build(ops: Op[]): SonobeDocument {
  const r = applyOps(createEmptyDocument(), ops, { registry });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r.doc;
}

const overlapsAny = (rect: Rect, others: readonly Rect[], gap = 0) => others.some((o) => rectsOverlap({ x: o.x - gap, y: o.y - gap, width: o.width + gap * 2, height: o.height + gap * 2 }, rect));

describe("findFreePosition", () => {
  it("uses the preferred spot when it's free", () => {
    expect(findFreePosition(size, { x: 400.4, y: 120.6 }, { nodes: [{ x: 0, y: 0, width: 200, height: 100 }] })).toEqual({ x: 400, y: 121 });
  });

  it("moves off patches, keeping the gap, and prefers staying in the column", () => {
    const nodes = [{ x: 100, y: 100, width: 200, height: 120 }];
    const at = findFreePosition(size, { x: 110, y: 110 }, { nodes });
    expect(overlapsAny({ ...at, ...size }, nodes, 19)).toBe(false);
    expect(at.x).toBe(110);
  });

  it("looks to the biased side first", () => {
    const nodes = [{ x: 0, y: -400, width: 200, height: 900 }];
    const right = findFreePosition(size, { x: 50, y: 0 }, { nodes }, { bias: "right" });
    const left = findFreePosition(size, { x: 50, y: 0 }, { nodes }, { bias: "left" });
    expect(right.x).toBeGreaterThanOrEqual(220);
    expect(left.x + size.width).toBeLessThanOrEqual(-20);
  });

  it("doesn't straddle a comment frame, but may land inside the one you aimed at", () => {
    const comments = [{ x: 0, y: 0, width: 600, height: 300 }];
    const edge = findFreePosition(size, { x: 520, y: 120 }, { nodes: [], comments });
    expect(overlapsAny({ ...edge, ...size }, comments)).toBe(false);
    const inside = findFreePosition(size, { x: 100, y: 80 }, { nodes: [], comments });
    expect(inside).toEqual({ x: 100, y: 80 });
    const titleBar = findFreePosition(size, { x: 100, y: 4 }, { nodes: [], comments });
    expect(titleBar.y).toBeGreaterThanOrEqual(36);
  });

  it("falls back to the preferred spot when nothing is free nearby", () => {
    const nodes = [{ x: -5000, y: -5000, width: 10000, height: 10000 }];
    expect(findFreePosition(size, { x: 10, y: 20 }, { nodes }, { radius: 160 })).toEqual({ x: 10, y: 20 });
  });
});

describe("estimatePatchSize and freeInsertPosition", () => {
  it("estimates a patch that doesn't exist yet from its ports", () => {
    const doc = createEmptyDocument();
    const transition = estimatePatchSize(doc, registry, { type: "transition", typeParam: "number", inputs: {}, ui: { x: 0, y: 0 } });
    const counter = estimatePatchSize(doc, registry, { type: "counter", inputs: {}, ui: { x: 0, y: 0 } });
    expect(transition.height).toBeGreaterThan(50);
    expect(counter.width).toBeGreaterThanOrEqual(164);
  });

  it("puts a patch below the graph without overlapping patches or comments", () => {
    const demo = createDemoDocument(registry);
    const main = demo.components.main!;
    const at = freeInsertPosition(demo, "main", registry, "counter");
    const obstacles = documentObstacles(demo, main, registry);
    const rect = { ...at, ...estimatePatchSize(demo, registry, { type: "counter", inputs: {}, ui: at }) };
    expect(overlapsAny(rect, obstacles.nodes)).toBe(false);
    expect(overlapsAny(rect, obstacles.comments ?? [])).toBe(false);
    expect(at.y).toBeGreaterThan(600);
  });

  it("finds room near a point in a crowded graph", () => {
    const doc = build([
      { op: "addPatch", patch: { id: "a", type: "switch", ui: { x: 0, y: 0 } } },
      { op: "addPatch", patch: { id: "b", type: "switch", ui: { x: 0, y: 120 } } },
    ]);
    const at = freeInsertPosition(doc, "main", registry, "switch", { x: 10, y: 10 });
    const obstacles = documentObstacles(doc, doc.components.main!, registry);
    expect(overlapsAny({ ...at, ...estimatePatchSize(doc, registry, { type: "switch", inputs: {}, ui: at }) }, obstacles.nodes)).toBe(false);
  });
});
