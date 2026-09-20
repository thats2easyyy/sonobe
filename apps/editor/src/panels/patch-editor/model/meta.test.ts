// @vitest-environment happy-dom
import { applyOps, nodePositionsOp, readNodePositions, type SonobeDocument } from "@sonobe/core";
import { deriveGraph } from "@sonobe/core/graph";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";

const registry = createPatchRegistry();
const demo = createDemoDocument(registry);

function apply(doc: SonobeDocument, ops: Parameters<typeof applyOps>[1], lenient = false) {
  const r = applyOps(doc, ops, { registry, lenient });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r;
}

describe("graph node positions", () => {
  it("reads nothing from a component without metadata, and ignores malformed entries", () => {
    expect(readNodePositions(demo.components.main)).toEqual({});
    expect(readNodePositions({ meta: { patchEditor: { nodes: { "@photo": [10, 20], "@card": { x: 1, y: 2 }, "@bad": ["a", 2], "@nan": [Number.NaN, 1] } } } })).toEqual({ "@photo": { x: 10, y: 20 }, "@card": { x: 1, y: 2 } });
  });

  it("saves layer and interface node positions (rounded), ignoring patches", () => {
    const op = nodePositionsOp(demo.components.main!, new Map([["@photo", { x: 900.4, y: 40.6 }], ["zoomed", { x: 1, y: 1 }], ["@card", { x: 880, y: 200 }]]));
    expect(op).toEqual({ op: "setNodePositions", component: "main", positions: { "@photo": [900, 41], "@card": [880, 200] } });
    const saved = apply(demo, [op!]).doc;
    expect(readNodePositions(saved.components.main)).toEqual({ "@card": { x: 880, y: 200 }, "@photo": { x: 900, y: 41 } });
    // deriveGraph places layer targets at their saved positions.
    const model = deriveGraph({ doc: saved, componentId: "main", registry });
    expect(model.nodes.find((n) => n.id === "@photo")!.position).toEqual({ x: 900, y: 41 });
  });

  it("names only the entries that change, keeps other patch editor metadata, and undoes", () => {
    const first = apply(demo, [{ op: "updateComponent", id: "main", meta: { patchEditor: { note: "keep" } } }, { op: "setNodePositions", positions: { "@photo": [1, 2] } }]).doc;
    const op = nodePositionsOp(first.components.main!, new Map([["@heart", { x: 5, y: 6 }], ["@photo", { x: 1.2, y: 2.3 }]]));
    expect(op).toEqual({ op: "setNodePositions", component: "main", positions: { "@heart": [5, 6] } });
    expect(nodePositionsOp(first.components.main!, new Map([["@photo", { x: 1.2, y: 2.3 }]]))).toBeUndefined();
    const moved = apply(first, [op!]);
    expect(moved.doc.components.main!.meta).toEqual({ patchEditor: { note: "keep", nodes: { "@heart": [5, 6], "@photo": [1, 2] } } });
    const undone = apply(moved.doc, moved.inverse, true);
    expect(readNodePositions(undone.doc.components.main)).toEqual({ "@photo": { x: 1, y: 2 } });
  });

  it("clears entries for layers that no longer exist", () => {
    const withGhost = apply(demo, [{ op: "updateComponent", id: "main", meta: { patchEditor: { nodes: { "@deleted_layer": [1, 2], $in: [3, 4] } } } }], true).doc;
    const op = nodePositionsOp(withGhost.components.main!, new Map([["@photo", { x: 7, y: 8 }]]));
    expect(op).toEqual({ op: "setNodePositions", component: "main", positions: { "@deleted_layer": null, $in: null, "@photo": [7, 8] } });
    expect(Object.keys(readNodePositions(apply(withGhost, [op!]).doc.components.main))).toEqual(["@photo"]);
  });
});
