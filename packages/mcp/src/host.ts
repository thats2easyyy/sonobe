/**
 * SonobeHost: everything the MCP tools need from wherever documents live (ARCHITECTURE §10).
 *
 * The desktop app implements it over the live editor (RPC into the renderer); HeadlessHost
 * (headless.ts) implements it over project folders on disk. Tool handlers only talk to this
 * interface, so both front doors behave the same. Browser-safe: types plus HostError.
 */

import type {
  Affected,
  Author,
  Diagnostic,
  Id,
  Op,
  OpResult,
  SonobeDocument,
  SonobeError,
  Suggestion,
} from "@sonobe/core";
import type { EngineRegistry, InputEvent, TraceSummary } from "@sonobe/engine";
import type { DesignCapture, ImportFile, ResolvedImage } from "@sonobe/import";

export type HostKind = "app" | "headless";

/** What a host can do; tools use this to explain unavailable features up front. */
export interface HostCapabilities {
  /** get_screenshot returns images. */
  screenshots: boolean;
  /** get_selection reflects a human's selection in an editor. */
  selection: boolean;
  /** begin_work / reveal show something to a human. */
  presence: boolean;
  /** Writes are saved to disk after every successful batch. */
  autosave: boolean;
  /** import_design draws `<svg data-sf-symbol>` placeholders as real SF Symbols (Sonobe on a Mac). */
  sfSymbols?: boolean;
}

/** One open document. */
export interface DocumentSummary {
  docId: Id;
  name: string;
  /** Project folder on disk, when there is one. */
  path?: string;
  revision: number;
  /** Has changes that aren't saved to disk. */
  dirty: boolean;
  /** Tools that omit docId use the active document. */
  active: boolean;
}

export interface DocumentSnapshot {
  docId: Id;
  path?: string;
  doc: SonobeDocument;
  revision: number;
  dirty: boolean;
  /** Component id → item ids retired this session (removed, so new items never get them). Hosts that don't track them leave it out. */
  retired?: Record<Id, Id[]>;
  /** The app keeps unsaved work as a draft, so it comes back after a crash or quit. */
  draft?: { id: string; updatedAt: number };
}

/** Unsaved work the app kept from an earlier session that no window has open (SonobeHost.listDrafts). */
export interface DraftSummary {
  /** Open it with open_document({ ref: "draft:<id>" }). */
  id: string;
  name: string;
  /** The project it has unsaved changes to; absent when it was never saved. */
  path?: string;
  updatedAt: number;
  counts: { components: number; layers: number; patches: number };
  /** Its files come from two moments (the app stopped mid-write), so the last changes may be missing. */
  torn?: boolean;
}

export interface CreateDocumentRequest {
  /** Project folder to create (required by hosts without a file picker). */
  path?: string;
  name?: string;
  /** Template id from templates.ts ("blank", "photo-zoom"). */
  template?: string;
  /** Device preset id. */
  device?: string;
  /** Make it the active document (default true). */
  open?: boolean;
}

export interface SaveOutcome {
  docId: Id;
  path?: string;
  revision: number;
  written: string[];
  removed: string[];
  /** With force: files others had changed on disk that this save wrote over. */
  overwritten?: string[];
}

/** One step of a long host call. Tools forward the message as an MCP progress notification. */
export interface ProgressStep {
  message: string;
  /** Items done so far within the step, for callers that draw a bar. */
  progress?: number;
  total?: number;
}

/**
 * The trailing argument of host methods that can run long. Requests stay plain data (the desktop sends
 * them over IPC), so the signal and the progress sink travel here.
 */
export interface HostCallControl {
  /** Aborts when the call is cancelled: stop, free what the call holds (windows, browsers), and reject. */
  signal?: AbortSignal;
  /** Report what the host is doing now. */
  progress?(step: ProgressStep): void;
}

export interface OpenDocumentOptions {
  /** Headless: read the project folder again, dropping unsaved changes and undo history. */
  reload?: boolean;
}

export interface SaveDocumentOptions {
  /**
   * Write over changes made outside this session since it last read or saved the project (headless:
   * on disk; app: external changes the person hasn't reviewed). Without it such a save fails with
   * "disk_changed".
   */
  force?: boolean;
  /**
   * Save to this new project folder (Save As), never asking the person where. It must be new or
   * empty and not inside another project (projectTarget.ts). Without it, a document that was never
   * saved goes to ~/Documents/<Name>.sonobe, or fails with "path_needed" while it's still "Untitled".
   */
  path?: string;
}

/** Why an automatic save after a write or undo didn't happen (the change itself stays applied). */
export interface SaveProblem {
  code: string;
  message: string;
  hint?: string;
}

export interface DiagnosticTotals {
  errors: number;
  warnings: number;
  info: number;
}

/** Diagnostics that appeared or went away because of a change. */
export interface DiagnosticsDelta {
  added: Diagnostic[];
  resolved: Diagnostic[];
  totals: DiagnosticTotals;
}

export interface HostApplyOptions {
  docId?: Id;
  /** History label, e.g. "added press animation". */
  label: string;
  author: Author;
  /** Default true: any failing op rolls back the batch. */
  atomic?: boolean;
  dryRun?: boolean;
  /** Reject the batch when the document moved on (optimistic concurrency). */
  expectedRevision?: number;
  /** Component used by ops that don't name one. */
  defaultComponent?: Id;
  /**
   * The tool call's cancellation signal. Once it has aborted, apply refuses (HostError "cancelled")
   * without changing anything, so a cancelled call never lands. An apply that has started finishes.
   */
  signal?: AbortSignal;
}

export interface HostApplyResult {
  ok: boolean;
  docId: Id;
  /** Revision after the batch (unchanged when nothing applied). */
  revision: number;
  dryRun: boolean;
  /** History group id when the batch was committed. */
  txnId?: string;
  results: OpResult[];
  errors: SonobeError[];
  idMap: Record<string, Id>;
  affected: Affected;
  applied: Op[];
  diagnostics: DiagnosticsDelta;
  /** Set when expectedRevision didn't match. */
  conflict?: { expectedRevision: number; currentRevision: number };
  /** The batch was written to disk (autosave hosts). */
  saved?: boolean;
  /** Autosave hosts: why the applied batch wasn't written to disk. */
  saveError?: SaveProblem;
  /** dryRun only: the would-be document. */
  preview?: SonobeDocument;
}

export interface Selection {
  docId: Id;
  component: Id;
  layers: Id[];
  patches: Id[];
  comments: Id[];
  /** Why the selection is always empty (headless hosts). */
  note?: string;
}

export type ScreenshotTarget =
  { kind: "viewer" } | { kind: "canvas" } | { kind: "graph" } | { kind: "layer"; layerId: Id };

export interface ScreenshotOptions {
  docId?: Id;
  /** Render a simulation's current frame instead of the live viewer. */
  simId?: string;
  /**
   * Milliseconds later: with simId, the frame this long after the session's current frame, drawn on
   * a copy so the session doesn't move; without simId (headless), this long after the prototype starts
   * (omitted: once start-up animations settle, up to 5 s).
   */
  atMs?: number;
  component?: Id;
  /**
   * With a layer target: draw only that layer and its children, where they are in the frame, without
   * the layers in front of or behind it (or its parents' opacity and clipping). Drawn from a
   * SceneFrame, so without simId the app draws a fresh run like headless servers do.
   */
  isolate?: boolean;
  /** Device pixel scale (default 1). */
  scale?: number;
  /** Downscale so the image is at most this wide. */
  maxWidth?: number;
}

export interface Screenshot {
  /** Base64-encoded image bytes. */
  data: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  timeMs?: number;
  /** What the image approximates or leaves out (headless drawings), in plain words. */
  notes?: string[];
}

/** The session behind an agent's call, when the transport knows it (the relay's sonobe-client id). */
export interface WorkClient {
  id: string;
  /** "Claude Code", "Claude Desktop", or the client's own name. */
  label: string;
  /** The session's project folder. */
  folder?: string;
}

/** An agent's "working on" badge. */
export interface WorkIntent {
  ids: Id[];
  intent: string;
  author: Author;
  since: number;
  /** The session that set it; badges are kept per session, so two sessions don't replace each other's. */
  client?: WorkClient;
}

export interface HistoryItem {
  txnId: string;
  label: string;
  author: Author;
  revision: number;
  opCount: number;
  timestamp: number;
  /** "Claude: added press animation (12 ops)". */
  summary: string;
}

export interface HistoryListOptions {
  docId?: Id;
  limit?: number;
  /** "human", "agent", or an author name. */
  author?: string;
}

export interface UndoOptions {
  docId?: Id;
  /** Undo every group up to and including this one (default: the newest). */
  txnId?: string;
  author: Author;
  /** Allow undoing a human's edit without naming its txnId. */
  allowHumanEdits?: boolean;
  /** Like HostApplyOptions.signal: a cancelled call never undoes anything. */
  signal?: AbortSignal;
}

export interface UndoResult {
  docId: Id;
  revision: number;
  undone: HistoryItem[];
  diagnostics: DiagnosticsDelta;
  saved?: boolean;
  /** Autosave hosts: why the undo wasn't written to disk. */
  saveError?: SaveProblem;
}

// ---------------------------------------------------------------------------
// Design import
// ---------------------------------------------------------------------------

/** A page to render and capture for import_design. */
export interface DesignCaptureRequest {
  /** An http(s) page, such as the person's app on a dev server. */
  url?: string;
  /** A complete HTML document (or fragment) to render. */
  html?: string;
  /** Viewport in points (CSS pixels). */
  width: number;
  height: number;
  /** Capture only the first element matching this selector. */
  selector?: string;
  /** Wait until an element matches this selector before capturing. */
  waitFor?: string;
  /** Extra milliseconds to wait once the page settles. */
  waitMs?: number;
  /** Capture the whole page height (default true). */
  fullPage?: boolean;
  /** prefers-color-scheme for the page. */
  colorScheme?: "light" | "dark";
  /** Also return a screenshot of the page as the browser drew it. */
  screenshot?: boolean;
  /** The whole capture's deadline, not counting waitMs. Default 90 s; hosts may lower it, never raise it. */
  timeoutMs?: number;
}

export interface CapturedDesign {
  capture: DesignCapture;
  /** Downloaded image bytes by capture image key (null: couldn't download). */
  images: ReadonlyMap<string, ResolvedImage | null>;
  /** The page as the browser drew it (when requested). */
  screenshot?: Screenshot;
  /** What the capture left out or approximated (a screenshot that timed out, images cut off), in plain words. */
  notes?: string[];
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/** A layer ("@card", "@card#2" for a loop copy) or a point in prototype coordinates. */
export type SimTarget = string | [number, number];

interface SimEventBase {
  /** Milliseconds after the dispatch (or trace) starts. Default 0. */
  atMs?: number;
}

/** High-level input the simulation synthesizes into pointer, key, and text events. */
export type SimEvent =
  | (SimEventBase & { kind: "tap"; target: SimTarget; holdMs?: number })
  | (SimEventBase & { kind: "longPress"; target: SimTarget; durationMs?: number })
  | (SimEventBase & {
      kind: "drag";
      from: SimTarget;
      to: SimTarget;
      durationMs?: number;
      release?: boolean;
    })
  | (SimEventBase & { kind: "hover"; target: SimTarget })
  | (SimEventBase & { kind: "leave" })
  | (SimEventBase & { kind: "scroll"; target: SimTarget; dx?: number; dy?: number })
  | (SimEventBase & {
      kind: "key";
      key: string;
      phase?: "press" | "down" | "up";
      shift?: boolean;
      alt?: boolean;
      meta?: boolean;
      ctrl?: boolean;
    })
  | (SimEventBase & { kind: "text"; layer: Id; value: string })
  | (SimEventBase & { kind: "focus"; layer: Id; focused: boolean })
  | (SimEventBase & { kind: "submit"; layer: Id })
  | (SimEventBase & {
      kind: "pointer";
      phase: "down" | "move" | "up" | "cancel" | "leave";
      x: number;
      y: number;
      pointerId?: number;
      pointerType?: "mouse" | "touch" | "pen";
    })
  | (SimEventBase & { kind: "orientation"; orientation: "portrait" | "landscape" })
  | (SimEventBase & {
      kind: "deviceMotion";
      acceleration: [number, number, number];
      rotationRate: [number, number, number];
    });

export interface SimIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  patchId?: Id;
  layerId?: Id;
  hint?: string;
  /** Ready-to-apply fixes (empty_loop warnings carry them). */
  suggestions?: Suggestion[];
}

/** Common fields of every simulation result. */
export interface SimState {
  simId: string;
  docId: Id;
  frame: number;
  timeMs: number;
  fps: number;
  seed: number;
  /** The document changed since the last call and was hot-swapped into the simulation. */
  documentUpdated?: boolean;
  /** Runtime issues raised since the last call (unimplemented patches, script errors...). */
  issues: SimIssue[];
  /** sim_override changes this session simulates on top of the person's document (absent when none). */
  overrides?: SimOverride[];
  /** Overrides the person's newer document no longer accepts, dropped since the last call. */
  droppedOverrides?: { target: string; reason: string }[];
  /** sim_reset only: the overrides the reset cleared. */
  clearedOverrides?: SimOverride[];
}

export interface SimResetOptions {
  docId?: Id;
  /** Reset this session instead of creating a new one. */
  simId?: string;
  seed?: number;
  fps?: 60 | 120;
  /** With simId: keep the session's overrides (default: a reset clears them). */
  keepOverrides?: boolean;
}

/** A literal to pin on a patch input or layer property inside one simulation. */
export interface SimOverrideSet {
  /**
   * "patchId.port" or "@layerId.prop". An instance path ("@card/badge.opacity", "card/tap.enabled")
   * changes the component the instance runs, so every instance of it.
   */
  target: string;
  /** A literal or wrapper value, or null for the declared default. */
  value: unknown;
  /** The component the target lives in (default: the root, or the instance path's component). */
  component?: Id;
}

/** sim_override: change values inside one simulation without touching the person's document. */
export interface SimOverrideRequest {
  set?: SimOverrideSet[];
  /** Value-level ops: setInput, connect, disconnect, updateLayer { props }, updatePatch { muted }. */
  ops?: Op[];
  /** Override ids ("ov_2") or targets to drop, or "all". Applied before set and ops. */
  clear?: string[] | "all";
  /** Start the simulation over from frame 0 with the resulting overrides (default: keep its state). */
  restart?: boolean;
}

/** One override a session simulates. */
export interface SimOverride {
  /** "ov_1": pass it to clear. */
  id: string;
  /** What it changes, as written ("@card_1.opacity", "grow_spring.number", "pop (muted)"). */
  target: string;
  /** The component it changes. */
  component: Id;
  /** "@card_1.opacity = 0 (was 1)". */
  summary: string;
}

export interface SimOverrideResult extends SimState {
  overrides: SimOverride[];
  /** Overrides this call added or replaced. */
  applied: SimOverride[];
  /** Overrides this call cleared. */
  cleared: SimOverride[];
  /** The session started over from frame 0. */
  restarted: boolean;
}

export interface SimHit {
  /** Front-most layer under the point, if any. */
  layerId?: Id;
  layerName?: string;
  /** The front-most node's own scene key: "card#0" for a loop copy, else the layer id. */
  key?: string;
  /** Instance path of the front-most layer when it's inside a component instance ("card#2"). */
  instancePath?: string;
  /** Front-most first, including ancestors that touches bubble to. */
  chain: Id[];
  /** Interaction-type patches listening to a layer in the chain (or to the whole screen); "card/tap_badge" inside instances. */
  handledBy: Id[];
}

export interface SimDispatchedEvent {
  index: number;
  kind: SimEvent["kind"];
  /** Resolved press or hover point. */
  point?: [number, number];
  hit?: SimHit;
  warnings: string[];
}

export interface SimDispatchResult extends SimState {
  framesStepped: number;
  events: SimDispatchedEvent[];
}

export type SimCompareOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface SimStepOptions {
  frames?: number;
  ms?: number;
  /** "idle": nothing animating and watched values stable; or a condition on a value. */
  until?: "idle" | { target: string; op: SimCompareOp; value: number | boolean | string };
  /** Cap for `until` (default 10000 ms). */
  maxMs?: number;
  /** Values reported in `changed` (default: linked layer properties of the root component). */
  watch?: string[];
}

export interface SimChange {
  target: string;
  from: unknown;
  to: unknown;
}

export interface SimStepResult extends SimState {
  framesStepped: number;
  settled: boolean;
  timedOut: boolean;
  changed: SimChange[];
}

export interface SimTraceOptions {
  targets: string[];
  durationMs: number;
  events?: SimEvent[];
  /** Advance the session through the traced time (default false: trace a copy). */
  advance?: boolean;
}

export interface SimTraceResult extends SimState {
  /** Hit reports for the scheduled events. */
  events: SimDispatchedEvent[];
  targets: string[];
  /** Milliseconds since the trace started, one per frame. */
  times: number[];
  values: Record<string, unknown[]>;
  summaries: Record<string, TraceSummary | null>;
  /**
   * advance: true only: frames the session stepped past durationMs to finish the scheduled events
   * (a drag's release), so no pointer is left down.
   */
  framesAfterTrace?: number;
}

export interface SimValuesResult extends SimState {
  values: Record<string, unknown>;
  /**
   * Plain-words notes for targets whose value needs one, by target: that it's overridden in this
   * simulation ("overridden in this simulation, was 1"), why it reads as null or an empty loop
   * ("Not drawn: Layer "Card" has 0 copies because ..."), or that "#n" is past the end.
   */
  notes?: Record<string, string>;
}

export interface SimHost {
  reset(options: SimResetOptions): Promise<SimState>;
  dispatch(simId: string, events: SimEvent[]): Promise<SimDispatchResult>;
  step(simId: string, options: SimStepOptions): Promise<SimStepResult>;
  trace(simId: string, options: SimTraceOptions): Promise<SimTraceResult>;
  values(simId: string, targets: string[]): Promise<SimValuesResult>;
  /** Change values inside one session only (sim_override); the person's document never changes. */
  override(simId: string, request: SimOverrideRequest): Promise<SimOverrideResult>;
  /** Open sessions (for get_document_info). */
  list(docId?: Id): SimState[];
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

/**
 * A change that MCP resource notifications publish: a new revision updates the document's
 * outline and diagnostics resources; opening or closing a document changes the resource list.
 */
export type DocumentChange =
  | { kind: "revision"; docId: Id; revision: number }
  | { kind: "opened"; docId: Id }
  | { kind: "closed"; docId: Id };

/** What restart_viewer did (SonobeHost.restartViewer). */
export interface ViewerRestartResult {
  docId: Id;
  /** The prototype plays on from its first frame; false when the person paused it (it shows frame 0). */
  playing: boolean;
}

/** What the live viewer's running prototype reports (SonobeHost.diagnostics `runtime`). */
export interface LiveRuntimeDiagnostics {
  /** The live prototype's frame when this was read. */
  frame: number;
  playing: boolean;
  /** Runtime issues as diagnostics: empty_loop warnings, script errors, loop limits... */
  diagnostics: Diagnostic[];
}

export interface SonobeHost {
  readonly kind: HostKind;
  readonly capabilities: HostCapabilities;
  /** Patch and layer declarations plus evaluators. */
  readonly registry: EngineRegistry;

  listDocuments(): Promise<DocumentSummary[]>;
  /** Optional: drafts of unsaved work from earlier sessions that no window has open (the app). */
  listDrafts?(): Promise<DraftSummary[]>;
  /** Open (or activate) a document by docId or project folder path, or "draft:<id>" (the app). */
  openDocument(ref: string, options?: OpenDocumentOptions & HostCallControl): Promise<DocumentSummary>;
  createDocument(request: CreateDocumentRequest, control?: HostCallControl): Promise<DocumentSummary>;
  /** A document snapshot (default: the active document). */
  getDocument(docId?: Id): Promise<DocumentSnapshot>;
  /** Throws HostError("disk_changed") when the project changed outside this session, unless `force`. */
  saveDocument(docId?: Id, options?: SaveDocumentOptions & HostCallControl): Promise<SaveOutcome>;
  /** Apply a batch through core applyOps as one attributed history group. Refuses once options.signal aborted. */
  apply(ops: Op[], options: HostApplyOptions): Promise<HostApplyResult>;
  /**
   * Diagnostics for the current revision (cached). Hosts with a live viewer add `runtime`: what the
   * running prototype reports right now (empty loops, script errors, loop limits), which changes
   * without a new revision.
   */
  diagnostics(docId?: Id): Promise<{
    docId: Id;
    revision: number;
    diagnostics: Diagnostic[];
    runtime?: LiveRuntimeDiagnostics;
  }>;

  getSelection(docId?: Id): Promise<Selection>;
  /** Throws HostError("screenshots_unavailable") when capabilities.screenshots is false. */
  screenshot(target: ScreenshotTarget, options: ScreenshotOptions): Promise<Screenshot>;
  reveal(
    ids: Id[],
    options: { docId?: Id; focus?: boolean },
  ): Promise<{ revealed: boolean; reason?: string }>;
  /**
   * Optional: start the person's live prototype over from its first frame, as Restart Prototype (⌘R)
   * does; phones and the pop-out viewer showing it restart too. Hosts without a live viewer leave it
   * out, and restart_viewer explains that simulations start over with sim_reset.
   */
  restartViewer?(options: { docId?: Id }): Promise<ViewerRestartResult>;
  /**
   * Show (or clear, with null) an agent's working badge. One badge per session: `client.id` when the
   * call came through the relay, else the author's name.
   */
  setWorking(
    work: { ids: Id[]; intent: string } | null,
    options: { docId?: Id; author: Author; client?: WorkClient },
  ): Promise<void>;
  /** Current working badges. */
  presence(docId?: Id): Promise<WorkIntent[]>;

  readonly sim: SimHost;
  readonly history: {
    list(options: HistoryListOptions): Promise<HistoryItem[]>;
    undo(options: UndoOptions): Promise<UndoResult>;
  };

  /**
   * Optional: render a URL or HTML page in a browser and capture it for import_design. Hosts without
   * a browser leave it out (import_design then accepts only ready-made captures).
   *
   * Hosts must finish within one deadline (90 s plus waitMs, or request.timeoutMs when lower) and
   * reject with HostError "capture_timeout" naming the stage that ran out of time; stop at once when
   * control.signal aborts (HostError "cancelled"); report stages through control.progress; and free
   * the browser window or process on every path.
   */
  captureDesign?(request: DesignCaptureRequest, control?: HostCallControl): Promise<CapturedDesign>;
  /**
   * Optional: download a capture's http(s) images (for captures made elsewhere). Default: Node's fetch
   * where it exists.
   */
  fetchImage?(url: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /**
   * Hold asset files (assets/<sha256>.<ext>) for a document so addAsset ops that name them draw right
   * away and save with the project. Required by import_design when the import brings new images.
   */
  putAssetFiles?(files: readonly ImportFile[], options: { docId?: Id } & HostCallControl): Promise<void>;

  /**
   * Optional: subscribe to document changes (new revisions, opened and closed documents).
   * createHttpHandler and serveStdioHost subscribe automatically and publish resource
   * notifications. Hosts without it can call NodeMcpHandler.documentChanged themselves.
   */
  onDocumentChange?(listener: (change: DocumentChange) => void): () => void;
}

/** A host failure written for the agent: code, message, hint, and ready-to-apply suggestions. */
export class HostError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly suggestions: Suggestion[];
  readonly data: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    extra: { hint?: string; suggestions?: Suggestion[]; data?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "HostError";
    this.code = code;
    this.hint = extra.hint;
    this.suggestions = extra.suggestions ?? [];
    this.data = extra.data;
  }
}

export function isHostError(err: unknown): err is HostError {
  return (
    err instanceof HostError ||
    (!!err &&
      typeof err === "object" &&
      (err as { name?: unknown }).name === "HostError" &&
      typeof (err as { code?: unknown }).code === "string")
  );
}

/** Events synthesized for one frame. */
export interface ScheduledFrameEvents {
  atMs: number;
  events: InputEvent[];
}
