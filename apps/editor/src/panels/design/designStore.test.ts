import { applyOps, createEmptyDocument, formatStyleDigest, styleDigest, type Op } from "@sonobe/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignPreviewUpdate } from "../../host/types.ts";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { assistantStore, initialAssistantData } from "../assistant/assistantStore.ts";
import { sharedAssistantController } from "../assistant/controller.ts";
import { fakeAssistantHost, usage } from "../assistant/testing.ts";
import type { AssistantEvent, AssistantImported } from "../assistant/types.ts";
import {
  activeDraft,
  applyPreviewUpdate,
  attachDesign,
  designStore,
  dismissDraft,
  initialDesignData,
  liveMcpDraft,
  MCP_DRAFT_IDLE_MS,
  MCP_DRAFT_STALLED_MS,
  mcpDraftIdleAt,
  reduceDesignEvent,
  reducePreviewUpdate,
  runReply,
  sendDesign,
  type DesignData,
  type DesignDraft,
  type DesignRequest,
  type PreviewTarget,
} from "./designStore.ts";

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
    expect(state.drafts).toEqual([{ source: "assistant", key: "t1", runId: "r1", turn: 1, toolUseId: "t1", html: html.slice(0, 30), fields: { name: "Checkout" }, status: "writing", since: 1000, progress: null, error: null, resync: false }]);
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

describe("reducePreviewUpdate", () => {
  const CLAUDE_CODE = { id: "cc-1", label: "Claude Code", folder: "/Users/ava/code/noddit" };
  const AUTHOR = { kind: "agent" as const, name: "Claude" };
  const update = (extra: Partial<DesignPreviewUpdate> = {}): DesignPreviewUpdate => ({
    docId: "noddit",
    key: "cc-1",
    author: AUTHOR,
    client: CLAUDE_CODE,
    name: "Checkout",
    component: null,
    replace: null,
    width: null,
    height: null,
    position: null,
    html: "<html><body><h1>Checkout</h1>",
    status: "writing",
    draftRevision: 1,
    ...extra,
  });
  const at = (revision = 0, lastChange: PreviewTarget["lastChange"] = null): PreviewTarget => ({ docId: null, revision, lastChange });

  function play(updates: DesignPreviewUpdate[], start: Partial<DesignData> = {}, target = at(), now = 1000): DesignData {
    let state: DesignData = { ...initialDesignData(), ...start };
    for (const u of updates) state = { ...state, ...reducePreviewUpdate(state, u, now, target) };
    return state;
  }

  it("draws a session's draft as it grows, with its fields, and moves it to adding", () => {
    let state = play([update()]);
    expect(state.drafts).toEqual([
      {
        source: "mcp",
        key: "mcp:cc-1",
        runId: "",
        turn: 0,
        toolUseId: "",
        html: "<html><body><h1>Checkout</h1>",
        fields: { name: "Checkout" },
        status: "writing",
        since: 1000,
        progress: null,
        error: null,
        resync: false,
        mcp: { author: AUTHOR, client: CLAUDE_CODE, draftRevision: 1, touchedAt: 1000, addingFrom: null },
      },
    ]);
    state = play([update({ html: "<html><body><h1>Checkout</h1><p>Apple Pay</p>", draftRevision: 2, replace: "home", width: 402, position: [0, 20] })], state, at(), 2000);
    expect(state.drafts).toHaveLength(1);
    expect(state.drafts[0]).toMatchObject({ html: "<html><body><h1>Checkout</h1><p>Apple Pay</p>", fields: { name: "Checkout", replace: "home", width: 402, position: [0, 20] }, status: "writing", since: 1000, mcp: { draftRevision: 2, touchedAt: 2000 } });
    expect(activeDraft(state, 2000)?.key).toBe("mcp:cc-1");

    state = play([update({ draftRevision: 3, status: "adding" })], state, at(7), 3000);
    expect(state.drafts[0]).toMatchObject({ status: "adding", since: 3000, mcp: { draftRevision: 3, addingFrom: 7 } });
  });

  it("ends a cleared draft as added after its author's import, else as stopped, and lets it fade", () => {
    const adding = play([update(), update({ draftRevision: 2, status: "adding" })], {}, at(7));
    const importChange = { kind: "apply" as const, revision: 8, author: AUTHOR };
    const added = play([update({ draftRevision: 3, status: "cleared", html: null })], adding, at(8, importChange), 5000);
    expect(added.drafts[0]).toMatchObject({ status: "added", since: 5000, mcp: { draftRevision: 3 } });
    expect(activeDraft(added, 5399)?.key).toBe("mcp:cc-1");
    expect(activeDraft(added, 5400)).toBeNull();

    // Someone else's change, or none since it started adding, isn't its import.
    expect(play([update({ draftRevision: 3, status: "cleared", html: null })], adding, at(8, { ...importChange, author: { kind: "human", name: "You" } })).drafts[0]?.status).toBe("stopped");
    expect(play([update({ draftRevision: 3, status: "cleared", html: null })], adding, at(7, { ...importChange, revision: 7 })).drafts[0]?.status).toBe("stopped");
    // Cleared while writing (preview_design clear, or the draft expired).
    expect(play([update(), update({ draftRevision: 2, status: "cleared", html: null })], {}, at(8, importChange)).drafts[0]?.status).toBe("stopped");
    // Nothing to clear.
    expect(reducePreviewUpdate(initialDesignData(), update({ status: "cleared", html: null }), 1, at())).toEqual({});
    expect(reducePreviewUpdate(added, update({ draftRevision: 4, status: "cleared", html: null }), 1, at())).toEqual({});
  });

  it("goes back to writing when the import fails, and starts over after it ended", () => {
    let state = play([update(), update({ draftRevision: 2, status: "adding" }), update({ draftRevision: 3, html: "<p>Fixed</p>" })], {}, at(4), 1000);
    expect(state.drafts[0]).toMatchObject({ status: "writing", html: "<p>Fixed</p>", mcp: { addingFrom: null } });
    state = play([update({ draftRevision: 4, status: "cleared", html: null })], state);
    // The same session's next draft replaces the ended one and is the newest, whatever its revision.
    const other: DesignDraft = { source: "assistant", key: "t9", runId: "r1", turn: 1, toolUseId: "t9", html: "<p>Home</p>", fields: {}, status: "added", since: 1000, progress: null, error: null, resync: false };
    state = play([update({ draftRevision: 1, name: "Profile", html: "<p>Profile</p>" })], { drafts: [state.drafts[0]!, other] });
    expect(state.drafts.map((d) => [d.key, d.status])).toEqual([
      ["t9", "added"],
      ["mcp:cc-1", "writing"],
    ]);
  });

  it("ignores an older update and another document's", () => {
    const state = play([update({ draftRevision: 5, html: "<p>5</p>" })]);
    expect(reducePreviewUpdate(state, update({ draftRevision: 4, html: "<p>4</p>" }), 1, at())).toEqual({});
    expect(reducePreviewUpdate(state, update({ draftRevision: 4, status: "cleared", html: null }), 1, at())).toEqual({});
    expect(reducePreviewUpdate(state, update({ draftRevision: 5, html: "<p>5 again</p>" }), 1, at()).drafts?.[0]?.html).toBe("<p>5 again</p>");
    // A window that knows its document ignores another's.
    expect(reducePreviewUpdate(initialDesignData(), update({ docId: "shop" }), 1, { ...at(), docId: "noddit" })).toEqual({});
    expect(reducePreviewUpdate(initialDesignData(), update(), 1, { ...at(), docId: "noddit" }).drafts).toHaveLength(1);
  });

  it("keeps two sessions' drafts apart, and previews the newest draft of any source", () => {
    let state = play([update(), update({ key: "cd-1", client: { id: "cd-1", label: "Claude Desktop" }, name: "Profile" }), update({ draftRevision: 2, html: "<p>more</p>" })]);
    expect(state.drafts.map((d) => [d.key, d.fields.name, d.html])).toEqual([
      ["mcp:cc-1", "Checkout", "<p>more</p>"],
      ["mcp:cd-1", "Profile", "<html><body><h1>Checkout</h1>"],
    ]);
    expect(activeDraft(state, 1000)?.key).toBe("mcp:cd-1");
    // The Assistant's draft starts after them, so it's the one the canvas shows.
    state = { ...state, ...reduceDesignEvent(state, draft(0, "<html>"), 1000) };
    expect(activeDraft(state, 1000)?.key).toBe("t1");
    // The Assistant's events leave MCP drafts alone.
    state = { ...state, ...reduceDesignEvent(state, { type: "run_finished", runId: "r1", outcome: "stopped", usage: usage() }, 1000) };
    expect(state.drafts.map((d) => d.status)).toEqual(["writing", "writing", "stopped"]);
    expect(activeDraft(state, 1000)?.key).toBe("mcp:cd-1");
  });

  it("leaves the canvas once its session stops sending: 3 minutes while it's written, 15 while it's added", () => {
    expect(MCP_DRAFT_STALLED_MS).toBe(3 * 60_000);
    expect(MCP_DRAFT_IDLE_MS).toBe(15 * 60_000);
    const state = play([update()], {}, at(), 1000);
    expect(mcpDraftIdleAt(state.drafts[0]!)).toBe(1000 + MCP_DRAFT_STALLED_MS);
    expect(activeDraft(state, 1000 + MCP_DRAFT_STALLED_MS - 1)?.key).toBe("mcp:cc-1");
    expect(activeDraft(state, 1000 + MCP_DRAFT_STALLED_MS)).toBeNull();
    // Another update brings it back.
    expect(activeDraft(play([update({ draftRevision: 2 })], state, at(), 1000 + MCP_DRAFT_STALLED_MS), 1000 + MCP_DRAFT_STALLED_MS)?.key).toBe("mcp:cc-1");

    // Adding can take a capture and the import: it waits as long as the MCP server keeps the draft.
    const adding = play([update({ draftRevision: 2, status: "adding" })], state, at(), 1000);
    expect(activeDraft(adding, 1000 + MCP_DRAFT_IDLE_MS - 1)?.key).toBe("mcp:cc-1");
    expect(activeDraft(adding, 1000 + MCP_DRAFT_IDLE_MS)).toBeNull();
    // The Assistant's drafts end with its run, not on a clock.
    expect(mcpDraftIdleAt({ ...state.drafts[0]!, mcp: undefined })).toBeNull();
  });

  it("hides a session's draft when the person asks, until the session sends more", () => {
    designStore.setState({ ...initialDesignData(), ...play([update()], {}, at(), 1000) });
    try {
      expect(liveMcpDraft(designStore.getState(), 2000)?.key).toBe("mcp:cc-1");
      expect(dismissDraft("mcp:cc-1", 2000)).toBe(true);
      expect(designStore.getState().drafts[0]).toMatchObject({ status: "stopped", since: 2000 });
      // It fades out, then it's gone; there's nothing left to hide.
      expect(activeDraft(designStore.getState(), 2399)?.key).toBe("mcp:cc-1");
      expect(liveMcpDraft(designStore.getState(), 2000)).toBeNull();
      expect(dismissDraft("mcp:cc-1", 2100)).toBe(false);
      expect(dismissDraft("t1", 2100)).toBe(false);
      // The session's next update starts it over.
      designStore.setState(reducePreviewUpdate(designStore.getState(), update({ draftRevision: 2 }), 3000, at()));
      expect(liveMcpDraft(designStore.getState(), 3000)?.key).toBe("mcp:cc-1");
    } finally {
      designStore.setState(initialDesignData());
    }
  });

  it("reads the window's document when applied, so the import that cleared it counts as added", () => {
    designStore.setState(initialDesignData());
    const session = createEditorSession({ host: null, document: createEmptyDocument({ name: "Noddit" }), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
    try {
      expect(applyPreviewUpdate(session, update(), 1000)).toBe(true);
      expect(applyPreviewUpdate(session, update({ draftRevision: 2, status: "adding" }), 1100)).toBe(true);
      const applied = session.document.getState().apply([{ op: "addLayer", layer: { id: "checkout", type: "group", name: "Checkout" } }], { label: "imported Checkout", author: AUTHOR });
      expect(applied.ok).toBe(true);
      expect(applyPreviewUpdate(session, update({ draftRevision: 3, status: "cleared", html: null }), 1200)).toBe(true);
      expect(designStore.getState().drafts[0]).toMatchObject({ key: "mcp:cc-1", status: "added" });
      expect(applyPreviewUpdate(session, update({ draftRevision: 4, status: "cleared", html: null }), 1300)).toBe(false);
    } finally {
      session.dispose();
      designStore.setState(initialDesignData());
    }
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

  it("selects and reveals a new screen, and takes Claude's closing words", () => {
    detach = attachDesign(session, host);
    host.emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
    host.emit({ type: "turn_started", runId: "r1", turn: 1 });
    host.emitDesign("r1", "t1", "<html><body>Checkout</body></html>", { fields: { name: "Checkout" } });
    expect(designStore.getState().drafts[0]).toMatchObject({ status: "adding", html: "<html><body>Checkout</body></html>" });

    const txnId = importScreen([addCheckout()]);
    host.emit(finished("t1", { imported: imported({ txnId }) }));
    expect(session.selection.getState().layers).toEqual(["checkout"]);
    expect(session.selection.getState().reveal).toMatchObject({ component: "main", ids: ["checkout"] });
    expect(designStore.getState().result).toEqual({ kind: "added", layerId: "checkout", component: "main", name: "Checkout", txnId, dropped: [], droppedCount: 0, reply: "" });

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
    expect(designStore.getState().result).toMatchObject({ layerId: "checkout", component: "badge" });
  });

  it("leaves an import into another open document alone: no result, no selection, and nothing added here", () => {
    detach = attachDesign(session, host);
    designStore.setState({ request: pending() });
    host.emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
    host.emitDesign("r1", "t1", "<html><body>Home</body></html>", { fields: { name: "Home" } });
    // This window's newest change is its own; the other window's history counts txnIds from 1 too.
    const ours = importScreen([{ op: "updateLayer", id: "card", name: "Big Card" }]);
    host.emit(finished("t1", { imported: imported({ docId: "other", screenId: "home", txnId: ours, name: "Home" }) }));
    expect(designStore.getState().result).toBeNull();
    expect(designStore.getState().request?.imported).toBeUndefined();
    expect(designStore.getState().drafts[0]?.status).toBe("stopped");
    expect(session.selection.getState().layers).toEqual([]);
    expect(session.selection.getState().reveal).toBeNull();
    // A txnId from before this window's newest change isn't the import either.
    host.emit(finished("t2", { imported: imported({ docId: "other", screenId: "card", txnId: "txn_0", name: "Card" }) }));
    expect(designStore.getState().result).toBeNull();
  });

  it("ends a session's draft once it stops sending, so the canvas lets go of it", () => {
    vi.useFakeTimers();
    try {
      detach = attachDesign(session, host);
      const now = Date.now();
      const update: DesignPreviewUpdate = { docId: "shop", key: "cc-1", author: { kind: "agent", name: "Claude" }, client: { id: "cc-1", label: "Claude Code" }, name: "Checkout", component: null, replace: null, width: null, height: null, position: null, html: "<p>Hi</p>", status: "writing", draftRevision: 1 };
      expect(applyPreviewUpdate(session, update, now)).toBe(true);
      vi.advanceTimersByTime(MCP_DRAFT_STALLED_MS - 1000);
      expect(designStore.getState().drafts[0]?.status).toBe("writing");
      // Another part resets the clock.
      expect(applyPreviewUpdate(session, { ...update, draftRevision: 2 }, Date.now())).toBe(true);
      vi.advanceTimersByTime(MCP_DRAFT_STALLED_MS - 1000);
      expect(designStore.getState().drafts[0]?.status).toBe("writing");
      vi.advanceTimersByTime(1001);
      expect(designStore.getState().drafts[0]).toMatchObject({ status: "stopped", since: Date.now() });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a replace as an update with what it dropped", () => {
    detach = attachDesign(session, host);
    session.selection.getState().select({ layers: ["card"] });
    host.emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
    const txnId = importScreen([{ op: "updateLayer", id: "card", name: "Promo Card" }]);
    host.emit(finished("t1", { imported: imported({ screenId: "card", txnId, name: "Card", replaced: "card", dropped: ["Promo Badge", "Divider"], droppedCount: 2 }) }));
    expect(designStore.getState().result).toMatchObject({ kind: "updated", layerId: "card", name: "Promo Card", dropped: ["Promo Badge", "Divider"], droppedCount: 2 });
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
      styles: formatStyleDigest(styleDigest(session.document.getState().doc, "main")),
    });
    expect(sent.context?.styles).toMatch(/^styles main \(2 layers\)/);
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
