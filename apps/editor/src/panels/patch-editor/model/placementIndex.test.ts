import { applyOps, createEmptyDocument, getDiagnostics, type Op, type SonobeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createPlacementIndex, estimateNodeSize, padRect, rectsOverlap, type Rect } from "./geometry.ts";
import { deriveGraph } from "./graph.ts";

/** Deterministic pseudo-random numbers (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("createPlacementIndex", () => {
  it("answers like checking every padded rect", () => {
    const rand = random(7);
    const index = createPlacementIndex(12);
    const placed: Rect[] = [];
    const rect = (): Rect => ({ x: Math.round((rand() - 0.5) * 6000), y: Math.round((rand() - 0.5) * 6000), width: 20 + Math.round(rand() * 400), height: 20 + Math.round(rand() * 300) });
    for (let i = 0; i < 400; i++) {
      const r = rect();
      index.add(r);
      placed.push(r);
    }
    // Rects the grid can't index (huge or not finite) still count.
    for (const odd of [{ x: -5000, y: 0, width: 40000, height: 10 }, { x: 0, y: 0, width: Number.NaN, height: 10 }]) {
      index.add(odd);
      placed.push(odd);
    }
    for (let i = 0; i < 4000; i++) {
      const q = i === 0 ? { x: 1e9, y: 0, width: 1e12, height: 10 } : rect();
      expect(index.overlaps(q)).toBe(placed.some((r) => rectsOverlap(padRect(r, 12), q)));
    }
  });
});

describe("deriveGraph placement", () => {
  const registry = createPatchRegistry();

  /** Pop Animation → Transition chains driving one rectangle each, `spacing` px apart per column. */
  function chains(count: number, spacing: number): SonobeDocument {
    const ops: Op[] = [];
    for (let i = 0; i < count; i++) {
      const gx = (i % 5) * spacing;
      const gy = Math.floor(i / 5) * 170;
      ops.push({ op: "addLayer", layer: { id: `card${i}`, type: "rectangle", name: `Card ${i}`, props: {} } });
      ops.push({ op: "addPatch", patch: { id: `pop${i}`, type: "popAnimation", ui: { x: gx, y: gy } } });
      ops.push({ op: "addPatch", patch: { id: `tr${i}`, type: "transition", typeParam: "number", inputs: { progress: { link: `pop${i}.output` } }, ui: { x: gx + 220, y: gy } } });
      ops.push({ op: "setInput", target: `@card${i}.scale`, value: { link: `tr${i}.output` } });
    }
    const r = applyOps(createEmptyDocument({ name: "Placement" }), ops, { registry });
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
    return r.doc;
  }

  const rectOf = (n: ReturnType<typeof deriveGraph>["nodes"][number]): Rect => ({ x: n.position.x, y: n.position.y, ...estimateNodeSize(n.data) });

  it("keeps layer nodes clear of every placed node", () => {
    const doc = chains(40, 960);
    const model = deriveGraph({ doc, componentId: doc.project.root, registry, diagnostics: getDiagnostics(doc, registry) });
    const layerNodes = model.nodes.filter((n) => n.type === "layer");
    expect(layerNodes).toHaveLength(40);
    for (const a of layerNodes) {
      for (const b of model.nodes) {
        if (a !== b && b.type !== "comment") expect(rectsOverlap(padRect(rectOf(b), 11), rectOf(a))).toBe(false);
      }
    }
  });

  it("places crowded layer nodes the same way on every derive", () => {
    const doc = chains(60, 600);
    const diagnostics = getDiagnostics(doc, registry);
    const first = deriveGraph({ doc, componentId: doc.project.root, registry, diagnostics });
    const scrubbed = applyOps(doc, [{ op: "setInput", target: "pop3.bounciness", value: 9 }], { registry }).doc;
    const again = deriveGraph({ doc: scrubbed, componentId: doc.project.root, registry, diagnostics: getDiagnostics(scrubbed, registry), previous: first });
    const positions = (m: typeof first) => m.nodes.filter((n) => n.type === "layer").map((n) => [n.id, n.position.x, n.position.y]);
    expect(positions(again)).toEqual(positions(first));
    expect(again.nodes.find((n) => n.id === "@card10")).toBe(first.nodes.find((n) => n.id === "@card10"));
  });
});
