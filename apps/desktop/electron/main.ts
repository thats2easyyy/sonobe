/** Electron main process entry: lifecycle, windows, menus, file IO, the MCP endpoint, and phone preview. */

import { app, autoUpdater, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, safeStorage, screen, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SonobeDocument } from "@sonobe/core";
import { saveProjectToDisk } from "@sonobe/core/node";
import { plainSceneFrame } from "@sonobe/engine";
import { checkProjectTarget, createClientRegistry, createHttpHandler, HostError, isHostError, loadGuides, resolveProjectTarget, type NodeMcpHandler } from "@sonobe/mcp";
import { createPatchRegistry } from "@sonobe/patches";
import { toBuffer as qrPng } from "qrcode";
import { createAppHost, type AppHost, type CapturedImage, type DocumentChange, type RendererTarget, type SceneRenderRequest, type SvgRenderRequest } from "./app-host.ts";
import { abortCaptures, captureDesignInWindow, fetchCaptureImage } from "./design-capture.ts";
import { createAppWindow, type AppWindow, type WindowContentSource } from "./app-window.ts";
import { createDraftStore, installQuitOnSignal, registerDraftIpc, type DraftStore } from "./drafts.ts";
import { createCodeFolderStore } from "./assistant/codeFolder.ts";
import { createConnectionStore } from "./assistant/connection.ts";
import { registerAssistant, type AssistantRegistration } from "./assistant/register.ts";
import { captureWebContents } from "./capture.ts";
import { bundledCliPath } from "./cli-path.ts";
import { isCommandId, RELEASES_URL, toHostPlatform } from "./commands.ts";
import { launchEnvProblem, projectPathsFromArgv, readDesktopEnv } from "./env.ts";
import type { McpStatus, PreviewStatus, SecretsStatus, SonobeCommandId, UpdateStatus, ViewerWindowStatus } from "./host-api.d.ts";
import { IPC } from "./ipc.ts";
import { phonePreviewDetail, resolveUnder, startLanPreview, type LanPreviewHandle } from "./lan-preview.ts";
import { defaultSonobeHome, startMcpServer, type McpServerHandle } from "./mcp-server.ts";
import { buildMenuSpec, toMenuTemplate, type NativeAction } from "./menu.ts";
import { OwnWriteRegistry, ProjectAccess, readProject, resolveProjectSelection, writeProject, type WriteProjectInput } from "./project-io.ts";
import { createProjectWatcher, type ProjectWatcher } from "./project-watcher.ts";
import { RecentProjects } from "./recent-projects.ts";
import { createRendererRpcHub, type RendererRpcHub, type RpcIpcEvent } from "./rpc.ts";
import { createSecretStore, createTestCipher, type SecretStore } from "./secrets.ts";
import { ALLOWED_PERMISSIONS, isAppUrl, isExternalUrl, isMailtoUrl } from "./security.ts";
import { desktopSymbols } from "./symbols.ts";
import { moveConflict, reopenPlan, restartConfirmation, restartKeepingWork, takeReopenRecord, writeReopenRecord, type ReopenRecord, type ReopenStep, type ReopenWindow, type RestartWindow } from "./update-restart.ts";
import type { NativeUpdaterLike } from "./updater-driver.ts";
import { createUpdateController, createUpdateSettings, installLocation, manualCheckDialog, updateMode, type UpdateController, type UpdateDriver, type UpdateModeResult } from "./updates.ts";

const APP_NAME = "Sonobe";
const VERSION = __SONOBE_VERSION__;
const platform = toHostPlatform(process.platform);

function log(level: "info" | "warn" | "error", message: string): void {
  (level === "info" ? console.log : level === "warn" ? console.warn : console.error)(`[sonobe] ${message}`);
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const env = readDesktopEnv(process.env, (msg) => log("warn", msg));

app.setName(APP_NAME);
if (env.userData) app.setPath("userData", env.userData);
if (env.mute) app.commandLine.appendSwitch("mute-audio");
if (platform === "win32") app.setAppUserModelId("dev.sonobe.app");
app.enableSandbox();

function resolveContentSource(): WindowContentSource {
  if (env.devUrl) return { kind: "dev", url: env.devUrl };
  const root = env.editorDist
    ? path.resolve(env.editorDist)
    : app.isPackaged
      ? path.join(process.resourcesPath, "editor")
      : path.resolve(__dirname, "../../editor/dist");
  return { kind: "file", root, index: path.join(root, "index.html") };
}

/** How often MCP resource-updated notifications go out while a document keeps changing. */
const RESOURCE_NOTIFY_MS = 250;

/** Updates start this long after the first window is on screen, so reading what the build can do never competes with launch. */
const UPDATES_START_MS = 1000;

/** Window content size for the pop-out viewer: the prototype's screen, shrunk to fit the display. */
function viewerWindowSize(doc: SonobeDocument | undefined, workArea: { width: number; height: number }): [number, number] {
  const device = doc?.project.device;
  let [width, height] = device?.size ?? [402, 874];
  if (device?.orientation === "landscape" && height > width) [width, height] = [height, width];
  const fit = Math.min(1, (workArea.height * 0.85) / height, (workArea.width * 0.85) / width);
  return [Math.max(160, Math.round(width * fit)), Math.max(160, Math.round(height * fit))];
}

/** A folder scripts/build.mjs copies next to main.cjs, or its source in a repo checkout. */
function bundledResource(name: string, repoRelative: string): string {
  const bundled = path.join(__dirname, name);
  return existsSync(bundled) ? bundled : path.resolve(__dirname, "../../..", repoRelative);
}

function main(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const windows = new Map<number, AppWindow>();
  const watchers = new Map<string, { ownerId: number; watcher: ProjectWatcher }>();
  const access = new ProjectAccess();
  const ownWrites = new OwnWriteRegistry();
  const pendingOpen: string[] = projectPathsFromArgv(process.argv.slice(1), process.cwd());
  let recents: RecentProjects | null = null;
  let rpc: RendererRpcHub | null = null;
  let mcp: McpServerHandle | null = null;
  let mcpHandler: NodeMcpHandler | null = null;
  /** MCP sessions that talked to the app (the relay's hellos and every tool call), for Connect Claude. */
  const mcpClients = createClientRegistry();
  let mcpStatusTimer: ReturnType<typeof setTimeout> | null = null;
  let appHost: AppHost | null = null;
  let preview: LanPreviewHandle | null = null;
  let previewError: string | null = null;
  let previewStarting: Promise<void> | null = null;
  let creating: Promise<AppWindow> | null = null;
  let ready = false;
  let secrets: SecretStore | null = null;
  /** Stopped on quit: it runs Claude's agent adapter as a child process when the subscription is on. */
  let assistant: AssistantRegistration | null = null;
  /** Set once an editor pushes revisions (notifyDocumentChanged): players stop polling. */
  let pushUpdates = false;
  /** Undo and Redo titles from the front editor window ("Undo Mute Card Shadow"), for the Edit menu. */
  let historyLabels: { undo: string; redo: string } | null = null;
  let historyMenuTimer: ReturnType<typeof setTimeout> | null = null;
  let viewerWindow: { win: BrowserWindow; server: LanPreviewHandle; origin: string } | null = null;
  let viewerWindowError: string | null = null;
  let viewerWindowOpening: Promise<ViewerWindowStatus> | null = null;
  let sceneWindow: Promise<BrowserWindow> | null = null;
  let sceneQueue: Promise<unknown> = Promise.resolve();
  const pendingResourceUris = new Set<string>();
  let resourceTimer: ReturnType<typeof setTimeout> | null = null;
  /** MCP notifications published (SONOBE_TEST only). */
  const notificationLog: string[] = [];
  /** Import dialog captures by `${webContents id}:${captureId}`, so the dialog can cancel them. */
  const dialogCaptures = new Map<string, AbortController>();
  /** A lower capture deadline for test runs (SONOBE_TEST only, set through __sonobeTest). */
  let testCaptureDeadlineMs: number | undefined;
  /** Draws SF Symbols in design imports (macOS 13 or later, with the bundled helper). */
  const symbols = desktopSymbols({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDir: __dirname, platform: process.platform, systemVersion: process.getSystemVersion(), exists: existsSync });
  /** Drafts of unsaved work in <userData>/Drafts (ARCHITECTURE §3.5 Drafts). */
  let drafts: DraftStore | null = null;
  /** Updates (electron/updates.ts). Nothing about them runs until the first window is on screen. */
  let updates: UpdateController | null = null;
  /** What this build does about updates: read once, when first asked. */
  let updateBuild: UpdateModeResult | null = null;
  /** electron-updater, loaded when the first check starts. */
  let updateDriver: Promise<UpdateDriver> | null = null;
  /** A stand-in updater (SONOBE_TEST only), which also makes the run count as a build that installs updates. */
  let testUpdateDriver: UpdateDriver | null = null;
  let testUpdateInstalls = 0;
  /** Resolves when updates have started: the editor's questions about them wait until then. */
  let updatesStarted!: () => void;
  const updatesReady = new Promise<void>((resolve) => (updatesStarted = resolve));
  /** The update item the menu shows now. */
  let menuUpdateItem: "check" | "restart" | undefined;
  /** Restart to Update or Move to Applications is closing the windows: the app neither quits nor opens a window on its own meanwhile. */
  let restarting = false;
  let restartRunning: Promise<boolean> | null = null;
  /** Rejects the install step of a restart when the updater reports an error. */
  let restartFailed: ((err: Error) => void) | null = null;
  /** The next editor window opens again what was open before a restart, so its editor skips the welcome screen. */
  let reopenInNextWindow = false;
  /** Settles once a launch that reopens work has done so. MCP calls wait for it: one that got in first would land on the blank launch document. */
  let reopened: Promise<void> = Promise.resolve();

  /** Every editor window writes its unsaved edits to its draft (at most 1.5 s each). */
  const flushDrafts = () =>
    Promise.allSettled(
      [...windows.values()]
        .filter((w) => !w.webContents.isDestroyed() && rpc?.hasMethod(w.webContents, "drafts.flush") === true)
        .map((w) => rpc!.invoke(w.webContents, "drafts.flush", undefined, { timeoutMs: 1500 })),
    );
  /**
   * A terminal closing, a background task ending, `kill`: keep the drafts and quit without prompts
   * nobody would answer. Installed once the app is ready: Chromium sets its own SIGTERM handler during
   * startup, which would replace one installed earlier.
   */
  const quitOnSignal = () =>
    installQuitOnSignal({
      flush: flushDrafts,
      exit: () => {
        for (const win of BrowserWindow.getAllWindows()) win.destroy();
        app.quit();
        setTimeout(() => app.exit(0), 2000).unref();
      },
      log,
    });

  const primaryWindow = (): AppWindow | undefined => {
    const focused = BrowserWindow.getFocusedWindow();
    return (focused && windows.get(focused.webContents.id)) ?? windows.values().next().value;
  };

  /** Only main frames of our windows, showing app content, may use the host API. */
  const trustedWindow = (event: IpcMainEvent | IpcMainInvokeEvent): AppWindow | null => {
    const w = windows.get(event.sender.id);
    const frame = event.senderFrame;
    if (!w || !frame || frame.parent !== null) return null;
    return isAppUrl(frame.url, w.content()) ? w : null;
  };

  const requireWindow = (event: IpcMainInvokeEvent): AppWindow => {
    const w = trustedWindow(event);
    if (!w) throw new Error("Untrusted sender");
    return w;
  };

  const rebuildMenu = () => {
    const spec = buildMenuSpec({
      platform,
      appName: APP_NAME,
      recentProjects: recents?.snapshot() ?? [],
      dev: !app.isPackaged,
      previewRunning: preview !== null,
      ...(historyLabels ? { undoLabel: historyLabels.undo, redoLabel: historyLabels.redo } : {}),
      ...((menuUpdateItem = updateMenuItem()) ? { updates: menuUpdateItem } : {}),
    });
    const template = toMenuTemplate(spec, platform, {
      command: (id: SonobeCommandId) => {
        if (id === "viewer.previewOnDevice") void showPhonePreview().catch((err: unknown) => log("warn", `Phone preview failed: ${errorMessage(err)}`));
        // With no window open, About is the system's panel: it doesn't open a window to show a dialog in.
        else if (id === "help.about" && windows.size === 0) app.showAboutPanel();
        else void ensureWindow().then((w) => w.sendCommand(id));
      },
      openRecent: (dir) => void openProjects([dir]),
      action: (action: NativeAction) => void handleAction(action),
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };

  /** The front editor's Undo and Redo titles changed: rebuild the menu (editing a MenuItem's label doesn't refresh the macOS menu bar), debounced while scrubbing. */
  const setHistoryLabels = (labels: unknown) => {
    if (!labels || typeof labels !== "object") return;
    const { undo, redo } = labels as { undo?: unknown; redo?: unknown };
    if (typeof undo !== "string" || typeof redo !== "string") return;
    const next = { undo: undo.slice(0, 120), redo: redo.slice(0, 120) };
    if (historyLabels?.undo === next.undo && historyLabels.redo === next.redo) return;
    historyLabels = next;
    if (historyMenuTimer) clearTimeout(historyMenuTimer);
    historyMenuTimer = setTimeout(() => {
      historyMenuTimer = null;
      rebuildMenu();
    }, 150);
  };

  const addRecent = async (dir: string) => {
    if (!recents) return;
    await recents.add(dir);
    if (platform !== "linux") app.addRecentDocument(dir);
    rebuildMenu();
  };

  const handleAction = async (action: NativeAction) => {
    if (action === "clearRecent") {
      await recents?.clear();
      app.clearRecentDocuments();
      rebuildMenu();
      return;
    }
    if (action === "stopPreview") {
      await stopPreview();
      return;
    }
    if (action === "checkForUpdates") {
      await checkForUpdates();
      return;
    }
    if (action === "restartToUpdate") {
      await restartToUpdate();
      return;
    }
    const w = primaryWindow();
    if (!w) return;
    if (action === "maximize") {
      if (w.win.isMaximized()) w.win.unmaximize();
      else w.win.maximize();
    } else {
      w.zoom(action);
    }
  };

  const createWindow = (): Promise<AppWindow> => {
    const reopening = reopenInNextWindow;
    reopenInNextWindow = false;
    return createAppWindow({
      preloadPath: path.join(__dirname, "preload.cjs"),
      source: resolveContentSource(),
      statePath: path.join(app.getPath("userData"), "window-state.json"),
      mute: env.mute,
      reopening,
      rpc: rpc!,
      appName: APP_NAME,
      log,
      onDiscardDrafts: async (id) => drafts?.discard(id),
      onCreated: (w) => {
        const id = w.webContents.id;
        windows.set(id, w);
        // The editor's document goes away with its page: its drafts become recoverable.
        w.webContents.on("did-start-navigation", (details) => {
          if (details.isMainFrame && !details.isSameDocument) drafts?.release(id);
        });
        w.webContents.on("render-process-gone", () => {
          drafts?.release(id);
          appHost?.forgetTarget(id);
        });
        // A reloaded editor shows a document of its own: the app host forgets the old page's (docId, cached snapshot, simulations).
        w.webContents.on("did-navigate", () => appHost?.forgetTarget(id));
        w.webContents.once("destroyed", () => {
          drafts?.release(id);
          windows.delete(id);
          appHost?.forgetTarget(id);
          for (const [watchId, entry] of watchers) {
            if (entry.ownerId === id) {
              entry.watcher.close();
              watchers.delete(watchId);
            }
          }
          if (windows.size === 0) {
            // Helper windows shouldn't keep the app alive (or show a document nobody has open).
            if (viewerWindow && !viewerWindow.win.isDestroyed()) viewerWindow.win.close();
            void sceneWindow?.then((scene) => scene.destroy()).catch(() => undefined);
          }
          pokePlayers();
        });
      },
    });
  };

  const ensureWindow = (): Promise<AppWindow> => {
    const existing = primaryWindow();
    if (existing) return Promise.resolve(existing);
    creating ??= createWindow().finally(() => {
      creating = null;
    });
    return creating;
  };

  /** The draft `dir` is, when it's a folder in <userData>/Drafts: unsaved work the draft store deletes once it's saved, never a project (§3.5 Drafts). */
  const draftAt = async (dir: unknown): Promise<string | null> => (typeof dir === "string" && drafts ? drafts.idAt(dir) : null);

  const refuseDraftFolder = async (dir: unknown) => {
    if (await draftAt(dir)) throw new Error(`${String(dir)} is a draft of unsaved work, not a prototype. Bring it back from Recovered on the welcome screen (Help > Welcome Screen), then save it where you want it.`);
  };

  /**
   * A draft folder opened like a project (Show in Finder on a Recovered draft, then a double-click), or a draft kept through a restart: it
   * comes back as the draft it is, so its next save asks where to go. Resolves false when it didn't come back.
   */
  const recoverDraftFolder = async (id: string, into?: AppWindow): Promise<boolean> => {
    const holder = drafts?.holder(id);
    const open = holder !== undefined ? windows.get(holder) : undefined;
    if (open) {
      open.focus();
      return true;
    }
    try {
      const w = into ?? (await ensureWindow());
      w.focus();
      await waitForEditor(w);
      // person: the app is acting for the person, so Settings → Claude → Read only doesn't refuse it (agentAccess.ts).
      const failed = rpc ? await rpc.invoke(w.webContents, "document.recoverDraft", { id, person: true }, { timeoutMs: 120_000 }).then(() => null, (err: unknown) => err) : new Error("The editor isn't ready yet.");
      if (failed && !w.win.isDestroyed()) await dialog.showMessageBox(w.win, { type: "info", message: "Sonobe couldn't bring back that draft.", detail: errorMessage(failed) });
      return !failed;
    } catch (err) {
      log("warn", `Couldn't recover draft ${id}: ${errorMessage(err)}`);
      return false;
    }
  };

  const openProjects = async (paths: readonly string[]) => {
    if (!ready) {
      pendingOpen.push(...paths);
      return;
    }
    for (const candidate of paths) {
      const dir = await resolveProjectSelection(candidate);
      if (!dir) {
        log("warn", `Not a Sonobe project: ${candidate}`);
        continue;
      }
      const draftId = await draftAt(dir);
      if (draftId) {
        void recoverDraftFolder(draftId);
        continue;
      }
      access.approve(dir);
      const w = await ensureWindow();
      w.openProject(dir);
      w.focus();
    }
  };

  // --- MCP bridge: windows as RendererTargets for the app host -------------------------------

  const editorTarget = (w: AppWindow): RendererTarget => ({
    id: w.webContents.id,
    invoke<T>(method: string, params?: unknown, opts?: { timeoutMs?: number }): Promise<T> {
      return rpc ? rpc.invoke<T>(w.webContents, method, params, opts) : Promise.reject(Object.assign(new Error("The RPC bridge isn't ready"), { code: "disposed" }));
    },
    hasMethod: (method) => rpc?.hasMethod(w.webContents, method),
    focus: () => w.focus(),
    capture: (rect, size) => captureWebContents(w.webContents, rect, size),
  });

  const editorTargets = (): RendererTarget[] => {
    const focused = BrowserWindow.getFocusedWindow();
    return [...windows.values()]
      .filter((w) => !w.webContents.isDestroyed())
      .sort((a, b) => Number(b.win === focused) - Number(a.win === focused))
      .map(editorTarget);
  };

  /** Resolve once a window's editor registered the MCP bridge, or clearly never will. */
  const waitForEditor = async (w: AppWindow, timeoutMs = 20_000) => {
    const started = Date.now();
    while (!w.webContents.isDestroyed() && Date.now() - started < timeoutMs) {
      const has = rpc?.hasMethod(w.webContents, "document.info");
      if (has === true || w.content().kind === "placeholder") return;
      if (has === false && !w.webContents.isLoading() && Date.now() - started > 5000) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  const approveAgentProject = async (dir: string) => {
    const resolved = await resolveProjectSelection(dir);
    const draftId = resolved ? await draftAt(resolved) : null;
    if (draftId) {
      throw new HostError("draft_folder", `${resolved} is a draft of unsaved work that Sonobe keeps, not a project.`, {
        hint: `Bring it back with open_document({ ref: "draft:${draftId}" }), then save it where the person wants it with save_document({ path }).`,
      });
    }
    if (resolved) access.approve(resolved);
    return resolved ?? null;
  };

  const defaultProjectDir = async (name: string): Promise<string> => {
    const base = name.replace(/[\\/:*?"<>|\0]/g, "-").trim() || "Untitled";
    const documents = app.getPath("documents");
    for (let n = 1; n < 10_000; n++) {
      const candidate = path.join(documents, `${n === 1 ? base : `${base} ${n}`}.sonobe`);
      if (!existsSync(candidate)) return candidate;
    }
    return path.join(documents, `${base} ${Date.now()}.sonobe`);
  };

  const writeNewProject = async (dir: string, doc: SonobeDocument) => {
    access.approve(dir);
    // A new project never deletes files already in the folder.
    await saveProjectToDisk(dir, doc, { removable: new Set() });
  };

  /** A folder an agent named for a new project: new or empty, outside other projects, in home, a drive or tmp. Approved for the editor. */
  const agentProjectTarget = async (input: string) => {
    const mounts = platform === "darwin" ? ["/Volumes"] : platform === "linux" ? ["/media", "/mnt", "/run/media"] : [];
    const dir = await resolveProjectTarget(input, {
      home: app.getPath("home"),
      roots: [app.getPath("home"), tmpdir(), ...mounts],
      refused: [
        { dir: app.getPath("userData"), why: "Sonobe keeps its settings and drafts there" },
        { dir: app.getAppPath(), why: "that's where the Sonobe app itself lives" },
      ],
    });
    access.approve(dir);
    return dir;
  };

  // --- MCP status (Connect Claude) -------------------------------------------------------------

  const mcpStatus = (): McpStatus => {
    const cliPath = bundledCliPath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDir: __dirname, platform: process.platform, exists: existsSync });
    const sessions = { clients: mcpClients.list(), checkedAt: Date.now(), version: VERSION };
    return mcp?.running
      ? { running: true, port: mcp.port, url: mcp.url, tokenFile: mcp.tokenFile, cliPath, ...sessions }
      : { running: false, port: null, url: null, tokenFile: path.join(env.home ?? defaultSonobeHome(), "mcp.json"), cliPath, ...sessions };
  };

  /** Push MCP status to every window when a session connects, calls a tool, or leaves (at most every 500 ms). */
  const publishMcpStatus = () => {
    mcpStatusTimer ??= setTimeout(() => {
      mcpStatusTimer = null;
      const status = mcpStatus();
      for (const w of windows.values()) if (!w.webContents.isDestroyed()) w.webContents.send(IPC.mcpChanged, status);
    }, 500);
  };
  mcpClients.subscribe(publishMcpStatus);

  // --- Updates (electron/updates.ts) -----------------------------------------------------------

  /** What this build does about updates. A checkout and every automated run are off without reading anything. */
  const updateBuildMode = (): UpdateModeResult => {
    if (testUpdateDriver) return { mode: "install", reason: null, canMove: false };
    return (updateBuild ??= updateMode({
      env,
      packaged: app.isPackaged,
      feedConfig: () => existsSync(path.join(process.resourcesPath, "app-update.yml")),
      // What package.mjs recorded about the signature (BuildInfo in scripts/signing.ts), in the packaged package.json.
      recorded: () => {
        try {
          return (JSON.parse(readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")) as { sonobe?: { updates?: unknown } }).sonobe?.updates;
        } catch {
          return undefined;
        }
      },
      location: () =>
        installLocation({ platform: process.platform, exePath: process.execPath, inApplications: () => app.isInApplicationsFolder(), access: (target) => accessSync(target, constants.W_OK), appImage: process.env.APPIMAGE }),
    }));
  };

  /**
   * electron-updater, loaded the first time it's needed: never at launch, and never in a build that's off. It lives in its own
   * bundle, dist/updater.cjs (scripts/build.mjs), so main.cjs doesn't carry its 600 KB through every launch.
   */
  const loadUpdateDriver = (): Promise<UpdateDriver> => {
    if (testUpdateDriver) return Promise.resolve(testUpdateDriver);
    return (updateDriver ??= Promise.resolve()
      .then(() => (require(path.join(__dirname, "updater.cjs")) as typeof import("./updater-driver.ts")).loadUpdaterDriver({ native: autoUpdater as unknown as NativeUpdaterLike, mode: updateBuildMode().mode, feed: env.updateFeed, platform: process.platform, log, onError: (err) => restartFailed?.(err) }))
      .catch((err: unknown) => {
        updateDriver = null;
        throw err;
      }));
  };

  const requireUpdates = (): UpdateController => {
    if (!updates) throw new Error("Updates aren't ready yet.");
    return updates;
  };

  /**
   * The menu's update item. Until the build has been read (which waits for the first window), it's there whenever updates aren't
   * plainly off, so Check for Updates… is in the menu from the start.
   */
  function updateMenuItem(): "check" | "restart" | undefined {
    if (!updates) return undefined;
    if (!updateBuild && !testUpdateDriver) return env.updates && app.isPackaged && !(env.testHooks && !env.updateFeed) ? "check" : undefined;
    const status = updates.status();
    return status.mode === "off" ? undefined : status.state === "ready" ? "restart" : "check";
  }

  const publishUpdateStatus = (status: UpdateStatus) => {
    for (const w of windows.values()) if (!w.webContents.isDestroyed()) w.webContents.send(IPC.updatesChanged, status);
    if (updateMenuItem() !== menuUpdateItem) rebuildMenu();
  };

  /** Answers a check in a native dialog: for Check for Updates… when no editor is listening (no window open, or a page without the notices). */
  const showUpdateDialog = async (status: UpdateStatus) => {
    const box = manualCheckDialog(status);
    const parent = primaryWindow()?.win;
    const options = { type: "info" as const, message: box.message, detail: box.detail, buttons: box.buttons, defaultId: 0, cancelId: box.buttons.length - 1 };
    const { response } = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    if (response !== 0 || !box.action) return;
    if (box.action === "restart") await restartToUpdate();
    else await shell.openExternal(status.releaseUrl);
  };

  /** Check for Updates… in the menu. The editor's notices answer when one is listening, a dialog otherwise. */
  const checkForUpdates = async () => {
    const status = await requireUpdates().check({ manual: true });
    // The check read what this build can do, if nothing had yet: a build that never checks loses the item.
    if (updateMenuItem() !== menuUpdateItem) rebuildMenu();
    if (![...windows.values()].some((w) => w.showsUpdates())) await showUpdateDialog(status);
  };

  const reopenFile = () => path.join(app.getPath("userData"), "reopen-after-update.json");

  /** The editor windows as a restart sees them, front first. */
  const restartWindows = (): RestartWindow[] => {
    const focused = BrowserWindow.getFocusedWindow();
    return [...windows.values()]
      .filter((w) => !w.win.isDestroyed())
      .sort((a, b) => Number(b.win === focused) - Number(a.win === focused))
      .map((w) => ({
        project: async () => {
          if (rpc?.hasMethod(w.webContents, "document.info") !== true) return null;
          const info = await rpc.invoke<{ projectPath?: unknown }>(w.webContents, "document.info", undefined, { timeoutMs: 5000 });
          return typeof info?.projectPath === "string" ? info.projectPath : null;
        },
        focus: () => w.focus(),
        requestClose: (reason) => w.requestClose(reason),
      }));
  };

  /** The helper windows (pop-out viewer, scene renderer, design captures) go too: the updater only quits an app with no window left. */
  const noWindowsLeft = async (): Promise<boolean> => {
    abortCaptures();
    const started = Date.now();
    while (BrowserWindow.getAllWindows().length > 0 && Date.now() - started < 5000) {
      // They hold nothing of the person's, so one that's slow to go is destroyed. Never an editor window: one that
      // opened meanwhile (a prototype double-clicked in Finder) stays, and the restart is called off.
      if (Date.now() - started > 1500) for (const win of BrowserWindow.getAllWindows()) if (!windows.has(win.webContents.id)) win.destroy();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return BrowserWindow.getAllWindows().length === 0;
  };

  /** The editor showing `dir` in `w`, or the wait running out: opening a project is asked of the editor, which answers later. */
  const waitForProject = async (w: AppWindow, dir: string, timeoutMs = 15_000) => {
    const started = Date.now();
    while (!w.webContents.isDestroyed() && rpc && Date.now() - started < timeoutMs) {
      const info = await rpc.invoke<{ projectPath?: unknown }>(w.webContents, "document.info", undefined, { timeoutMs: 2000 }).catch(() => null);
      if (info?.projectPath === dir) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  /** What to open for a restart's record: each window's draft when it's still there, else its project. */
  const reopenSteps = async (record: ReopenRecord): Promise<ReopenStep[]> => {
    const unclaimed = drafts ? (await drafts.list().catch(() => [])).map((draft) => draft.id) : [];
    return reopenPlan(record, { drafts: unclaimed, exists: (dir) => existsSync(path.join(dir, "project.json")) });
  };

  const reopen = async (steps: readonly ReopenStep[]) => {
    for (const step of steps) {
      const dir = step.kind === "project" ? step.path : (await recoverDraftFolder(step.id)) ? null : step.project;
      if (!dir) continue;
      await openProjects([dir]);
      const w = primaryWindow();
      if (w) await waitForProject(w, dir);
    }
  };

  /** Every window is closed and the app is still running: a window comes back with what was open. */
  const recoverAfterRestart = async (open: ReopenWindow[]) => {
    // The record was for a launch that isn't coming.
    takeReopenRecord(reopenFile());
    const steps = await reopenSteps({ version: 1, fromVersion: VERSION, toVersion: null, at: Date.now(), windows: open });
    reopenInNextWindow = steps.length > 0;
    await ensureWindow();
    await reopen(steps);
  };

  const setRestarting = (on: boolean) => {
    restarting = on;
    updates?.setRestarting(on);
  };

  /**
   * Restart to Update. Each window closes through its unsaved-changes prompt (Save, Keep Draft or Cancel), what was open is written
   * down for the next launch, and only then does the updater quit the app. Resolves false when it didn't restart.
   */
  const restartToUpdate = (): Promise<boolean> =>
    (restartRunning ??= (async () => {
      const status = requireUpdates().status();
      if (status.state !== "ready") return false;
      const outcome = await restartKeepingWork({
        reason: "restart",
        confirm: async () => {
          const sessions = mcpClients.list().filter((client) => client.state === "connected").map((client) => client.label);
          const question = restartConfirmation(sessions, status.version, process.platform);
          if (!question) return true;
          const parent = primaryWindow()?.win;
          const options = { type: "question" as const, message: question.message, detail: question.detail, buttons: question.buttons, defaultId: 0, cancelId: question.buttons.length - 1 };
          const { response } = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
          return response === 0;
        },
        windows: restartWindows,
        setRestarting,
        record: (open) => writeReopenRecord(reopenFile(), { version: 1, fromVersion: VERSION, toVersion: status.version, at: Date.now(), windows: open }),
        noWindowsLeft,
        // When it works the app is gone before this settles. It rejects when the updater reports an error instead.
        install: () =>
          new Promise<void>((_resolve, reject) => {
            restartFailed = reject;
            requireUpdates().install().catch(reject);
          }),
        recover: recoverAfterRestart,
      });
      if (outcome.result === "failed") requireUpdates().fail(outcome.error, "install");
      return false;
    })()
      .catch((err: unknown) => {
        log("warn", `Restart to Update failed: ${errorMessage(err)}`);
        return false;
      })
      .finally(() => {
        restartFailed = null;
        restartRunning = null;
      }));

  /**
   * Moves the app to the Applications folder and opens it there (macOS), so it can update itself. The windows close as for a
   * restart, and the moved app opens what was open. Resolves false when the app stayed where it is.
   */
  const moveToApplications = (): Promise<boolean> =>
    (restartRunning ??= (async () => {
      if (process.platform !== "darwin" || !requireUpdates().status().canMove) return false;
      const outcome = await restartKeepingWork({
        reason: "move",
        confirm: async () => true,
        windows: restartWindows,
        setRestarting,
        record: (open) => writeReopenRecord(reopenFile(), { version: 1, fromVersion: VERSION, toVersion: null, at: Date.now(), windows: open }),
        noWindowsLeft,
        install: () => {
          const moved = app.moveToApplicationsFolder({
            conflictHandler: (conflict) => {
              const answer = moveConflict(conflict);
              if (answer.replace === false) {
                dialog.showMessageBoxSync({ type: "info", message: answer.message, detail: answer.detail });
                return false;
              }
              const { message, detail, buttons } = answer.question;
              return dialog.showMessageBoxSync({ type: "question", message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 }) === 0;
            },
          });
          // Moved: the app quits and the copy in Applications opens, before this would settle.
          return moved ? new Promise<void>(() => undefined) : Promise.reject(new Error("Sonobe stayed where it is."));
        },
        recover: recoverAfterRestart,
      });
      if (outcome.result === "failed") log("info", `Move to Applications: ${outcome.error.message}`);
      return false;
    })()
      .catch((err: unknown) => {
        log("warn", `Move to Applications failed: ${errorMessage(err)}`);
        return false;
      })
      .finally(() => {
        restartRunning = null;
      }));

  // --- Phone preview (LAN web player) ---------------------------------------------------------

  const previewStatus = (): PreviewStatus =>
    preview
      ? { running: true, url: preview.url, urls: preview.urls, lanReachable: preview.lanReachable, clients: preview.clientCount(), error: null }
      : { running: false, url: null, urls: [], lanReachable: false, clients: 0, error: previewError };

  const publishPreviewStatus = () => {
    const status = previewStatus();
    for (const w of windows.values()) if (!w.webContents.isDestroyed()) w.webContents.send(IPC.previewChanged, status);
  };

  const previewDocument = async () => {
    if (!appHost || windows.size === 0) return null;
    try {
      const snap = await appHost.getDocument();
      return { docId: snap.docId, name: snap.doc.project.name, revision: snap.revision, doc: snap.doc, scriptsPaused: appHost.scriptsPaused(snap.docId) };
    } catch (err) {
      if (isHostError(err)) return null;
      throw err;
    }
  };

  const previewAsset = async (file: string) => {
    const snap = appHost ? await appHost.getDocument().catch(() => null) : null;
    if (!snap?.path) return null;
    const candidate = resolveUnder(path.join(snap.path, "assets"), file);
    return candidate && existsSync(candidate) ? candidate : null;
  };

  const startPreview = async (): Promise<PreviewStatus> => {
    if (preview) return previewStatus();
    const playerRoot = path.join(__dirname, "player");
    if (!existsSync(path.join(playerRoot, "index.html"))) {
      previewError = `The phone player isn't built (${playerRoot}). Run npm run build -w @sonobe/desktop.`;
      publishPreviewStatus();
      return previewStatus();
    }
    const starting = (previewStarting ??= startLanPreview({
      playerRoot,
      port: env.lanPort,
      version: VERSION,
      log,
      getDocument: previewDocument,
      resolveAsset: previewAsset,
      onClientsChange: publishPreviewStatus,
      pushUpdates,
    })
      .then((handle) => {
        preview = handle;
        previewError = null;
      })
      .catch((err: unknown) => {
        previewError = errorMessage(err);
        log("warn", `Phone preview couldn't start: ${previewError}`);
      })
      .finally(() => {
        previewStarting = null;
        rebuildMenu();
        publishPreviewStatus();
      }));
    await starting;
    return previewStatus();
  };

  const stopPreview = async (): Promise<PreviewStatus> => {
    const handle = preview;
    preview = null;
    previewError = null;
    if (handle) await handle.close();
    rebuildMenu();
    publishPreviewStatus();
    return previewStatus();
  };

  /** Viewer → Preview on Phone: start the server, then let the editor show its QR panel (or show ours). */
  const showPhonePreview = async () => {
    const w = await ensureWindow();
    const status = await startPreview();
    if (!status.running || !status.url) {
      await dialog.showMessageBox(w.win, { type: "warning", message: "Sonobe couldn't start the phone preview.", detail: status.error ?? "The preview server didn't start." });
      return;
    }
    if (rpc?.hasMethod(w.webContents, "viewer.showPhonePreview") === true) {
      try {
        await rpc.invoke(w.webContents, "viewer.showPhonePreview", status);
        return;
      } catch (err) {
        log("warn", `The editor couldn't show the phone preview: ${errorMessage(err)}`);
      }
    }
    const png = await qrPng(status.url, { margin: 2, width: 240, errorCorrectionLevel: "M" });
    const { response } = await dialog.showMessageBox(w.win, {
      type: "none",
      icon: nativeImage.createFromBuffer(png),
      message: "Preview on Phone",
      detail: phonePreviewDetail(status.url, status.lanReachable),
      buttons: ["Done", "Copy Link", "Stop Preview"],
      defaultId: 0,
      cancelId: 0,
    });
    if (response === 1) clipboard.writeText(status.url);
    else if (response === 2) await stopPreview();
  };

  // --- Live sync: revisions pushed by the editor ---------------------------------------------

  /** Look for a new revision in every connected player (phone preview and pop-out viewer). */
  function pokePlayers(): void {
    preview?.poke();
    viewerWindow?.server.poke();
  }

  /** The editor in `w` restarted its prototype: players showing its document restart too. */
  const prototypeRestarted = (w: AppWindow) => {
    const shown = appHost?.activeTargetId() ?? w.webContents.id;
    if (shown !== w.webContents.id) return;
    preview?.restart();
    viewerWindow?.server.restart();
  };

  /** The editor in `w` committed `revision` (sonobeHost.notifyDocumentChanged). */
  const documentChanged = (w: AppWindow, revision: number) => {
    if (!pushUpdates) {
      pushUpdates = true;
      preview?.setPushUpdates(true);
      viewerWindow?.server.setPushUpdates(true);
      log("info", "The editor pushes revisions; players follow them instead of polling");
    }
    pokePlayers();
    void appHost?.documentChanged(w.webContents.id, revision).catch(() => undefined);
  };

  const flushResourceUpdates = () => {
    resourceTimer = null;
    const uris = [...pendingResourceUris];
    pendingResourceUris.clear();
    for (const uri of uris) {
      if (env.testHooks) notificationLog.push(`resources/updated ${uri}`);
      mcpHandler?.notify.resourceUpdated(uri);
    }
  };

  /** Documents opened, changed or closed: MCP resource notifications, and players follow along. */
  const onDocumentChange = (change: DocumentChange) => {
    if (change.kind !== "changed") {
      if (env.testHooks) notificationLog.push("resources/list_changed");
      mcpHandler?.notify.resourcesChanged();
    }
    if (change.kind !== "closed") {
      pendingResourceUris.add(`sonobe://documents/${change.docId}/outline`);
      pendingResourceUris.add(`sonobe://documents/${change.docId}/diagnostics`);
      resourceTimer ??= setTimeout(flushResourceUpdates, RESOURCE_NOTIFY_MS);
    }
    if (change.kind === "changed") pokePlayers();
  };

  // --- Pop-out viewer window --------------------------------------------------------------------

  const viewerWindowStatus = (): ViewerWindowStatus => {
    const win = viewerWindow?.win;
    return win && !win.isDestroyed() ? { open: true, alwaysOnTop: win.isAlwaysOnTop(), error: null } : { open: false, alwaysOnTop: false, error: viewerWindowError };
  };

  const publishViewerWindowStatus = () => {
    const status = viewerWindowStatus();
    for (const w of windows.values()) if (!w.webContents.isDestroyed()) w.webContents.send(IPC.viewerWindowChanged, status);
  };

  /** A sandboxed window running the web player from a loopback-only server, next to the editor. */
  const openViewerWindow = async (opts: { alwaysOnTop?: boolean }): Promise<ViewerWindowStatus> => {
    const playerRoot = path.join(__dirname, "player");
    if (!existsSync(path.join(playerRoot, "index.html"))) {
      viewerWindowError = `The viewer player isn't built (${playerRoot}). Run npm run build -w @sonobe/desktop.`;
      publishViewerWindowStatus();
      return viewerWindowStatus();
    }
    let server: LanPreviewHandle;
    try {
      server = await startLanPreview({ playerRoot, host: "127.0.0.1", version: VERSION, log, getDocument: previewDocument, resolveAsset: previewAsset, pushUpdates });
    } catch (err) {
      viewerWindowError = `The viewer window couldn't start: ${errorMessage(err)}`;
      publishViewerWindowStatus();
      return viewerWindowStatus();
    }
    const snap = await previewDocument().catch(() => null);
    const anchor = primaryWindow()?.win;
    const display = anchor ? screen.getDisplayMatching(anchor.getBounds()) : screen.getPrimaryDisplay();
    const [width, height] = viewerWindowSize(snap?.doc, display.workArea);
    let position: { x: number; y: number } | undefined;
    if (anchor) {
      const b = anchor.getBounds();
      const area = display.workArea;
      const x = b.x + b.width + 12;
      if (x + width <= area.x + area.width) position = { x, y: Math.max(area.y, Math.min(b.y, area.y + area.height - height)) };
    }
    const win = new BrowserWindow({
      width,
      height,
      ...(position ?? {}),
      useContentSize: true,
      show: false,
      title: snap ? `${snap.name} · Viewer` : "Viewer",
      backgroundColor: "#000000",
      alwaysOnTop: opts.alwaysOnTop === true,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, webSecurity: true, webviewTag: false, navigateOnDragDrop: false, spellcheck: false, safeDialogs: true },
    });
    const wc = win.webContents;
    if (env.mute) wc.setAudioMuted(true);
    const origin = new URL(server.url).origin;
    wc.on("will-navigate", (event) => {
      let same = false;
      try {
        same = new URL(event.url).origin === origin;
      } catch {
        same = false;
      }
      if (same) return;
      event.preventDefault();
      if (isExternalUrl(event.url) || isMailtoUrl(event.url)) void shell.openExternal(event.url);
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (isExternalUrl(url) || isMailtoUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
      if (viewerWindow?.win === win) viewerWindow = null;
      void server.close();
      publishViewerWindowStatus();
    });
    viewerWindow = { win, server, origin };
    viewerWindowError = null;
    try {
      // The page has no host API, so ?mute=1 is how it learns to speak silently (system speech plays past setAudioMuted).
      await win.loadURL(env.mute ? `${server.url}?mute=1` : server.url);
    } catch (err) {
      log("warn", `The viewer window didn't load: ${errorMessage(err)}`);
    }
    publishViewerWindowStatus();
    return viewerWindowStatus();
  };

  const popOutViewer = (opts: { alwaysOnTop?: boolean } = {}): Promise<ViewerWindowStatus> => {
    const existing = viewerWindow?.win;
    if (existing && !existing.isDestroyed()) {
      if (opts.alwaysOnTop !== undefined) existing.setAlwaysOnTop(opts.alwaysOnTop, "floating");
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      publishViewerWindowStatus();
      return Promise.resolve(viewerWindowStatus());
    }
    return (viewerWindowOpening ??= openViewerWindow(opts).finally(() => {
      viewerWindowOpening = null;
    }));
  };

  const closeViewerWindow = async (): Promise<ViewerWindowStatus> => {
    const win = viewerWindow?.win;
    if (win && !win.isDestroyed()) {
      const closed = new Promise<void>((resolve) => win.once("closed", () => resolve()));
      win.close();
      await closed;
    }
    return viewerWindowStatus();
  };

  // --- Simulation frames for MCP screenshots ---------------------------------------------------

  /** A hidden window that draws SceneFrames (dist/scene), created on first use. */
  const sceneRenderer = (): Promise<BrowserWindow> =>
    (sceneWindow ??= (async () => {
      const index = path.join(__dirname, "scene", "index.html");
      if (!existsSync(index)) throw new Error(`The scene renderer isn't built (${index}). Run npm run build -w @sonobe/desktop.`);
      const win = new BrowserWindow({
        show: false,
        width: 402,
        height: 874,
        useContentSize: true,
        frame: false,
        skipTaskbar: true,
        enableLargerThanScreen: true,
        paintWhenInitiallyHidden: true,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, navigateOnDragDrop: false, spellcheck: false },
      });
      win.webContents.setAudioMuted(true);
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.on("closed", () => {
        sceneWindow = null;
      });
      await win.loadFile(index);
      return win;
    })().catch((err: unknown) => {
      sceneWindow = null;
      throw err;
    }));

  const renderScene = (request: SceneRenderRequest): Promise<CapturedImage | null> => {
    const task = async () => {
      const win = await sceneRenderer();
      const scale = request.crop.width > 0 ? request.size.width / request.crop.width : 1;
      const [width, height] = request.scene.size;
      win.setContentSize(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)));
      const assets = Object.fromEntries(Object.entries(request.assets).map(([id, file]) => [id, pathToFileURL(file).href]));
      // Scene props inherit layer defaults, which JSON would drop: send plain props.
      await win.webContents.executeJavaScript(`window.__sonobeRenderScene(${JSON.stringify({ scene: plainSceneFrame(request.scene), scale, assets })})`, true);
      const crop = { x: request.crop.x * scale, y: request.crop.y * scale, width: request.crop.width * scale, height: request.crop.height * scale };
      return captureWebContents(win.webContents, crop, request.size);
    };
    const run = sceneQueue.then(task, task);
    sceneQueue = run.catch(() => undefined);
    return run.catch((err: unknown) => {
      log("warn", `Couldn't draw a simulation frame: ${errorMessage(err)}`);
      return null;
    });
  };

  /** A patch graph the patch editor isn't showing (get_screenshot with component), drawn in the same hidden window. */
  const renderSvg = (request: SvgRenderRequest): Promise<CapturedImage | null> => {
    const task = async () => {
      const win = await sceneRenderer();
      const { width, height } = request.size;
      win.setContentSize(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
      await win.webContents.executeJavaScript(`window.__sonobeRenderSvg(${JSON.stringify({ svg: request.svg, width, height })})`, true);
      return captureWebContents(win.webContents, { x: 0, y: 0, width, height }, request.size);
    };
    const run = sceneQueue.then(task, task);
    sceneQueue = run.catch(() => undefined);
    return run.catch((err: unknown) => {
      log("warn", `Couldn't draw a patch graph: ${errorMessage(err)}`);
      return null;
    });
  };

  const requireSecrets = (): SecretStore => {
    if (!secrets) throw new Error("Secure storage isn't ready yet.");
    return secrets;
  };

  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    void openProjects([filePath]);
  });

  app.on("second-instance", (_event, argv, workingDirectory) => {
    const paths = projectPathsFromArgv(argv.slice(1), workingDirectory);
    if (!ready) {
      pendingOpen.push(...paths);
      return;
    }
    void ensureWindow().then((w) => {
      w.focus();
      if (paths.length) void openProjects(paths);
    });
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  // A restart closes every window before the updater quits the app: closing the last one mustn't quit it first (the update would
  // install without opening Sonobe again), and the Dock mustn't open a window in between.
  app.on("window-all-closed", () => {
    if (platform !== "darwin" && !restarting) app.quit();
  });

  app.on("activate", () => {
    if (ready && windows.size === 0 && !restarting) void ensureWindow();
  });

  // The players show the document in front, so switching editor windows may change what they show.
  app.on("browser-window-focus", (_event, win) => {
    if (windows.has(win.webContents.id)) pokePlayers();
  });

  app.on("will-quit", () => {
    updates?.stop();
    abortCaptures();
    for (const { watcher } of watchers.values()) watcher.close();
    watchers.clear();
    if (resourceTimer) clearTimeout(resourceTimer);
    if (viewerWindow) void viewerWindow.server.close();
    rpc?.dispose();
    void assistant?.dispose().catch(() => undefined);
    if (mcpHandler) void mcpHandler.close().catch(() => undefined);
    appHost?.dispose();
    if (preview) void preview.close();
    if (mcp) {
      mcp.removeTokenFile();
      void mcp.close();
    }
  });
  process.on("exit", () => mcp?.removeTokenFile());

  const registerIpc = () => {
    ipcMain.handle(IPC.dialogOpenProject, async (event) => {
      const w = requireWindow(event);
      const result = await dialog.showOpenDialog(w.win, {
        title: "Open Prototype",
        buttonLabel: "Open",
        properties: platform === "darwin" ? ["openFile", "openDirectory"] : ["openDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const dir = await resolveProjectSelection(result.filePaths[0]);
      if (!dir) {
        await dialog.showMessageBox(w.win, {
          type: "info",
          message: "That folder isn't a Sonobe prototype.",
          detail: "Choose a folder ending in .sonobe, or a folder that contains project.json.",
        });
        return null;
      }
      const draftId = await draftAt(dir);
      if (draftId) {
        void recoverDraftFolder(draftId, w);
        return null;
      }
      access.approve(dir);
      return dir;
    });

    ipcMain.handle(IPC.dialogSaveProject, async (event, defaultName: unknown) => {
      const w = requireWindow(event);
      const name = (typeof defaultName === "string" ? defaultName : "Untitled").replace(/[\\/:*?"<>|\0]/g, "-").trim() || "Untitled";
      let defaultPath = path.join(app.getPath("documents"), name.endsWith(".sonobe") ? name : `${name}.sonobe`);
      for (;;) {
        const result = await dialog.showSaveDialog(w.win, {
          title: "Save Prototype",
          buttonLabel: "Save",
          defaultPath,
          properties: ["createDirectory", "showOverwriteConfirmation"],
        });
        if (result.canceled || !result.filePath) return null;
        const dir = result.filePath.endsWith(".sonobe") ? result.filePath : `${result.filePath}.sonobe`;
        if (await draftAt(dir)) {
          await dialog.showMessageBox(w.win, { type: "info", message: "Sonobe keeps drafts of unsaved work in that folder.", detail: "It deletes them once the work is saved, so choose a folder of your own, such as Documents." });
          defaultPath = path.join(app.getPath("documents"), path.basename(dir));
          continue;
        }
        // The folder rules agents follow, except that replacing a prototype (the panel asked) is the person's call.
        const problem = await checkProjectTarget(dir, { allowExistingProject: true });
        if (!problem) {
          access.approve(dir);
          return dir;
        }
        await dialog.showMessageBox(w.win, { type: "info", message: problem.message, detail: problem.hint });
        defaultPath = problem.suggestion ?? dir;
      }
    });

    ipcMain.handle(IPC.readProject, async (event, dir: unknown) => {
      const w = requireWindow(event);
      if (!(await access.canAccess(dir))) throw new Error(`Sonobe can only open prototype folders you've chosen: ${String(dir)}`);
      await refuseDraftFolder(dir);
      const project = await readProject(dir as string);
      access.approve(dir as string);
      await addRecent(dir as string);
      w.setRepresentedDir(dir as string);
      return project;
    });

    ipcMain.handle(IPC.readProjectIfExists, async (event, dir: unknown) => {
      requireWindow(event);
      if (!(await access.canAccess(dir))) throw new Error(`Sonobe can only open prototype folders you've chosen: ${String(dir)}`);
      if (!existsSync(dir as string)) return null;
      return readProject(dir as string);
    });

    ipcMain.handle(IPC.writeProject, async (event, dir: unknown, changes: unknown) => {
      const w = requireWindow(event);
      if (!(await access.canAccess(dir))) throw new Error(`Sonobe can only save into prototype folders you've chosen: ${String(dir)}`);
      if (!changes || typeof changes !== "object") throw new Error("writeProject: changes must be an object");
      await refuseDraftFolder(dir);
      await writeProject(dir as string, changes as WriteProjectInput, { ownWrites });
      await addRecent(dir as string);
      w.setRepresentedDir(dir as string);
    });

    ipcMain.handle(IPC.watchProject, async (event, watchId: unknown, dir: unknown) => {
      const w = requireWindow(event);
      if (typeof watchId !== "string" || watchId.length > 64) throw new Error("watchProject: invalid watch id");
      if (!(await access.canAccess(dir))) throw new Error(`Sonobe can only watch prototype folders you've chosen: ${String(dir)}`);
      watchers.get(watchId)?.watcher.close();
      const wc = w.webContents;
      const watcher = createProjectWatcher({
        dir: dir as string,
        ownWrites,
        onChange: (paths) => {
          if (!wc.isDestroyed()) wc.send(IPC.projectChanged, { id: watchId, dir, paths });
        },
        onError: (err) => log("warn", `Watcher for ${String(dir)} stopped: ${err.message}`),
      });
      watchers.set(watchId, { ownerId: wc.id, watcher });
    });

    ipcMain.handle(IPC.unwatchProject, (event, watchId: unknown) => {
      const w = requireWindow(event);
      const entry = typeof watchId === "string" ? watchers.get(watchId) : undefined;
      if (entry && entry.ownerId === w.webContents.id) {
        entry.watcher.close();
        watchers.delete(watchId as string);
      }
    });

    ipcMain.handle(IPC.revealInFinder, (event, target: unknown) => {
      requireWindow(event);
      if (typeof target === "string" && path.isAbsolute(target)) shell.showItemInFolder(target);
    });

    ipcMain.handle(IPC.recentProjects, async (event) => {
      requireWindow(event);
      return recents ? recents.list() : [];
    });

    ipcMain.handle(IPC.mcpStatus, (event): McpStatus => {
      requireWindow(event);
      return mcpStatus();
    });

    ipcMain.handle(IPC.previewStatus, (event): PreviewStatus => {
      requireWindow(event);
      return previewStatus();
    });
    ipcMain.handle(IPC.previewStart, (event): Promise<PreviewStatus> => {
      requireWindow(event);
      return startPreview();
    });
    ipcMain.handle(IPC.previewStop, (event): Promise<PreviewStatus> => {
      requireWindow(event);
      return stopPreview();
    });

    // The editor's questions about updates wait until updates have started, after the first window is on screen: answering reads
    // what the build can do, and that never happens during launch.
    ipcMain.handle(IPC.updatesStatus, async (event): Promise<UpdateStatus> => {
      requireWindow(event);
      await updatesReady;
      return requireUpdates().status();
    });
    ipcMain.handle(IPC.updatesCheck, async (event): Promise<UpdateStatus> => {
      requireWindow(event);
      await updatesReady;
      return requireUpdates().check({ manual: true });
    });
    ipcMain.handle(IPC.updatesSetAutoCheck, async (event, enabled: unknown): Promise<UpdateStatus> => {
      requireWindow(event);
      await updatesReady;
      return requireUpdates().setAutoCheck(enabled === true);
    });
    ipcMain.handle(IPC.updatesRestart, (event): Promise<boolean> => {
      requireWindow(event);
      return restartToUpdate();
    });
    ipcMain.handle(IPC.updatesMoveToApplications, (event): Promise<boolean> => {
      requireWindow(event);
      return moveToApplications();
    });
    ipcMain.on(IPC.updatesListeners, (event, count: unknown) => {
      if (typeof count === "number") trustedWindow(event)?.setUpdateListeners(count);
    });

    ipcMain.on(IPC.documentChanged, (event, revision: unknown, labels: unknown) => {
      const w = trustedWindow(event);
      if (!w || typeof revision !== "number" || !Number.isFinite(revision)) return;
      documentChanged(w, revision);
      if (w === primaryWindow()) setHistoryLabels(labels);
    });

    ipcMain.on(IPC.prototypeRestarted, (event) => {
      const w = trustedWindow(event);
      if (w) prototypeRestarted(w);
    });

    ipcMain.handle(IPC.secretsStatus, (event): SecretsStatus => {
      requireWindow(event);
      return requireSecrets().status();
    });
    ipcMain.handle(IPC.secretsSet, async (event, name: unknown, value: unknown) => {
      requireWindow(event);
      await requireSecrets().set(name, value);
    });
    ipcMain.handle(IPC.secretsDelete, (event, name: unknown) => {
      requireWindow(event);
      return requireSecrets().delete(name);
    });

    ipcMain.handle(IPC.openExternal, async (event, url: unknown) => {
      requireWindow(event);
      if (typeof url !== "string" || url.length > 8192 || !(isExternalUrl(url) || isMailtoUrl(url))) return false;
      await shell.openExternal(url);
      return true;
    });

    ipcMain.handle(IPC.captureDesign, async (event, request: unknown) => {
      requireWindow(event);
      const r = (request && typeof request === "object" ? request : {}) as Record<string, unknown>;
      const str = (key: string) => (typeof r[key] === "string" ? (r[key] as string) : undefined);
      const num = (key: string, fallback: number) => (typeof r[key] === "number" && Number.isFinite(r[key]) ? (r[key] as number) : fallback);
      const sender = event.sender;
      const captureId = typeof r.captureId === "string" && r.captureId.length <= 200 ? r.captureId : undefined;
      const key = captureId !== undefined ? `${sender.id}:${captureId}` : undefined;
      // The dialog's Cancel, a reload of the editor, or a closed window stops the capture.
      const controller = new AbortController();
      const stop = () => controller.abort();
      const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
        if (details.isMainFrame && !details.isSameDocument) stop();
      };
      sender.once("destroyed", stop);
      sender.on("did-start-navigation", onNavigate);
      if (key) dialogCaptures.set(key, controller);
      try {
        const url = str("url");
        const html = str("html");
        if ((url === undefined) === (html === undefined)) return { ok: false, code: "invalid_source", message: "Pass a URL or HTML to import." };
        const colorScheme = str("colorScheme");
        const captured = await captureDesignInWindow(
          {
            ...(url !== undefined ? { url } : { html: html! }),
            width: num("width", 402),
            height: num("height", 874),
            ...(str("selector") ? { selector: str("selector")! } : {}),
            ...(str("waitFor") ? { waitFor: str("waitFor")! } : {}),
            ...(typeof r.waitMs === "number" ? { waitMs: num("waitMs", 0) } : {}),
            ...(r.fullPage === false ? { fullPage: false } : {}),
            ...(colorScheme === "light" || colorScheme === "dark" ? { colorScheme } : {}),
          },
          {
            log,
            signal: controller.signal,
            symbols,
            ...(testCaptureDeadlineMs ? { maxTimeoutMs: testCaptureDeadlineMs } : {}),
            ...(captureId !== undefined
              ? {
                  onProgress: (progress) => {
                    if (!sender.isDestroyed()) sender.send(IPC.captureDesignProgress, { captureId, ...progress });
                  },
                }
              : {}),
          },
        );
        return { ok: true, capture: captured.capture, images: [...captured.images.entries()], ...(captured.notes ? { notes: captured.notes } : {}) };
      } catch (err) {
        const e = err as { code?: unknown; message?: unknown; hint?: unknown };
        return { ok: false, code: typeof e.code === "string" ? e.code : "capture_failed", message: typeof e.message === "string" ? e.message : String(err), ...(typeof e.hint === "string" ? { hint: e.hint } : {}) };
      } finally {
        if (key && dialogCaptures.get(key) === controller) dialogCaptures.delete(key);
        sender.removeListener("destroyed", stop);
        sender.removeListener("did-start-navigation", onNavigate);
      }
    });

    ipcMain.on(IPC.captureDesignCancel, (event, captureId: unknown) => {
      if (!trustedWindow(event) || typeof captureId !== "string") return;
      dialogCaptures.get(`${event.sender.id}:${captureId}`)?.abort();
    });

    ipcMain.handle(IPC.fetchCaptureFile, async (event, url: unknown) => {
      requireWindow(event);
      if (typeof url !== "string" || url.length > 8192) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        return await fetchCaptureImage(url, controller.signal);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    });

    ipcMain.handle(IPC.viewerWindowOpen, (event, options: unknown) => {
      requireWindow(event);
      const alwaysOnTop = options && typeof options === "object" ? (options as { alwaysOnTop?: unknown }).alwaysOnTop : undefined;
      return popOutViewer(typeof alwaysOnTop === "boolean" ? { alwaysOnTop } : {});
    });
    ipcMain.handle(IPC.viewerWindowClose, (event) => {
      requireWindow(event);
      return closeViewerWindow();
    });
    ipcMain.handle(IPC.viewerWindowStatus, (event): ViewerWindowStatus => {
      requireWindow(event);
      return viewerWindowStatus();
    });

    ipcMain.on(IPC.commandListeners, (event, count: unknown) => {
      if (typeof count === "number") trustedWindow(event)?.setCommandListeners(count);
    });
    ipcMain.on(IPC.openProjectReady, (event) => trustedWindow(event)?.markOpenReady());
    ipcMain.on(IPC.setDocumentEdited, (event, edited: unknown) => trustedWindow(event)?.setDocumentEdited(edited === true));
    ipcMain.on(IPC.setTitle, (event, title: unknown) => {
      if (typeof title === "string") trustedWindow(event)?.setTitle(title.slice(0, 512));
    });
  };

  void app.whenReady().then(async () => {
    quitOnSignal();
    const trustedUrl = (url: string | undefined) => {
      if (!url) return false;
      if ([...windows.values()].some((w) => isAppUrl(url, w.content()))) return true;
      // The pop-out viewer may use the camera and microphone like the editor's viewer (no IPC access).
      try {
        return !!viewerWindow && new URL(url).origin === viewerWindow.origin;
      } catch {
        return false;
      }
    };
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
      callback(ALLOWED_PERMISSIONS.has(permission) && trustedUrl(details.requestingUrl));
    });
    // Origins of file: and data: pages are opaque ("file:///", "null"), so judge by the page URL.
    session.defaultSession.setPermissionCheckHandler((wc, permission) => ALLOWED_PERMISSIONS.has(permission) && trustedUrl(wc?.getURL()));

    app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: VERSION, copyright: "MIT License · Sonobe contributors" });

    rpc = createRendererRpcHub(ipcMain, { isTrustedSender: (event: RpcIpcEvent) => !!trustedWindow(event as unknown as IpcMainEvent) });
    // Test runs use a reversible cipher so automated launches never touch (or prompt for) the keychain.
    secrets = createSecretStore({ file: path.join(app.getPath("userData"), "secrets.json"), cipher: env.testHooks ? createTestCipher() : safeStorage, log });
    // Created here and started once the first window is on screen. Until then it reads nothing and loads nothing.
    updates = createUpdateController({
      current: VERSION,
      mode: updateBuildMode,
      settings: createUpdateSettings({ file: path.join(app.getPath("userData"), "updates.json"), log }),
      driver: loadUpdateDriver,
      releasesUrl: RELEASES_URL,
      onChange: publishUpdateStatus,
      log,
    });
    registerIpc();
    drafts = createDraftStore({ dir: path.join(app.getPath("userData"), "Drafts"), version: VERSION, log });
    registerDraftIpc(ipcMain, drafts, { requireWindow, reveal: (folder) => shell.showItemInFolder(folder) });
    void drafts.prune().then((n) => n && log("info", `Removed ${n} empty or 90-day-old draft${n === 1 ? "" : "s"}`)).catch(() => undefined);
    assistant = registerAssistant({
      ipcMain,
      isTrustedSender: (event) => trustedWindow(event as IpcMainInvokeEvent) !== null,
      host: () => appHost,
      secrets: () => secrets,
      version: VERSION,
      guides: () => loadGuides(bundledResource("guides", "packages/mcp/guides")),
      log,
      documentFor: (id) => (appHost ? appHost.targetDocument(id) : Promise.resolve(null)),
      codeFolders: createCodeFolderStore({ file: path.join(app.getPath("userData"), "assistant-code-folders.json"), home: homedir() }),
      pickFolder: async (sender, { defaultPath }) => {
        const w = windows.get(sender.id);
        if (!w) return null;
        const result = await dialog.showOpenDialog(w.win, {
          title: "Match Your Code",
          message: "Pick your app's folder. The Assistant can read its text files, like themes, tokens and components, to match your design, and sends what it reads to Anthropic's API. It skips hidden files, .env files, keys and node_modules, and it can't change anything.",
          buttonLabel: "Link Folder",
          properties: ["openDirectory"],
          defaultPath,
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      handoff: {
        platform: process.platform,
        dir: path.join(app.getPath("userData"), "handoff"),
        // Connect Claude's relay: the CLI that ships with the app, else `sonobe` on PATH.
        server: () => ({ command: mcpStatus().cliPath ?? "sonobe", args: ["mcp"] }),
        openPath: (file) => shell.openPath(file),
      },
      // Experimental and off by default (Settings → Claude): the Assistant on the person's Claude subscription.
      connection: createConnectionStore({ file: path.join(app.getPath("userData"), "assistant-connection.json"), log }),
      subscription: {
        // Never in a release until Anthropic agrees: every release is a packaged build, and a packaged build never offers the switch.
        available: !app.isPackaged,
        sessionsDir: path.join(app.getPath("userData"), "assistant", "claude"),
        signIn: { platform: process.platform, dir: path.join(app.getPath("userData"), "handoff"), openPath: (file) => shell.openPath(file) },
      },
    });

    appHost = createAppHost({
      registry: createPatchRegistry(),
      targets: editorTargets,
      ensureTarget: async () => {
        await reopened;
        const w = await ensureWindow();
        await waitForEditor(w);
        return editorTarget(w);
      },
      approveProject: approveAgentProject,
      defaultProjectDir,
      projectExists: async (dir) => existsSync(path.join(dir, "project.json")),
      writeProject: writeNewProject,
      newProjectTarget: agentProjectTarget,
      drafts: { list: () => drafts?.list() ?? Promise.resolve([]) },
      renderScene,
      renderSvg,
      captureDesign: (request, control = {}) =>
        captureDesignInWindow(request, {
          log,
          symbols,
          ...(control.signal ? { signal: control.signal } : {}),
          ...(control.progress ? { onProgress: (p) => control.progress?.({ message: p.message, ...(p.done !== undefined ? { progress: p.done } : {}), ...(p.total !== undefined ? { total: p.total } : {}) }) } : {}),
          ...(testCaptureDeadlineMs ? { maxTimeoutMs: testCaptureDeadlineMs } : {}),
        }),
      fetchImage: fetchCaptureImage,
      sfSymbols: !symbols.unavailable,
      onDocumentChange,
    });

    recents = new RecentProjects(path.join(app.getPath("userData"), "recent-projects.json"));
    for (const dir of await recents.list()) {
      // A draft folder an older build opened as a project.
      if (await draftAt(dir)) await recents.remove(dir);
      else access.approve(dir);
    }
    rebuildMenu();

    // A restart for an update wrote down what was open: it opens again, once. A project named on the command line or opened from
    // Finder wins, and the record is used up either way. Without a record (every other launch) this is one failed read.
    const record = takeReopenRecord(reopenFile());
    const reopening = record && !pendingOpen.length ? await reopenSteps(record) : [];
    let finishReopen = () => undefined as void;
    if (reopening.length) {
      reopenInNextWindow = true;
      // MCP calls wait for the work to be back (the endpoint below listens before the window exists), 30 s at most.
      reopened = new Promise((resolve) => (finishReopen = resolve));
      setTimeout(finishReopen, 30_000).unref();
    }

    if (env.mcpEnabled) {
      try {
        mcp = await startMcpServer({ version: VERSION, port: env.mcpPort, ...(env.home ? { configDir: env.home } : {}), clients: mcpClients, log });
        const handler = (mcpHandler = createHttpHandler(appHost, {
          version: VERSION,
          guides: loadGuides(bundledResource("guides", "packages/mcp/guides")),
          clients: mcpClients,
          onError: (err) => log("warn", `MCP transport error: ${err.message}`),
        }));
        // A relay that outlived the restart reconnects as soon as /health answers: its calls wait until the work is back.
        mcp.setHandler(async (req, res) => {
          await reopened;
          return handler(req, res);
        });
      } catch (err) {
        log("warn", `MCP endpoint disabled: ${errorMessage(err)}`);
      }
    }

    const first = await ensureWindow();
    ready = true;
    if (pendingOpen.length) await openProjects(pendingOpen.splice(0));
    else if (reopening.length) await reopen(reopening).catch((err: unknown) => log("warn", `Couldn't reopen what was open before the restart: ${errorMessage(err)}`));
    finishReopen();
    if (env.lan) void startPreview();

    // Updates begin once the window is on screen, and a moment later still, so launch never waits on them. The first check comes
    // a few seconds after that (updates.ts).
    let begun = false;
    const beginUpdates = () => {
      if (begun) return;
      begun = true;
      updates?.start();
      updatesStarted();
      if (updateMenuItem() !== menuUpdateItem) rebuildMenu();
    };
    const afterShow = () => setTimeout(beginUpdates, UPDATES_START_MS).unref();
    if (first.win.isDestroyed() || first.win.isVisible()) afterShow();
    else first.win.once("show", afterShow);
    // A window that never shows (closed at once) doesn't hold updates back for good.
    setTimeout(beginUpdates, 10 * UPDATES_START_MS).unref();

    if (env.testHooks) {
      (globalThis as Record<string, unknown>).__sonobeTest = {
        invokeRenderer: (method: string, params?: unknown, opts?: { timeoutMs?: number }) => {
          const w = primaryWindow();
          if (!w || !rpc) return Promise.reject(new Error("No window"));
          return rpc.invoke(w.webContents, method, params, opts);
        },
        hasRendererMethod: (method: string) => {
          const w = primaryWindow();
          return w && rpc ? (rpc.hasMethod(w.webContents, method) ?? null) : null;
        },
        sendCommand: (id: string) => {
          if (isCommandId(id)) primaryWindow()?.sendCommand(id);
        },
        openProject: (dir: string) => openProjects([dir]),
        mcpStatus: () => (mcp ? { running: mcp.running, port: mcp.port, url: mcp.url, tokenFile: mcp.tokenFile, clients: mcpClients.list() } : null),
        previewStatus: () => previewStatus(),
        startPreview: () => startPreview(),
        stopPreview: () => stopPreview(),
        previewPushUpdates: () => preview?.pushUpdates ?? null,
        simulationScreenshots: () => appHost?.simulationScreenshots() ?? false,
        viewerWindowStatus: () => viewerWindowStatus(),
        viewerWindowUrl: () => (viewerWindow && !viewerWindow.win.isDestroyed() ? viewerWindow.win.webContents.getURL() : null),
        popOutViewer: (options?: { alwaysOnTop?: boolean }) => popOutViewer(options),
        closeViewerWindow: () => closeViewerWindow(),
        secretsStatus: () => secrets?.status() ?? null,
        /** MCP notifications published so far (outline/diagnostics updates and list changes). */
        notifications: () => {
          if (resourceTimer) {
            clearTimeout(resourceTimer);
            flushResourceUpdates();
          }
          return [...notificationLog];
        },
        /** Lower the design capture deadline (ms, not counting waitMs), or restore it with null. */
        setCaptureDeadline: (ms: number | null) => {
          testCaptureDeadlineMs = typeof ms === "number" && ms > 0 ? ms : undefined;
        },
        updates: {
          status: () => updates?.status() ?? null,
          check: () => requireUpdates().check({ manual: true }),
          restart: () => restartToUpdate(),
          /** Whether electron-updater was ever loaded in this run. */
          driverLoaded: () => updateDriver !== null,
          /**
           * A stand-in updater that finds `version` (or fails with `fail`), downloads at once and only counts its installs. It also
           * makes this run count as a build that installs updates, which a checkout never is, so the restart can be driven here.
           */
          useFakeDriver: (options: { version?: string; fail?: string }) => {
            testUpdateDriver = {
              check: async () => {
                if (options.fail) throw new Error(options.fail);
                return options.version ? { version: options.version } : null;
              },
              download: async (onProgress) => onProgress(1),
              install: () => void testUpdateInstalls++,
            };
            if (updateMenuItem() !== menuUpdateItem) rebuildMenu();
          },
          installs: () => testUpdateInstalls,
          /** The update item in the menu now. */
          menuItem: () => menuUpdateItem ?? null,
        },
        /** Destroy every window without the unsaved-changes prompt. */
        destroyWindows: () => {
          for (const w of windows.values()) w.win.destroy();
          if (viewerWindow && !viewerWindow.win.isDestroyed()) viewerWindow.win.destroy();
          void sceneWindow?.then((scene) => scene.destroy()).catch(() => undefined);
        },
      };
    }
  });
}

// A build made for the update rehearsal (package.mjs --launch-env) stops here unless it was given its own data
// folder: macOS opens an updated app without the environment of the one it replaced, and it must never run on the
// person's real Sonobe data instead.
const launchProblem = launchEnvProblem(__SONOBE_LAUNCH_ENV__.split(",").filter(Boolean), process.env);
if (launchProblem) {
  console.error(`[sonobe] ${launchProblem}`);
  dialog.showErrorBox("This rehearsal build of Sonobe can't run here", launchProblem);
  app.exit(1);
} else {
  main();
}
