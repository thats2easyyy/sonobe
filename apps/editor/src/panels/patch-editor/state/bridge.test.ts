// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../../runtime/scheduler.ts";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { getRegistry } from "../../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../../state/session.ts";
import { instanceChoiceKey } from "../model/instances.ts";
import { patchEditorBridge } from "./bridge.ts";

const registry = getRegistry();
let session: EditorSession;

beforeEach(() => {
  session = createEditorSession({ host: null, registry, document: createDemoDocument(registry), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
});

afterEach(() => {
  session.dispose();
});

describe("patchEditorBridge", () => {
  it("forgets the watched copy and instance choices when another prototype replaces the document", () => {
    const bridge = patchEditorBridge(session);
    bridge.getState().watchCopy(7);
    bridge.getState().chooseInstance(instanceChoiceKey("main", "card"), "card_2");
    session.document.getState().newDocument();
    expect(bridge.getState().watchedCopy).toBeNull();
    expect(bridge.getState().instanceChoices).toEqual({});

    bridge.getState().watchCopy(3);
    session.document.getState().replaceDocument(createDemoDocument(registry), { projectPath: null, saved: true, label: "Started lesson" });
    expect(bridge.getState().watchedCopy).toBeNull();
  });

  it("keeps them through edits and a reload of the same project from disk", () => {
    const bridge = patchEditorBridge(session);
    bridge.getState().watchCopy(2);
    bridge.getState().chooseInstance(instanceChoiceKey("main", "card"), "card_2");
    const applied = session.document.getState().apply([{ op: "addLayer", layer: { id: "dot", type: "oval", name: "Dot" } }], { label: "Add dot" });
    expect(applied.ok).toBe(true);
    session.document.getState().replaceDocument(session.document.getState().doc, { keepHistory: true, saved: true, kind: "reload" });
    expect(bridge.getState().watchedCopy).toBe(2);
    expect(bridge.getState().instanceChoices).toEqual({ [instanceChoiceKey("main", "card")]: "card_2" });
  });
});
