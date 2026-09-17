/** Electron main process entry: lifecycle, windows, menus, file IO, the MCP endpoint, and phone preview. */

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, safeStorage, screen, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SonobeDocument } from "@sonobe/core";
import { saveProjectToDisk } from "@sonobe/core/node";
import { createHttpHandler, isHostError, loadGuides, type NodeMcpHandler } from "@sonobe/mcp";
import { createPatchRegistry } from "@sonobe/patches";
import { toBuffer as qrPng } from "qrcode";
import { createAppHost, type AppHost, type CapturedImage, type DocumentChange, type RendererTarget, type SceneRenderRequest } from "./app-host.ts";
import { createAppWindow, type AppWindow, type WindowContentSource } from "./app-window.ts";
import { registerAssistant } from "./assistant/register.ts";
import { captureWebContents } from "./capture.ts";
import { isCommandId, toHostPlatform } from "./commands.ts";
import { projectPathsFromArgv, readDesktopEnv } from "./env.ts";
import type { McpStatus, PreviewStatus, SecretsStatus, SonobeCommandId, ViewerWindowStatus } from "./host-api.d.ts";
import { IPC } from "./ipc.ts";
import { resolveUnder, startLanPreview, type LanPreviewHandle } from "./lan-preview.ts";
import { defaultSonobeHome, startMcpServer, type McpServerHandle } from "./mcp-server.ts";
import { buildMenuSpec, toMenuTemplate, type NativeAction } from "./menu.ts";
import { OwnWriteRegistry, ProjectAccess, readProject, resolveProjectSelection, writeProject, type WriteProjectInput } from "./project-io.ts";
import { createProjectWatcher, type ProjectWatcher } from "./project-watcher.ts";
import { RecentProjects } from "./recent-projects.ts";
import { createRendererRpcHub, type RendererRpcHub, type RpcIpcEvent } from "./rpc.ts";
import { createSecretStore, createTestCipher, type SecretStore } from "./secrets.ts";
import { ALLOWED_PERMISSIONS, isAppUrl, isExternalUrl, isMailtoUrl } from "./security.ts";

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
  let appHost: AppHost | null = null;
  let preview: LanPreviewHandle | null = null;
  let previewError: string | null = null;
  let previewStarting: Promise<void> | null = null;
  let creating: Promise<AppWindow> | null = null;
  let ready = false;
  let secrets: SecretStore | null = null;
  /** Set once an editor pushes revisions (notifyDocumentChanged): players stop polling. */
  let pushUpdates = false;
  let viewerWindow: { win: BrowserWindow; server: LanPreviewHandle; origin: string } | null = null;
  let viewerWindowError: string | null = null;
  let viewerWindowOpening: Promise<ViewerWindowStatus> | null = null;
  let sceneWindow: Promise<BrowserWindow> | null = null;
  let sceneQueue: Promise<unknown> = Promise.resolve();
  const pendingResourceUris = new Set<string>();
  let resourceTimer: ReturnType<typeof setTimeout> | null = null;
  /** MCP notifications published (SONOBE_TEST only). */
  const notificationLog: string[] = [];

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
    const spec = buildMenuSpec({ platform, appName: APP_NAME, recentProjects: recents?.snapshot() ?? [], dev: !app.isPackaged, previewRunning: preview !== null });
    const template = toMenuTemplate(spec, platform, {
      command: (id: SonobeCommandId) => {
        if (id === "viewer.previewOnDevice") void showPhonePreview().catch((err: unknown) => log("warn", `Phone preview failed: ${errorMessage(err)}`));
        else void ensureWindow().then((w) => w.sendCommand(id));
      },
      openRecent: (dir) => void openProjects([dir]),
      action: (action: NativeAction) => void handleAction(action),
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    const w = primaryWindow();
    if (!w) return;
    if (action === "maximize") {
      if (w.win.isMaximized()) w.win.unmaximize();
      else w.win.maximize();
    } else {
      w.zoom(action);
    }
  };

  const createWindow = (): Promise<AppWindow> =>
    createAppWindow({
      preloadPath: path.join(__dirname, "preload.cjs"),
      source: resolveContentSource(),
      statePath: path.join(app.getPath("userData"), "window-state.json"),
      mute: env.mute,
      rpc: rpc!,
      appName: APP_NAME,
      log,
      onCreated: (w) => {
        const id = w.webContents.id;
        windows.set(id, w);
        w.webContents.once("destroyed", () => {
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

  const ensureWindow = (): Promise<AppWindow> => {
    const existing = primaryWindow();
    if (existing) return Promise.resolve(existing);
    creating ??= createWindow().finally(() => {
      creating = null;
    });
    return creating;
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
    await saveProjectToDisk(dir, doc);
  };

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
      return { docId: snap.docId, name: snap.doc.project.name, revision: snap.revision, doc: snap.doc };
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
      detail: [
        status.lanReachable ? "Scan the code with a phone on the same Wi-Fi, or open this link:" : "No local network was found, so only this computer can open the preview:",
        status.url,
        "",
        "The link includes a private code. Anyone with it can view this prototype while the preview is on.",
      ].join("\n"),
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
      await win.loadURL(server.url);
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
      await win.webContents.executeJavaScript(`window.__sonobeRenderScene(${JSON.stringify({ scene: request.scene, scale, assets })})`, true);
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

  app.on("window-all-closed", () => {
    if (platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (ready && windows.size === 0) void ensureWindow();
  });

  // The players show the document in front, so switching editor windows may change what they show.
  app.on("browser-window-focus", (_event, win) => {
    if (windows.has(win.webContents.id)) pokePlayers();
  });

  app.on("will-quit", () => {
    for (const { watcher } of watchers.values()) watcher.close();
    watchers.clear();
    if (resourceTimer) clearTimeout(resourceTimer);
    if (viewerWindow) void viewerWindow.server.close();
    rpc?.dispose();
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
      access.approve(dir);
      return dir;
    });

    ipcMain.handle(IPC.dialogSaveProject, async (event, defaultName: unknown) => {
      const w = requireWindow(event);
      const name = (typeof defaultName === "string" ? defaultName : "Untitled").replace(/[\\/:*?"<>|\0]/g, "-").trim() || "Untitled";
      const result = await dialog.showSaveDialog(w.win, {
        title: "Save Prototype",
        buttonLabel: "Save",
        defaultPath: path.join(app.getPath("documents"), name.endsWith(".sonobe") ? name : `${name}.sonobe`),
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return null;
      const dir = result.filePath.endsWith(".sonobe") ? result.filePath : `${result.filePath}.sonobe`;
      access.approve(dir);
      return dir;
    });

    ipcMain.handle(IPC.readProject, async (event, dir: unknown) => {
      const w = requireWindow(event);
      if (!(await access.canAccess(dir))) throw new Error(`Sonobe can only open prototype folders you've chosen: ${String(dir)}`);
      const project = await readProject(dir as string);
      access.approve(dir as string);
      await addRecent(dir as string);
      w.setRepresentedDir(dir as string);
      return project;
    });

    ipcMain.handle(IPC.writeProject, async (event, dir: unknown, changes: unknown) => {
      const w = requireWindow(event);
      if (!(await access.canAccess(dir))) throw new Error(`Sonobe can only save into prototype folders you've chosen: ${String(dir)}`);
      if (!changes || typeof changes !== "object") throw new Error("writeProject: changes must be an object");
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
      return mcp?.running
        ? { running: true, port: mcp.port, url: mcp.url, tokenFile: mcp.tokenFile }
        : { running: false, port: null, url: null, tokenFile: path.join(env.home ?? defaultSonobeHome(), "mcp.json") };
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

    ipcMain.on(IPC.documentChanged, (event, revision: unknown) => {
      const w = trustedWindow(event);
      if (w && typeof revision === "number" && Number.isFinite(revision)) documentChanged(w, revision);
    });

    ipcMain.handle(IPC.secretsStatus, (event): SecretsStatus => {
      requireWindow(event);
      return requireSecrets().status();
    });
    ipcMain.handle(IPC.secretsGet, (event, name: unknown) => {
      requireWindow(event);
      return requireSecrets().get(name);
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
    registerIpc();
    registerAssistant({ ipcMain, isTrustedSender: (event) => trustedWindow(event as IpcMainInvokeEvent) !== null, host: () => appHost, secrets: () => secrets, version: VERSION, guides: () => loadGuides(bundledResource("guides", "packages/mcp/guides")), log });

    appHost = createAppHost({
      registry: createPatchRegistry(),
      targets: editorTargets,
      ensureTarget: async () => {
        const w = await ensureWindow();
        await waitForEditor(w);
        return editorTarget(w);
      },
      approveProject: approveAgentProject,
      defaultProjectDir,
      projectExists: async (dir) => existsSync(path.join(dir, "project.json")),
      writeProject: writeNewProject,
      renderScene,
      onDocumentChange,
    });

    recents = new RecentProjects(path.join(app.getPath("userData"), "recent-projects.json"));
    for (const dir of await recents.list()) access.approve(dir);
    rebuildMenu();

    if (env.mcpEnabled) {
      try {
        mcp = await startMcpServer({ version: VERSION, port: env.mcpPort, ...(env.home ? { configDir: env.home } : {}), log });
        mcpHandler = createHttpHandler(appHost, {
          version: VERSION,
          guides: loadGuides(bundledResource("guides", "packages/mcp/guides")),
          onError: (err) => log("warn", `MCP transport error: ${err.message}`),
        });
        mcp.setHandler(mcpHandler);
      } catch (err) {
        log("warn", `MCP endpoint disabled: ${errorMessage(err)}`);
      }
    }

    await ensureWindow();
    ready = true;
    if (pendingOpen.length) await openProjects(pendingOpen.splice(0));
    if (env.lan) void startPreview();

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
        mcpStatus: () => (mcp ? { running: mcp.running, port: mcp.port, url: mcp.url, tokenFile: mcp.tokenFile } : null),
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

main();
