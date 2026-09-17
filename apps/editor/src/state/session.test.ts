import { COMPONENT_INSTANCE_LAYER_TYPE, createEmptyDocument } from "@sonobe/core";
import { buildDoc, defineMock, MOCK_DEFINITIONS, port } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { createBrowserHost, createMemoryProjectStorage } from "../host/browserHost.ts";
import { createDesktopHost } from "../host/desktopHost.ts";
import type { DesktopHostApi } from "../host/types.ts";
import type { MuteState } from "../runtime/platform.ts";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { createMemoryTrustPersistence } from "../runtime/scriptTrust.ts";
import { createDialogStore } from "./dialogs.ts";
import { getRegistry } from "./registry.ts";
import { createEditorSession, createTemplateDocument, type EditorSession } from "./session.ts";

const js = defineMock({ type: "javascript", name: "JavaScript", inputs: [], outputs: [port("output", "number")], evaluate: (ctx) => ctx.output("output", 42) });
const registry = createPatchRegistry({ definitions: [...MOCK_DEFINITIONS, js] });
const headless = () => ({ autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" as const, platform: null, registry });

function fakeApi(extra: Partial<DesktopHostApi> = {}): DesktopHostApi {
  return {
    platform: "darwin",
    version: "0.0.0",
    openProjectDialog: async () => null,
    saveProjectDialog: async () => null,
    readProject: async () => ({ files: {}, binaries: {} }),
    writeProject: async () => undefined,
    watchProject: () => () => undefined,
    revealInFinder: () => undefined,
    recentProjects: async () => [],
    onCommand: () => () => undefined,
    onOpenProject: () => () => undefined,
    commands: () => [],
    setDocumentEdited: () => undefined,
    setTitle: () => undefined,
    rpc: { handle: () => () => undefined, fail: () => undefined },
    getMcpStatus: async () => ({}),
    ...extra,
  };
}

const sessions: EditorSession[] = [];
const track = (session: EditorSession) => {
  sessions.push(session);
  return session;
};

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
});

describe("editor session", () => {
  it("asks about unsaved changes through the dialog service", async () => {
    const dialogs = createDialogStore();
    const session = track(createEditorSession({ host: null, dialogStore: dialogs, document: createEmptyDocument(), ...headless() }));
    expect(session.dialogs).toBe(dialogs);
    expect(await session.confirmDiscardChanges("new")).toBe(true);
    session.document.getState().apply([{ op: "addLayer", layer: { type: "rectangle", name: "Card" } }], { label: "Add Card" });

    const declined = session.confirmDiscardChanges("open");
    const request = dialogs.getState().queue[0]!;
    expect(request).toMatchObject({ kind: "choose", options: { title: 'Save changes to "Untitled"?', actions: [{ value: "save", variant: "primary" }, { value: "discard", variant: "danger" }, { value: "cancel" }] } });
    dialogs.getState().dismiss(request.id);
    expect(await declined).toBe(false);

    const replacing = session.newProject({ name: "Fresh", device: "iphone-se" });
    await vi.waitFor(() => expect(dialogs.getState().queue).toHaveLength(1));
    dialogs.getState().settle(dialogs.getState().queue[0]!.id, "discard");
    expect(await replacing).toBe(true);
    expect(session.document.getState()).toMatchObject({ dirty: false, projectPath: null, canUndo: false, doc: { project: { name: "Fresh", device: { preset: "iphone-se" } } } });
  });

  it("creates documents from templates", () => {
    const real = getRegistry();
    expect(createTemplateDocument(real, { name: "Blank", device: "iphone-se" }).project).toMatchObject({ name: "Blank", device: { preset: "iphone-se" } });
    expect(createTemplateDocument(real).project.name).toBe("Untitled");
    const demo = createTemplateDocument(real, { template: "demo", name: "Demo Copy", device: "android-large" });
    expect(demo.project).toMatchObject({ name: "Demo Copy", device: { preset: "android-large" } });
    expect(demo.components.main!.layers.length).toBeGreaterThan(0);
    expect(() => createTemplateDocument(real, { template: "poster" as never })).toThrow("template");
    expect(() => createTemplateDocument(real, { device: "toaster" })).toThrow("device");
  });

  it("pushes revisions to the desktop once per burst of changes, and follows the host's mute", async () => {
    const notify = vi.fn();
    const mute = createStore<MuteState>()(() => ({ muted: false, reason: null }));
    const session = track(createEditorSession({ host: createDesktopHost(fakeApi({ notifyDocumentChanged: notify, muted: true })), dialogStore: createDialogStore(), document: createEmptyDocument(), mute, ...headless() }));
    expect(mute.getState()).toEqual({ muted: true, reason: "host" });
    const add = (name: string) => session.document.getState().apply([{ op: "addLayer", layer: { type: "rectangle", name } }], { label: `Add ${name}` });
    add("A");
    add("B");
    expect(notify).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notify).toHaveBeenCalledTimes(1);
    // The Edit menu's titles travel with the revision.
    expect(notify).toHaveBeenCalledWith(2, { undo: "Undo Add B", redo: "Redo" });
  });

  it("keeps trust for prototypes the person saves, and asks before running someone else's scripts", async () => {
    const storage = createMemoryProjectStorage();
    const persistence = createMemoryTrustPersistence();
    const host = createBrowserHost({ storage, channelName: null, recentKey: null, fileSystemAccess: false, dialogs: { promptName: async () => "Scripted" } });
    const session = track(createEditorSession({ host, dialogStore: createDialogStore(), document: createEmptyDocument(), trustPersistence: persistence, ...headless() }));
    session.document.getState().apply([{ op: "addPatch", patch: { id: "js_1", type: "javascript", ui: { x: 0, y: 0 } } }], { label: "Add script" });
    expect(session.scriptTrust.allowed()).toBe(true);
    expect((await session.document.getState().save()).ok).toBe(true);
    expect(persistence.isTrusted("browser:Scripted")).toBe(true);
    expect(session.scriptTrust.getState()).toMatchObject({ required: true, trusted: true, projectPath: "browser:Scripted" });

    const dialogs = createDialogStore();
    const other = track(createEditorSession({ host: createBrowserHost({ storage, channelName: null, recentKey: null, fileSystemAccess: false }), dialogStore: dialogs, document: createEmptyDocument(), trustPersistence: createMemoryTrustPersistence(), ...headless() }));
    expect((await other.openProject("browser:Scripted")).ok).toBe(true);
    expect(other.scriptTrust.getState()).toMatchObject({ required: true, trusted: false, scriptCount: 1 });
    const asking = other.runtime.requestScriptTrust();
    await vi.waitFor(() => expect(dialogs.getState().queue[0]).toMatchObject({ kind: "choose", options: { title: 'Run the scripts in "Scripted"?', actions: [{ value: "trust" }, { value: "cancel" }] } }));
    dialogs.getState().settle(dialogs.getState().queue[0]!.id, "trust");
    expect(await asking).toBe(true);
    expect(other.scriptTrust.getState().trusted).toBe(true);
  });

  it("points live values at the component being edited", () => {
    const doc = buildDoc(
      {
        components: [{ id: "card", kind: "layerComponent", size: [100, 100], patches: { toggle: { type: "switch" } } }],
        layers: [{ id: "card_1", type: COMPONENT_INSTANCE_LAYER_TYPE, name: "Card", component: "card" }],
      },
      registry,
    );
    const session = track(createEditorSession({ host: null, dialogStore: createDialogStore(), document: doc, ...headless() }));
    expect(session.runtime.state.getState().scope).toBe("");
    session.selection.getState().enterComponent("card");
    expect(session.runtime.state.getState().scope).toBe("card_1");
    session.runtime.stepFrame();
    expect(session.runtime.readValue("toggle.on")).toBe(false);
    session.selection.getState().exitComponent();
    expect(session.runtime.state.getState().scope).toBe("");
    expect(session.runtime.readValue("toggle.on")).toBeUndefined();
  });
});
