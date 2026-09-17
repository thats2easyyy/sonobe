/**
 * `window.sonobeHost`: the desktop host API the Electron preload exposes to the editor.
 *
 * The editor must also run in a plain browser, so treat `window.sonobeHost` as optional.
 * Everything here crosses a context bridge: values are copied, never shared.
 */

/** Command ids sent by native menus (and listed by `commands()` for the command palette). */
export type SonobeCommandId =
  // File
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.reveal"
  | "file.close"
  | "app.settings"
  // Edit
  | "edit.undo"
  | "edit.redo"
  | "edit.duplicate"
  | "edit.delete"
  | "edit.selectAll"
  | "edit.deselectAll"
  | "edit.rename"
  // View
  | "view.commandPalette"
  | "view.toggleLayers"
  | "view.toggleViewer"
  | "view.toggleCanvas"
  | "view.togglePatchEditor"
  | "view.toggleConsole"
  | "view.toggleAssistant"
  | "view.toggleInspector"
  | "view.toggleSplitOrientation"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomToFit"
  // Layer
  | "layer.insert"
  | "layer.group"
  | "layer.ungroup"
  | "layer.createComponent"
  | "layer.enterComponent"
  | "layer.exitComponent"
  | "layer.toggleVisibility"
  | "layer.toggleLock"
  | "layer.useAsMask"
  | "layer.bringForward"
  | "layer.sendBackward"
  | "layer.bringToFront"
  | "layer.sendToBack"
  // Patch
  | "patch.insert"
  | "patch.tidyUp"
  | "patch.commentAroundSelection"
  | "patch.alignLeft"
  | "patch.alignRight"
  | "patch.alignTop"
  | "patch.alignBottom"
  // Viewer
  | "viewer.restart"
  | "viewer.toggleDeviceFrame"
  | "viewer.toggleHitTargets"
  | "viewer.actualSize"
  | "viewer.rotateDevice"
  | "viewer.fullscreen"
  | "viewer.popOut"
  | "viewer.previewOnDevice"
  // Help
  | "help.learn"
  | "help.connectClaude"
  | "help.shortcuts"
  | "help.reportIssue";

/** A command as shown in menus, for the command palette and the editor keymap. */
export interface SonobeCommandInfo {
  id: SonobeCommandId;
  label: string;
  /** Electron accelerator for this platform (e.g. "CmdOrCtrl+Shift+G"), or null. */
  accelerator: string | null;
  /**
   * False when the menu only *displays* the shortcut (bare keys, Delete, Alt+arrows...).
   * The editor keymap must handle those keys itself when focus isn't in a text field.
   */
  nativeAccelerator: boolean;
}

/** Project folder contents, keyed by POSIX path relative to the project root. */
export interface ProjectFiles {
  /** UTF-8 text files (project.json, components/*.json, scripts/*.js, .sonobe/session.json...). */
  files: Record<string, string>;
  /** Everything under assets/ except assets/assets.json, plus files without a text extension. */
  binaries: Record<string, ArrayBuffer>;
}

export interface ProjectWrite {
  files?: Record<string, string>;
  binaries?: Record<string, ArrayBuffer | Uint8Array>;
  /** Relative paths to remove. Missing files are ignored. */
  deleted?: string[];
}

/** External edits observed under a watched project (own writes are filtered out). */
export interface ProjectChange {
  dir: string;
  /**
   * Sorted POSIX paths relative to the project root, created, modified, or removed.
   * "." means the platform didn't say which file changed: re-read the project.
   */
  paths: string[];
}

export interface McpStatus {
  running: boolean;
  port: number | null;
  /** e.g. "http://127.0.0.1:52817/mcp" */
  url: string | null;
  /** Path of ~/.sonobe/mcp.json (port + bearer token, mode 0600). */
  tokenFile: string;
}

/** The phone preview server (LAN web player). */
export interface PreviewStatus {
  running: boolean;
  /** Player URL for a phone on the same Wi-Fi, with its access token; null when stopped. */
  url: string | null;
  /** Every usable player URL, best first. */
  urls: string[];
  /** False when no local network address was found: only this computer can open the URL. */
  lanReachable: boolean;
  /** Players connected right now. */
  clients: number;
  /** Why the server couldn't start, when it couldn't. */
  error: string | null;
}

export type RpcHandler = (params: unknown) => unknown | Promise<unknown>;

/**
 * Handlers the main process can call (the MCP server uses these to reach the live document).
 * A handler's return value is the response. A thrown error (or rejected promise) reaches the
 * caller with code "handler_error" and its message only: the context bridge drops custom Error
 * properties. To send a `code` and `data` (e.g. a SonobeError), return `rpc.fail(code, message, data)`.
 *
 * Well-known methods the host calls when registered:
 * - `document.save`: called when the user picks Save in the "unsaved changes" prompt.
 *   Resolve `false` to cancel closing.
 * - The MCP bridge methods of apps/editor/src/host/rpcHandlers.ts (`document.info`, `document.apply`...).
 *   Optional: `canvas.bounds`, `graph.bounds` and `viewer.layerBounds({ layerId })` resolve a
 *   `{ x, y, width, height, scale? }` rect in viewport CSS pixels so screenshots can target them.
 * - `viewer.showPhonePreview(status: PreviewStatus)`: show the editor's QR panel after Viewer →
 *   Preview on Phone starts the server. Without it the host shows a native dialog with a QR code.
 */
export interface SonobeHostRpc {
  /** Register a handler; returns an unregister function. Re-registering replaces the handler. */
  handle(method: string, fn: RpcHandler): () => void;
  /** Currently registered method names. */
  methods(): string[];
  /** A result value that the host turns into an error with this code, message, and data. */
  fail(code: string, message: string, data?: unknown): unknown;
}

export interface SonobeHost {
  readonly platform: "darwin" | "win32" | "linux" | string;
  readonly version: string;

  /** Native folder picker for a *.sonobe project. Resolves the project directory or null. */
  openProjectDialog(): Promise<string | null>;
  /** Native save panel; resolves a path ending in ".sonobe" (not yet created) or null. */
  saveProjectDialog(defaultName: string): Promise<string | null>;
  readProject(dir: string): Promise<ProjectFiles>;
  /** Atomic per-file writes; creates the folder when saving to a path from saveProjectDialog. */
  writeProject(dir: string, changes: ProjectWrite): Promise<void>;
  /** Debounced change notifications for external edits. Returns unsubscribe. */
  watchProject(dir: string, cb: (change: ProjectChange) => void): () => void;
  revealInFinder(path: string): void;
  /** Most recent first; only folders that still exist. */
  recentProjects(): Promise<string[]>;

  /** Native menu commands. Returns unsubscribe. */
  onCommand(cb: (id: SonobeCommandId) => void): () => void;
  /** Projects opened from Finder, the command line, a second launch, or Open Recent. */
  onOpenProject(cb: (dir: string) => void): () => void;
  /** Every command with its platform accelerator. */
  commands(): SonobeCommandInfo[];

  /** macOS close-button dot + title marker; also enables the unsaved-changes prompt on close. */
  setDocumentEdited(edited: boolean): void;
  setTitle(title: string): void;

  rpc: SonobeHostRpc;
  getMcpStatus(): Promise<McpStatus>;

  /** Phone preview server state (for the viewer's "On phone" QR panel). */
  getPreviewStatus(): Promise<PreviewStatus>;
  /** Start the phone preview server; resolves the new status (with `error` when it couldn't start). */
  startPreview(): Promise<PreviewStatus>;
  stopPreview(): Promise<PreviewStatus>;
  /** Status changes: started, stopped, players joining or leaving. Returns unsubscribe. */
  onPreviewStatus(cb: (status: PreviewStatus) => void): () => void;
}

declare global {
  interface Window {
    sonobeHost?: SonobeHost;
  }
}
