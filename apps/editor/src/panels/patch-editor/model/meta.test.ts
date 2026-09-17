// @vitest-environment happy-dom
import { applyOps, type SonobeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { deriveGraph } from "./graph.ts";
import { nodePositionsMetaOp, readNodePositions, PATCH_EDITOR_META_KEY } from "./meta.ts";

const registry = createPatchRegistry();
const demo = createDemoDocument(registry);

function apply(doc: SonobeDocument, ops: Parameters<typeof applyOps>[1]) {
  const r = applyOps(doc, ops, { registry });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r;
}

describe("patch editor metadata", () => {
  it("reads nothing from a component without metadata, and ignores malformed entries", () => {
    expect(readNodePositions(demo.components.main)).toEqual({});
    expect(readNodePositions({ meta: { patchEditor: { nodes: { "@photo": [10, 20], "@card": { x: 1, y: 2 }, "@bad": ["a", 2], "@nan": [Number.NaN, 1] } } } })).toEqual({ "@photo": { x: 10, y: 20 }, "@card": { x: 1, y: 2 } });
  });

  it("saves layer and interface node positions (rounded, sorted), ignoring patches", () => {
    const op = nodePositionsMetaOp(demo.components.main!, new Map([["@photo", { x: 900.4, y: 40.6 }], ["zoomed", { x: 1, y: 1 }], ["@card", { x: 880, y: 200 }]]));
    expect(op).toEqual({ op: "updateComponent", id: "main", meta: { [PATCH_EDITOR_META_KEY]: { nodes: { "@card": [880, 200], "@photo": [900, 41] } } } });
    const saved = apply(demo, [op!]).doc;
    expect(readNodePositions(saved.components.main)).toEqual({ "@card": { x: 880, y: 200 }, "@photo": { x: 900, y: 41 } });
    // deriveGraph places layer targets at their saved positions.
    const model = deriveGraph({ doc: saved, componentId: "main", registry });
    expect(model.nodes.find((n) => n.id === "@photo")!.position).toEqual({ x: 900, y: 41 });
  });

  it("merges with saved positions and other patch editor metadata, is a no-op when unchanged, and undoes", () => {
    const first = apply(demo, [{ op: "updateComponent", id: "main", meta: { patchEditor: { nodes: { "@photo": [1, 2] }, note: "keep" } } }]).doc;
    const op = nodePositionsMetaOp(first.components.main!, new Map([["@heart", { x: 5, y: 6 }]]));
    expect(op).toMatchObject({ meta: { patchEditor: { note: "keep", nodes: { "@heart": [5, 6], "@photo": [1, 2] } } } });
    expect(nodePositionsMetaOp(first.components.main!, new Map([["@photo", { x: 1.2, y: 2.3 }]]))).toBeUndefined();
    const moved = apply(first, [op!]);
    const undone = apply(moved.doc, moved.inverse);
    expect(readNodePositions(undone.doc.components.main)).toEqual({ "@photo": { x: 1, y: 2 } });
  });

  it("drops entries for layers that no longer exist", () => {
    const withGhost = apply(demo, [{ op: "updateComponent", id: "main", meta: { patchEditor: { nodes: { "@deleted_layer": [1, 2], "$in": [3, 4] } } } }]).doc;
    const op = nodePositionsMetaOp(withGhost.components.main!, new Map([["@photo", { x: 7, y: 8 }]]));
    expect(op).toMatchObject({ meta: { patchEditor: { nodes: { "@photo": [7, 8] } } } });
    expect(Object.keys((op as unknown as { meta: { patchEditor: { nodes: object } } }).meta.patchEditor.nodes)).toEqual(["@photo"]);
  });
});
