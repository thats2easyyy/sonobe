import { describe, expect, it } from "vitest";
import { layersWithGraphNodes, readNodePositions } from "../graph/graphNodes.ts";
import { buildSampleDocument, expectRoundTrip, mockRegistry, mustApply } from "../testing/fixtures.ts";
import type { Op, SonobeDocument } from "../types.ts";
import { applyOps } from "./index.ts";

const apply = (doc: SonobeDocument, ops: Op[]) => applyOps(doc, ops, { registry: mockRegistry });
const firstError = (doc: SonobeDocument, ops: Op[]) => apply(doc, ops).errors[0]!;
const positions = (doc: SonobeDocument, component = "main") => readNodePositions(doc.components[component]);

describe("setNodePositions", () => {
  it("sets, rounds and clears entries, keeping other nodes and other patch editor metadata", () => {
    const doc = mustApply(buildSampleDocument(), [{ op: "updateComponent", id: "main", meta: { patchEditor: { zoom: 2 } } }]).doc;
    const set = mustApply(doc, [{ op: "setNodePositions", positions: { "@card": [600.4, 39.6], $in: [-200, 0] } }]);
    expect(set.doc.components.main!.meta).toEqual({ patchEditor: { zoom: 2, nodes: { $in: [-200, 0], "@card": [600, 40] } } });
    expect(set.applied).toEqual([{ op: "setNodePositions", component: "main", positions: { "@card": [600, 40], $in: [-200, 0] } }]);
    expectRoundTrip(doc, set);

    const partial = mustApply(set.doc, [{ op: "setNodePositions", positions: { "@title": [900, 40] } }]);
    expect(positions(partial.doc)).toEqual({ $in: { x: -200, y: 0 }, "@card": { x: 600, y: 40 }, "@title": { x: 900, y: 40 } });
    // The inverse names only the touched key.
    expect(partial.inverse).toEqual([{ op: "setNodePositions", component: "main", positions: { "@title": null } }]);
    expectRoundTrip(set.doc, partial);

    const cleared = mustApply(set.doc, [{ op: "setNodePositions", positions: { "@card": null, $in: null } }]);
    expect(cleared.doc.components.main!.meta).toEqual({ patchEditor: { zoom: 2 } });
    expectRoundTrip(set.doc, cleared);
    const empty = mustApply(buildSampleDocument(), [{ op: "setNodePositions", positions: { "@card": [1, 2] } }, { op: "setNodePositions", positions: { "@card": null } }]);
    expect(empty.doc.components.main!.meta).toBeUndefined();
  });

  it("names layers made in the same batch by ref", () => {
    const r = mustApply(buildSampleDocument(), [
      { op: "setNodePositions", positions: { "@$badge": [10, 20] } },
      { op: "addLayer", layer: { ref: "badge", type: "rectangle", name: "Badge" } },
    ]);
    expect(positions(r.doc)).toEqual({ "@badge": { x: 10, y: 20 } });
  });

  it("teaches the right op for patches and comments, and the node id for layers", () => {
    const doc = mustApply(buildSampleDocument(), [{ op: "addComment", comment: { id: "note", text: "Note", rect: [0, 0, 200, 100] } }]).doc;
    expect(firstError(doc, [{ op: "setNodePositions", positions: { "@crad": [1, 2] } }])).toMatchObject({ code: "not_found", message: expect.stringContaining('Did you mean "@card"') });
    expect(firstError(doc, [{ op: "setNodePositions", positions: { pop: [1, 2] } }])).toMatchObject({ code: "invalid_op", hint: expect.stringContaining('"updatePatch", "id": "pop", "ui"') });
    expect(firstError(doc, [{ op: "setNodePositions", positions: { note: [1, 2] } }])).toMatchObject({ code: "invalid_op", hint: expect.stringContaining("updateComment") });
    expect(firstError(doc, [{ op: "setNodePositions", positions: { card: [1, 2] } }]).message).toContain('"@card"');
    expect(firstError(doc, [{ op: "setNodePositions", positions: { "@card": { x: 1, y: 2 } as never } }])).toMatchObject({ code: "invalid_value", message: expect.stringContaining("[x, y]") });
    expect(firstError(doc, [{ op: "setNodePositions", positions: [] as never }]).code).toBe("invalid_op");
    expect(firstError(doc, [{ op: "setNodePositions", positions: {}, zoom: 1 } as never]).code).toBe("unknown_field");
  });

  it("clears an entry for a layer that no longer exists", () => {
    const ghost = mustApply(buildSampleDocument(), [{ op: "updateComponent", id: "main", meta: { patchEditor: { nodes: { "@gone": [1, 2] } } } }]).doc;
    const r = mustApply(ghost, [{ op: "setNodePositions", positions: { "@gone": null } }]);
    expect(positions(r.doc)).toEqual({});
  });
});

describe("saved node positions follow their layers", () => {
  it("removeLayer drops the subtree's positions, undo restores them, and a new layer with the id starts fresh", () => {
    const doc = mustApply(buildSampleDocument(), [{ op: "setNodePositions", positions: { "@card": [600, 40], "@title": [900, 40] } }]).doc;
    const removed = mustApply(doc, [{ op: "removeLayer", id: "card" }]);
    expect(positions(removed.doc)).toEqual({});
    expect(removed.inverse.at(-1)).toEqual({ op: "setNodePositions", component: "main", positions: { "@card": [600, 40], "@title": [900, 40] } });
    expectRoundTrip(doc, removed);
    const readded = mustApply(removed.doc, [{ op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } }]);
    expect(positions(readded.doc)).toEqual({});
  });

  it("createComponent moves the moved layers' positions into the new component", () => {
    const doc = mustApply(buildSampleDocument(), [{ op: "setNodePositions", positions: { "@card": [600, 40] } }]).doc;
    const r = mustApply(doc, [{ op: "createComponent", name: "Card Stack", layerIds: ["card"], patchIds: ["tap_card"] }]);
    expect(positions(r.doc)).toEqual({});
    expect(positions(r.doc, "card_stack")).toEqual({ "@card": { x: 600, y: 40 } });
    expectRoundTrip(doc, r);
  });
});

describe("updateComponent meta and saved node positions", () => {
  const placed = () => mustApply(buildSampleDocument(), [{ op: "setNodePositions", positions: { "@card": [600, 40], $in: [0, 0] } }]).doc;

  it("refuses a patchEditor object that would drop or move saved positions", () => {
    const e = firstError(placed(), [{ op: "updateComponent", id: "main", meta: { patchEditor: { nodes: { "@title": [1, 2] } } } }]);
    expect(e.code).toBe("meta_conflict");
    expect(e.message).toContain("drop the saved graph positions of $in, @card");
    expect(e.hint).toContain("setNodePositions");
    expect(firstError(placed(), [{ op: "updateComponent", id: "main", meta: { patchEditor: { nodes: { "@card": [1, 2], $in: [0, 0] } } } }]).code).toBe("meta_conflict");
  });

  it("allows other keys with the nodes unchanged, clearing patchEditor, and a first write; every inverse applies", () => {
    const doc = placed();
    const same = mustApply(doc, [{ op: "updateComponent", id: "main", meta: { patchEditor: { note: "keep", nodes: { "@card": [600, 40], $in: [0, 0] } } } }]);
    expectRoundTrip(doc, same);
    const cleared = mustApply(doc, [{ op: "updateComponent", id: "main", meta: { patchEditor: null } }]);
    expect(positions(cleared.doc)).toEqual({});
    expectRoundTrip(doc, cleared);
    const all = mustApply(doc, [{ op: "updateComponent", id: "main", meta: null }]);
    expectRoundTrip(doc, all);
    const first = mustApply(buildSampleDocument(), [{ op: "updateComponent", id: "main", meta: { patchEditor: { nodes: { "@card": [1, 2] } } } }]);
    expectRoundTrip(buildSampleDocument(), first);
  });

  it("stays lenient for undo and redo", () => {
    const r = applyOps(placed(), [{ op: "updateComponent", id: "main", meta: { patchEditor: { nodes: {} } } }], { registry: mockRegistry, lenient: true });
    expect(r.ok).toBe(true);
  });
});

describe("layersWithGraphNodes", () => {
  it("lists layers whose properties are driven or read, like the patch editor", () => {
    const doc = buildSampleDocument();
    expect([...layersWithGraphNodes(doc.components.main!)]).toEqual(["card"]);
    const read = mustApply(doc, [{ op: "addPatch", patch: { id: "watch", type: "switch", inputs: { flip: { link: "@title.opacity" } } } }]).doc;
    expect([...layersWithGraphNodes(read.components.main!)].sort()).toEqual(["card", "title"]);
  });
});
