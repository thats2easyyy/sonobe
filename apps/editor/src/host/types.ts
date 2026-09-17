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
  /** Push the live document's revision to main (LAN player sync, MCP resource notifications). Optional: older preloads lack it. */
  notifyDocumentChanged?(revision: number): void;
  /** Open a web or mail link in the system browser. Optional: older preloads lack it. */
  openExternal?(url: string): boolean | void | Promise<boolean | void>;
  /** True when the app was started muted (SONOBE_MUTE, automated runs). */
  readonly muted?: boolean;
  getPreviewStatus?(): Promise<unknown>;
  startPreview?(): Promise<unknown>;
  stopPreview?(): Promise<unknown>;
  onPreviewStatus?(cb: (status: unknown) => void): () => void;
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
  /** Tell the host the live document moved to `revision`. */
  notifyDocumentChanged?(revision: number): void;
  /** The host asks for silence (SONOBE_MUTE, automated runs). */
  readonly muted?: boolean;
  dispose(): void;
}
