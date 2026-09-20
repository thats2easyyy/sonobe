/**
 * Design with Claude state: whether the canvas's box is open, the request it sent, the drafts Claude
 * is writing, and the last result. A draft comes from the in-app Assistant (import_design's html,
 * before the tool runs; `reduceDesignEvent` folds its events) or from an MCP client such as Claude
 * Code (preview_design, over the design.preview RPC; `reducePreviewUpdate` folds its updates). Both
 * reducers are pure, and the canvas previews the newest draft of either. On the Claude subscription
 * the Assistant draws through preview_design too: its MCP drafts belong to its run.
 */

import { findLayer, type Author, type Id, type LayerLocation, type SonobeDocument } from "@sonobe/core";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { DesignPreviewUpdate } from "../../host/types.ts";
import type { DocumentChange } from "../../state/document.ts";
import type { WorkClient } from "../../state/presence.ts";
import type { EditorSession } from "../../state/session.ts";
import { assistantStore, type AssistantData } from "../assistant/assistantStore.ts";
import { sharedAssistantController } from "../assistant/controller.ts";
import { getAssistantHost, type AssistantCanvasContext, type AssistantDesignFields, type AssistantError, type AssistantEvent, type AssistantHostLike, type AssistantImported, type AssistantOutcome } from "../assistant/types.ts";
import { canvasContext, designTarget } from "./context.ts";

export type DraftStatus = "writing" | "adding" | "added" | "failed" | "stopped";
/** Who writes a draft: the in-app Assistant, or an MCP client's preview_design. */
export type DraftSource = "assistant" | "mcp";
/** An MCP client's draft: who writes it, and what its updates said. */
export interface McpDraftSession {
  author: Author;
  /** The session's client ("Claude Code"), when the host knows it. */
  client: WorkClient | null;
  /** The last update's draftRevision; an older update changes nothing. */
  draftRevision: number;
  /** When the last update came (epoch ms). A draft with no update for a while leaves the canvas (mcpDraftIdleAt): its session may be gone. */
  touchedAt: number;
  /** The document's revision when import_design started adding it; null while it's written. */
  addingFrom: number | null;
}
export interface DesignDraft {
  source: DraftSource;
  /** Its identity: the Assistant's toolUseId, or "mcp:<session key>" (one draft per MCP session). */
  key: string;
  /**
   * The Assistant's run, turn and tool call ("", 0 and "" for an MCP client's draft). The Assistant's
   * own preview_design drafts (the subscription path) are MCP drafts with its runId: see assistantDraft.
   */
  runId: string; turn: number; toolUseId: string;
  html: string; fields: AssistantDesignFields;
  status: DraftStatus; since: number;
  /** tool_progress while adding ("Downloading images: 3 of 7"). */
  progress: string | null;
  /** failed: "too_long" (max_tokens) or the tool's detail. */
  error: string | null;
  /** An append arrived at the wrong offset; wait for done's html. */
  resync: boolean;
  /** Present for an MCP client's draft. */
  mcp?: McpDraftSession;
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
/**
 * The screen the box's import made. What it covers is read from the document when it's shown (status.ts resultPlacement).
 * `undone`: Undo put its import on the redo stack. Redo clears it, and a later edit that empties the redo stack leaves it set.
 */
export interface DesignResult { kind: "added" | "updated"; layerId: string; component: string; name: string; txnId: string | null; dropped: string[]; droppedCount: number; reply: string; undone?: boolean }
export interface DesignData {
  open: boolean;
  newScreen: boolean;
  request: DesignRequest | null;
  drafts: DesignDraft[];
  result: DesignResult | null;
  /** Counts openBox calls: the box moves focus to its field on each, even when it's already open. */
  focusRequest: number;
}
export interface DesignState extends DesignData { openBox(): void; closeBox(): void; setNewScreen(value: boolean): void }

/** DesignDraft.error when the reply hit max_tokens before the page was finished. */
export const DRAFT_TOO_LONG = "too_long";

/** The history author of the in-app Assistant's edits (apps/desktop's ASSISTANT_AUTHOR_NAME). */
export const ASSISTANT_AUTHOR = "Assistant";

/** A draft the in-app Assistant writes: its import_design html, or (the subscription path) its preview_design draft during its run. */
export const assistantDraft = (draft: DesignDraft): boolean => draft.source === "assistant" || draft.runId !== "";

const DRAFTS_KEPT = 5;
/** How long a draft stays on the canvas after it's added, fails or stops: the preview's fade. */
const FADE_MS = 400;
/** How long an MCP client's draft stays on the canvas without an update while it's being added (the MCP server drops a draft after as long). */
export const MCP_DRAFT_IDLE_MS = 15 * 60_000;
/** How long one that's being written stays without an update: Claude sends each part within seconds, so its session has most likely stopped. */
export const MCP_DRAFT_STALLED_MS = 3 * 60_000;
const REPLY_CHARS = 280;
/** The start of the agent's notice when an edit is refused in Read only. */
const READ_ONLY_NOTICE = "Claude is set to Read only";

export function initialDesignData(): DesignData {
  return { open: false, newScreen: false, request: null, drafts: [], result: null, focusRequest: 0 };
}

/** The app-wide Design with Claude store (the canvas header, ⌘K, the Layers menu and the box share it). */
export const designStore: StoreApi<DesignState> = createStore<DesignState>()((set) => ({
  ...initialDesignData(),
  openBox: () => set((s) => ({ open: true, focusRequest: s.focusRequest + 1 })),
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

/** The Assistant's own preview_design drafts of `runId` (the subscription path) that `which` picks. */
function updateRunDraft(state: DesignData, runId: string, which: (draft: DesignDraft) => boolean, update: (draft: DesignDraft) => DesignDraft): Partial<DesignData> {
  const picked = (d: DesignDraft) => !!d.mcp && d.runId === runId && which(d);
  return state.drafts.some(picked) ? { drafts: state.drafts.map((d) => (picked(d) ? update(d) : d)) } : {};
}

function reduceDraft(state: DesignData, event: Extract<AssistantEvent, { type: "design_draft" }>, now: number): Partial<DesignData> {
  const index = state.drafts.findIndex((d) => d.toolUseId === event.toolUseId);
  const current = index === -1 ? null : state.drafts[index]!;
  // Done already came, or the tool ran: late appends change nothing.
  if (current && current.status !== "writing") return {};
  const base: DesignDraft = current ?? { source: "assistant", key: event.toolUseId, runId: event.runId, turn: event.turn, toolUseId: event.toolUseId, html: "", fields: {}, status: "writing", since: now, progress: null, error: null, resync: false };
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
    case "tool_progress": {
      const patch = updateDraft(state, event.toolUseId, (d) => ({ ...d, progress: event.detail }));
      // The subscription path: import_design { preview: true } adds the run's preview_design draft, which has no toolUseId.
      // Only that import has it adding (a dry run leaves it writing), so no other tool's progress lands on it.
      return patch.drafts ? patch : updateRunDraft(state, event.runId, (d) => d.status === "adding", (d) => ({ ...d, progress: event.detail }));
    }
    case "tool_finished": {
      if (event.name !== "import_design") return {};
      // A dry run or a declined replace finishes without adding anything: the draft stops rather than fails.
      const status: DraftStatus = event.imported ? "added" : event.status === "error" ? "failed" : "stopped";
      const finish = (d: DesignDraft): DesignDraft => ({ ...d, status, since: now, progress: null, error: status === "failed" ? event.detail : d.error });
      let patch = updateDraft(state, event.toolUseId, finish);
      if (!patch.drafts) {
        // import_design { preview: true } on the subscription path finishes the run's preview draft: added (its cleared update may come
        // later, or not at all), declined by the replace check (no update comes), or failed (the server's "writing" update came first).
        // A preview dry run finishes done without adding: the draft stays as it is.
        if (event.imported) patch = updateRunDraft(state, event.runId, (d) => d.status === "adding", finish);
        else if (event.status !== "done") patch = updateRunDraft(state, event.runId, (d) => isLive(d.status), finish);
      }
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

/** The window an MCP client's preview update arrived at: what it knows. */
export interface PreviewTarget {
  /** The window's document id, when the editor knows it: an update for another document is ignored. */
  docId: string | null;
  /** The document's revision, and its newest change: a draft cleared after its author's import went in counts as added. */
  revision: number;
  lastChange: Pick<DocumentChange, "kind" | "revision" | "author"> | null;
  /** The in-app Assistant's running reply: a draft it writes through preview_design (the subscription path) belongs to that run. With none, its updates draw nothing. */
  assistantRunId?: string | null;
}

const isLive = (status: DraftStatus) => status === "writing" || status === "adding";
const sameAuthor = (a: Author, b: Author) => a.kind === b.kind && a.name === b.name;

function previewFields(update: DesignPreviewUpdate): AssistantDesignFields {
  return {
    ...(update.name !== null ? { name: update.name } : {}),
    ...(update.component !== null ? { component: update.component } : {}),
    ...(update.replace !== null ? { replace: update.replace } : {}),
    ...(update.width !== null ? { width: update.width } : {}),
    ...(update.height !== null ? { height: update.height } : {}),
    ...(update.position !== null ? { position: [update.position[0], update.position[1]] } : {}),
  };
}

/**
 * Fold an MCP client's preview_design update (the design.preview RPC) into design state. Pure. Each
 * update carries the session's whole draft and its fields; "cleared" ends it, as added when the
 * author's change went in while it was adding (import_design clears it after the import), else stopped.
 */
export function reducePreviewUpdate(state: DesignData, update: DesignPreviewUpdate, now: number, target: PreviewTarget): Partial<DesignData> {
  if (target.docId !== null && update.docId !== target.docId) return {};
  const key = `mcp:${update.key}`;
  const index = state.drafts.findIndex((d) => d.key === key);
  const current = index === -1 ? undefined : state.drafts[index];
  // The session's draft while it's on the canvas (an ended one fades, and a new update starts over).
  const live = current && isLive(current.status) ? current : undefined;
  const mcp = live?.mcp;
  // A call overtaken by a newer one of the same session changes nothing.
  if (mcp && update.draftRevision < mcp.draftRevision) return {};
  const replaceCurrent = (next: DesignDraft) => ({ drafts: state.drafts.map((d, i) => (i === index ? next : d)) });

  if (update.status === "cleared") {
    if (!live || !mcp) return {};
    const change = target.lastChange;
    const from = mcp.addingFrom;
    const added = live.status === "adding" && from !== null && change !== null && change.kind === "apply" && change.revision > from && sameAuthor(change.author, update.author);
    return replaceCurrent({ ...live, status: added ? "added" : "stopped", since: now, mcp: { ...mcp, draftRevision: update.draftRevision, touchedAt: now } });
  }

  // The in-app Assistant's own session: its name, with no relay client id (a client of the relay that calls itself "Assistant" isn't it).
  const ours = update.author.name === ASSISTANT_AUTHOR && update.key === ASSISTANT_AUTHOR;
  // It draws only during its own reply. A call still in flight when its reply ended (Stop) draws after run_finished: that draws
  // nothing, rather than a stranger's draft for minutes, whether or not the reply drew one before (its stopped draft stays
  // stopped). The next reply's first update takes the draft over.
  if (ours && !target.assistantRunId) return {};
  // The document's revision when adding began: the import's change comes after it.
  const addingFrom = update.status === "adding" ? ((live?.status === "adding" ? mcp?.addingFrom : null) ?? target.revision) : null;
  // The Assistant's own drafts belong to its running reply, so the box follows them as its own and the reply's end stops one left writing.
  const runId = ours ? (target.assistantRunId ?? "") : "";
  const next: DesignDraft = {
    source: "mcp",
    key,
    runId,
    turn: 0,
    toolUseId: "",
    html: update.html ?? "",
    fields: previewFields(update),
    status: update.status,
    since: live && live.status === update.status ? live.since : now,
    progress: null,
    error: null,
    resync: false,
    mcp: { author: { ...update.author }, client: update.client ? { ...update.client } : null, draftRevision: update.draftRevision, touchedAt: now, addingFrom },
  };
  if (live) return replaceCurrent(next);
  // A new draft, or one started over after it ended: it's the newest.
  return { drafts: [...state.drafts.filter((d) => d.key !== key), next].slice(-DRAFTS_KEPT) };
}

/** Show an MCP client's preview update on this window's canvas. False when it changed nothing (older than what's shown, or nothing left to clear). */
export function applyPreviewUpdate(session: EditorSession, update: DesignPreviewUpdate, now = Date.now()): boolean {
  const { revision, lastChange } = session.document.getState();
  const assistant = assistantStore.getState();
  // The desktop routes design.preview to the window that shows update.docId, and the editor doesn't learn the id main gave it.
  const patch = reducePreviewUpdate(designStore.getState(), update, now, { docId: null, revision, lastChange, assistantRunId: assistant.running ? assistant.runId : null });
  if (!Object.keys(patch).length) return false;
  designStore.setState(patch);
  return true;
}

/** When an MCP client's draft leaves the canvas if no update comes: its session may have ended without clearing it. Null for the Assistant's drafts. */
export function mcpDraftIdleAt(draft: DesignDraft): number | null {
  if (!draft.mcp) return null;
  return draft.mcp.touchedAt + (draft.status === "writing" ? MCP_DRAFT_STALLED_MS : MCP_DRAFT_IDLE_MS);
}

const isIdleDraft = (draft: DesignDraft, now: number): boolean => {
  const at = mcpDraftIdleAt(draft);
  return at !== null && now >= at;
};

/** End a live MCP draft on this canvas (Hide preview): it fades out onto the layers. The session's next update brings it back. False when there's none. */
export function dismissDraft(key: string, now = Date.now()): boolean {
  const draft = designStore.getState().drafts.find((d) => d.key === key);
  if (!draft?.mcp || !isLive(draft.status)) return false;
  designStore.setState((s) => ({ drafts: s.drafts.map((d) => (d.key === key ? { ...d, status: "stopped", since: now } : d)) }));
  return true;
}

/** The MCP client's draft the canvas shows now, while it's live. The Assistant's own (its run's preview_design) isn't one: the box follows it as its reply. */
export function liveMcpDraft(state: DesignData, now: number): DesignDraft | null {
  const draft = activeDraft(state, now);
  return draft?.mcp && !assistantDraft(draft) && isLive(draft.status) ? draft : null;
}

/** End each MCP draft once it goes idle, so the canvas and the box let go of it when that happens (activeDraft already skips it). Returns stop. */
function endIdleDrafts(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = undefined;
    const next = Math.min(...designStore.getState().drafts.flatMap((d) => (isLive(d.status) ? (mcpDraftIdleAt(d) ?? []) : [])));
    if (!Number.isFinite(next)) return;
    timer = setTimeout(() => {
      const now = Date.now();
      const { drafts } = designStore.getState();
      const ended = drafts.map((d): DesignDraft => (isLive(d.status) && isIdleDraft(d, now) ? { ...d, status: "stopped", since: now } : d));
      // The store change schedules the next one.
      if (ended.some((d, i) => d !== drafts[i])) designStore.setState({ drafts: ended });
      else schedule();
    }, Math.max(0, next - Date.now()) + 1);
  };
  const stop = designStore.subscribe((state, previous) => {
    if (state.drafts !== previous.drafts) schedule();
  });
  schedule();
  return () => {
    stop();
    clearTimeout(timer);
  };
}

/** The draft the canvas previews: the newest writing/adding one of any source, else one that left those states < 400 ms ago (the fade). */
export function activeDraft(state: DesignData, now: number): DesignDraft | null {
  for (let i = state.drafts.length - 1; i >= 0; i--) {
    const draft = state.drafts[i]!;
    if (isLive(draft.status) && !isIdleDraft(draft, now)) return draft;
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

/**
 * Whether an import went into this window's document. Claude can pass another open document's docId,
 * and the editor doesn't know its own, so it checks that its newest change is the import's and added or
 * changed the screen (txnIds count per window, so they alone can collide). Without a txnId, whether the
 * screen is here at all.
 */
function holdsImport(session: EditorSession, imported: AssistantImported): boolean {
  const { doc, lastChange } = session.document.getState();
  if (imported.txnId === null) return locateScreen(doc, imported.screenId, []) !== null;
  return lastChange?.kind === "apply" && lastChange.txnId === imported.txnId && lastChange.affected.layers.includes(imported.screenId);
}

/**
 * Mark the result undone while Undo has put its import on the redo stack, and not after Redo brings it
 * back. Once a later edit empties the redo stack, it stays undone: a redesign keeps its layer's id, so the
 * old layer Undo brought back would otherwise read as Claude's result again. Returns unsubscribe.
 */
function followResultUndo(session: EditorSession): () => void {
  return session.document.subscribe((state, previous) => {
    const { result } = designStore.getState();
    const txnId = result?.txnId;
    // Undo, Redo and edits each move the revision.
    if (!result || !txnId || state.revision === previous.revision) return;
    // Neither stack holding it (the redo stack emptied, or the undo limit dropped it) keeps what it was.
    const undone = state.redoEntries().some((e) => e.txnId === txnId) || (!!result.undone && !state.historyEntries().some((e) => e.txnId === txnId));
    if (undone !== !!result.undone) designStore.setState({ result: { ...result, undone } });
  });
}

/**
 * Subscribe to host.assistant.onEvent (default getAssistantHost()); on tool_finished.imported into this
 * window's document, select and reveal the screen when it's in the current component and the selection
 * hasn't changed since the run started; set result. Also follows Undo of the result, and ends MCP drafts
 * that go idle. Returns detach.
 */
export function attachDesign(session: EditorSession, host: AssistantHostLike | null = getAssistantHost()): () => void {
  // The chip's × means "New screen" until the selection changes.
  const stopSelection = session.selection.subscribe((state, previous) => {
    if (state.layers !== previous.layers && designStore.getState().newScreen) designStore.getState().setNewScreen(false);
  });
  const stopUndo = followResultUndo(session);
  const stopIdle = endIdleDrafts();
  const onEvent = host?.assistant?.onEvent;
  if (!onEvent) {
    return () => {
      stopSelection();
      stopUndo();
      stopIdle();
    };
  }

  /** Each running reply's selection when it started (then the screen it selected). */
  const baselines = new Map<string, readonly Id[]>();
  let resultRun: string | null = null;

  const showImported = (runId: string, imported: AssistantImported) => {
    const design = designStore.getState();
    const request = design.request?.runId === runId ? design.request : null;
    const { doc, lastChange } = session.document.getState();
    const touched = lastChange?.txnId !== undefined && lastChange.txnId === imported.txnId ? lastChange.affected.components : [];
    const found = locateScreen(doc, imported.screenId, [...touched, ...(request ? [request.context.component.id] : []), session.currentComponentId()]);
    resultRun = runId;
    designStore.setState({
      result: {
        kind: imported.replaced ? "updated" : "added",
        layerId: imported.screenId,
        component: found?.componentId ?? request?.context.component.id ?? session.currentComponentId(),
        name: found?.loc.layer.name ?? imported.name,
        txnId: imported.txnId,
        dropped: imported.dropped,
        droppedCount: imported.droppedCount,
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

  const unsubscribe = onEvent((received) => {
    // An import into another open document isn't this window's: its draft stops here, and the box's request didn't add anything here.
    let event = received;
    if (event.type === "tool_finished" && event.imported && !holdsImport(session, event.imported)) {
      const { imported: _elsewhere, ...rest } = event;
      event = rest;
    }
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
    stopUndo();
    stopIdle();
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
