/**
 * Assistant drawer state: whether it's open, the host's status, the chat transcript, tool activity,
 * pending confirmations, usage, and the chosen model. `reduceEvent` folds host events into state and
 * is pure, so it's unit-tested without a host.
 */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { readString, writeString } from "../../ui/lib/storage.ts";
import { DEFAULT_MODEL_ID, FALLBACK_MODELS, type AssistantEvent, type AssistantLimits, type AssistantStatus, type AssistantToolStatus, type AssistantUsage } from "./types.ts";

export const MODEL_STORAGE_KEY = "sonobe.assistant.model";

export interface ToolChip {
  toolUseId: string;
  name: string;
  title: string;
  detail: string;
  status: AssistantToolStatus;
  changedDocument: boolean;
}

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; runId: string; turn: number; text: string; thinking: string; tools: ToolChip[] }
  | { kind: "notice"; id: string; tone: "info" | "warn" | "error"; text: string; code?: string }
  | { kind: "confirm"; id: string; runId: string; title: string; message: string; count: number; status: "pending" | "approved" | "declined" };

export type KeyCheckState = { state: "idle" } | { state: "checking" } | { state: "ok" } | { state: "error"; message: string };

export interface AssistantState {
  /** The standalone drawer (AssistantHost) is open. */
  open: boolean;
  status: AssistantStatus | null;
  /** Why the status couldn't be loaded. */
  statusError: string | null;
  items: ChatItem[];
  /** A reply is in progress. */
  running: boolean;
  runId: string | null;
  /** Receiving thinking before any text in the current turn. */
  thinking: boolean;
  model: string;
  usage: AssistantUsage | null;
  limits: AssistantLimits | null;
  keyCheck: KeyCheckState;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setModel: (model: string) => void;
}

export type AssistantData = Omit<AssistantState, "show" | "hide" | "toggle" | "setOpen" | "setModel">;

let itemCounter = 0;
/** Local ids for transcript items. */
export const nextItemId = (prefix: string) => `${prefix}-${++itemCounter}-${Date.now().toString(36)}`;

const assistantItemId = (runId: string, turn: number) => `assistant-${runId}-${turn}`;

function updateTurn(items: ChatItem[], runId: string, turn: number, update: (item: Extract<ChatItem, { kind: "assistant" }>) => Extract<ChatItem, { kind: "assistant" }>): ChatItem[] {
  const id = assistantItemId(runId, turn);
  const index = items.findIndex((i) => i.id === id);
  if (index === -1) return [...items, update({ kind: "assistant", id, runId, turn, text: "", thinking: "", tools: [] })];
  const next = items.slice();
  next[index] = update(items[index] as Extract<ChatItem, { kind: "assistant" }>);
  return next;
}

/** The newest assistant turn of a run (tool chips attach there). */
function latestTurn(items: ChatItem[], runId: string): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === "assistant" && item.runId === runId) return item.turn;
  }
  return null;
}

const OUTCOME_NOTICES: Partial<Record<string, { tone: "info" | "warn"; text: string }>> = {
  stopped: { tone: "info", text: "Stopped." },
};

/** Fold one host event into state. Pure. */
export function reduceEvent(state: AssistantData, event: AssistantEvent): Partial<AssistantData> {
  switch (event.type) {
    case "run_started":
      return { running: true, runId: event.runId, thinking: false };
    case "turn_started":
      // A re-issued turn replaces the partial text of the failed attempt.
      return { items: updateTurn(state.items, event.runId, event.turn, (item) => ({ ...item, text: "", thinking: "" })), thinking: false };
    case "text_delta":
      return { items: updateTurn(state.items, event.runId, event.turn, (item) => ({ ...item, text: item.text + event.delta })), thinking: false };
    case "thinking_delta":
      return { items: updateTurn(state.items, event.runId, event.turn, (item) => ({ ...item, thinking: item.thinking + event.delta })), thinking: true };
    case "tool_started": {
      const turn = latestTurn(state.items, event.runId) ?? 1;
      const chip: ToolChip = { toolUseId: event.toolUseId, name: event.name, title: event.title, detail: event.detail, status: "running", changedDocument: false };
      return { items: updateTurn(state.items, event.runId, turn, (item) => ({ ...item, tools: [...item.tools.filter((t) => t.toolUseId !== chip.toolUseId), chip] })), thinking: false };
    }
    case "tool_progress":
      return {
        items: state.items.map((item) =>
          item.kind === "assistant" && item.runId === event.runId && item.tools.some((t) => t.toolUseId === event.toolUseId && t.status === "running")
            ? { ...item, tools: item.tools.map((t) => (t.toolUseId === event.toolUseId && t.status === "running" ? { ...t, detail: event.detail } : t)) }
            : item,
        ),
      };
    case "tool_finished":
      return {
        items: state.items.map((item) =>
          item.kind === "assistant" && item.runId === event.runId && item.tools.some((t) => t.toolUseId === event.toolUseId)
            ? { ...item, tools: item.tools.map((t) => (t.toolUseId === event.toolUseId ? { ...t, status: event.status, detail: event.detail || t.detail, changedDocument: event.changedDocument } : t)) }
            : item,
        ),
      };
    case "confirm_required":
      return { items: [...state.items, { kind: "confirm", id: event.confirmationId, runId: event.runId, title: event.title, message: event.message, count: event.count, status: "pending" }] };
    case "confirm_resolved":
      return { items: state.items.map((item) => (item.kind === "confirm" && item.id === event.confirmationId ? { ...item, status: event.approved ? "approved" : "declined" } : item)) };
    case "usage":
      return { usage: event.usage, limits: event.limits };
    case "notice":
      return { items: [...state.items, { kind: "notice", id: nextItemId("notice"), tone: event.tone, text: event.message }] };
    case "run_finished": {
      if (state.runId !== null && state.runId !== event.runId) return {};
      // Drop empty turns (stopped before anything streamed) and settle leftovers.
      let items = state.items
        .filter((item) => !(item.kind === "assistant" && item.runId === event.runId && !item.text.trim() && item.tools.length === 0))
        .map((item) =>
          item.kind === "assistant" && item.runId === event.runId && item.tools.some((t) => t.status === "running")
            ? { ...item, tools: item.tools.map((t) => (t.status === "running" ? { ...t, status: "skipped" as const } : t)) }
            : item.kind === "confirm" && item.runId === event.runId && item.status === "pending"
              ? { ...item, status: "declined" as const }
              : item,
        );
      const notice = OUTCOME_NOTICES[event.outcome];
      if (notice) items = [...items, { kind: "notice", id: nextItemId("notice"), tone: notice.tone, text: notice.text }];
      if (event.error) items = [...items, { kind: "notice", id: nextItemId("error"), tone: "error", text: event.error.message, code: event.error.code }];
      return {
        items,
        running: false,
        runId: null,
        thinking: false,
        usage: event.usage,
        ...(state.status ? { status: { ...state.status, usage: event.usage, running: false } } : {}),
      };
    }
    case "design_draft":
      // Drafts don't show in the transcript yet.
      return {};
  }
}

function storedModel(): string {
  const stored = readString(MODEL_STORAGE_KEY);
  return stored && FALLBACK_MODELS.some((m) => m.id === stored) ? stored : DEFAULT_MODEL_ID;
}

export function initialAssistantData(model: string = DEFAULT_MODEL_ID): AssistantData {
  return { open: false, status: null, statusError: null, items: [], running: false, runId: null, thinking: false, model, usage: null, limits: null, keyCheck: { state: "idle" } };
}

export function createAssistantStore(options: { persistModel?: boolean } = {}): StoreApi<AssistantState> {
  const persist = options.persistModel ?? true;
  return createStore<AssistantState>()((set) => ({
    ...initialAssistantData(persist ? storedModel() : DEFAULT_MODEL_ID),
    show: () => set({ open: true }),
    hide: () => set({ open: false }),
    toggle: () => set((s) => ({ open: !s.open })),
    setOpen: (open) => set({ open }),
    setModel: (model) => {
      if (persist) writeString(MODEL_STORAGE_KEY, model);
      set({ model });
    },
  }));
}

/** The app-wide Assistant store (menu, toolbar, and drawer share it). */
export const assistantStore = createAssistantStore();

export function useAssistant<T>(selector: (state: AssistantState) => T, store: StoreApi<AssistantState> = assistantStore): T {
  return useStore(store, selector);
}
