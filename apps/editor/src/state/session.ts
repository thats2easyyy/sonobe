/**
 * EditorSession: one open prototype and everything around it. The document, selection, presence,
 * console, and dialog stores, the bounds registry, asset import, the shared registry, the host
 * adapter, and the live runtime, wired together (selection pruning, agent activity, window title and
 * edited marker, projects opened by the OS, revision pushes to the desktop, script trust, and live
 * values following the component being edited).
 */

import { applyOps, createEmptyDocument, DEVICE_PRESETS, seenIdsFromJSON, type Id, type SonobeDocument } from "@sonobe/core";
import type { PatchRegistry } from "@sonobe/patches";
import { getMuteStore, type MuteStore } from "@sonobe/renderer";
import { createHostAdapter } from "../host/detect.ts";
import type { DraftInfo, HostAdapter, RecoveredDraft } from "../host/types.ts";
import { instancePathFor } from "../runtime/instances.ts";
import { createRuntimeHost, type RuntimeHost, type RuntimeHostOptions } from "../runtime/runtimeHost.ts";
import type { FrameScheduler } from "../runtime/scheduler.ts";
import { createScriptTrustStore, scriptPatchCount, type ScriptTrustStore, type TrustPersistence } from "../runtime/scriptTrust.ts";
import { createAssetService, type AssetService } from "./assets.ts";
import { createBoundsRegistry, type BoundsRegistry } from "./bounds.ts";
import { createGraphGeometrySlot, type GraphGeometrySlot } from "./graphGeometry.ts";
import type { ClipboardFragment } from "./clipboard.ts";
import { createConsoleStore, type ConsoleStore } from "./console.ts";
import { createDemoDocument } from "./demoDocument.ts";
import { getDefaultDialogs, type DialogStore } from "./dialogs.ts";
import { createDocumentStore, type DocumentState, type DocumentStore, type FileResult } from "./document.ts";
import { createDraftKeeper, type DraftKeeper, type DraftKeeperOptions } from "./drafts.ts";
import { createPresenceStore, type PresenceStore } from "./presence.ts";
import { getRegistry } from "./registry.ts";
import { saveDocumentInteractively } from "./saveFlow.ts";
import { createSelectionStore, currentComponentId, type SelectionStore } from "./selection.ts";
import { undoMenuTitle } from "./undoLabels.ts";

export type DiscardChoice = "save" | "discard" | "cancel";

/** Asked before replacing a document that has unsaved changes. */
export type ConfirmDiscard = (info: { name: string; action: "open" | "new" | "reload" }) => Promise<DiscardChoice>;

/** Starting points for new documents. */
export type DocumentTemplate = "blank" | "demo";
export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = ["blank", "demo"];

export interface NewProjectOptions {
  name?: string;
  /** Default "blank". */
  template?: DocumentTemplate;
  /** Device preset id (see DEVICE_PRESETS). */
  device?: string;
}

export interface EditorSessionOptions {
  /** Default: DesktopHost inside the app, BrowserHost otherwise. Null: no persistence. */
  host?: HostAdapter | null;
  registry?: PatchRegistry;
  /** Default: the Photo Zoom demo. */
  document?: SonobeDocument;
  projectPath?: string | null;
  scheduler?: FrameScheduler;
  textMeasurer?: RuntimeHostOptions["textMeasurer"];
  /** Start the prototype playing. Default true. */
  autoplay?: boolean;
  /** Default: a Save / Don't Save / Cancel dialog through `dialogs`. */
  confirmDiscard?: ConfirmDiscard;
  /** Window title suffix. Default "Sonobe". */
  appName?: string;
  /** Where dialogs queue (session.dialogs). Default getDefaultDialogs() (render it with a DialogHost). */
  dialogStore?: DialogStore;
  /** Remembered trusted project paths. Default: localStorage. */
  trustPersistence?: TrustPersistence;
  /** Platform services for the live viewer. Default "browser" when a DOM exists. */
  platform?: RuntimeHostOptions["platform"];
  /** Mute switch. Default: the app-wide switch. */
  mute?: MuteStore;
  /** Draft keeper timing, or false to keep no drafts. Default: drafts whenever the host keeps them. */
  drafts?: Pick<DraftKeeperOptions, "debounceMs" | "maxWaitMs" | "onError"> | false;
}

/** What restoring a draft did. */
export interface RestoreDraftResult extends FileResult {
  draft?: DraftInfo;
  /** What the person should know ("its last changes may be missing"). */
  notes?: string[];
}

export interface EditorSession {
  readonly registry: PatchRegistry;
  readonly host: HostAdapter | null;
  readonly document: DocumentStore;
  readonly selection: SelectionStore;
  readonly presence: PresenceStore;
  readonly console: ConsoleStore;
  readonly runtime: RuntimeHost;
  /** Confirm, prompt, choose, and pick dialogs as promises (the shell renders the queue). */
  readonly dialogs: DialogStore;
  /** Where panels are on screen (canvas.bounds, graph.bounds, viewer.layerBounds) for screenshots. */
  readonly bounds: BoundsRegistry;
  /** Where the patch editor draws its nodes and how big they are (graph.geometry), for MCP layout tools. */
  readonly graphGeometry: GraphGeometrySlot;
  /** Import files as assets and hold asset bytes. */
  readonly assets: AssetService;
  /** Whether project scripts may run (same store as runtime.scriptTrust). */
  readonly scriptTrust: ScriptTrustStore;
  /** Last copied fragment; paste falls back to it when the system clipboard can't be read. */
  clipboard: ClipboardFragment | null;
  /** The component being edited. */
  currentComponentId(): Id;
  resolveAssetUrl(assetId: Id): string | undefined;
  /** Resolves true when it's fine to replace the document (saving first when asked to). */
  confirmDiscardChanges(action: "open" | "new" | "reload"): Promise<boolean>;
  /** Open a project (asking about unsaved changes first). */
  openProject(path?: string): Promise<FileResult>;
  /** Start a new, unsaved prototype (asking about unsaved changes first). */
  newProject(options?: NewProjectOptions): Promise<boolean>;
  /** Keeps unsaved edits as a draft (ARCHITECTURE §3.5 Drafts); null when the host keeps none. */
  readonly drafts: DraftKeeper | null;
  /** Drafts left by earlier sessions that no window has open, newest first. */
  recoverableDrafts(): Promise<DraftInfo[]>;
  /** Bring a draft back as the document (asking about unsaved changes first): unsaved, with its project path and seen ids. */
  restoreDraft(id: string): Promise<RestoreDraftResult>;
  /** Delete a draft nobody has open. */
  discardDraft(id: string): Promise<void>;
  dispose(): void;
}

/** A new document from a template (validated device and template names). */
export function createTemplateDocument(registry: PatchRegistry, options: NewProjectOptions = {}): SonobeDocument {
  const template = options.template ?? "blank";
  if (!DOCUMENT_TEMPLATES.includes(template)) throw new Error(`There's no "${template}" template. Use one of: ${DOCUMENT_TEMPLATES.join(", ")}.`);
  if (options.device !== undefined && !DEVICE_PRESETS.some((d) => d.id === options.device)) throw new Error(`There's no device "${options.device}". Use one of: ${DEVICE_PRESETS.map((d) => d.id).join(", ")}.`);
  const name = options.name?.trim();
  if (template === "blank") return createEmptyDocument({ ...(name ? { name } : {}), ...(options.device ? { device: options.device } : {}) });
  const demo = createDemoDocument(registry);
  const changes = { ...(name ? { name } : {}), ...(options.device ? { device: { preset: options.device } } : {}) };
  if (Object.keys(changes).length === 0) return demo;
  const result = applyOps(demo, [{ op: "setProject", changes }], { registry });
  return result.ok ? result.doc : demo;
}

export function createEditorSession(options: EditorSessionOptions = {}): EditorSession {
  const registry = options.registry ?? getRegistry();
  const dialogs = options.dialogStore ?? getDefaultDialogs();
  const host = options.host === undefined ? createHostAdapter({ dialogService: dialogs }) : options.host;
  const appName = options.appName ?? "Sonobe";
  const mute = options.mute ?? getMuteStore();
  if (host?.muted && !mute.getState().muted) mute.setState({ muted: true, reason: "host" });

  const confirmDiscard: ConfirmDiscard =
    options.confirmDiscard ??
    (async ({ name, action }) => {
      const choice = await dialogs.choose<DiscardChoice>({
        title: `Save changes to "${name}"?`,
        message: action === "reload" ? "The project changed on disk. Your unsaved changes will be lost if you reload." : "Your changes will be lost if you don't save them.",
        actions: [
          { value: "save", label: "Save", variant: "primary" },
          { value: "discard", label: "Don't Save", variant: "danger" },
          { value: "cancel", label: "Cancel" },
        ],
      });
      return choice ?? "cancel";
    });
  const initial = options.document ?? createDemoDocument(registry);

  const document = createDocumentStore({ registry, host, document: initial, projectPath: options.projectPath ?? null });
  const selection = createSelectionStore({ root: initial.project.root });
  const presence = createPresenceStore();
  const consoleStore = createConsoleStore();
  const bounds = createBoundsRegistry();
  const graphGeometry = createGraphGeometrySlot();
  const assets = createAssetService({ document, host });
  const keeper = host?.drafts && options.drafts !== false ? createDraftKeeper({ document, drafts: host.drafts, ...(options.drafts ?? {}) }) : null;
  // A page going to the background or away writes unsaved edits right away (best effort while unloading).
  const page = typeof globalThis.document === "undefined" ? null : globalThis.document;
  const flushHidden = () => {
    if (page?.visibilityState === "hidden") void keeper?.flush();
  };
  if (keeper) page?.addEventListener("visibilitychange", flushHidden);

  const resolveAssetUrl = (assetId: Id): string | undefined => {
    const { doc, projectPath } = document.getState();
    const record = doc.assets[assetId];
    if (!record) return undefined;
    return host?.resolveAssetUrl(projectPath, record.file) ?? assets.resolveUrl(record.file);
  };

  const scriptTrust = createScriptTrustStore({
    ...(options.trustPersistence ? { persistence: options.trustPersistence } : {}),
    confirm: async ({ name, scriptCount }) => {
      const choice = await dialogs.choose<"trust" | "cancel">({
        title: `Run the scripts in "${name ?? "this prototype"}"?`,
        message: `This project has ${scriptCount === 1 ? "a JavaScript patch" : `${scriptCount} JavaScript patches`}. Scripts can use the network and read what you type into the prototype. Only trust projects from people you trust.`,
        actions: [
          { value: "trust", label: "Trust and Run", variant: "primary" },
          { value: "cancel", label: "Not Now" },
        ],
      });
      return choice === "trust";
    },
  });

  const runtime = createRuntimeHost({
    registry,
    document,
    console: consoleStore,
    resolveAssetUrl,
    scriptTrust,
    mute,
    scope: () => instancePathFor(document.getState().doc, selection.getState().componentPath),
    platformOptions: {
      readAssetBytes: (assetId) => assets.readBytes(assetId),
      ...(host?.openExternal ? { openExternal: (url: string) => host.openExternal!(url) } : {}),
    },
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    ...(options.textMeasurer ? { textMeasurer: options.textMeasurer } : {}),
    ...(options.autoplay !== undefined ? { autoplay: options.autoplay } : {}),
  });

  const title = (s: DocumentState) => `${host?.kind === "browser" && s.dirty ? "• " : ""}${s.doc.project.name} — ${appName}`;

  const unsubscribeRevision = document.getState().subscribeRevision((s, previous) => {
    selection.getState().prune(s.doc);
    runtime.refreshScope();
    const change = s.lastChange;
    if (!change || change === previous.lastChange || change.author.kind !== "agent" || change.kind === "replace" || change.kind === "reload") return;
    presence.getState().recordChange({
      kind: change.kind,
      ...(change.txnId !== undefined ? { txnId: change.txnId } : {}),
      author: change.author,
      label: change.label,
      ids: [...change.affected.layers, ...change.affected.patches],
      components: change.affected.components,
      revision: change.revision,
      opCount: change.opCount,
      timestamp: change.timestamp,
    });
  });

  const unsubscribeScope = selection.subscribe((s, previous) => {
    if (s.componentPath !== previous.componentPath) runtime.refreshScope();
  });

  let notifyQueued = false;
  const unsubscribeChrome = document.subscribe((s, previous) => {
    if (s.dirty !== previous.dirty) host?.setDocumentEdited(s.dirty);
    if (s.doc.project.name !== previous.doc.project.name || s.dirty !== previous.dirty || s.projectPath !== previous.projectPath) host?.setTitle(title(s));
    if (s.revision !== previous.revision && host?.notifyDocumentChanged && !notifyQueued) {
      notifyQueued = true;
      queueMicrotask(() => {
        notifyQueued = false;
        const state = document.getState();
        host.notifyDocumentChanged?.(state.revision, { undo: undoMenuTitle("Undo", state.undoLabel), redo: undoMenuTitle("Redo", state.redoLabel) });
      });
    }
    // A prototype the person made (or already trusted) keeps its trust when it's saved somewhere new.
    if (s.projectPath && s.projectPath !== previous.projectPath && s.lastChange === previous.lastChange && scriptTrust.allowed() && scriptPatchCount(s.doc) > 0) {
      scriptTrust.rememberPath(s.projectPath);
      scriptTrust.evaluate(s.doc, s.projectPath);
    }
  });
  host?.setDocumentEdited(document.getState().dirty);
  host?.setTitle(title(document.getState()));

  // Restarting here restarts the phone preview and the pop-out viewer too.
  const unsubscribeRestart = runtime.subscribeRestart(() => host?.notifyPrototypeRestarted?.());

  // The runtime's own layer bounds answer viewer.layerBounds while a viewer is attached (panels may override).
  let unregisterLayerBounds: (() => void) | null = null;
  const syncLayerBounds = (viewerCount: number) => {
    if (viewerCount > 0 && !unregisterLayerBounds) {
      unregisterLayerBounds = bounds.register(
        "viewer.layerBounds",
        (params) => runtime.layerBounds({ ...(typeof params.layerId === "string" ? { layerId: params.layerId } : {}), ...(typeof params.key === "string" ? { key: params.key } : {}) }),
        { fallback: true },
      );
    } else if (viewerCount === 0 && unregisterLayerBounds) {
      unregisterLayerBounds();
      unregisterLayerBounds = null;
    }
  };
  syncLayerBounds(runtime.state.getState().viewers);
  const unsubscribeViewers = runtime.state.subscribe((s, previous) => {
    if (s.viewers !== previous.viewers) syncLayerBounds(s.viewers);
  });

  const session: EditorSession = {
    registry,
    host,
    document,
    selection,
    presence,
    console: consoleStore,
    runtime,
    dialogs,
    bounds,
    graphGeometry,
    assets,
    scriptTrust,
    clipboard: null,
    currentComponentId: () => currentComponentId(selection.getState()),
    resolveAssetUrl,

    async confirmDiscardChanges(action) {
      const s = document.getState();
      if (!s.dirty) return true;
      const choice = await confirmDiscard({ name: s.doc.project.name, action });
      if (choice === "cancel") return false;
      if (choice === "save") return (await saveDocumentInteractively(document, dialogs)).ok;
      return true;
    },

    async openProject(path) {
      if (!(await session.confirmDiscardChanges("open"))) return { ok: false, cancelled: true };
      const result = await document.getState().open(path);
      if (result.ok) selection.getState().setComponentPath([document.getState().doc.project.root]);
      return result;
    },

    async newProject(newOptions = {}) {
      const doc = createTemplateDocument(registry, newOptions);
      if (!(await session.confirmDiscardChanges("new"))) return false;
      document.getState().newDocument(undefined, doc);
      selection.getState().setComponentPath([document.getState().doc.project.root]);
      return true;
    },

    drafts: keeper,

    recoverableDrafts: async () => (host?.drafts ? host.drafts.list() : []),

    async restoreDraft(id) {
      const drafts = host?.drafts;
      if (!drafts || !keeper) return { ok: false, error: "Drafts aren't kept here.", errorCode: "no_drafts" };
      if (keeper.current()?.id === id) return { ok: true, ...(document.getState().projectPath ? { path: document.getState().projectPath! } : {}) };
      // Only ask about unsaved changes for a draft that can be recovered.
      if (!(await drafts.list()).some((d) => d.id === id)) return { ok: false, error: `There's no draft "${id}" to recover. It may be open in another window, or discarded.`, errorCode: "unknown_draft" };
      if (!(await session.confirmDiscardChanges("open"))) return { ok: false, cancelled: true };
      let recovered: RecoveredDraft;
      try {
        recovered = await drafts.open(id);
      } catch (err) {
        const e = err as { message?: unknown; code?: unknown };
        return { ok: false, error: typeof e.message === "string" ? e.message : String(err), errorCode: typeof e.code === "string" ? e.code : "open_failed" };
      }
      const { info } = recovered;
      const notes: string[] = [];
      // Unsaved changes to a saved project: open the project first (its files, assets and watcher), then put the draft over it.
      let projectPath = info.projectPath;
      let diskChanged = false;
      if (projectPath) {
        const opened = await document.getState().open(projectPath);
        if (opened.ok) diskChanged = drafts.diskChanged(projectPath, recovered);
        else {
          notes.push(`Its project (${projectPath}) couldn't be opened, so it's back as a prototype that isn't saved anywhere.`);
          projectPath = null;
        }
      }
      for (const [rel, bytes] of Object.entries(recovered.binaries)) host.putAssetBytes?.(projectPath, rel.slice("assets/".length), bytes);
      keeper.adopt(id, { createdAt: info.createdAt, projectPath: info.projectPath });
      document.getState().replaceDocument(recovered.doc, {
        projectPath,
        saved: false,
        keepHistory: projectPath !== null,
        ...(recovered.seenIds ? { seenIds: seenIdsFromJSON(recovered.seenIds) } : {}),
        label: `Recovered “${info.name}”`,
      });
      selection.getState().setComponentPath([recovered.doc.project.root]);
      // The project changed on disk after the draft was written: ask which version to keep.
      if (diskChanged) await document.getState().checkExternalChanges();
      if (info.torn) notes.push("It was cut off while being written, so its last few changes may be missing.");
      if (info.textOnly && Object.keys(recovered.doc.assets).length) notes.push("This browser kept only its text, so its images and other media are missing.");
      return { ok: true, ...(projectPath ? { path: projectPath } : {}), draft: info, ...(notes.length ? { notes } : {}) };
    },

    async discardDraft(id) {
      await host?.drafts?.remove(id);
    },

    dispose() {
      unsubscribeRevision();
      unsubscribeScope();
      unsubscribeChrome();
      unsubscribeRestart();
      unsubscribeViewers();
      unregisterLayerBounds?.();
      unsubscribeOpen?.();
      keeper?.dispose();
      page?.removeEventListener("visibilitychange", flushHidden);
      runtime.dispose();
      assets.dispose();
      document.getState().dispose();
      host?.dispose();
    },
  };

  const unsubscribeOpen = host?.onOpenProject((path) => {
    void session.openProject(path);
  });

  return session;
}

let defaultSession: EditorSession | null = null;

/** The app-wide session, created on first use (demo document, detected host). */
export function getDefaultSession(): EditorSession {
  defaultSession ??= createEditorSession();
  return defaultSession;
}

/** Replace (or clear) the app-wide session. The previous one is not disposed. */
export function setDefaultSession(session: EditorSession | null): void {
  defaultSession = session;
}
