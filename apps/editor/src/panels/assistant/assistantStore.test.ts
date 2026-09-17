import { describe, expect, it } from "vitest";
import { createAssistantStore, initialAssistantData, reduceEvent, type AssistantData, type ChatItem } from "./assistantStore.ts";
import type { AssistantEvent, AssistantUsage } from "./types.ts";

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
});
