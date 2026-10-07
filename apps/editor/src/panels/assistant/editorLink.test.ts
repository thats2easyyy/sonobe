import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { layoutStore } from "../../shell/layoutStore.ts";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { assistantEditor, attachAssistantEditor, pointAtMention, showMention } from "./editorLink.ts";
import { mentionKey, type MentionTarget } from "./mentions.ts";

const registry = getRegistry();

function cameraDoc(): SonobeDocument {
  const ops: Op[] = [
    { op: "addKnob", knob: { id: "flight_time", name: "Flight Time", type: "number", value: 0.6 } },
    { op: "addComponent", component: { id: "swipe_card", name: "Swipe Card", kind: "patchComponent" } },
    { op: "addPatch", component: "swipe_card", patch: { id: "tilt", type: "multiply", name: "Tilt Angle", typeParam: "number", inputCount: 2, inputs: {} } },
    { op: "addLayer", layer: { id: "level_line", type: "rectangle", name: "Level Line", props: {} } },
    { op: "addLayer", layer: { id: "flash", type: "rectangle", name: "Flash", props: {} } },
    { op: "addPatch", patch: { id: "flight_timer", type: "wait", name: "Flight Timer", inputs: {} } },
    { op: "addPatch", patch: { id: "flight_ease", type: "curve", name: "Flight Easing", inputs: {} } },
    { op: "addPatch", patch: { id: "card_1", type: "component", component: "swipe_card", name: "Card", inputs: {} } },
    { op: "addComment", comment: { id: "note_1", text: "The photo's flight", rect: [0, 0, 300, 200] } },
  ];
  const result = applyOps(createEmptyDocument({ name: "Camera Demo" }), ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

let session: EditorSession;
let detach: (() => void) | null = null;

beforeEach(() => {
  layoutStore.getState().reset();
  session = createEditorSession({ host: null, registry, document: cameraDoc(), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
});

afterEach(() => {
  detach?.();
  detach = null;
  session.dispose();
  layoutStore.getState().reset();
});

const attach = () => (detach = attachAssistantEditor(session));
const apply = (ops: Op[]) => {
  const result = session.document.getState().apply(ops, { label: "test" });
  if (!result.ok) throw new Error(result.errors[0]?.message);
};
const main = () => session.document.getState().doc.project.root;
const patch = (id: string, component = main()): MentionTarget => ({ kind: "patch", id, component, name: id });
const layer = (id: string, component = main()): MentionTarget => ({ kind: "layer", id, component, name: id });

describe("attachAssistantEditor", () => {
  it("is empty without an editor, and again once it's detached", () => {
    expect(assistantEditor.getState()).toMatchObject({ selection: null, index: null });
    attach();
    expect(assistantEditor.getState().index).not.toBeNull();
    detach!();
    detach = null;
    expect(assistantEditor.getState()).toMatchObject({ selection: null, index: null });
    expect(assistantEditor.getState().selected.size).toBe(0);
  });

  it("follows the selection: its items, and which chips are selected", () => {
    attach();
    expect(assistantEditor.getState().selection).toBeNull();
    session.selection.getState().select({ patches: ["flight_timer"], layers: ["level_line"] });
    const { selection, selected } = assistantEditor.getState();
    expect(selection?.items.map((i) => `${i.kind}:${i.id}`)).toEqual(["patch:flight_timer", "layer:level_line"]);
    expect([...selected].sort()).toEqual([mentionKey(layer("level_line")), mentionKey(patch("flight_timer"))].sort());
    session.selection.getState().clear();
    expect(assistantEditor.getState().selection).toBeNull();
    expect(assistantEditor.getState().selected.size).toBe(0);
  });

  it("keeps the same index and selection through edits that change no name or id (a drag re-renders nothing in the chat)", () => {
    attach();
    session.selection.getState().select({ layers: ["flash"] });
    const before = assistantEditor.getState();
    let changes = 0;
    const stop = assistantEditor.subscribe(() => changes++);
    for (let x = 0; x < 20; x++) apply([{ op: "updateLayer", id: "flash", props: { position: [x, 0] } }]);
    stop();
    expect(changes).toBe(0);
    expect(assistantEditor.getState().index).toBe(before.index);
    expect(assistantEditor.getState().selection).toBe(before.selection);
  });

  it("makes a new index when a name changes, and the selection's chip follows", () => {
    attach();
    session.selection.getState().select({ layers: ["flash"] });
    const before = assistantEditor.getState();
    apply([{ op: "rename", id: "flash", name: "White Flash" }]);
    const after = assistantEditor.getState();
    expect(after.index).not.toBe(before.index);
    expect(after.index!.items.has("White Flash")).toBe(true);
    expect(after.selection?.items[0]).toMatchObject({ id: "flash", name: "White Flash" });
  });

  it("looks from the component the person is viewing", () => {
    attach();
    expect(assistantEditor.getState().index!.scope.current).toBe(main());
    session.selection.getState().enterComponent("swipe_card");
    expect(assistantEditor.getState().index!.scope.current).toBe("swipe_card");
    session.selection.getState().select({ patches: ["tilt"] });
    expect(assistantEditor.getState().selection).toMatchObject({ component: { id: "swipe_card", name: "Swipe Card" }, items: [{ id: "tilt" }] });
  });
});

describe("showMention", () => {
  it("selects a patch and brings the patch editor into view", () => {
    layoutStore.getState().setViewMode("canvas");
    expect(showMention(session, patch("flight_timer"))).toBe(true);
    expect(layoutStore.getState().viewMode).toBe("split");
    expect(session.selection.getState().patches).toEqual(["flight_timer"]);
    // Gentle: the person is reading along, so the patch editor keeps its zoom.
    expect(session.selection.getState().reveal).toMatchObject({ component: main(), ids: ["flight_timer"], gentle: true });
  });

  it("selects a layer and leaves the view as it is", () => {
    layoutStore.getState().setViewMode("canvas");
    expect(showMention(session, layer("level_line"))).toBe(true);
    expect(layoutStore.getState().viewMode).toBe("canvas");
    expect(session.selection.getState().layers).toEqual(["level_line"]);
    layoutStore.getState().setViewMode("patches");
    showMention(session, layer("flash"));
    expect(layoutStore.getState().viewMode).toBe("patches");
  });

  it("enters the component an item is in", () => {
    expect(showMention(session, patch("tilt", "swipe_card"))).toBe(true);
    expect(session.selection.getState().componentPath).toEqual([main(), "swipe_card"]);
    expect(session.selection.getState().patches).toEqual(["tilt"]);
  });

  it("opens the Knobs tab on a knob's row", () => {
    layoutStore.getState().setInspectorTab("properties");
    expect(showMention(session, { kind: "knob", id: "flight_time", name: "Flight Time" })).toBe(true);
    expect(layoutStore.getState().inspectorTab).toBe("knobs");
  });

  it("changes nothing for an item that's gone, or whose id now names something else", () => {
    session.selection.getState().select({ layers: ["flash"] });
    expect(showMention(session, patch("gone"))).toBe(false);
    expect(showMention(session, patch("level_line"))).toBe(false);
    expect(showMention(session, { kind: "patch", id: "flight_timer", name: "Flight Timer" })).toBe(false);
    expect(session.selection.getState().layers).toEqual(["flash"]);
    expect(session.selection.getState().patches).toEqual([]);
  });
});

describe("pointAtMention", () => {
  it("highlights an item of the viewed component, and lets go of only its own highlight", () => {
    pointAtMention(session, layer("level_line"));
    expect(session.selection.getState().hovered).toEqual({ kind: "layer", id: "level_line", component: main(), source: "assistant" });
    pointAtMention(session, patch("flight_timer"));
    expect(session.selection.getState().hovered).toMatchObject({ kind: "patch", id: "flight_timer", source: "assistant" });
    pointAtMention(session, null);
    expect(session.selection.getState().hovered).toBeNull();

    // The canvas's own hover isn't the chat's to clear.
    session.selection.getState().setHovered({ kind: "layer", id: "flash", component: main(), source: "canvas" });
    pointAtMention(session, null);
    expect(session.selection.getState().hovered?.source).toBe("canvas");
  });

  it("has nothing to highlight for a knob or an item in another component", () => {
    pointAtMention(session, layer("level_line"));
    pointAtMention(session, { kind: "knob", id: "flight_time", name: "Flight Time" });
    expect(session.selection.getState().hovered).toBeNull();
    pointAtMention(session, patch("tilt", "swipe_card"));
    expect(session.selection.getState().hovered).toBeNull();
  });

  it("lets go when the chat closes", () => {
    attach();
    assistantEditor.getState().point(layer("level_line"));
    expect(session.selection.getState().hovered?.source).toBe("assistant");
    detach!();
    detach = null;
    expect(session.selection.getState().hovered).toBeNull();
  });
});
