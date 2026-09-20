/**
 * Design with Claude state: whether the canvas's box is open, the request it sent, the drafts Claude
 * is writing (import_design's html, before the tool runs), and the last result. `reduceDesignEvent`
 * folds Assistant events into it and is pure. A draft is keyed by its toolUseId, whatever sent it.
 */

import { findLayer, type Id, type LayerLocation, type SonobeDocument } from "@sonobe/core";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { EditorSession } from "../../state/session.ts";
import { assistantStore, type AssistantData } from "../assistant/assistantStore.ts";
import { sharedAssistantController } from "../assistant/controller.ts";
import { getAssistantHost, type AssistantCanvasContext, type AssistantDesignFields, type AssistantError, type AssistantEvent, type AssistantHostLike, type AssistantImported, type AssistantOutcome } from "../assistant/types.ts";
import { canvasContext, designTarget } from "./context.ts";

export type DraftStatus = "writing" | "adding" | "added" | "failed" | "stopped";
export interface DesignDraft {
  runId: string; turn: number; toolUseId: string;
  html: string; fields: AssistantDesignFields;
  status: DraftStatus; since: number;
  /** tool_progress while adding ("Downloading images: 3 of 7"). */
  progress: string | null;
  /** failed: "too_long" (max_tokens) or the tool's detail. */
  error: string | null;
  /** An append arrived at the wrong offset; wait for done's html. */
  resync: boolean;
}
export interface DesignRequest {
  runId: string | null; text: string; context: AssistantCanvasContext; selection: readonly string[];
  /** Screens import_design added or replaced in its run. */
  imported?: number;
  /** An edit in its run was refused because Claude is set to Read only. */
  readOnly?: boolean;
  /** How its run ended, or why it never started (the send's result). Absent while it runs. */
  outcome?: AssistantOutcome;
  error?: AssistantError;
}
export interface DesignResult { kind: "added" | "updated"; layerId: string; component: string; name: string; txnId: string | null; dropped: string[]; droppedCount: number; coveredScreen: string | null; reply: string }
export interface DesignData { open: boolean; newScreen: boolean; request: DesignRequest | null; drafts: DesignDraft[]; result: DesignResult | null }
export interface DesignState extends DesignData { openBox(): void; closeBox(): void; setNewScreen(value: boolean): void }

/** DesignDraft.error when the reply hit max_tokens before the page was finished. */
export const DRAFT_TOO_LONG = "too_long";

const DRAFTS_KEPT = 5;
/** How long a draft stays on the canvas after it's added, fails or stops: the preview's fade. */
const FADE_MS = 400;
const REPLY_CHARS = 280;
/** The start of the agent's notice when an edit is refused in Read only. */
const READ_ONLY_NOTICE = "Claude is set to Read only";

export function initialDesignData(): DesignData {
  return { open: false, newScreen: false, request: null, drafts: [], result: null };
}

/** The app-wide Design with Claude store (the canvas header, ⌘K, the Layers menu and the box share it). */
export const designStore: StoreApi<DesignState> = createStore<DesignState>()((set) => ({
  ...initialDesignData(),
  openBox: () => set({ open: true }),
  closeBox: () => set({ open: false }),
  setNewScreen: (value) => set({ newScreen: value }),
}));

export function useDesign<T>(selector: (s: DesignState) => T): T {
  return useStore(designStore, selector);
}

function updateDraft(state: DesignData, toolUseId: string, update: (draft: DesignDraft) => DesignDraft): Partial<DesignData> {
  const index = state.drafts.findIndex((d) => d.toolUseId === toolUseId);
  if (index === -1) return {};
  return { drafts: state.drafts.map((d, i) => (i === index ? update(d) : d)) };
}

function reduceDraft(state: DesignData, event: Extract<AssistantEvent, { type: "design_draft" }>, now: number): Partial<DesignData> {
  const index = state.drafts.findIndex((d) => d.toolUseId === event.toolUseId);
  const current = index === -1 ? null : state.drafts[index]!;
  // Done already came, or the tool ran: late appends change nothing.
  if (current && current.status !== "writing") return {};
  const base: DesignDraft = current ?? { runId: event.runId, turn: event.turn, toolUseId: event.toolUseId, html: "", fields: {}, status: "writing", since: now, progress: null, error: null, resync: false };
  const fields = event.fields ? { ...base.fields, ...event.fields } : base.fields;
  const inSync = !base.resync && event.offset === base.html.length;
  let next: DesignDraft;
  if (event.done) {
    const html = event.html ?? (inSync ? base.html + event.append : null);
    next = html === null ? { ...base, fields, status: "adding", since: now, resync: true } : { ...base, fields, html, status: "adding", since: now, resync: false };
  } else if (inSync) {
    next = { ...base, fields, html: base.html + event.append };
  } else {
    if (current && current.resync && fields === base.fields) return {};
    next = { ...base, fields, resync: true };
  }
  return { drafts: current ? state.drafts.map((d, i) => (i === index ? next : d)) : [...state.drafts, next].slice(-DRAFTS_KEPT) };
}

/** Fold one Assistant event into design state. Pure. */
export function reduceDesignEvent(state: DesignData, event: AssistantEvent, now: number): Partial<DesignData> {
  const { request } = state;
  switch (event.type) {
    case "run_started":
      if (!request) return {};
      // The box's send starts the next run; any other run (the chat sheet's) leaves the box's request behind.
      if (request.runId === null && request.outcome === undefined) return { request: { ...request, runId: event.runId } };
      return request.runId === event.runId ? {} : { request: null };
    case "turn_started": {
      // A re-issued turn (a retry) writes its drafts again. Its tools never ran, so a finished page of it is stale too.
      const drafts = state.drafts.filter((d) => !(d.runId === event.runId && (d.status === "writing" || d.status === "adding") && d.turn >= event.turn));
      return drafts.length === state.drafts.length ? {} : { drafts };
    }
    case "design_draft":
      return reduceDraft(state, event, now);
    case "tool_progress":
      return updateDraft(state, event.toolUseId, (d) => ({ ...d, progress: event.detail }));
    case "tool_finished": {
      if (event.name !== "import_design") return {};
      // A dry run or a declined replace finishes without adding anything: the draft stops rather than fails.
      const status: DraftStatus = event.imported ? "added" : event.status === "error" ? "failed" : "stopped";
      const patch = updateDraft(state, event.toolUseId, (d) => ({ ...d, status, since: now, progress: null, error: status === "failed" ? event.detail : d.error }));
      if (event.imported && request?.runId === event.runId) return { ...patch, request: { ...request, imported: (request.imported ?? 0) + 1 } };
      return patch;
    }
    case "notice":
      return request?.runId === event.runId && !request.readOnly && event.message.startsWith(READ_ONLY_NOTICE) ? { request: { ...request, readOnly: true } } : {};
    case "run_finished": {
      let settled = false;
      const drafts = state.drafts.map((d): DesignDraft => {
        if (d.runId !== event.runId || (d.status !== "writing" && d.status !== "adding")) return d;
        settled = true;
        return event.outcome === "max_tokens" ? { ...d, status: "failed", since: now, progress: null, error: DRAFT_TOO_LONG } : { ...d, status: "stopped", since: now, progress: null };
      });
      const ours = request !== null && request.outcome === undefined && (request.runId === event.runId || request.runId === null);
      return {
        ...(settled ? { drafts } : {}),
        ...(ours ? { request: { ...request, runId: event.runId, outcome: event.outcome, ...(event.error ? { error: event.error } : {}) } } : {}),
      };
    }
    default:
      return {};
  }
}

/** The draft the canvas previews: the newest writing/adding one, else one that left those states < 400 ms ago (the fade). */
export function activeDraft(state: DesignData, now: number): DesignDraft | null {
  for (let i = state.drafts.length - 1; i >= 0; i--) {
    const draft = state.drafts[i]!;
    if (draft.status === "writing" || draft.status === "adding") return draft;
  }
  for (let i = state.drafts.length - 1; i >= 0; i--) {
    const draft = state.drafts[i]!;
    if (now - draft.since < FADE_MS) return draft;
  }
  return null;
}

/** A run's closing words: the text of its last turn that has any, cut at 280 characters. */
export function runReply(assistant: Pick<AssistantData, "items">, runId: string | null): string {
  if (runId === null) return "";
  for (let i = assistant.items.length - 1; i >= 0; i--) {
    const item = assistant.items[i]!;
    if (item.kind !== "assistant" || item.runId !== runId) continue;
    const text = item.text.trim();
    if (!text) continue;
    if (text.length <= REPLY_CHARS) return text;
    // Don't split a surrogate pair.
    const cut = /[\uD800-\uDBFF]/.test(text[REPLY_CHARS - 2]!) ? REPLY_CHARS - 2 : REPLY_CHARS - 1;
    return `${text.slice(0, cut).trimEnd()}…`;
  }
  return "";
}

const sameIds = (a: readonly Id[], b: readonly Id[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Where an imported screen landed: the components its change touched first, then the likely ones. Layer ids are unique only within a component. */
function locateScreen(doc: SonobeDocument, screenId: Id, likely: readonly Id[]): { componentId: Id; loc: LayerLocation } | null {
  for (const componentId of new Set([...likely, ...Object.keys(doc.components)])) {
    const component = doc.components[componentId];
    const loc = component ? findLayer(component.layers, screenId) : undefined;
    if (loc) return { componentId, loc };
  }
  return null;
}

/** Subscribe to host.assistant.onEvent (default getAssistantHost()); on tool_finished.imported, select and reveal the screen when it's in the current component and the selection hasn't changed since the run started; set result. Returns detach. */
export function attachDesign(session: EditorSession, host: AssistantHostLike | null = getAssistantHost()): () => void {
  // The chip's × means "New screen" until the selection changes.
  const stopSelection = session.selection.subscribe((state, previous) => {
    if (state.layers !== previous.layers && designStore.getState().newScreen) designStore.getState().setNewScreen(false);
  });
  const onEvent = host?.assistant?.onEvent;
  if (!onEvent) return stopSelection;

  /** Each running reply's selection when it started (then the screen it selected). */
  const baselines = new Map<string, readonly Id[]>();
  let resultRun: string | null = null;

  const showImported = (runId: string, imported: AssistantImported) => {
    const design = designStore.getState();
    const request = design.request?.runId === runId ? design.request : null;
    const { doc, lastChange } = session.document.getState();
    const touched = lastChange?.txnId !== undefined && lastChange.txnId === imported.txnId ? lastChange.affected.components : [];
    const found = locateScreen(doc, imported.screenId, [...touched, ...(request ? [request.context.component.id] : []), session.currentComponentId()]);
    const kind = imported.replaced ? "updated" : "added";
    // A new screen lands in front: name the top-level screen it covers.
    const behind = kind === "added" && found && found.loc.parent === null && found.loc.index > 0 ? found.loc.siblings[found.loc.index - 1]! : null;
    resultRun = runId;
    designStore.setState({
      result: {
        kind,
        layerId: imported.screenId,
        component: found?.componentId ?? request?.context.component.id ?? session.currentComponentId(),
        name: found?.loc.layer.name ?? imported.name,
        txnId: imported.txnId,
        dropped: imported.dropped,
        droppedCount: imported.droppedCount,
        coveredScreen: behind?.name ?? null,
        reply: runReply(assistantStore.getState(), runId),
      },
    });
    if (!found || found.componentId !== session.currentComponentId()) return;
    const selection = session.selection.getState();
    const baseline = baselines.get(runId);
    // The person picked something else while Claude worked: leave their selection alone.
    if (!baseline || !(sameIds(selection.layers, baseline) || sameIds(selection.layers, [imported.screenId]))) return;
    selection.select({ layers: [imported.screenId] });
    selection.requestReveal(found.componentId, [imported.screenId]);
    baselines.set(runId, [imported.screenId]);
  };

  const unsubscribe = onEvent((event) => {
    const patch = reduceDesignEvent(designStore.getState(), event, Date.now());
    if (Object.keys(patch).length) designStore.setState(patch);
    switch (event.type) {
      case "run_started": {
        const request = designStore.getState().request;
        baselines.set(event.runId, request?.runId === event.runId ? request.selection : [...session.selection.getState().layers]);
        break;
      }
      case "tool_finished":
        if (event.imported) showImported(event.runId, event.imported);
        break;
      case "run_finished": {
        baselines.delete(event.runId);
        // Claude's closing words come after the import: take them into the result.
        const result = designStore.getState().result;
        if (result && resultRun === event.runId) designStore.setState({ result: { ...result, reply: runReply(assistantStore.getState(), event.runId) } });
        break;
      }
    }
  });
  return () => {
    unsubscribe();
    stopSelection();
  };
}

/** Send the box's text with the canvas context through sharedAssistantController(). */
export async function sendDesign(session: EditorSession, text: string, bounds: (id: string) => { x: number; y: number; width: number; height: number } | null): Promise<void> {
  const controller = sharedAssistantController();
  const message = text.trim();
  if (!controller.available || !message || assistantStore.getState().running) return;
  const context = canvasContext(session, designTarget(session, designStore.getState()), bounds);
  const request: DesignRequest = { runId: null, text: message, context, selection: [...session.selection.getState().layers] };
  designStore.setState({ request });
  const result = await controller.send(message, { context });
  designStore.setState((s) => {
    // The same request (with what its run filled in), unless a newer one replaced it.
    const current = s.request;
    if (!current || current.context !== context) return {};
    if (!result) return { request: null };
    if (current.outcome !== undefined) return {};
    // It never started (no key, busy…), or its run_finished didn't reach this store.
    return { request: { ...current, runId: current.runId ?? result.runId, outcome: result.outcome, ...(result.error ? { error: result.error } : {}) } };
  });
}
