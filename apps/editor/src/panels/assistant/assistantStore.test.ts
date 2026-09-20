import { describe, expect, it } from "vitest";
import { createAssistantStore, initialAssistantData, reduceEvent, type AssistantData, type ChatItem } from "./assistantStore.ts";
import type { AssistantConfirmOption, AssistantEvent, AssistantStatus, AssistantUsage } from "./types.ts";

const usage = (totalTokens = 0): AssistantUsage => ({ inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens, estimatedCostUsd: 0, requests: 1 });

function fold(events: AssistantEvent[], start: Partial<AssistantData> = {}): AssistantData {
  let state: AssistantData = { ...initialAssistantData(), ...start };
  for (const event of events) state = { ...state, ...reduceEvent(state, event) };
  return state;
}

const user: ChatItem = { kind: "user", id: "u1", text: "Add a card" };

describe("reduceEvent", () => {
  it("builds a streamed reply with tool chips per turn", () => {
    const state = fold(
      [
        { type: "run_started", runId: "r1", model: "claude-sonnet-5" },
        { type: "turn_started", runId: "r1", turn: 1 },
        { type: "thinking_delta", runId: "r1", turn: 1, delta: "Plan" },
        { type: "text_delta", runId: "r1", turn: 1, delta: "Let me " },
        { type: "text_delta", runId: "r1", turn: 1, delta: "look." },
        { type: "tool_started", runId: "r1", toolUseId: "t1", name: "get_outline", title: "Get outline", detail: "" },
        { type: "tool_finished", runId: "r1", toolUseId: "t1", name: "get_outline", status: "done", detail: "revision 3", changedDocument: false },
        { type: "turn_started", runId: "r1", turn: 2 },
        { type: "tool_started", runId: "r1", toolUseId: "t2", name: "add_layers", title: "Add layers", detail: "Card" },
        { type: "tool_finished", runId: "r1", toolUseId: "t2", name: "add_layers", status: "done", detail: "Added 1 layer", changedDocument: true },
        { type: "turn_started", runId: "r1", turn: 3 },
        { type: "text_delta", runId: "r1", turn: 3, delta: "Added a Card." },
        { type: "usage", runId: "r1", usage: usage(5000), limits: { maxTurns: 30, tokenBudget: 1_500_000, deleteConfirmThreshold: 10 } },
        { type: "run_finished", runId: "r1", outcome: "completed", usage: usage(5000) },
      ],
      { items: [user], running: true },
    );
    expect(state.running).toBe(false);
    expect(state.runId).toBeNull();
    expect(state.usage?.totalTokens).toBe(5000);
    expect(state.limits?.tokenBudget).toBe(1_500_000);
    expect(state.items.map((i) => i.kind)).toEqual(["user", "assistant", "assistant", "assistant"]);
    const [, first, second, third] = state.items as Extract<ChatItem, { kind: "assistant" }>[];
    expect(first).toMatchObject({ text: "Let me look.", thinking: "Plan", tools: [{ toolUseId: "t1", status: "done", detail: "revision 3" }] });
    expect(second).toMatchObject({ text: "", tools: [{ toolUseId: "t2", status: "done", changedDocument: true, detail: "Added 1 layer" }] });
    expect(third).toMatchObject({ text: "Added a Card.", tools: [] });
  });

  it("shows a running tool's progress in its chip, until it finishes", () => {
    const events: AssistantEvent[] = [
      { type: "run_started", runId: "r1", model: "claude-sonnet-5" },
      { type: "turn_started", runId: "r1", turn: 1 },
      { type: "tool_started", runId: "r1", toolUseId: "t1", name: "import_design", title: "Import design", detail: "" },
      { type: "tool_progress", runId: "r1", toolUseId: "t1", detail: "Downloading images: 7 of 28" },
    ];
    const running = fold(events, { items: [user], running: true });
    expect((running.items[1] as Extract<ChatItem, { kind: "assistant" }>).tools[0]).toMatchObject({ status: "running", detail: "Downloading images: 7 of 28" });
    const done = fold([...events, { type: "tool_finished", runId: "r1", toolUseId: "t1", name: "import_design", status: "done", detail: "Imported Profile", changedDocument: true }, { type: "tool_progress", runId: "r1", toolUseId: "t1", detail: "late" }], { items: [user], running: true });
    expect((done.items[1] as Extract<ChatItem, { kind: "assistant" }>).tools[0]).toMatchObject({ status: "done", detail: "Imported Profile" });
  });

  it("tracks thinking until text arrives", () => {
    let state = fold([
      { type: "run_started", runId: "r1", model: "claude-opus-5" },
      { type: "thinking_delta", runId: "r1", turn: 1, delta: "hmm" },
    ]);
    expect(state.thinking).toBe(true);
    state = { ...state, ...reduceEvent(state, { type: "text_delta", runId: "r1", turn: 1, delta: "Okay" }) };
    expect(state.thinking).toBe(false);
  });

  it("replaces a re-issued turn's partial text", () => {
    const state = fold([
      { type: "run_started", runId: "r1", model: "claude-sonnet-5" },
      { type: "turn_started", runId: "r1", turn: 1 },
      { type: "text_delta", runId: "r1", turn: 1, delta: "Partial" },
      { type: "turn_started", runId: "r1", turn: 1 },
      { type: "text_delta", runId: "r1", turn: 1, delta: "Complete answer" },
    ]);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ text: "Complete answer" });
  });

  it("walks a confirmation from pending to resolved", () => {
    const pending = fold([
      { type: "run_started", runId: "r1", model: "claude-sonnet-5" },
      { type: "confirm_required", runId: "r1", confirmationId: "c1", toolUseId: "t1", title: "Delete 12 items?", message: "Deleting 12 items from main.", count: 12 },
    ]);
    expect(pending.items.at(-1)).toMatchObject({ kind: "confirm", id: "c1", status: "pending", count: 12 });
    const resolved = { ...pending, ...reduceEvent(pending, { type: "confirm_resolved", runId: "r1", confirmationId: "c1", approved: true }) };
    expect(resolved.items.at(-1)).toMatchObject({ status: "approved" });
  });

  it("on stop: drops empty turns, settles running chips and pending confirmations, and says it stopped", () => {
    const state = fold(
      [
        { type: "run_started", runId: "r1", model: "claude-sonnet-5" },
        { type: "turn_started", runId: "r1", turn: 1 },
        { type: "tool_started", runId: "r1", toolUseId: "t1", name: "delete_items", title: "Delete items", detail: "3 items" },
        { type: "confirm_required", runId: "r1", confirmationId: "c1", toolUseId: "t1", title: "Delete 14 items?", message: "…", count: 14 },
        { type: "turn_started", runId: "r1", turn: 2 },
        { type: "run_finished", runId: "r1", outcome: "stopped", usage: usage(100) },
      ],
      { items: [user], running: true },
    );
    expect(state.items.map((i) => i.kind)).toEqual(["user", "assistant", "confirm", "notice"]);
    expect(state.items[1]).toMatchObject({ tools: [{ status: "skipped" }] });
    expect(state.items[2]).toMatchObject({ status: "declined" });
    expect(state.items[3]).toMatchObject({ tone: "info", text: "Stopped." });
  });

  it("shows run errors with their code", () => {
    const state = fold([
      { type: "run_started", runId: "r1", model: "claude-sonnet-5" },
      { type: "run_finished", runId: "r1", outcome: "error", error: { code: "invalid_key", message: "Anthropic didn't accept this API key." }, usage: usage() },
    ]);
    expect(state.items.at(-1)).toMatchObject({ kind: "notice", tone: "error", code: "invalid_key", text: "Anthropic didn't accept this API key." });
  });

  it("adds notices and ignores another run's finish", () => {
    const state = fold([
      { type: "run_started", runId: "r2", model: "claude-sonnet-5" },
      { type: "notice", runId: "r2", tone: "warn", message: "Read only" },
      { type: "run_finished", runId: "r1", outcome: "completed", usage: usage() },
    ]);
    expect(state.running).toBe(true);
    expect(state.items).toEqual([expect.objectContaining({ kind: "notice", tone: "warn", text: "Read only" })]);
  });
});

describe("reduceEvent: Design with Claude", () => {
  const draft = (offset: number, append: string, extra: Partial<Extract<AssistantEvent, { type: "design_draft" }>> = {}): AssistantEvent => ({ type: "design_draft", runId: "r1", turn: 1, toolUseId: "t1", offset, append, done: false, ...extra });
  const chipOf = (state: AssistantData) => (state.items.find((i) => i.kind === "assistant") as Extract<ChatItem, { kind: "assistant" }> | undefined)?.tools[0];
  const started = fold([
    { type: "run_started", runId: "r1", model: "claude-sonnet-5" },
    { type: "turn_started", runId: "r1", turn: 1 },
  ]);

  it("shows import_design's chip while Claude writes the page, changing only with the rounded size, the name, or done", () => {
    let state = { ...started, ...reduceEvent(started, draft(0, "<html>")) };
    expect(chipOf(state)).toMatchObject({ toolUseId: "t1", name: "import_design", title: "Import design", detail: "Writing the screen · 1 KB", status: "running" });

    // Still 1 KB, no name: nothing to re-render.
    expect(reduceEvent(state, draft(6, "<body>"))).toEqual({});

    state = { ...state, ...reduceEvent(state, draft(6, "x".repeat(600), { fields: { name: "Checkout" } })) };
    expect(chipOf(state)?.detail).toBe("Writing “Checkout” · 1 KB");
    // A later event without fields keeps the name; the same rounded KB changes nothing.
    expect(reduceEvent(state, draft(606, "y".repeat(100)))).toEqual({});

    state = { ...state, ...reduceEvent(state, draft(706, "z".repeat(14_000))) };
    expect(chipOf(state)?.detail).toBe("Writing “Checkout” · 14 KB");

    const html = "<html>" + "x".repeat(15_000);
    state = { ...state, ...reduceEvent(state, draft(14_706, "", { done: true, html })) };
    expect(chipOf(state)).toMatchObject({ detail: "Writing “Checkout” · 15 KB", draft: { done: true } });

    // The tool starts: its own chip replaces the draft's, and late drafts are ignored.
    state = { ...state, ...reduceEvent(state, { type: "tool_started", runId: "r1", toolUseId: "t1", name: "import_design", title: "Import design", detail: "Checkout" }) };
    expect(chipOf(state)).toEqual({ toolUseId: "t1", name: "import_design", title: "Import design", detail: "Checkout", status: "running", changedDocument: false });
    expect(reduceEvent(state, draft(0, "late"))).toEqual({});
  });

  it("names the screen before any html arrives", () => {
    const state = { ...started, ...reduceEvent(started, draft(0, "", { fields: { name: "Checkout" } })) };
    expect(chipOf(state)?.detail).toBe("Writing “Checkout”");
  });

  it("drops a retried turn's draft chip", () => {
    let state = { ...started, ...reduceEvent(started, draft(0, "x".repeat(3000), { fields: { name: "Home" } })) };
    expect(chipOf(state)?.draft).toBeDefined();
    state = { ...state, ...reduceEvent(state, { type: "turn_started", runId: "r1", turn: 1 }) };
    expect(chipOf(state)).toBeUndefined();
  });

  it("carries a replace confirmation's kind and labels", () => {
    const state = fold([
      { type: "run_started", runId: "r1", model: "claude-sonnet-5" },
      { type: "confirm_required", runId: "r1", confirmationId: "c1", toolUseId: "t1", title: "Replace “Home”?", message: "Claude wants to rebuild “Home”, which you didn't ask it to change. You can undo it afterwards.", count: 0, kind: "replace", approveLabel: "Replace", declineLabel: "Keep “Home”" },
      { type: "confirm_required", runId: "r1", confirmationId: "c2", toolUseId: "t2", title: "Delete 12 items?", message: "…", count: 12 },
    ]);
    expect(state.items[0]).toMatchObject({ kind: "confirm", id: "c1", confirmKind: "replace", approveLabel: "Replace", declineLabel: "Keep “Home”", status: "pending" });
    expect(state.items[1]).not.toHaveProperty("confirmKind");
    expect(state.items[1]).not.toHaveProperty("approveLabel");
  });

  it("keeps a permission card's choices and the one picked", () => {
    const options: AssistantConfirmOption[] = [
      { id: "allow-once", label: "Allow", kind: "allow_once" },
      { id: "allow-with-updates", label: "Allow for this chat", kind: "allow_always" },
      { id: "reject", label: "Don't allow", kind: "reject_once" },
    ];
    let state = fold([
      { type: "run_started", runId: "r1", model: "claude-sonnet-5", provider: "subscription" },
      { type: "confirm_required", runId: "r1", confirmationId: "p1", toolUseId: "toolu_1", title: "Allow Claude to save this prototype?", message: "…", count: 0, kind: "permission", options },
    ]);
    expect(state.items[0]).toMatchObject({ kind: "confirm", confirmKind: "permission", options, status: "pending" });
    expect(state.items[0]).not.toHaveProperty("optionId");
    state = fold([{ type: "confirm_resolved", runId: "r1", confirmationId: "p1", approved: true, optionId: "allow-with-updates" }], state);
    expect(state.items[0]).toMatchObject({ status: "approved", optionId: "allow-with-updates" });
  });

  it("updates a chip when its tool starts again with its input, where it is and only while it runs", () => {
    let state = fold([
      { type: "run_started", runId: "r1", model: "claude-sonnet-5", provider: "subscription" },
      { type: "turn_started", runId: "r1", turn: 1 },
      { type: "tool_started", runId: "r1", toolUseId: "toolu_1", name: "get_outline", title: "Get outline", detail: "" },
      { type: "tool_started", runId: "r1", toolUseId: "toolu_2", name: "add_layers", title: "Add layers", detail: "" },
      { type: "turn_started", runId: "r1", turn: 2 },
      { type: "tool_started", runId: "r1", toolUseId: "toolu_1", name: "get_outline", title: "Get outline", detail: "styles" },
    ]);
    const turns = state.items as Extract<ChatItem, { kind: "assistant" }>[];
    // The chip stays in the first turn; the second has none.
    expect(turns.map((t) => t.tools.map((c) => [c.toolUseId, c.detail]))).toEqual([
      [
        ["toolu_1", "styles"],
        ["toolu_2", ""],
      ],
      [],
    ]);
    state = fold(
      [
        { type: "tool_finished", runId: "r1", toolUseId: "toolu_2", name: "add_layers", status: "done", detail: "Added 3 layers", changedDocument: true },
        { type: "tool_started", runId: "r1", toolUseId: "toolu_2", name: "add_layers", title: "Add layers", detail: "Card" },
      ],
      state,
    );
    expect((state.items[0] as Extract<ChatItem, { kind: "assistant" }>).tools[1]).toMatchObject({ status: "done", detail: "Added 3 layers" });
  });

  it("learns what the chat runs on from its run", () => {
    const status = { hasKey: false, chatProvider: null } as unknown as AssistantStatus;
    expect(fold([{ type: "run_started", runId: "r1", model: "claude-sonnet-5", provider: "subscription" }], { status }).status?.chatProvider).toBe("subscription");
    // Older hosts don't say: the status stays as it was.
    expect(fold([{ type: "run_started", runId: "r1", model: "claude-sonnet-5" }], { status }).status).toBe(status);
  });

  it("keeps a message's canvas origin through the reply", () => {
    const state = fold(
      [
        { type: "run_started", runId: "r1", model: "claude-sonnet-5" },
        { type: "turn_started", runId: "r1", turn: 1 },
        { type: "text_delta", runId: "r1", turn: 1, delta: "Added a checkout." },
        { type: "run_finished", runId: "r1", outcome: "completed", usage: usage(10) },
      ],
      { items: [{ kind: "user", id: "u1", text: "a checkout", origin: "canvas" }], running: true },
    );
    expect(state.items[0]).toEqual({ kind: "user", id: "u1", text: "a checkout", origin: "canvas" });
  });
});

describe("assistant store", () => {
  it("opens, closes, toggles, and remembers the model in memory", () => {
    const store = createAssistantStore({ persistModel: false });
    expect(store.getState()).toMatchObject({ open: false, model: "claude-sonnet-5" });
    store.getState().toggle();
    expect(store.getState().open).toBe(true);
    store.getState().hide();
    expect(store.getState().open).toBe(false);
    store.getState().setModel("claude-opus-5");
    expect(store.getState().model).toBe("claude-opus-5");
  });

  it("opens on the setup, and closing leaves it", () => {
    const store = createAssistantStore({ persistModel: false });
    store.getState().showSetup();
    expect(store.getState()).toMatchObject({ open: true, setup: true });
    store.getState().toggle();
    expect(store.getState()).toMatchObject({ open: false, setup: false });
    store.getState().showSetup();
    store.getState().setOpen(false);
    expect(store.getState().setup).toBe(false);
    store.getState().show();
    store.getState().setSetup(true);
    store.getState().hide();
    expect(store.getState().setup).toBe(false);
  });
});
