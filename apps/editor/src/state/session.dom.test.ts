// @vitest-environment happy-dom
import { buildDoc, createMockRegistry } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { MOCK_DEFINITIONS } from "@sonobe/engine/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { createDialogStore } from "./dialogs.ts";
import { createEditorSession, type EditorSession } from "./session.ts";

const registry = createPatchRegistry({ definitions: MOCK_DEFINITIONS });
let session: EditorSession | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
  document.body.innerHTML = "";
});

describe("editor session in the DOM", () => {
  it("answers viewer.layerBounds from the runtime while a viewer is attached", async () => {
    const doc = buildDoc({ layers: [{ id: "card", type: "rectangle", props: { position: [0, 0], size: [200, 200] } }] }, createMockRegistry());
    const scheduler = createManualScheduler();
    session = createEditorSession({ host: null, dialogStore: createDialogStore(), registry, document: doc, autoplay: false, scheduler, textMeasurer: "approximate", platform: null });
    expect(session.bounds.methods()).toEqual([]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const viewer = session.runtime.attachRenderer(container, { captureInput: false });
    scheduler.frame();
    expect(session.bounds.methods()).toEqual(["viewer.layerBounds"]);
    vi.spyOn(viewer.renderer.elementForKey("card")!, "getBoundingClientRect").mockReturnValue({ x: 1, y: 2, left: 1, top: 2, width: 30, height: 40, right: 31, bottom: 42, toJSON: () => ({}) } as DOMRect);
    expect(await session.bounds.measure("viewer.layerBounds", { layerId: "card" })).toMatchObject({ x: 1, y: 2, width: 30, height: 40 });
    const panel = session.bounds.register("viewer.layerBounds", () => ({ x: 9, y: 9, width: 9, height: 9 }));
    expect(await session.bounds.measure("viewer.layerBounds", { layerId: "card" })).toEqual({ x: 9, y: 9, width: 9, height: 9 });
    panel();
    viewer.dispose();
    expect(session.bounds.methods()).toEqual([]);
  });
});
