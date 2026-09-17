/**
 * EditorSession: one open prototype and everything around it. The document, selection, presence,
 * and console stores, the shared registry, the host adapter, and the live runtime, wired together
 * (selection pruning, agent activity, window title and edited marker, projects opened by the OS).
 */

import type { Id, SonobeDocument } from "@sonobe/core";
import type { PatchRegistry } from "@sonobe/patches";
import { createHostAdapter } from "../host/detect.ts";
import type { HostAdapter } from "../host/types.ts";
import { createRuntimeHost, type RuntimeHost, type RuntimeHostOptions } from "../runtime/runtimeHost.ts";
import type { FrameScheduler } from "../runtime/scheduler.ts";
import type { ClipboardFragment } from "./clipboard.ts";
import { createConsoleStore, type ConsoleStore } from "./console.ts";
import { createDemoDocument } from "./demoDocument.ts";
import { createDocumentStore, type DocumentState, type DocumentStore, type FileResult } from "./document.ts";
import { createPresenceStore, type PresenceStore } from "./presence.ts";
import { getRegistry } from "./registry.ts";
import { createSelectionStore, currentComponentId, type SelectionStore } from "./selection.ts";

export type DiscardChoice = "save" | "discard" | "cancel";

/** Asked before replacing a document that has unsaved changes. */
export type ConfirmDiscard = (info: { name: string; action: "open" | "new" | "reload" }) => Promise<DiscardChoice>;

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
  confirmDiscard?: ConfirmDiscard;
  /** Window title suffix. Default "Sonobe". */
  appName?: string;
}

export interface EditorSession {
  readonly registry: PatchRegistry;
  readonly host: HostAdapter | null;
  readonly document: DocumentStore;
  readonly selection: SelectionStore;
  readonly presence: PresenceStore;
  readonly console: ConsoleStore;
  readonly runtime: RuntimeHost;
  /** Last copied fragment; paste falls back to it when the system clipboard can't be read. */
  clipboard: ClipboardFragment | null;
  /** The component being edited. */
  currentComponentId(): Id;
  resolveAssetUrl(assetId: Id): string | undefined;
  /** Resolves true when it's fine to replace the document (saving first when asked to). */
  confirmDiscardChanges(action: "open" | "new" | "reload"): Promise<boolean>;
  /** Open a project (asking about unsaved changes first). */
  openProject(path?: string): Promise<FileResult>;
  /** Start a new, empty prototype (asking about unsaved changes first). */
  newProject(): Promise<boolean>;
  dispose(): void;
}

const defaultConfirmDiscard: ConfirmDiscard = async ({ name }) => {
  const confirmFn = (globalThis as { confirm?: (message: string) => boolean }).confirm;
  if (typeof confirmFn !== "function") return "cancel";
  return confirmFn(`"${name}" has unsaved changes. Discard them?`) ? "discard" : "cancel";
};

export function createEditorSession(options: EditorSessionOptions = {}): EditorSession {
  const registry = options.registry ?? getRegistry();
  const host = options.host === undefined ? createHostAdapter() : options.host;
  const appName = options.appName ?? "Sonobe";
  const confirmDiscard = options.confirmDiscard ?? defaultConfirmDiscard;
  const initial = options.document ?? createDemoDocument(registry);

  const document = createDocumentStore({ registry, host, document: initial, projectPath: options.projectPath ?? null });
  const selection = createSelectionStore({ root: initial.project.root });
  const presence = createPresenceStore();
  const consoleStore = createConsoleStore();

  const resolveAssetUrl = (assetId: Id): string | undefined => {
    const { doc, projectPath } = document.getState();
    const record = doc.assets[assetId];
    return record ? host?.resolveAssetUrl(projectPath, record.file) : undefined;
  };

  const runtime = createRuntimeHost({
    registry,
    document,
    console: consoleStore,
    resolveAssetUrl,
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    ...(options.textMeasurer ? { textMeasurer: options.textMeasurer } : {}),
    ...(options.autoplay !== undefined ? { autoplay: options.autoplay } : {}),
  });

  const title = (s: DocumentState) => `${host?.kind === "browser" && s.dirty ? "• " : ""}${s.doc.project.name} — ${appName}`;

  const unsubscribeRevision = document.getState().subscribeRevision((s, previous) => {
    selection.getState().prune(s.doc);
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

  const unsubscribeChrome = document.subscribe((s, previous) => {
    if (s.dirty !== previous.dirty) host?.setDocumentEdited(s.dirty);
    if (s.doc.project.name !== previous.doc.project.name || s.dirty !== previous.dirty || s.projectPath !== previous.projectPath) host?.setTitle(title(s));
  });
  host?.setDocumentEdited(document.getState().dirty);
  host?.setTitle(title(document.getState()));

  const session: EditorSession = {
    registry,
    host,
    document,
    selection,
    presence,
    console: consoleStore,
    runtime,
    clipboard: null,
    currentComponentId: () => currentComponentId(selection.getState()),
    resolveAssetUrl,

    async confirmDiscardChanges(action) {
      const s = document.getState();
      if (!s.dirty) return true;
      const choice = await confirmDiscard({ name: s.doc.project.name, action });
      if (choice === "cancel") return false;
      if (choice === "save") return (await document.getState().save()).ok;
      return true;
    },

    async openProject(path) {
      if (!(await session.confirmDiscardChanges("open"))) return { ok: false, cancelled: true };
      const result = await document.getState().open(path);
      if (result.ok) selection.getState().setComponentPath([document.getState().doc.project.root]);
      return result;
    },

    async newProject() {
      if (!(await session.confirmDiscardChanges("new"))) return false;
      document.getState().newDocument();
      selection.getState().setComponentPath([document.getState().doc.project.root]);
      return true;
    },

    dispose() {
      unsubscribeRevision();
      unsubscribeChrome();
      unsubscribeOpen?.();
      runtime.dispose();
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
