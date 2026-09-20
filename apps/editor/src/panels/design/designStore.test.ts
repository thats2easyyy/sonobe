import { applyOps, createEmptyDocument, type Op, type StyleDigest } from "@sonobe/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { assistantStore, initialAssistantData } from "../assistant/assistantStore.ts";
import { sharedAssistantController } from "../assistant/controller.ts";
import { fakeAssistantHost, usage } from "../assistant/testing.ts";
import type { AssistantEvent, AssistantImported } from "../assistant/types.ts";
import { activeDraft, attachDesign, designStore, initialDesignData, reduceDesignEvent, runReply, sendDesign, type DesignData, type DesignRequest } from "./designStore.ts";

// The digest is packages/core's (styles.test.ts); canvasContext only passes it on.
vi.mock("@sonobe/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sonobe/core")>();
  return {
    ...actual,
    styleDigest: (_doc: unknown, component = "main"): StyleDigest => ({ component, layers: 0, colors: [], fonts: [], fontSizes: [], radii: [], shadows: [] }),
    formatStyleDigest: (d: StyleDigest) => `styles ${d.component} (no layers yet)`,
  };
});

type Draft = Extract<AssistantEvent, { type: "design_draft" }>;
const draft = (offset: number, append: string, extra: Partial<Draft> = {}): Draft => ({ type: "design_draft", runId: "r1", turn: 1, toolUseId: "t1", offset, append, done: false, ...extra });

function fold(events: AssistantEvent[], start: Partial<DesignData> = {}, now = 1000): DesignData {
  let state: DesignData = { ...initialDesignData(), ...start };
  for (const event of events) state = { ...state, ...reduceDesignEvent(state, event, now) };
  return state;
}

const context = { component: { id: "main", name: "Main", size: [402, 874] as [number, number] }, screens: [] };
const pending = (extra: Partial<DesignRequest> = {}): DesignRequest => ({ runId: null, text: "a checkout", context, selection: [], ...extra });
const imported = (extra: Partial<AssistantImported> = {}): AssistantImported => ({ docId: "d1", screenId: "checkout", txnId: null, name: "Checkout", replaced: null, dropped: [], droppedCount: 0, lostConnections: 0, ...extra });
const finished = (toolUseId: string, extra: Partial<Extract<AssistantEvent, { type: "tool_finished" }>> = {}): AssistantEvent => ({ type: "tool_finished", runId: "r1", toolUseId, name: "import_design", status: "done", detail: "Imported “Checkout”", changedDocument: true, ...extra });

describe("reduceDesignEvent", () => {
  it("walks a draft from writing to adding to added", () => {
    const html = "<html><body><h1>Checkout</h1></body></html>";
    let state = fold([draft(0, html.slice(0, 12), { fields: { name: "Checkout" } }), draft(12, html.slice(12, 30))], {}, 1000);
    expect(state.drafts).toEqual([{ runId: "r1", turn: 1, toolUseId: "t1", html: html.slice(0, 30), fields: { name: "Checkout" }, status: "writing", since: 1000, progress: null, error: null, resync: false }]);
    expect(activeDraft(state, 5000)?.toolUseId).toBe("t1");

    state = fold([draft(30, html.slice(30), { done: true, html, fields: { name: "Checkout", width: 402 } })], state, 2000);
    expect(state.drafts[0]).toMatchObject({ html, status: "adding", since: 2000, fields: { name: "Checkout", width: 402 } });

    state = fold([{ type: "tool_progress", runId: "r1", toolUseId: "t1", detail: "Downloading images: 3 of 7" }], state);
    expect(state.drafts[0]?.progress).toBe("Downloading images: 3 of 7");

    state = fold([finished("t1", { imported: imported() })], state, 3000);
    expect(state.drafts[0]).toMatchObject({ status: "added", since: 3000, progress: null, error: null });
    // It fades out for 400 ms, then leaves the canvas.
    expect(activeDraft(state, 3399)?.toolUseId).toBe("t1");
    expect(activeDraft(state, 3400)).toBeNull();
  });

  it("waits for done's html after an append at the wrong offset", () => {
    const html = "<html><body>0123456789</body></html>";
    let state = fold([draft(0, html.slice(0, 10)), draft(14, html.slice(14, 20))]);
    expect(state.drafts[0]).toMatchObject({ html: html.slice(0, 10), resync: true });
    // Later appends don't build on the gap.
    state = fold([draft(20, html.slice(20, 26))], state);
    expect(state.drafts[0]).toMatchObject({ html: html.slice(0, 10), resync: true });
    state = fold([draft(26, "", { done: true, html })], state);
    expect(state.drafts[0]).toMatchObject({ html, resync: false, status: "adding" });
    // Late appends after done change nothing.
    expect(reduceDesignEvent(state, draft(0, "x"), 1)).toEqual({});
  });

  it("drops a retried turn's drafts", () => {
    const state = fold([
      draft(0, "<html>", { turn: 1, toolUseId: "old" }),
      draft(0, "<html>", { turn: 2, toolUseId: "t2" }),
      draft(0, "<html>", { turn: 2, toolUseId: "t3", done: true, html: "<html>" }),
      draft(0, "<p>", { runId: "r2", turn: 2, toolUseId: "other" }),
      { type: "turn_started", runId: "r1", turn: 2 },
    ]);
    expect(state.drafts.map((d) => d.toolUseId)).toEqual(["old", "other"]);
    expect(reduceDesignEvent(state, { type: "turn_started", runId: "r1", turn: 3 }, 1)).toEqual({});
  });

  it("fails a draft cut off by max_tokens, and stops one on Stop", () => {
    const tooLong = fold([draft(0, "<html>"), { type: "run_finished", runId: "r1", outcome: "max_tokens", usage: usage() }]);
    expect(tooLong.drafts[0]).toMatchObject({ status: "failed", error: "too_long" });
    const stopped = fold([draft(0, "<html>"), draft(6, "", { done: true, html: "<html>" }), { type: "run_finished", runId: "r1", outcome: "stopped", usage: usage() }]);
    expect(stopped.drafts[0]).toMatchObject({ status: "stopped", error: null });
    // Another run's finish leaves the draft writing.
    expect(fold([draft(0, "<html>"), { type: "run_finished", runId: "r9", outcome: "stopped", usage: usage() }]).drafts[0]?.status).toBe("writing");
  });

  it("stops a declined replace, and fails an import that didn't work with its detail", () => {
    const declined = fold([draft(0, "<html>", { done: true, html: "<html>" }), finished("t1", { status: "declined", detail: "You kept “Home”", changedDocument: false })]);
    expect(declined.drafts[0]).toMatchObject({ status: "stopped", error: null });
    const failed = fold([draft(0, "<html>", { done: true, html: "<html>" }), finished("t1", { status: "error", detail: "The page didn't load", changedDocument: false })]);
    expect(failed.drafts[0]).toMatchObject({ status: "failed", error: "The page didn't load" });
    // Other tools' results aren't drafts.
    expect(reduceDesignEvent(failed, { type: "tool_finished", runId: "r1", toolUseId: "t1", name: "update_layers", status: "done", detail: "", changedDocument: true }, 1)).toEqual({});
  });

  it("keeps the last five drafts, whatever sent them", () => {
    const state = fold(Array.from({ length: 7 }, (_, i) => draft(0, "<p>", { runId: i % 2 ? "r1" : "mcp:claude-code", toolUseId: `t${i}` })));
    expect(state.drafts.map((d) => d.toolUseId)).toEqual(["t2", "t3", "t4", "t5", "t6"]);
    expect(activeDraft(state, 1)?.toolUseId).toBe("t6");
  });

  it("follows the box's request through its run", () => {
    let state = fold([{ type: "run_started", runId: "r1", model: "claude-sonnet-5" }], { request: pending() });
    expect(state.request?.runId).toBe("r1");
    state = fold(
      [
        { type: "notice", runId: "r1", tone: "warn", message: "Claude is set to Read only in Settings, so the Assistant can look but not edit. Change it in Settings → Claude." },
        finished("t1", { imported: imported() }),
        { type: "run_finished", runId: "r1", outcome: "error", error: { code: "network", message: "Sonobe couldn't reach the Anthropic API." }, usage: usage() },
      ],
      state,
    );
    expect(state.request).toMatchObject({ runId: "r1", imported: 1, readOnly: true, outcome: "error", error: { code: "network" } });
    // A run the chat sheet started leaves the box's request behind.
    expect(fold([{ type: "run_started", runId: "r2", model: "claude-sonnet-5" }], state).request).toBeNull();
    expect(fold([{ type: "run_started", runId: "r2", model: "claude-sonnet-5" }]).request).toBeNull();
  });
});

describe("runReply", () => {
  it("is the run's last text, cut at 280 characters", () => {
    const items = [
      { kind: "assistant" as const, id: "a1", runId: "r1", turn: 1, text: "Let me look.", thinking: "", tools: [] },
      { kind: "assistant" as const, id: "a2", runId: "r1", turn: 2, text: "", thinking: "", tools: [] },
      { kind: "assistant" as const, id: "a3", runId: "r2", turn: 1, text: "Other run", thinking: "", tools: [] },
    ];
    expect(runReply({ items }, "r1")).toBe("Let me look.");
    expect(runReply({ items }, null)).toBe("");
    const long = runReply({ items: [{ ...items[0]!, text: "word ".repeat(100) }] }, "r1");
    expect(long).toHaveLength(280);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("attachDesign and sendDesign", () => {
  const host = fakeAssistantHost({ key: "sk-ant-api03-abcdefgh1234" });
  let session: EditorSession;
  let detach: () => void = () => undefined;

  beforeAll(() => {
    // The shared controller folds the same host's events into assistantStore, as in the app.
    vi.stubGlobal("window", { __sonobeFakeAssistant: host });
    sharedAssistantController();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    designStore.setState(initialDesignData());
    assistantStore.setState(initialAssistantData());
    const built = applyOps(
      createEmptyDocument({ name: "Shop" }),
      [
        { op: "addLayer", layer: { id: "home", type: "group", name: "Home", props: { size: [402, 874] } } },
        { op: "addLayer", parent: "home", layer: { id: "card", type: "rectangle", name: "Card", props: { position: [16, 120], size: [370, 200] } } },
        { op: "addComponent", component: { id: "badge", name: "Badge", kind: "layerComponent" } },
      ],
      { registry: getRegistry() },
    );
    expect(built.ok).toBe(true);
    session = createEditorSession({ host: null, document: built.doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  });

  afterEach(() => {
    detach();
    session.dispose();
  });

  /** What import_design does in the app: one apply, as the Assistant. */
  function importScreen(ops: Op[]): string {
    const result = session.document.getState().apply(ops, { label: "Import “Checkout”", author: { kind: "agent", name: "Assistant" } });
    expect(result.ok).toBe(true);
    return session.document.getState().lastChange!.txnId!;
  }
  const addCheckout = (component?: string): Op => ({ op: "addLayer", ...(component ? { component } : {}), layer: { id: "checkout", type: "group", name: "Checkout", props: { size: [402, 874] } } });

  it("selects and reveals a new screen, names the one it covers, and takes Claude's closing words", () => {
    detach = attachDesign(session, host);
    host.emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
    host.emit({ type: "turn_started", runId: "r1", turn: 1 });
    host.emitDesign("r1", "t1", "<html><body>Checkout</body></html>", { fields: { name: "Checkout" } });
    expect(designStore.getState().drafts[0]).toMatchObject({ status: "adding", html: "<html><body>Checkout</body></html>" });

    const txnId = importScreen([addCheckout()]);
    host.emit(finished("t1", { imported: imported({ txnId }) }));
    expect(session.selection.getState().layers).toEqual(["checkout"]);
    expect(session.selection.getState().reveal).toMatchObject({ component: "main", ids: ["checkout"] });
    expect(designStore.getState().result).toEqual({ kind: "added", layerId: "checkout", component: "main", name: "Checkout", txnId, dropped: [], droppedCount: 0, coveredScreen: "Home", reply: "" });

    host.emit({ type: "turn_started", runId: "r1", turn: 2 });
    host.emit({ type: "text_delta", runId: "r1", turn: 2, delta: "Added a checkout with Apple Pay." });
    host.emit({ type: "run_finished", runId: "r1", outcome: "completed", usage: usage() });
    expect(designStore.getState().result?.reply).toBe("Added a checkout with Apple Pay.");
  });

  it("leaves the selection alone when the person changed it during the run", () => {
    detach = attachDesign(session, host);
    host.emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
    session.selection.getState().select({ layers: ["card"] });
    const txnId = importScreen([addCheckout()]);
    host.emit(finished("t1", { imported: imported({ txnId }) }));
    expect(session.selection.getState().layers).toEqual(["card"]);
    expect(session.selection.getState().reveal).toBeNull();
    expect(designStore.getState().result?.layerId).toBe("checkout");
  });

  it("doesn't select a screen that landed in another component", () => {
    detach = attachDesign(session, host);
    host.emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
    const txnId = importScreen([addCheckout("badge")]);
    host.emit(finished("t1", { imported: imported({ txnId }) }));
    expect(session.selection.getState().layers).toEqual([]);
    expect(designStore.getState().result).toMatchObject({ layerId: "checkout", component: "badge", coveredScreen: null });
  });

  it("reports a replace as an update with what it dropped", () => {
    detach = attachDesign(session, host);
    session.selection.getState().select({ layers: ["card"] });
    host.emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
    const txnId = importScreen([{ op: "updateLayer", id: "card", name: "Promo Card" }]);
    host.emit(finished("t1", { imported: imported({ screenId: "card", txnId, name: "Card", replaced: "card", dropped: ["Promo Badge", "Divider"], droppedCount: 2 }) }));
    expect(designStore.getState().result).toMatchObject({ kind: "updated", layerId: "card", name: "Promo Card", dropped: ["Promo Badge", "Divider"], droppedCount: 2, coveredScreen: null });
    expect(session.selection.getState().layers).toEqual(["card"]);
  });

  it("lets the × on the chip pin a new screen until the selection changes", () => {
    detach = attachDesign(session, null);
    designStore.getState().setNewScreen(true);
    session.selection.getState().select({ layers: ["card"] });
    expect(designStore.getState().newScreen).toBe(false);
  });

  it("stops listening when detached", () => {
    attachDesign(session, host)();
    const listeners = host.listeners.size;
    host.emit(draft(0, "<html>"));
    expect(designStore.getState().drafts).toEqual([]);
    expect(listeners).toBe(1); // only the shared controller's
  });

  it("sends the box's text with the canvas context, and follows its run", async () => {
    detach = attachDesign(session, host);
    session.selection.getState().select({ layers: ["card"] });
    host.nextResult = (_request, emit) => {
      emit({ type: "run_started", runId: "r7", model: "claude-sonnet-5" });
      emit({ type: "turn_started", runId: "r7", turn: 1 });
      emit({ type: "text_delta", runId: "r7", turn: 1, delta: "Made it darker." });
      emit({ type: "run_finished", runId: "r7", outcome: "completed", usage: usage(10) });
      return { runId: "r7", outcome: "completed", usage: usage(10) };
    };
    await sendDesign(session, "  make it darker ", (id) => (id === "card" ? { x: 16, y: 120, width: 370, height: 200 } : null));
    const sent = host.sent.at(-1)!;
    expect(sent.text).toBe("make it darker");
    expect(sent.context).toEqual({
      component: { id: "main", name: "Main", size: [402, 874] },
      screens: [{ id: "home", name: "Home" }],
      target: { id: "card", name: "Card", type: "rectangle", frame: [16, 120, 370, 200], screen: { id: "home", name: "Home" } },
      styles: "styles main (no layers yet)",
    });
    expect(assistantStore.getState().items[0]).toMatchObject({ kind: "user", text: "make it darker", origin: "canvas" });
    expect(designStore.getState().request).toMatchObject({ runId: "r7", text: "make it darker", selection: ["card"], outcome: "completed" });
  });

  it("records why a send never started, and sends nothing while a reply runs", async () => {
    host.nextResult = () => ({ runId: "r8", outcome: "error", error: { code: "no_key", message: "Add your Anthropic API key to use the Assistant." }, usage: usage() });
    await sendDesign(session, "a checkout", () => null);
    expect(designStore.getState().request).toMatchObject({ runId: "r8", outcome: "error", error: { code: "no_key" } });

    const count = host.sent.length;
    assistantStore.setState({ running: true });
    await sendDesign(session, "another", () => null);
    await sendDesign(session, "   ", () => null);
    expect(host.sent).toHaveLength(count);
    expect(designStore.getState().request?.text).toBe("a checkout");
  });
});
