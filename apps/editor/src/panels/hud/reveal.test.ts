import { applyOps, createEmptyDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "../../state/document.ts";
import { createSelectionStore } from "../../state/selection.ts";
import { revealItems } from "./reveal.ts";

const registry = createPatchRegistry();

describe("revealItems", () => {
  function setup() {
    let doc = createEmptyDocument();
    const added = applyOps(doc, [{ op: "addComponent", component: { name: "Card", kind: "layerComponent" } }], { registry });
    doc = added.doc;
    const card = Object.keys(doc.components).find((id) => id !== "main")!;
    const r = applyOps(
      doc,
      [
        { op: "addLayer", layer: { id: "photo", type: "rectangle" } },
        { op: "addPatch", patch: { id: "tap", type: "interaction" } },
        { op: "addLayer", component: card, layer: { id: "title", type: "text" } },
      ],
      { registry },
    );
    expect(r.ok).toBe(true);
    return { document: createDocumentStore({ registry, document: r.doc }), selection: createSelectionStore(), card };
  }

  it("selects existing items and publishes a reveal request", () => {
    const session = setup();
    expect(revealItems(session, "main", ["photo", "tap", "gone"])).toBe(true);
    const s = session.selection.getState();
    expect(s.layers).toEqual(["photo"]);
    expect(s.patches).toEqual(["tap"]);
    expect(s.reveal).toMatchObject({ component: "main", ids: ["photo", "tap"] });
  });

  it("enters another component first", () => {
    const session = setup();
    expect(revealItems(session, session.card, ["title"])).toBe(true);
    expect(session.selection.getState()).toMatchObject({ componentPath: ["main", session.card], layers: ["title"] });
    expect(revealItems(session, undefined, ["tap"])).toBe(true);
    expect(session.selection.getState().componentPath).toEqual(["main"]);
  });

  it("returns false when nothing exists", () => {
    const session = setup();
    expect(revealItems(session, "nope", ["photo"])).toBe(false);
    expect(revealItems(session, "main", ["gone"])).toBe(false);
    expect(session.selection.getState().reveal).toBeNull();
  });
});
