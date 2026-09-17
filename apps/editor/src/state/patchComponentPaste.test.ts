import { applyOps, createEmptyDocument } from "@sonobe/core";
import { afterEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { copySelection, pasteFragment } from "./editActions.ts";
import { getRegistry } from "./registry.ts";
import { createEditorSession, type EditorSession } from "./session.ts";

const registry = getRegistry();
let session: EditorSession | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
});

function start(): EditorSession {
  const doc = applyOps(
    createEmptyDocument(),
    [
      { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
      { op: "addPatch", patch: { id: "toggle", type: "switch", ui: { x: 0, y: 0 } } },
      { op: "addComponent", component: { id: "logic", name: "Logic", kind: "patchComponent" } },
    ],
    { registry },
  ).doc;
  session = createEditorSession({ host: null, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  return session;
}

describe("pasting into a patch component", () => {
  it("pastes the patches and leaves the layers out", () => {
    const s = start();
    s.selection.getState().select({ layers: ["card"], patches: ["toggle"] });
    const fragment = copySelection(s)!;
    s.selection.getState().enterComponent("logic");
    const result = pasteFragment(s, fragment);
    expect(result).toMatchObject({ ok: true, droppedLayers: 1 });
    const logic = s.document.getState().doc.components.logic!;
    expect(logic.layers).toEqual([]);
    expect(Object.values(logic.patches).map((p) => p.type)).toEqual(["switch"]);
  });

  it("explains instead of pasting when there are only layers", () => {
    const s = start();
    s.selection.getState().select({ layers: ["card"] });
    const fragment = copySelection(s)!;
    s.selection.getState().enterComponent("logic");
    const result = pasteFragment(s, fragment);
    expect(result).toMatchObject({ ok: false, message: "Patch components hold only patches, so layers can't be pasted here." });
    expect(s.document.getState().doc.components.logic!.layers).toEqual([]);
  });
});
