import { applyOps, createEmptyDocument, type Op } from "@sonobe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { createAssistantStore } from "./assistantStore.ts";
import { EXPLAIN_COMMAND_ID, explainCommand, explainSelection } from "./commands.ts";
import { createAssistantController } from "./controller.ts";
import { selectionKey } from "./selectionContext.ts";
import { fakeAssistantHost } from "./testing.ts";

const registry = getRegistry();
let session: EditorSession;

beforeEach(() => {
  const ops: Op[] = [
    { op: "addLayer", layer: { id: "level_line", type: "rectangle", name: "Level Line", props: {} } },
    { op: "addPatch", patch: { id: "flight_timer", type: "wait", name: "Flight Timer", inputs: {} } },
  ];
  const built = applyOps(createEmptyDocument({ name: "Camera Demo" }), ops, { registry });
  if (!built.ok) throw new Error(built.errors[0]?.message);
  session = createEditorSession({ host: null, registry, document: built.doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
});

afterEach(() => session.dispose());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(options: Parameters<typeof fakeAssistantHost>[0] = { key: "sk-ant-api03-abcdefghijklmnop3f9a" }) {
  const host = fakeAssistantHost(options);
  const store = createAssistantStore({ persistModel: false });
  const controller = createAssistantController(host, store);
  return { host, store, controller };
}

describe("Explain with Claude", () => {
  it("is ⌘E, and needs something selected", () => {
    const command = explainCommand(session);
    expect(command).toMatchObject({ id: EXPLAIN_COMMAND_ID, title: "Explain with Claude", shortcut: "Mod+E", disabledReason: "Select a layer or a patch first" });
    expect(command.when!({} as never)).toBe(false);
    session.selection.getState().select({ patches: ["flight_timer"] });
    expect(command.when!({} as never)).toBe(true);
  });

  it("opens the chat and asks about the selection, which goes with the message", async () => {
    const { host, store, controller } = setup();
    session.selection.getState().select({ patches: ["flight_timer"] });
    expect(explainSelection(session, { store, controller })).toBe(true);
    expect(store.getState()).toMatchObject({ open: true, setup: false, focusRequest: 1 });
    await flush();
    const selection = { component: { id: session.currentComponentId(), name: "Main" }, items: [{ kind: "patch", id: "flight_timer", name: "Flight Timer", type: "wait" }] };
    expect(host.sent).toEqual([{ text: "What does this do, and how does it work?", model: store.getState().model, selection }]);
    expect(store.getState().items[0]).toMatchObject({ kind: "user", text: "What does this do, and how does it work?", selection });

    session.selection.getState().select({ patches: ["flight_timer"], layers: ["level_line"] });
    explainSelection(session, { store, controller });
    await flush();
    expect(host.sent[1]).toMatchObject({ text: "What do these do, and how do they work together?", selection: { items: [{ id: "flight_timer" }, { id: "level_line" }] } });
  });

  it("puts back a selection the person had taken off the message", async () => {
    const { store, controller } = setup();
    session.selection.getState().select({ patches: ["flight_timer"] });
    store.getState().setSelectionOff(selectionKey({ component: { id: session.currentComponentId(), name: "Main" }, items: [{ kind: "patch", id: "flight_timer", name: "Flight Timer", type: "wait" }] }));
    explainSelection(session, { store, controller });
    expect(store.getState().selectionOff).toBeNull();
    await flush();
  });

  it("opens the setup instead of asking when the Assistant has no key yet", async () => {
    const { host, store, controller } = setup({});
    session.selection.getState().select({ patches: ["flight_timer"] });
    expect(explainSelection(session, { store, controller })).toBe(true);
    await flush();
    // The status was read to find out, and nothing was sent: no question with an error under it once the key is in.
    expect(store.getState()).toMatchObject({ open: true, status: { hasKey: false }, items: [], running: false });
    expect(host.sent).toEqual([]);

    // With a key the same press asks.
    await controller.saveKey("sk-ant-api03-abcdefghijklmnop3f9a");
    explainSelection(session, { store, controller });
    await flush();
    expect(host.sent).toHaveLength(1);
  });

  it("only opens the chat while a reply is running, and does nothing with nothing selected", async () => {
    const { host, store, controller } = setup();
    expect(explainSelection(session, { store, controller })).toBe(false);
    expect(store.getState().open).toBe(false);

    store.setState({ running: true });
    session.selection.getState().select({ layers: ["level_line"] });
    expect(explainSelection(session, { store, controller })).toBe(true);
    expect(store.getState().open).toBe(true);
    await flush();
    expect(host.sent).toEqual([]);
  });
});
