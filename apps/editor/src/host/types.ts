/**
 * Host adapters: where projects are read and written, native dialogs, menus, window chrome, and
 * the RPC bridge. The desktop adapter wraps `window.sonobeHost` (apps/desktop/electron/host-api.d.ts);
 * the browser adapter keeps projects in OPFS, localStorage, or memory, or opens real folders with
 * the File System Access API.
 */

import type { SonobeDocument } from "@sonobe/core";

/** A handler registry for calls from the desktop main process (see SonobeHostRpc). */
export interface RpcRegistrar {
  handle(method: string, fn: (params: unknown) => unknown): () => void;
  methods?(): string[];
  /** A result the host turns into an error response with this code, message, and data. */
  fail(code: string, message: string, data?: unknown): unknown;
}

/**
 * Structural mirror of `SonobeHost` (window.sonobeHost), so the editor doesn't import from the
 * desktop app. Keep in sync with apps/desktop/electron/host-api.d.ts.
 */
export interface DesktopHostApi {
  readonly platform: string;
  readonly version: string;
  openProjectDialog(): Promise<string | null>;
  saveProjectDialog(defaultName: string): Promise<string | null>;
  readProject(dir: string): Promise<{ files: Record<string, string>; binaries: Record<string, ArrayBuffer> }>;
  writeProject(dir: string, changes: { files?: Record<string, string>; binaries?: Record<string, ArrayBuffer | Uint8Array>; deleted?: string[] }): Promise<void>;
  watchProject(dir: string, cb: (change: { dir: string; paths: string[] }) => void): () => void;
  revealInFinder(path: string): void;
  recentProjects(): Promise<string[]>;
  onCommand(cb: (id: string) => void): () => void;
  onOpenProject(cb: (dir: string) => void): () => void;
  commands(): { id: string; label: string; accelerator: string | null; nativeAccelerator: boolean }[];
  setDocumentEdited(edited: boolean): void;
  setTitle(title: string): void;
  rpc: RpcRegistrar;
  getMcpStatus(): Promise<unknown>;
  /** Push the live document's revision (and the Edit menu's Undo and Redo titles) to main. Optional: older preloads lack it. */
  notifyDocumentChanged?(revision: number, history?: { undo: string; redo: string }): void;
  /** The prototype restarted, so players (phones, the pop-out viewer) restart too. Optional: older preloads lack it. */
  notifyPrototypeRestarted?(): void;
  /** Open a web or mail link in the system browser. Optional: older preloads lack it. */
  openExternal?(url: string): boolean | void | Promise<boolean | void>;
  /** True when the app was started muted (SONOBE_MUTE, automated runs). */
  readonly muted?: boolean;
  getPreviewStatus?(): Promise<unknown>;
  startPreview?(): Promise<unknown>;
  stopPreview?(): Promise<unknown>;
  onPreviewStatus?(cb: (status: unknown) => void): () => void;
  /** Keychain-backed secrets (the in-app assistant's API key). Optional: older preloads lack it. */
  secrets?: DesktopSecretsApi;
  /** The in-app assistant bridge; panels/assistant/types.ts describes it (AssistantApi). */
  assistant?: unknown;
  /** Render a URL or HTML page in a hidden window and capture it (DesignCaptureReply in host-api.d.ts). Optional: older preloads lack it. */
  captureDesign?(request: DesktopCaptureParams): Promise<DesktopCaptureReply>;
  /** Cancel the capture started with this captureId. Optional: older preloads lack it. */
  cancelCaptureDesign?(captureId: string): void;
  /** Progress of captures started with a captureId. Returns unsubscribe. Optional: older preloads lack it. */
  onCaptureDesignProgress?(cb: (progress: DesktopCaptureProgress) => void): () => void;
  /** Download a pasted capture's http(s) file in the main process. Optional: older preloads lack it. */
  fetchCaptureFile?(url: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** Show the prototype in its own window, or focus it when it's open. */
  popOutViewer?(options?: DesktopViewerWindowOptions): Promise<DesktopViewerWindowStatus>;
  closeViewerWindow?(): Promise<DesktopViewerWindowStatus>;
  getViewerWindowStatus?(): Promise<DesktopViewerWindowStatus>;
  /** The pop-out viewer window opened, closed, or changed. Returns unsubscribe. */
  onViewerWindowStatus?(cb: (status: DesktopViewerWindowStatus) => void): () => void;
}

/** DesignCaptureParams in host-api.d.ts. */
export interface DesktopCaptureParams {
  url?: string;
  html?: string;
  width: number;
  height: number;
  selector?: string;
  waitFor?: string;
  waitMs?: number;
  fullPage?: boolean;
  colorScheme?: "light" | "dark";
  captureId?: string;
}

/** DesignCaptureReply in host-api.d.ts. */
export type DesktopCaptureReply =
  | { ok: true; capture: unknown; images: [string, { bytes: Uint8Array; mime: string; width?: number; height?: number } | null][]; notes?: string[] }
  | { ok: false; code: string; message: string; hint?: string };

/** DesignCaptureProgress in host-api.d.ts. */
export interface DesktopCaptureProgress {
  captureId: string;
  stage: string;
  message: string;
  done?: number;
  total?: number;
}

/** SecretsStatus in host-api.d.ts. */
export interface DesktopSecretsStatus {
  available: boolean;
  /** "keychain" (macOS), "dpapi" (Windows), or the Linux key store. */
  backend: string | null;
  reason: string | null;
}

/** SonobeSecrets in host-api.d.ts. */
export interface DesktopSecretsApi {
  status(): Promise<DesktopSecretsStatus>;
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
}

/** ViewerWindowOptions in host-api.d.ts. */
export interface DesktopViewerWindowOptions {
  alwaysOnTop?: boolean;
}

/** ViewerWindowStatus in host-api.d.ts. */
export interface DesktopViewerWindowStatus {
  open: boolean;
  alwaysOnTop: boolean;
  error: string | null;
}

export interface HostCapabilities {
  /** Menus send commands through onCommand. */
  nativeMenus: boolean;
  /** Open/save dialogs are available without extra UI. */
  nativeDialogs: boolean;
  /** watchProject reports external edits. */
  watch: boolean;
  /** revealInFinder does something. */
  reveal: boolean;
  /** Projects survive a reload. */
  persistent: boolean;
}

export interface WriteProjectOptions {
  /** Copy asset binaries from this project (Save As into a new folder). */
  copyAssetsFrom?: string | null;
}

export interface WriteSummary {
  /** Paths written (created or changed). */
  written: string[];
  /** Stale paths removed. */
  deleted: string[];
  /** Files whose contents were already up to date. */
  unchanged: number;
}

export interface HostAdapter {
  readonly kind: "desktop" | "browser";
  readonly platform: string;
  readonly capabilities: HostCapabilities;
  /** Resolves a project path, or null when cancelled. */
  openProjectDialog(): Promise<string | null>;
  /** Resolves a new project path for `defaultName`, or null when cancelled. */
  saveProjectDialog(defaultName: string): Promise<string | null>;
  /** Read and parse a project. Throws core ProjectFormatError for invalid projects. */
  readProject(path: string): Promise<SonobeDocument>;
  /** Serialize and write a project, writing only changed files and removing stale ones. */
  writeProject(path: string, doc: SonobeDocument, options?: WriteProjectOptions): Promise<WriteSummary>;
  /** External edits under `path` (own writes are filtered). Returns unsubscribe. */
  watchProject(path: string, cb: (paths: string[]) => void): () => void;
  revealInFinder(path: string): void;
  recentProjects(): Promise<string[]>;
  /** A loadable URL for a file under the project's assets/ folder. */
  resolveAssetUrl(path: string | null, file: string): string | undefined;
  onCommand(cb: (id: string) => void): () => void;
  onOpenProject(cb: (path: string) => void): () => void;
  setDocumentEdited(edited: boolean): void;
  setTitle(title: string): void;
  /** A short display name for a project path ("Checkout Flow"). */
  displayName(path: string): string;
  /** The desktop RPC bridge; null in the browser. */
  readonly rpc: RpcRegistrar | null;
  /**
   * Keep an asset file's bytes for a project (null: the unsaved document). They are served by
   * resolveAssetUrl right away and written into assets/ on the next writeProject.
   */
  putAssetBytes?(path: string | null, file: string, bytes: ArrayBuffer | Uint8Array): void;
  /** Bytes of an asset file the host already holds in memory (synchronous; for clipboard copies). */
  peekAssetBytes?(path: string | null, file: string): ArrayBuffer | undefined;
  /** Bytes of an asset file, reading the project from disk or storage when needed. */
  readAssetBytes?(path: string | null, file: string): Promise<ArrayBuffer | undefined>;
  /** Open a link outside the editor (system browser in the desktop app). False when it didn't open. */
  openExternal?(url: string): boolean | Promise<boolean>;
  /** Tell the host the live document moved to `revision`; `history` holds the current Undo and Redo titles. */
  notifyDocumentChanged?(revision: number, history?: { undo: string; redo: string }): void;
  /** Tell the host the prototype restarted, so its players restart too. */
  notifyPrototypeRestarted?(): void;
  /** The host asks for silence (SONOBE_MUTE, automated runs). */
  readonly muted?: boolean;
  dispose(): void;
}
