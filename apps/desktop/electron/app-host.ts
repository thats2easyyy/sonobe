/**
 * SonobeHost for the desktop app (ARCHITECTURE.md §10). MCP tools reach the live editor through the
 * renderer RPC handlers in apps/editor/src/host/rpcHandlers.ts, so every edit lands in the person's
 * undo history and AI Activity. Around that bridge, the main process caches documents by revision,
 * computes diagnostics and runs simulations on the patch registry, guards undo against discarding
 * human edits, and crops screenshots to the viewer. Electron-free: windows arrive as RendererTargets.
 */

import { homedir } from "node:os";
import path from "node:path";
import { applyOps, getDiagnostics, slugify, uniqueId, type Affected, type Author, type Diagnostic, type Id, type Op, type OpResult, type SonobeDocument, type SonobeError } from "@sonobe/core";
import type { EngineRegistry, SceneFrame, SceneNode } from "@sonobe/engine";
import {
  createSimulationManager,
  createTemplateDocument,
  diagnosticTotals,
  diffDiagnostics,
  HostError,
  isHostError,
  TEMPLATES,
  ToolCancelledError,
  type DocumentSummary,
  type HistoryItem,
  type CapturedDesign,
  type DesignCaptureRequest,
  type HostApplyResult,
  type HostCallControl,
  type Screenshot,
  type ScreenshotOptions,
  type ScreenshotTarget,
  type SimHost,
  type SimulationManager,
  type SimulationManagerOptions,
  type SonobeHost,
  type WorkIntent,
} from "@sonobe/mcp";
import { intersectRects, isRect, isViewerBounds, screenshotSize, viewerCaptureRect, type Rect, type Size, type ViewerBoundsLike } from "./screenshot.ts";

export interface CapturedImage {
  /** Base64-encoded PNG. */
  data: string;
  width: number;
  height: number;
}

/** One editor window, as the app host sees it. */
export interface RendererTarget {
  /** Stable for the window's lifetime (the webContents id). */
  readonly id: number;
  /** Call a renderer RPC handler. Rejects with `{ code, message, data }` errors. */
  invoke<T = unknown>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T>;
  /** Whether the renderer registered `method`; undefined before it reported any methods. */
  hasMethod(method: string): boolean | undefined;
  /** Bring the window to the front. */
  focus(): void;
  /** Capture a page rect (viewport CSS pixels) as a PNG at most `size` big; null when capture fails. */
  capture(rect: Rect, size: Size): Promise<CapturedImage | null>;
}

export interface AppHostOptions {
  registry: EngineRegistry;
  /** Editor windows, the focused one first. */
  targets(): RendererTarget[];
  /** Open a window when none exists and resolve once its editor can answer (or null). */
  ensureTarget?(): Promise<RendererTarget | null>;
  /** Resolve a folder an agent named to an approved project directory, or null when it isn't one. */
  approveProject(dir: string): Promise<string | null>;
  /** Where create_document puts a project when no path is given (should not exist yet). */
  defaultProjectDir(name: string): Promise<string>;
  /** Whether `dir` already holds a Sonobe project. */
  projectExists(dir: string): Promise<boolean>;
  /** Write a new project folder to disk (and approve it for the editor). */
  writeProject(dir: string, doc: SonobeDocument): Promise<void>;
  /**
   * Draw a simulation's frame for get_screenshot({ simId }). Without it (or when @sonobe/mcp's
   * SimulationManager has no `scene(simId)`), simulation screenshots explain that they're unavailable.
   */
  renderScene?(request: SceneRenderRequest): Promise<CapturedImage | null>;
  /** Render a URL or HTML page in a hidden browser window and capture it (import_design). */
  captureDesign?(request: DesignCaptureRequest, control?: HostCallControl): Promise<CapturedDesign>;
  /** Download an image for a capture made elsewhere (default: Node's fetch). */
  fetchImage?(url: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** A window's document appeared, reached a new revision, or went away (drives MCP resource notifications). */
  onDocumentChange?(change: DocumentChange): void;
  /** Creates the simulation manager. Default: @sonobe/mcp createSimulationManager (tests wrap it). */
  simulations?(options: SimulationManagerOptions): SimulationManager;
  maxSimSessions?: number;
  now?: () => number;
}

/** What renderScene draws. */
export interface SceneRenderRequest {
  scene: SceneFrame;
  /** The part of the screen to capture, in prototype points. */
  crop: Rect;
  /** Output image size in pixels. */
  size: Size;
  /** Asset id → absolute path of its file in the project's assets folder (none for unsaved projects). */
  assets: Record<string, string>;
}

export interface DocumentChange {
  kind: "opened" | "changed" | "closed";
  docId: Id;
  revision: number;
  /** The window (RendererTarget id). */
  targetId: number;
}

export interface AppHost extends SonobeHost {
  /** Forget a closed window's document, badges and simulations. */
  forgetTarget(id: number): void;
  /** The editor in window `targetId` pushed a new revision (sonobeHost.notifyDocumentChanged). */
  documentChanged(targetId: number, revision: number): Promise<void>;
  /** Whether get_screenshot({ simId }) can draw a simulation's frame. */
  simulationScreenshots(): boolean;
  dispose(): void;
}

/** What `document.info` returns. */
interface RendererInfo {
  name: string;
  projectPath: string | null;
  revision: number;
  dirty: boolean;
}

interface RendererApplyReply {
  result: { ok: boolean; results: OpResult[]; errors: SonobeError[]; idMap: Record<string, Id>; affected: Affected; applied: number };
  revision: number;
  /** The ops as the editor applied them, with the ids it generated (it knows which ids this session reserved). */
  applied?: Op[];
  /** The history group of a committed batch. */
  txnId?: string;
  /** Every diagnostic of the resulting document (the preview for a dry run), so the main process doesn't diagnose it again. */
  documentDiagnostics?: Diagnostic[];
}

interface RendererHistoryEntry {
  txnId: string;
  label: string;
  author: Author;
  revision: number;
  opCount: number;
  timestamp: number;
  description: string;
}

interface Snapshot {
  revision: number;
  doc: SonobeDocument;
}

interface Entry {
  target: RendererTarget;
  docId: Id;
  info: RendererInfo;
  snapshot: Snapshot | null;
  diagnostics: { doc: SonobeDocument; list: Diagnostic[] } | null;
  /** Working badges this host started, by author name. */
  working: Map<string, { workId: string; intent: WorkIntent }>;
}

const OPEN_TIMEOUT_MS = 120_000;
const APPLY_TIMEOUT_MS = 60_000;
const HISTORY_SCAN = 500;

const EDITOR_NOT_CONNECTED_HINT =
  "Wait a moment for the editor to finish loading, then retry. If it keeps happening, this editor build doesn't include the MCP bridge: rebuild it with `npm run build -w @sonobe/editor` and restart Sonobe.";

function noWindow(): HostError {
  return new HostError("no_window", "Sonobe has no editor window open.", {
    hint: "Ask the person to open a prototype in Sonobe (File → New Prototype or Open…), or call open_document with a project folder.",
  });
}

function unexpectedReply(method: string): HostError {
  return new HostError("editor_error", `The editor sent an unexpected reply to ${method}.`, {
    hint: "This is a bug in Sonobe (the editor and app may be out of sync). Restart Sonobe and try again.",
  });
}

/** Turn a renderer RPC failure into a teaching HostError. */
export function hostErrorFromRpc(err: unknown, method: string): HostError {
  if (isHostError(err)) return err;
  const e = (err ?? {}) as { code?: unknown; message?: unknown; data?: unknown };
  const code = typeof e.code === "string" ? e.code : "editor_error";
  const message = typeof e.message === "string" && e.message ? e.message : String(err);
  switch (code) {
    case "no_handler":
      return new HostError("editor_not_connected", "This Sonobe window's editor isn't connected to Claude yet.", { hint: EDITOR_NOT_CONNECTED_HINT, data: { method } });
    case "renderer_gone":
      return new HostError("window_closed", "The Sonobe window closed before it answered.", { hint: "Ask the person to open the prototype again, then retry." });
    case "timeout":
      return new HostError("editor_timeout", `The editor didn't answer ${method} in time.`, { hint: "It may be busy or showing a dialog. Ask the person to check the Sonobe window, then retry." });
    case "disposed":
      return new HostError("app_quitting", "Sonobe is quitting.", { hint: "Reopen Sonobe to continue." });
    case "send_failed":
    case "unserializable_result":
      return new HostError("editor_error", message, { hint: "This is a bug in Sonobe. The call couldn't cross into the editor; try a smaller request." });
    default: {
      const data = e.data && typeof e.data === "object" && !Array.isArray(e.data) ? { ...(e.data as Record<string, unknown>) } : undefined;
      const hint = typeof data?.hint === "string" ? data.hint : undefined;
      if (data) {
        delete data.hint;
        for (const reserved of ["ok", "changed", "error"]) delete data[reserved];
      }
      return new HostError(code, message, { ...(hint ? { hint } : {}), ...(data && Object.keys(data).length ? { data } : {}) });
    }
  }
}

function asInfo(value: unknown): RendererInfo {
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v.name !== "string" || typeof v.revision !== "number") throw unexpectedReply("document.info");
  return { name: v.name, projectPath: typeof v.projectPath === "string" ? v.projectPath : null, revision: v.revision, dirty: v.dirty === true };
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(homedir(), p.slice(1)) : p;
}

function samePath(a: string, b: string): boolean {
  if (!path.isAbsolute(expandHome(b))) return false;
  const norm = (p: string) => path.resolve(expandHome(p)).replace(/[\\/]+$/, "");
  return process.platform === "linux" ? norm(a) === norm(b) : norm(a).toLowerCase() === norm(b).toLowerCase();
}

const toHistoryItem = (e: RendererHistoryEntry): HistoryItem => ({ txnId: e.txnId, label: e.label, author: e.author, revision: e.revision, opCount: e.opCount, timestamp: e.timestamp, summary: e.description });

/** An undone group as history.undo reports it (older editor builds send only txnId, label, author and opCount). */
function undoneItem(e: Partial<RendererHistoryEntry>, revision: number): HistoryItem {
  const author: Author = e.author && typeof e.author.name === "string" ? e.author : { kind: "human", name: "Someone" };
  const label = typeof e.label === "string" ? e.label : "";
  return {
    txnId: String(e.txnId ?? ""),
    label,
    author,
    revision: typeof e.revision === "number" ? e.revision : revision,
    opCount: typeof e.opCount === "number" ? e.opCount : 0,
    timestamp: typeof e.timestamp === "number" ? e.timestamp : 0,
    summary: typeof e.description === "string" ? e.description : `${author.name}: ${label}`,
  };
}

function matchesAuthor(author: Author, filter: string | undefined): boolean {
  if (!filter) return true;
  if (filter === "human" || filter === "agent") return author.kind === filter;
  return author.name.toLowerCase() === filter.toLowerCase();
}

/** CSS pixels per prototype point, measured from the stage (the viewer may be zoomed by CSS outside the renderer). */
function measuredScale(bounds: ViewerBoundsLike): number {
  return bounds.prototypeSize[0] > 0 && bounds.stage.width > 0 ? bounds.stage.width / bounds.prototypeSize[0] : bounds.scale;
}

function* walkScene(nodes: readonly SceneNode[]): Generator<SceneNode> {
  for (const node of nodes) {
    yield node;
    yield* walkScene(node.children);
  }
}

/** Axis-aligned bounds of a node in prototype points. */
function nodeBounds(node: SceneNode): Rect {
  const m = node.worldTransform;
  const corners = [
    [0, 0],
    [node.width, 0],
    [0, node.height],
    [node.width, node.height],
  ].map(([x, y]) => [m[0]! * x! + m[4]! * y! + m[12]!, m[1]! * x! + m[5]! * y! + m[13]!] as const);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** Where a layer is drawn in a scene: its exact node key, else every copy of it (loops, components). */
export function sceneLayerBounds(scene: SceneFrame, layerId: string): Rect | null {
  const nodes = [...walkScene(scene.roots)];
  const exact = nodes.find((n) => n.key === layerId);
  const matches = exact ? [exact] : nodes.filter((n) => n.layerId === layerId);
  if (!matches.length) return null;
  const rects = matches.map(nodeBounds);
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Asset id → file path for a saved project (files must stay inside assets/). */
function assetFiles(doc: SonobeDocument | undefined, projectPath: string | null): Record<string, string> {
  if (!doc || !projectPath) return {};
  const out: Record<string, string> = {};
  for (const [id, record] of Object.entries(doc.assets ?? {})) {
    const file = (record as { file?: unknown }).file;
    if (typeof file === "string" && file && path.basename(file) === file && file !== "..") out[id] = path.join(projectPath, "assets", file);
  }
  return out;
}

export function createAppHost(options: AppHostOptions): AppHost {
  const { registry } = options;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<number, Entry>();
  const simDocs = new Map<string, Id>();
  let activeId: number | null = null;

  const call = async <T>(target: RendererTarget, method: string, params?: unknown, timeoutMs?: number): Promise<T> => {
    try {
      return await target.invoke<T>(method, params, timeoutMs !== undefined ? { timeoutMs } : undefined);
    } catch (err) {
      throw hostErrorFromRpc(err, method);
    }
  };

  const emit = (change: DocumentChange) => {
    try {
      options.onDocumentChange?.(change);
    } catch {
      // Notifications are best effort.
    }
  };

  const forget = (id: number) => {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    manager.closeDocument(entry.docId);
    for (const [simId, docId] of simDocs) if (docId === entry.docId) simDocs.delete(simId);
    if (activeId === id) activeId = null;
    emit({ kind: "closed", docId: entry.docId, revision: entry.info.revision, targetId: id });
  };

  const prune = (targets: readonly RendererTarget[]) => {
    for (const id of [...entries.keys()]) if (!targets.some((t) => t.id === id)) forget(id);
  };

  const findEntry = (ref: string): Entry | undefined => [...entries.values()].find((e) => e.docId === ref || (e.info.projectPath !== null && samePath(e.info.projectPath, ref)));

  const assignDocId = (entry: Entry) => {
    entry.docId = uniqueId(slugify(entry.info.name, "document"), (id: Id) => [...entries.values()].some((other) => other !== entry && other.docId === id));
  };

  /** Fresh document.info for a window (creating its entry on first sight). */
  const describe = async (target: RendererTarget): Promise<Entry> => {
    const info = asInfo(await call<unknown>(target, "document.info"));
    let entry = entries.get(target.id);
    if (entry) {
      const changed = entry.info.revision !== info.revision;
      entry.target = target;
      entry.info = info;
      if (changed) emit({ kind: "changed", docId: entry.docId, revision: info.revision, targetId: target.id });
    } else {
      entry = { target, docId: "", info, snapshot: null, diagnostics: null, working: new Map() };
      entries.set(target.id, entry);
      assignDocId(entry);
      emit({ kind: "opened", docId: entry.docId, revision: info.revision, targetId: target.id });
    }
    return entry;
  };

  const activeTarget = (targets: readonly RendererTarget[]) => (activeId !== null ? targets.find((t) => t.id === activeId) : undefined) ?? targets[0];

  const resolve = async (docId: Id | undefined): Promise<Entry> => {
    const targets = options.targets();
    prune(targets);
    if (docId === undefined) {
      const target = activeTarget(targets);
      if (!target) throw noWindow();
      return describe(target);
    }
    const known = findEntry(docId);
    if (known) return describe(known.target);
    for (const target of targets) if (!entries.has(target.id)) await describe(target).catch(() => undefined);
    const found = findEntry(docId);
    if (found) return describe(found.target);
    const open = [...entries.values()].map((e) => e.docId);
    throw new HostError("unknown_document", `There's no open document "${docId}".`, {
      hint: open.length ? `Open documents: ${open.join(", ")}. Omit docId to use the one in front.` : "Nothing is open in Sonobe yet. Ask the person to open a prototype, or call open_document with a project folder.",
    });
  };

  /** The document at the entry's last described revision (fetched only when it changed). */
  const snapshot = async (entry: Entry): Promise<Snapshot> => {
    if (entry.snapshot && entry.snapshot.revision === entry.info.revision) return entry.snapshot;
    const reply = (await call<unknown>(entry.target, "document.get", { format: "json", diagnostics: true })) as { revision?: unknown; document?: unknown; diagnostics?: unknown } | null;
    if (!reply || typeof reply.revision !== "number" || !reply.document || typeof reply.document !== "object") throw unexpectedReply("document.get");
    entry.snapshot = { revision: reply.revision, doc: reply.document as SonobeDocument };
    entry.info = { ...entry.info, revision: reply.revision };
    // The editor already knows the document's diagnostics; older builds don't send them, and diagnosticsOf computes them here.
    if (Array.isArray(reply.diagnostics)) entry.diagnostics = { doc: entry.snapshot.doc, list: reply.diagnostics as Diagnostic[] };
    return entry.snapshot;
  };

  const refresh = async (entry: Entry): Promise<Snapshot> => snapshot(await describe(entry.target));

  const diagnosticsOf = (entry: Entry, snap: Snapshot): Diagnostic[] => {
    if (entry.diagnostics?.doc !== snap.doc) entry.diagnostics = { doc: snap.doc, list: getDiagnostics(snap.doc, registry) };
    return entry.diagnostics.list;
  };

  const summary = (entry: Entry): DocumentSummary => ({
    docId: entry.docId,
    name: entry.info.name,
    ...(entry.info.projectPath ? { path: entry.info.projectPath } : {}),
    revision: entry.info.revision,
    dirty: entry.info.dirty,
    active: entry.target.id === activeTarget(options.targets())?.id,
  });

  const manager: SimulationManager = (options.simulations ?? createSimulationManager)({
    registry,
    ...(options.maxSimSessions !== undefined ? { maxSessions: options.maxSimSessions } : {}),
    getDocument: (docId) => {
      const entry = docId !== undefined ? findEntry(docId) : activeId !== null ? entries.get(activeId) : entries.values().next().value;
      if (!entry?.snapshot) throw new HostError("unknown_document", docId !== undefined ? `There's no open document "${docId}".` : "No document is open in Sonobe.", { hint: "Call get_document_info to see what's open." });
      return { docId: entry.docId, doc: entry.snapshot.doc, revision: entry.snapshot.revision };
    },
  });

  /** Pull the latest revision of a simulation's document so the session hot-swaps edits. */
  const prepareSim = async (simId: string) => {
    const docId = simDocs.get(simId);
    if (docId === undefined) return;
    const entry = findEntry(docId);
    if (!entry || !options.targets().some((t) => t.id === entry.target.id)) {
      manager.closeDocument(docId);
      simDocs.delete(simId);
      throw new HostError("window_closed", `The Sonobe window simulation "${simId}" was running in has closed.`, { hint: "Start a new simulation with sim_reset." });
    }
    await refresh(entry);
  };

  const sim: SimHost = {
    async reset(o) {
      const entry = await resolve(o.docId ?? (o.simId !== undefined ? simDocs.get(o.simId) : undefined));
      await snapshot(entry);
      const state = await manager.reset({ ...o, docId: entry.docId });
      simDocs.set(state.simId, state.docId);
      return state;
    },
    async dispatch(simId, events) {
      await prepareSim(simId);
      return manager.dispatch(simId, events);
    },
    async step(simId, o) {
      await prepareSim(simId);
      return manager.step(simId, o);
    },
    async trace(simId, o) {
      await prepareSim(simId);
      return manager.trace(simId, o);
    },
    async values(simId, targets) {
      await prepareSim(simId);
      return manager.values(simId, targets);
    },
    list: (docId) => manager.list(docId),
  };

  const sceneFunction = () => (manager as SimulationManager & { scene?: (simId: string) => SceneFrame }).scene;

  /** get_screenshot({ simId }): draw the simulation's current frame (it doesn't step or hot-swap). */
  const simScreenshot = async (target: ScreenshotTarget, simId: string, o: ScreenshotOptions): Promise<Screenshot> => {
    const sceneOf = sceneFunction();
    if (typeof sceneOf !== "function" || !options.renderScene) {
      throw new HostError("sim_screenshot_unavailable", "Screenshots show the live viewer; Sonobe can't draw a simulation's frame yet.", {
        hint: "Take the screenshot without simId, and check the simulation with sim_get_values or sim_trace.",
      });
    }
    if (target.kind === "graph" || target.kind === "canvas") {
      throw new HostError("target_unavailable", `A simulation has no ${target.kind === "graph" ? "patch graph" : "canvas"} to capture: its screenshots show the prototype screen.`, {
        hint: 'Use target "viewer" for the whole screen, or "layer" with a layerId.',
      });
    }
    const scene = sceneOf.call(manager, simId);
    const screen: Rect = { x: 0, y: 0, width: scene.size[0], height: scene.size[1] };
    let crop: Rect | null = screen;
    if (target.kind === "layer") {
      const bounds = sceneLayerBounds(scene, target.layerId);
      if (!bounds) {
        throw new HostError("not_found", `Layer "${target.layerId}" isn't drawn in simulation "${simId}" right now.`, {
          hint: "Check the id with get_outline. Hidden layers and layers outside a loop's current count aren't drawn.",
        });
      }
      crop = intersectRects(bounds, screen);
    }
    if (!crop || crop.width < 1 || crop.height < 1) {
      throw new HostError("capture_failed", "There's nothing visible to capture: the target has no area on screen.", { hint: 'Try target "viewer" to see the whole screen.' });
    }
    const docId = simDocs.get(simId);
    const entry = docId !== undefined ? findEntry(docId) : undefined;
    const size = screenshotSize(crop, 1, o.scale ?? 1, o.maxWidth);
    const image = await options.renderScene({ scene, crop, size, assets: assetFiles(entry?.snapshot?.doc, entry?.info.projectPath ?? null) });
    if (!image) {
      throw new HostError("capture_failed", "Sonobe couldn't draw the simulation's frame.", { hint: "Try again. If it keeps failing, check the simulation with sim_get_values or sim_trace instead." });
    }
    return { data: image.data, mimeType: "image/png", width: image.width, height: image.height, timeMs: Math.round(scene.time * 1000) };
  };

  const conflictResult = (entry: Entry, expected: number, current: number, diagnostics: Diagnostic[], dryRun: boolean): HostApplyResult => ({
    ok: false,
    docId: entry.docId,
    revision: current,
    dryRun,
    results: [],
    errors: [
      {
        code: "revision_conflict",
        message: `The document changed since revision ${expected}; it's at revision ${current} now. Nothing was applied.`,
        hint: "Re-read what you're changing (get_outline or get_items), then retry with expectedRevision set to the current revision.",
      },
    ],
    idMap: {},
    affected: { components: [], layers: [], patches: [] },
    applied: [],
    diagnostics: { added: [], resolved: [], totals: diagnosticTotals(diagnostics) },
    conflict: { expectedRevision: expected, currentRevision: current },
  });

  const openInto = async (target: RendererTarget, dir: string): Promise<DocumentSummary> => {
    const reply = await call<{ ok?: unknown; cancelled?: unknown }>(target, "document.open", { path: dir }, OPEN_TIMEOUT_MS);
    if (reply?.ok !== true) {
      throw new HostError("open_cancelled", "The person kept their unsaved changes, so the project wasn't opened.", {
        hint: "Ask them to save or discard their changes in Sonobe, then try again.",
      });
    }
    const previous = entries.get(target.id);
    if (previous) forget(target.id);
    const entry = await describe(target);
    activeId = target.id;
    return summary(entry);
  };

  const host: AppHost = {
    kind: "app",
    capabilities: { screenshots: true, selection: true, presence: true, autosave: false },
    registry,

    async listDocuments() {
      const targets = options.targets();
      prune(targets);
      const out: DocumentSummary[] = [];
      for (const target of targets) {
        try {
          out.push(summary(await describe(target)));
        } catch (err) {
          if (isHostError(err) && (err.code === "editor_not_connected" || err.code === "window_closed")) continue;
          throw err;
        }
      }
      return out;
    },

    async openDocument(ref) {
      const targets = options.targets();
      prune(targets);
      for (const target of targets) if (!entries.has(target.id)) await describe(target).catch(() => undefined);
      const open = findEntry(ref);
      if (open) {
        activeId = open.target.id;
        open.target.focus();
        return summary(await describe(open.target));
      }
      const dir = path.isAbsolute(expandHome(ref)) ? await options.approveProject(path.resolve(expandHome(ref))) : null;
      if (!dir) {
        const docIds = [...entries.values()].map((e) => e.docId);
        throw new HostError("not_a_project", `"${ref}" isn't an open document or a Sonobe project folder.`, {
          hint: `${docIds.length ? `Open documents: ${docIds.join(", ")}. ` : ""}To open a project, pass the absolute path of its folder (it contains project.json, e.g. "~/Documents/Checkout Flow.sonobe"). To start one, use create_document.`,
        });
      }
      const target = activeTarget(targets) ?? (await options.ensureTarget?.()) ?? null;
      if (!target) throw noWindow();
      return openInto(target, dir);
    },

    async createDocument(request) {
      if (request.template !== undefined && !TEMPLATES.some((t) => t.id === request.template)) {
        throw new HostError("unknown_template", `There's no template "${request.template}".`, {
          hint: `Templates: ${TEMPLATES.map((t) => `${t.id} (${t.description})`).join("; ")}.`,
        });
      }
      let dir: string;
      if (request.path !== undefined) {
        const expanded = expandHome(request.path);
        if (!path.isAbsolute(expanded)) {
          throw new HostError("absolute_path_required", `"${request.path}" is a relative path, and the Sonobe app has no working folder to resolve it against.`, {
            hint: 'Pass an absolute folder path such as "~/Documents/Checkout Flow.sonobe", or omit path to save in the Documents folder.',
          });
        }
        dir = path.resolve(expanded);
      } else {
        dir = await options.defaultProjectDir(request.name?.trim() || "Untitled");
      }
      if (await options.projectExists(dir)) {
        throw new HostError("already_exists", `${dir} already holds a Sonobe project.`, { hint: "Open it with open_document instead, or pick another folder." });
      }
      const name = request.name?.trim() || path.basename(dir).replace(/\.sonobe$/i, "") || "Untitled";
      const doc = createTemplateDocument({ name, registry, ...(request.template ? { template: request.template } : {}), ...(request.device ? { device: request.device } : {}) });
      await options.writeProject(dir, doc);
      if (request.open === false) {
        const docId = uniqueId(slugify(name, "document"), (id: Id) => [...entries.values()].some((e) => e.docId === id));
        return { docId, name, path: dir, revision: 0, dirty: false, active: false };
      }
      const targets = options.targets();
      const target = activeTarget(targets) ?? (await options.ensureTarget?.()) ?? null;
      if (!target) throw noWindow();
      return openInto(target, dir);
    },

    async getDocument(docId) {
      const entry = await resolve(docId);
      const snap = await snapshot(entry);
      return { docId: entry.docId, ...(entry.info.projectPath ? { path: entry.info.projectPath } : {}), doc: snap.doc, revision: snap.revision, dirty: entry.info.dirty };
    },

    async saveDocument(docId, saveOptions = {}) {
      const entry = await resolve(docId);
      // Without force, the editor refuses (disk_changed) while outside changes wait for the person's decision.
      const reply = await call<false | { ok?: unknown; path?: unknown; revision?: unknown }>(entry.target, "document.save", saveOptions.force ? { force: true } : {}, OPEN_TIMEOUT_MS);
      if (reply === false) {
        throw new HostError("save_cancelled", "Saving was cancelled.", {
          hint: "This prototype hadn't been saved before, so Sonobe asked the person where to put it and they cancelled. Ask them where it should go, then call save_document again.",
        });
      }
      if (!reply || reply.ok !== true || typeof reply.revision !== "number") throw unexpectedReply("document.save");
      await describe(entry.target);
      return { docId: entry.docId, ...(typeof reply.path === "string" ? { path: reply.path } : {}), revision: reply.revision, written: [], removed: [] };
    },

    async apply(ops, o) {
      const entry = await resolve(o.docId);
      const before = await snapshot(entry);
      const beforeDiagnostics = diagnosticsOf(entry, before);
      const dryRun = !!o.dryRun;
      if (o.expectedRevision !== undefined && o.expectedRevision !== before.revision) return conflictResult(entry, o.expectedRevision, before.revision, beforeDiagnostics, dryRun);

      // The last moment a cancelled call can be stopped: once the editor has the batch, it lands.
      if (o.signal?.aborted) throw new ToolCancelledError();
      const reply = await call<RendererApplyReply>(
        entry.target,
        "document.apply",
        {
          ops,
          label: o.label,
          author: o.author,
          dryRun,
          ...(o.expectedRevision !== undefined ? { expectedRevision: o.expectedRevision } : {}),
          ...(o.atomic !== undefined ? { atomic: o.atomic } : {}),
          ...(o.defaultComponent !== undefined ? { component: o.defaultComponent } : {}),
        },
        APPLY_TIMEOUT_MS,
      );
      const r = reply?.result;
      if (!r || typeof reply.revision !== "number" || !Array.isArray(r.errors)) throw unexpectedReply("document.apply");
      if (!r.ok && r.errors.some((e) => e.code === "revision_mismatch")) return conflictResult(entry, o.expectedRevision ?? before.revision, reply.revision, beforeDiagnostics, dryRun);

      // The editor's own applied ops carry the ids it generated. A local replay can't know which ids the
      // editor reserved (removed this session), so it's only a fallback for builds that don't send them.
      const applied: Op[] = Array.isArray(reply.applied)
        ? reply.applied
        : applyOps(before.doc, ops, { registry, atomic: o.atomic !== false, dryRun: true, ...(o.defaultComponent !== undefined ? { defaultComponent: o.defaultComponent } : {}) }).applied;
      const out: HostApplyResult = {
        ok: r.ok,
        docId: entry.docId,
        revision: reply.revision,
        dryRun,
        results: r.results,
        errors: r.errors,
        idMap: r.idMap,
        affected: r.affected,
        applied,
        diagnostics: { added: [], resolved: [], totals: diagnosticTotals(beforeDiagnostics) },
      };
      if (dryRun) {
        // Replay the resolved ops (explicit ids) so the preview shows what a commit would create.
        const local = applyOps(before.doc, applied, { registry, atomic: false, dryRun: true });
        if (local.preview) {
          out.preview = local.preview;
          const previewDiagnostics = Array.isArray(reply.documentDiagnostics) ? reply.documentDiagnostics : getDiagnostics(local.preview, registry);
          out.diagnostics = diffDiagnostics(beforeDiagnostics, previewDiagnostics);
        }
        return out;
      }
      if (r.applied > 0) {
        const after = await refresh(entry);
        if (Array.isArray(reply.documentDiagnostics) && after.revision === reply.revision) entry.diagnostics = { doc: after.doc, list: reply.documentDiagnostics };
        out.diagnostics = diffDiagnostics(beforeDiagnostics, diagnosticsOf(entry, after));
        if (typeof reply.txnId === "string") out.txnId = reply.txnId;
      }
      return out;
    },

    ...(options.captureDesign ? { captureDesign: options.captureDesign } : {}),
    ...(options.fetchImage ? { fetchImage: options.fetchImage } : {}),

    async putAssetFiles(files, fileOptions) {
      const entry = await resolve(fileOptions.docId);
      if (!files.length) return;
      if (fileOptions.signal?.aborted) throw new ToolCancelledError();
      await call(entry.target, "assets.put", { files: files.map((f) => ({ file: f.file, mime: f.mime, data: Buffer.from(f.bytes).toString("base64") })) }, APPLY_TIMEOUT_MS);
    },

    async diagnostics(docId) {
      const entry = await resolve(docId);
      const snap = await snapshot(entry);
      return { docId: entry.docId, revision: snap.revision, diagnostics: diagnosticsOf(entry, snap) };
    },

    async getSelection(docId) {
      const entry = await resolve(docId);
      const s = await call<{ component?: unknown; layers?: unknown; patches?: unknown; comments?: unknown }>(entry.target, "selection.get");
      const ids = (v: unknown): Id[] => (Array.isArray(v) ? v.filter((id): id is Id => typeof id === "string") : []);
      if (!s || typeof s.component !== "string") throw unexpectedReply("selection.get");
      return { docId: entry.docId, component: s.component, layers: ids(s.layers), patches: ids(s.patches), comments: ids(s.comments) };
    },

    async screenshot(target, o) {
      const entry = await resolve(o.docId);
      if (o.simId !== undefined) return simScreenshot(target, o.simId, o);
      const scale = o.scale ?? 1;
      let rect: Rect | null;
      let cssPerPoint = 1;
      if (target.kind === "viewer") {
        const bounds = await call<unknown>(entry.target, "viewer.bounds");
        if (!isViewerBounds(bounds)) throw unexpectedReply("viewer.bounds");
        rect = viewerCaptureRect(bounds);
        // Measure the stage rather than trusting `scale`: the viewer may be zoomed by a CSS transform
        // outside the renderer, which getBoundingClientRect includes.
        cssPerPoint = measuredScale(bounds);
      } else {
        const method = target.kind === "layer" ? "viewer.layerBounds" : `${target.kind}.bounds`;
        const label = target.kind === "layer" ? `layer "${target.layerId}"` : target.kind === "graph" ? "patch graph" : "canvas";
        if (entry.target.hasMethod(method) !== true) {
          throw new HostError("target_unavailable", `This version of the editor can capture the viewer, but not the ${label}.`, {
            hint: target.kind === "graph" ? 'Use target "viewer". To read the graph, use get_outline or explain.' : 'Use target "viewer" (the whole prototype screen).',
          });
        }
        const bounds = await call<unknown>(entry.target, method, target.kind === "layer" ? { layerId: target.layerId } : undefined);
        if (!isRect(bounds)) throw unexpectedReply(method);
        rect = bounds;
        const perPoint = (bounds as unknown as { scale?: unknown }).scale;
        if (typeof perPoint === "number" && perPoint > 0) cssPerPoint = perPoint;
        if (target.kind === "layer" && entry.target.hasMethod("viewer.bounds") === true) {
          // A layer is drawn in the viewer: clip it to the visible stage and size it in points.
          const viewer = await call<unknown>(entry.target, "viewer.bounds").catch(() => null);
          if (isViewerBounds(viewer)) {
            const visible = viewerCaptureRect(viewer);
            rect = visible ? intersectRects(rect, visible) : null;
            if (!(typeof perPoint === "number" && perPoint > 0)) cssPerPoint = measuredScale(viewer);
          }
        }
      }
      if (!rect || rect.width < 1 || rect.height < 1) {
        throw new HostError("capture_failed", "There's nothing visible to capture: the target has no area on screen.", { hint: "Ask the person to show the Viewer panel (⌘2) and make the window larger, then try again." });
      }
      const image = await entry.target.capture(rect, screenshotSize(rect, cssPerPoint, scale, o.maxWidth));
      if (!image) {
        throw new HostError("capture_failed", "Sonobe couldn't capture the window.", { hint: "Make sure the Sonobe window isn't minimized, then try again." });
      }
      const shot: Screenshot = { data: image.data, mimeType: "image/png", width: image.width, height: image.height };
      return shot;
    },

    async reveal(ids, o) {
      const entry = await resolve(o.docId);
      const reply = await call<{ revealed?: unknown; missing?: unknown }>(entry.target, "reveal", { ids });
      const list = (v: unknown): Id[] => (Array.isArray(v) ? v.filter((id): id is Id => typeof id === "string") : []);
      const revealed = list(reply?.revealed);
      const missing = list(reply?.missing);
      if (o.focus) entry.target.focus();
      if (!revealed.length) return { revealed: false, reason: `None of these are in the document: ${missing.join(", ") || ids.join(", ")}.` };
      return missing.length ? { revealed: true, reason: `Not found: ${missing.join(", ")}.` } : { revealed: true };
    },

    async setWorking(work, o) {
      const entry = await resolve(o.docId);
      const key = o.author.name;
      const current = entry.working.get(key);
      if (current) {
        entry.working.delete(key);
        await call(entry.target, "presence.finish", { workId: current.workId });
      } else if (work === null) {
        await call(entry.target, "presence.finish", { author: o.author });
      }
      if (work === null) return;
      const reply = await call<{ workId?: unknown }>(entry.target, "presence.begin", { ids: work.ids, intent: work.intent, author: o.author });
      if (typeof reply?.workId !== "string") throw unexpectedReply("presence.begin");
      entry.working.set(key, { workId: reply.workId, intent: { ids: [...work.ids], intent: work.intent, author: o.author, since: now() } });
    },

    async presence(docId) {
      const entry = await resolve(docId);
      return [...entry.working.values()].map((w) => w.intent);
    },

    sim,

    history: {
      async list(o) {
        const entry = await resolve(o.docId);
        const limit = o.limit ?? 20;
        const reply = await call<{ entries?: RendererHistoryEntry[] }>(entry.target, "history.list", { limit: o.author ? HISTORY_SCAN : limit });
        return (reply?.entries ?? []).filter((e) => matchesAuthor(e.author, o.author)).slice(0, limit).map(toHistoryItem);
      },

      async undo(o) {
        const entry = await resolve(o.docId);
        const before = await snapshot(entry);
        const beforeDiagnostics = diagnosticsOf(entry, before);
        // The editor checks the human-edit guard and undoes in one task, so a person's edit can't land
        // between the check and the undo. Its refusals (human_edit, not_found, nothing_to_undo) come back as HostErrors.
        if (o.signal?.aborted) throw new ToolCancelledError();
        const reply = await call<{ revision?: unknown; undone?: Partial<RendererHistoryEntry>[] }>(entry.target, "history.undo", {
          ...(o.txnId !== undefined ? { txnId: o.txnId } : {}),
          ...(o.allowHumanEdits ? { allowHumanEdits: true } : {}),
          author: o.author,
        });
        if (typeof reply?.revision !== "number") throw unexpectedReply("history.undo");
        const revision = reply.revision;
        const after = await refresh(entry);
        return {
          docId: entry.docId,
          revision,
          undone: (reply.undone ?? []).map((e) => undoneItem(e, revision)),
          diagnostics: diffDiagnostics(beforeDiagnostics, diagnosticsOf(entry, after)),
        };
      },
    },

    forgetTarget: forget,

    async documentChanged(targetId, revision) {
      if (!Number.isFinite(revision)) return;
      const target = options.targets().find((t) => t.id === targetId);
      if (!target) return;
      const entry = entries.get(targetId);
      if (!entry) {
        await describe(target).catch(() => undefined);
        return;
      }
      if (entry.info.revision === revision) return;
      entry.info = { ...entry.info, revision };
      emit({ kind: "changed", docId: entry.docId, revision, targetId });
    },

    simulationScreenshots: () => typeof sceneFunction() === "function" && !!options.renderScene,

    dispose() {
      manager.dispose();
      entries.clear();
      simDocs.clear();
    },
  };
  return host;
}
