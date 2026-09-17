// @vitest-environment happy-dom
import { applyOps, type SonobeDocument } from "@sonobe/core";
import { afterEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../../runtime/scheduler.ts";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { getRegistry } from "../../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../../state/session.ts";
import { rectsOverlap } from "../model/geometry.ts";
import { instanceChoiceKey } from "../model/instances.ts";
import { readNodePositions } from "../model/meta.ts";
import { documentObstacles, estimatePatchSize } from "../model/placement.ts";
import { createPatchEditorActions } from "./actions.ts";
import { patchEditorBridge } from "./bridge.ts";
import { createUiStore } from "./uiStore.ts";

const registry = getRegistry();
let session: EditorSession | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
});

function setup(doc: SonobeDocument = createDemoDocument(registry)) {
  session = createEditorSession({ host: null, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  const s = session;
  const actions = createPatchEditorActions({ session: s, registry, componentId: "main", ui: createUiStore(), flow: () => null, pointer: () => null, openPicker: () => undefined, openInfo: () => undefined });
  return { s, actions, main: () => s.document.getState().doc.components.main! };
}

describe("patch editor actions", () => {
  it("saves layer target positions in component metadata with patch moves, in one undo step", () => {
    const { s, actions, main } = setup();
    actions.moveNodes(new Map([["@photo", { x: 1000.2, y: 30 }], ["zoomed", { x: 262, y: 60 }]]));
    expect(readNodePositions(main())).toEqual({ "@photo": { x: 1000, y: 30 } });
    expect(main().patches.zoomed!.ui).toMatchObject({ x: 262, y: 60 });
    expect(s.document.getState().undo().ok).toBe(true);
    expect(readNodePositions(main())).toEqual({});
    expect(main().patches.zoomed!.ui.x).toBe(260);
  });

  it("inserts patches in free space instead of on top of other patches or across comment frames", () => {
    const { s, actions, main } = setup();
    const id = actions.insertPatch("switch", { x: 262, y: 62 })!;
    const node = main().patches[id]!;
    const rect = { x: node.ui.x, y: node.ui.y, ...estimatePatchSize(s.document.getState().doc, registry, node) };
    const others = documentObstacles(s.document.getState().doc, { ...main(), patches: Object.fromEntries(Object.entries(main().patches).filter(([pid]) => pid !== id)) }, registry);
    expect(others.nodes.some((r) => rectsOverlap(r, rect))).toBe(false);
    const frames = others.comments ?? [];
    const straddles = frames.some((f) => rectsOverlap(f, rect) && !(rect.x >= f.x && rect.y >= f.y && rect.x + rect.width <= f.x + f.width && rect.y + rect.height <= f.y + f.height));
    expect(straddles).toBe(false);
    expect(s.selection.getState().patches).toEqual([id]);
    const exact = actions.insertPatch("switch", { x: 262, y: 62 }, { placement: "exact" })!;
    expect(main().patches[exact]!.ui).toMatchObject({ x: 262, y: 62 });
  });

  it("inserts a patch beside the port it connects to and connects it", () => {
    const { actions, main } = setup();
    const id = actions.insertPatch("transition", { x: 900, y: 40 }, { typeParam: "number", connect: { address: "zoom_spring.output", side: "out", portKey: "progress" }, placement: "right" })!;
    expect(main().patches[id]!.inputs.progress).toEqual({ link: "zoom_spring.output" });
    expect(main().patches[id]!.ui.x).toBeGreaterThanOrEqual(900);
  });

  it("remembers which instance you entered a component through", () => {
    const withComponent = applyOps(
      createDemoDocument(registry),
      [
        { op: "addComponent", component: { id: "press", name: "Press", kind: "patchComponent" } },
        { op: "addPatch", patch: { id: "press_1", type: "component", component: "press", ui: { x: 0, y: 900 } } },
        { op: "addPatch", patch: { id: "press_2", type: "component", component: "press", ui: { x: 0, y: 1100 } } },
      ],
      { registry },
    ).doc;
    const { s, actions } = setup(withComponent);
    expect(actions.enterComponent("press_2")).toBe(true);
    expect(s.selection.getState().componentPath).toEqual(["main", "press"]);
    expect(patchEditorBridge(s).getState().instanceChoices[instanceChoiceKey("main", "press")]).toBe("press_2");
    expect(actions.enterComponent("zoomed")).toBe(false);
  });

  it("asks to drive a layer property and hides undriven targets again", () => {
    const { s, actions } = setup();
    actions.driveLayerProp("photo", "opacity");
    actions.driveLayerProp("card", "rotation");
    expect(patchEditorBridge(s).getState().targets.main).toEqual(["@photo.opacity", "@card.rotation"]);
    expect(patchEditorBridge(s).getState().request?.address).toBe("@card.rotation");
    actions.removeLayerTargets("photo");
    expect(patchEditorBridge(s).getState().targets.main).toEqual(["@card.rotation"]);
    actions.connect("zoom_spring.output", "@card.rotation");
    expect(patchEditorBridge(s).getState().targets.main).toBeUndefined();
  });
});
