// @vitest-environment happy-dom
import { applyOps, type SonobeDocument } from "@sonobe/core";
import { afterEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../../runtime/scheduler.ts";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { getRegistry } from "../../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../../state/session.ts";
import { boundsOf, COMMENT_PADDING, rectsOverlap } from "../model/geometry.ts";
import { instanceChoiceKey } from "../model/instances.ts";
import { readNodePositions } from "@sonobe/core";
import { componentNodeBoxes, deriveGraph, documentObstacles, estimatePatchSize } from "@sonobe/core/graph";
import { createPatchEditorActions, type ActionDeps } from "./actions.ts";
import { patchEditorBridge } from "./bridge.ts";
import { createUiStore } from "./uiStore.ts";

const registry = getRegistry();
let session: EditorSession | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
});

function setup(doc: SonobeDocument = createDemoDocument(registry), componentId = "main", flow: ActionDeps["flow"] = () => null, reveal?: ActionDeps["reveal"]) {
  session = createEditorSession({ host: null, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  const s = session;
  const ui = createUiStore();
  const actions = createPatchEditorActions({ session: s, registry, componentId, ui, flow, pointer: () => null, openPicker: () => undefined, openInfo: () => undefined, ...(reveal ? { reveal } : {}) });
  return { s, actions, ui, main: () => s.document.getState().doc.components.main!, component: () => s.document.getState().doc.components[componentId]! };
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

  it("tells the view about every patch an insert adds, so it can pan to one that landed off screen", () => {
    const revealed: string[] = [];
    const { actions } = setup(undefined, "main", () => null, (id) => revealed.push(id));
    const id = actions.insertPatch("switch", { x: 262, y: 62 })!;
    expect(revealed).toEqual([id]);
    actions.insertPatch("no_such_patch", { x: 0, y: 0 });
    expect(revealed).toEqual([id]);
  });

  it("explains a refused cable at the drop point, with the converter as an action, and in a toast when nothing was dropped", () => {
    const { actions, ui, main } = setup();
    const before = Object.keys(main().patches).length;
    actions.explainConnection("heart_color.output", "card_shadow.start", { x: 900, y: 300 });
    expect(ui.getState().connectHint).toBeNull();
    actions.explainConnection("heart_color.output", "card_shadow.start", { x: 900, y: 300 }, { x: 640, y: 420 });
    const hint = ui.getState().connectHint!;
    expect(hint).toMatchObject({ client: { x: 640, y: 420 }, reason: expect.stringContaining("needs a number") });
    expect(hint.converter!.label).toMatch(/^Insert /);
    expect(Object.keys(main().patches)).toHaveLength(before);
    hint.converter!.insert();
    expect(Object.keys(main().patches)).toHaveLength(before + 1);
  });

  it("names patches, not ids, when a keyboard connect is refused, and anchors the hint where it says", () => {
    const { actions, ui } = setup();
    expect(actions.connect("like_spring.output", "like_spring.number", { x: 320, y: 240 })).toBe(false);
    const hint = ui.getState().connectHint!;
    expect(hint.client).toEqual({ x: 320, y: 240 });
    expect(hint.reason).not.toMatch(/like_spring|→/);
    expect(hint.reason).toContain("Like Spring");
  });

  it("replaces a patch with another type in place, in one undo step", () => {
    const { s, actions, main } = setup();
    const before = s.document.getState().doc;
    actions.replaceWith("zoom_spring", "classicAnimation");
    expect(main().patches.zoom_spring).toMatchObject({ type: "classicAnimation", name: "Zoom Spring", inputs: { number: { link: "zoomed.on" } } });
    expect(main().patches.photo_scale!.inputs.progress).toEqual({ link: "zoom_spring.output" });
    expect(s.selection.getState().patches).toEqual(["zoom_spring"]);
    expect(s.document.getState().undoLabel).toContain("You: Replace Zoom Spring with Classic Animation");
    expect(s.document.getState().undo().ok).toBe(true);
    expect(s.document.getState().doc).toStrictEqual(before);
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

  it("sizes nodes that haven't rendered yet with the layer names they show", () => {
    const built = applyOps(
      createDemoDocument(registry),
      [
        { op: "addLayer", layer: { id: "hero", type: "rectangle", name: "Onboarding Hero Card Title" } },
        { op: "addPatch", patch: { id: "press_hero", type: "interaction", inputs: { layer: { layer: "hero" } }, ui: { x: 2000, y: 0 } } },
      ],
      { registry },
    );
    expect(built.ok).toBe(true);
    // Off screen, so React Flow hasn't measured it: Comment Selection frames the estimate.
    const nodes = deriveGraph({ doc: built.doc, componentId: "main", registry }).nodes;
    const { s, actions, main } = setup(built.doc, "main", () => ({ getNodes: () => nodes, getEdges: () => [] }) as never);
    s.selection.getState().select({ patches: ["press_hero"] });
    const before = new Set(main().comments.map((c) => c.id));
    actions.commentSelection();
    const box = componentNodeBoxes(built.doc, registry, "main").get("press_hero")!;
    expect(main().comments.find((c) => !before.has(c.id))!.rect[2]).toBe(boundsOf([box], COMMENT_PADDING)!.width);
  });
});

describe("patch editor actions: components and variables", () => {
  const withComponent = () => applyOps(createDemoDocument(registry), [{ op: "createComponent", component: "main", name: "Heart Logic", patchIds: ["liked", "like_spring"] }], { registry }).doc;

  it("groups patches into a component and starts naming the component", () => {
    const { s, actions, ui, main } = setup();
    s.selection.getState().select({ patches: ["liked", "like_spring"] });
    actions.groupIntoComponent();
    const instance = s.selection.getState().patches[0]!;
    const componentId = main().patches[instance]!.component!;
    expect(ui.getState()).toMatchObject({ editingTitle: instance, namingComponent: componentId });
    actions.renameComponent(componentId, "Heart Logic");
    expect(s.document.getState().doc.components[componentId]!.name).toBe("Heart Logic");
    expect(main().patches[instance]!.name).toBe("Heart Logic");
    expect(s.document.getState().undoLabel).toBe("You: Rename component “Component” to “Heart Logic” (2 ops)");
    expect(s.document.getState().undo().ok).toBe(true);
    expect(s.document.getState().doc.components[componentId]!.name).toBe("Component");
    expect(main().patches[instance]!.name).toBe("Component");
  });

  it("leaves an instance the author named themselves alone when the component is renamed", () => {
    const { s, actions, main } = setup();
    s.selection.getState().select({ patches: ["liked", "like_spring"] });
    actions.groupIntoComponent();
    const instance = s.selection.getState().patches[0]!;
    const componentId = main().patches[instance]!.component!;
    actions.apply([{ op: "updatePatch", component: "main", id: instance, name: "Heart" }], "Rename patch");
    actions.renameComponent(componentId, "Heart Logic");
    expect(main().patches[instance]!.name).toBe("Heart");
    expect(s.document.getState().undoLabel).toBe("You: Rename component “Component” to “Heart Logic”");
  });

  it("publishes a port inside a component in one undo step, and ⌥P again unpublishes it", () => {
    const { s, actions, component } = setup(withComponent(), "heart_logic");
    expect(actions.publishPort("like_spring.bounciness", "in")).toBe(true);
    expect(component().interface.inputs.bounciness).toMatchObject({ name: "Bounciness", type: "number" });
    expect(component().patches.like_spring!.inputs.bounciness).toEqual({ link: "$in.bounciness" });
    expect(s.document.getState().undoLabel).toBe("You: Publish Like Spring · Bounciness (2 ops)");
    actions.togglePublish("like_spring.bounciness", "in");
    expect(component().interface.inputs.bounciness).toBeUndefined();
    expect(s.document.getState().undo().ok).toBe(true);
    expect(component().interface.inputs.bounciness).toBeDefined();
  });

  it("refuses to publish at the prototype's root with a teaching message", () => {
    const { actions, main } = setup();
    expect(actions.publishPort("zoom_spring.bounciness", "in")).toBe(false);
    expect(main().interface.inputs).toEqual({});
  });

  it("names new broadcasters, and jumps from a receiver to its broadcaster", () => {
    const { s, actions, main } = setup();
    const broadcaster = actions.insertPatch("variableBroadcaster", { x: 1400, y: 1400 })!;
    const name = main().patches[broadcaster]!.settings?.name;
    expect(name).toMatch(/^Variable( \d+)?$/);
    const receiver = actions.insertPatch("variableReceiver", { x: 1700, y: 1400 })!;
    actions.apply([{ op: "updatePatch", component: "main", id: receiver, settings: { name: name as string } }], "Pick variable");
    expect(actions.jumpToBroadcaster(receiver)).toBe(true);
    expect(s.selection.getState().patches).toEqual([broadcaster]);
    expect(s.selection.getState().reveal).toMatchObject({ component: "main", ids: [broadcaster] });
    const lonely = actions.insertPatch("variableReceiver", { x: 1700, y: 1700 })!;
    actions.apply([{ op: "updatePatch", component: "main", id: lonely, settings: { name: "nobody" } }], "Pick variable");
    expect(actions.jumpToBroadcaster(lonely)).toBe(false);
  });
});

