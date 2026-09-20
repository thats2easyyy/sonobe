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
  | "file.importDesign"
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
  | "view.showKnobs"
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
  /**
   * The app's bundled `sonobe` CLI launcher (Resources/cli/sonobe, or sonobe.cmd on Windows), or null
   * when this build has none. Connect Claude uses it so Claude launches the relay by full path.
   */
  cliPath: string | null;
  /**
   * MCP clients that talked to the app recently, most recently active first (@sonobe/mcp clients.ts).
   * A running server with no connected client means nothing is connected, whatever else is set up.
   */
  clients: McpClientSession[];
  /** When the main process read `clients` (epoch ms), for "active 12 s ago". */
  checkedAt: number;
  /** The app's version, to spot sessions running an older relay. */
  version: string;
}

/** One MCP client session, as the app sees it. */
export interface McpClientSession {
  /** The relay's per-process id, or "http" for the one row of clients without the relay. */
  id: string;
  /** "Claude Code", "Claude Desktop", the client's own name, or "Unidentified MCP client". */
  label: string;
  name: string | null;
  version: string | null;
  /** The session's project folder (CLAUDE_PROJECT_DIR or the relay's working folder). */
  folder: string | null;
  /** relay: `sonobe mcp`, with hellos and heartbeats. http: a client without the relay (no id). */
  via: "relay" | "http";
  /** connected: heard from recently. idle: a client without the relay, quiet for 2 minutes. gone: left. */
  state: "connected" | "idle" | "gone";
  connectedAt: number;
  lastSeenAt: number;
  lastActivityAt: number | null;
  lastTool: string | null;
  toolCalls: number;
  relayVersion: string | null;
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

/** Whether secrets can be stored on this computer, and where. */
export interface SecretsStatus {
  available: boolean;
  /** "keychain" (macOS), "dpapi" (Windows), or the Linux key store (e.g. "gnome_libsecret"). */
  backend: string | null;
  /** Why secrets can't be stored, when they can't. */
  reason: string | null;
}

/**
 * Small secrets such as the optional in-app assistant's API key. Values are encrypted with the
 * operating system's keychain (Electron safeStorage) and kept in the app's user data folder; they
 * never reach project files. Names are 1–64 letters, digits, ".", "_" or "-", e.g. "anthropic.apiKey".
 */
export interface SonobeSecrets {
  status(): Promise<SecretsStatus>;
  /** The stored value, or null when it isn't set. */
  get(name: string): Promise<string | null>;
  /** Rejects when the keychain isn't available (see status()) or the value is over 16 KB. */
  set(name: string, value: string): Promise<void>;
  /** Resolves true when something was removed. */
  delete(name: string): Promise<boolean>;
}

export interface ViewerWindowOptions {
  /** Keep the viewer window above other windows. */
  alwaysOnTop?: boolean;
}

/** The pop-out viewer window: the live prototype in its own window, following edits. */
export interface ViewerWindowStatus {
  open: boolean;
  alwaysOnTop: boolean;
  /** Why the window couldn't open, when it couldn't. */
  error: string | null;
}

/** What the Import dialog asks the app to render and capture. */
export interface DesignCaptureParams {
  url?: string;
  html?: string;
  width: number;
  height: number;
  selector?: string;
  waitFor?: string;
  waitMs?: number;
  fullPage?: boolean;
  colorScheme?: "light" | "dark";
  /** An id the editor picks to follow the capture (onCaptureDesignProgress) and cancel it (cancelCaptureDesign). */
  captureId?: string;
}

/**
 * A capture (a DesignCapture from @sonobe/import) with its downloaded images and notes, or why it
 * failed. A cancelled capture fails with code "cancelled".
 */
export type DesignCaptureReply =
  | { ok: true; capture: unknown; images: [string, { bytes: Uint8Array; mime: string; width?: number; height?: number } | null][]; notes?: string[] }
  | { ok: false; code: string; message: string; hint?: string };

/** What a capture started with a captureId is doing now. */
export interface DesignCaptureProgress {
  captureId: string;
  stage: "starting" | "loading" | "color-scheme" | "walking" | "symbols" | "images" | "screenshot";
  /** "Downloading images: 7 of 28". */
  message: string;
  done?: number;
  total?: number;
}

/** How big a draft is ("66 layers"). */
export interface DraftCounts {
  components: number;
  layers: number;
  patches: number;
}

/** A draft of unsaved work (ARCHITECTURE §3.5 Drafts). */
export interface DraftInfo {
  /** Letters, digits and dashes, 8 to 64 of them. */
  id: string;
  name: string;
  /** The project it has unsaved changes to; null when it was never saved. */
  projectPath: string | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
  counts: DraftCounts;
  /** Its files come from two moments (the app stopped while writing it), so its last changes may be missing. */
  torn?: boolean;
}

/** What the editor records in a draft's draft.json (the app adds the file list and times). */
export interface DraftManifestInput {
  name: string;
  projectPath: string | null;
  revision: number;
  createdAt: number;
  counts: DraftCounts;
  /** Ids the session has seen (seenIdsToJSON in @sonobe/core), so a restored draft continues the session. */
  seenIds: { items: Record<string, string[]>; components: string[]; knobs: string[]; presets: string[] };
  /** Digests of the project files the draft started from, to notice outside changes on restore. */
  base?: Record<string, string>;
}

/** A draft call's result. Failures are values, because the context bridge drops Error properties. */
export type DraftReply<T = object> = ({ ok: true } & T) | { ok: false; code: "unknown_draft" | "draft_in_use" | "invalid_draft" | "draft_failed" | string; message: string };

/**
 * Drafts in `<userData>/Drafts/<id>.sonobe`, one project folder each. A window claims the drafts it
 * writes or reads; list() shows the ones no window claims (left by a crash, a quit or a signal).
 */
export interface SonobeDrafts {
  /** Write changed files (atomic per file), then draft.json. */
  write(id: string, changes: ProjectWrite, meta: DraftManifestInput): Promise<DraftReply>;
  /** Delete a draft this window claims or nobody does. */
  remove(id: string): Promise<DraftReply>;
  list(): Promise<DraftInfo[]>;
  /** Claim a draft for this window and read it. */
  read(id: string): Promise<DraftReply<{ info: DraftInfo; manifest: Record<string, unknown>; files: Record<string, string>; binaries: Record<string, ArrayBuffer> }>>;
  /** Give back a draft this window read but couldn't open, so it's listed again (and closing the window leaves it). */
  release(id: string): Promise<void>;
  /** Show the draft's folder in Finder or Explorer. */
  reveal(id: string): void;
}

export type RpcHandler = (params: unknown) => unknown | Promise<unknown>;

/**
 * Handlers the main process can call (the MCP server uses these to reach the live document).
 * A handler's return value is the response. A thrown error (or rejected promise) reaches the
 * caller with code "handler_error" and its message only: the context bridge drops custom Error
 * properties. To send a `code` and `data` (e.g. a SonobeError), return `rpc.fail(code, message, data)`.
 *
 * Well-known methods the host calls when registered:
 * - `document.save`: called when the user picks Save in the "unsaved changes" prompt (with
 *   `interactive: true`), and by save_document (with `noDialog`, and `path` for a new folder).
 *   Resolve `false` to cancel closing.
 * - `drafts.flush`: write unsaved edits to the window's draft now (before a quit on a signal, and
 *   when the unsaved-changes prompt opens).
 * - The MCP bridge methods of apps/editor/src/host/rpcHandlers.ts (`document.info`, `document.apply`...).
 *   Optional: `canvas.bounds`, `graph.bounds` and `viewer.layerBounds({ layerId })` resolve a
 *   `{ x, y, width, height, scale? }` rect in viewport CSS pixels so screenshots can target them, and
 *   `graph.geometry({ component })` lists the patch editor's node boxes (ARCHITECTURE §9.1).
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
  /** Like readProject, but resolves null for a folder that doesn't exist yet (a Save As target). */
  readProjectIfExists(dir: string): Promise<ProjectFiles | null>;
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
  /** MCP status changes: a session connected, called a tool, or left. Returns unsubscribe. */
  onMcpStatus(cb: (status: McpStatus) => void): () => void;

  /** Phone preview server state (for the viewer's "On phone" QR panel). */
  getPreviewStatus(): Promise<PreviewStatus>;
  /** Start the phone preview server; resolves the new status (with `error` when it couldn't start). */
  startPreview(): Promise<PreviewStatus>;
  stopPreview(): Promise<PreviewStatus>;
  /** Status changes: started, stopped, players joining or leaving. Returns unsubscribe. */
  onPreviewStatus(cb: (status: PreviewStatus) => void): () => void;

  /**
   * Tell the host the document reached `revision`: call it after every committed change, undo, redo,
   * open, and reload. It drives the phone preview's and pop-out viewer's live sync and MCP resource
   * notifications. Cheap; calling it for every revision is fine. `history` carries the Edit menu's
   * Undo and Redo titles ("Undo Mute Card Shadow").
   */
  notifyDocumentChanged(revision: number, history?: { undo: string; redo: string }): void;

  /**
   * Tell the host the prototype restarted (Restart Prototype, ⌘R, restart_viewer). The phone preview
   * and the pop-out viewer restart it too when they show this window's document.
   */
  notifyPrototypeRestarted(): void;

  /** Keychain-backed secrets (for example the in-app assistant's API key). */
  secrets: SonobeSecrets;

  /** Open an http(s) or mailto link in the default browser or mail app. Resolves false for any other URL. */
  openExternal(url: string): Promise<boolean>;

  /**
   * Render a URL or HTML page in a hidden, sandboxed window and capture it for import. It stops after
   * 90 s plus waitMs (code "capture_timeout"), when cancelled, or when this window reloads or closes.
   */
  captureDesign(request: DesignCaptureParams): Promise<DesignCaptureReply>;
  /** Cancel the capture started with this captureId; its captureDesign resolves with code "cancelled". */
  cancelCaptureDesign(captureId: string): void;
  /** Progress of captures started with a captureId. Returns unsubscribe. */
  onCaptureDesignProgress(cb: (progress: DesignCaptureProgress) => void): () => void;
  /** Download an http(s) image or font for a pasted capture, without the renderer's CORS limits. */
  fetchCaptureFile(url: string): Promise<{ bytes: Uint8Array; mime: string } | null>;

  /** Show the prototype in its own window (a live player that follows edits), or focus it when it's open. */
  popOutViewer(options?: ViewerWindowOptions): Promise<ViewerWindowStatus>;
  closeViewerWindow(): Promise<ViewerWindowStatus>;
  getViewerWindowStatus(): Promise<ViewerWindowStatus>;
  /** The pop-out viewer window opened, closed, or changed. Returns unsubscribe. */
  onViewerWindowStatus(cb: (status: ViewerWindowStatus) => void): () => void;

  /** Drafts of unsaved work, so it survives a crash, a quit or a killed process. */
  drafts: SonobeDrafts;
}

declare global {
  interface Window {
    sonobeHost?: SonobeHost;
  }
}
