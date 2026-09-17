import { BrowserWindow, dialog, screen, shell, type WebContents } from "electron";
import { existsSync } from "node:fs";
import type { SonobeCommandId } from "./host-api.d.ts";
import { ISSUES_URL } from "./commands.ts";
import { DARK_BACKGROUND, placeholderHtml, toDataUrl } from "./placeholder.ts";
import type { RendererRpcHub } from "./rpc.ts";
import { isAppUrl, isExternalUrl, isMailtoUrl, type AppContent } from "./security.ts";
import { ZOOM_MAX, ZOOM_MIN, loadWindowState, saveWindowStateSync, type WindowState } from "./window-state.ts";
import { IPC } from "./ipc.ts";
import type { NativeAction } from "./menu.ts";

export const WINDOW_DEFAULTS = { width: 1440, height: 900, minWidth: 1024, minHeight: 680 } as const;

/** What the window should load. */
export type WindowContentSource = { kind: "file"; index: string; root: string } | { kind: "dev"; url: URL };

export interface AppWindowOptions {
  preloadPath: string;
  source: WindowContentSource;
  statePath: string;
  mute: boolean;
  rpc: RendererRpcHub;
  appName: string;
  log(level: "info" | "warn" | "error", message: string): void;
  /** Called once the window exists, before content loads (so IPC from the first page is trusted). */
  onCreated?(appWindow: AppWindow): void;
}

export interface AppWindow {
  readonly win: BrowserWindow;
  readonly webContents: WebContents;
  /** Current trust boundary for navigation and IPC. */
  content(): AppContent;
  /** Set by the preload when onCommand subscribers change. */
  setCommandListeners(count: number): void;
  sendCommand(id: SonobeCommandId): void;
  /** Queue or deliver a project folder to the renderer. */
  openProject(dir: string): void;
  markOpenReady(): void;
  setDocumentEdited(edited: boolean): void;
  setTitle(title: string): void;
  setRepresentedDir(dir: string): void;
  zoom(action: Extract<NativeAction, "interfaceLarger" | "interfaceSmaller" | "interfaceReset">): void;
  focus(): void;
}

const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** Commands the main process can perform itself when no renderer subscriber exists. */
function nativeFallback(win: BrowserWindow, id: SonobeCommandId): boolean {
  const wc = win.webContents;
  switch (id) {
    case "file.close":
      win.close();
      return true;
    case "edit.undo":
      wc.undo();
      return true;
    case "edit.redo":
      wc.redo();
      return true;
    case "edit.selectAll":
      wc.selectAll();
      return true;
    case "edit.delete":
      wc.delete();
      return true;
    default:
      return false;
  }
}

export async function createAppWindow(opts: AppWindowOptions): Promise<AppWindow> {
  const mac = process.platform === "darwin";
  const workAreas = screen.getAllDisplays().map((d) => d.workArea);
  const state: WindowState = await loadWindowState(opts.statePath, workAreas, WINDOW_DEFAULTS);

  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: WINDOW_DEFAULTS.minWidth,
    minHeight: WINDOW_DEFAULTS.minHeight,
    show: false,
    title: opts.appName,
    backgroundColor: DARK_BACKGROUND,
    ...(mac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      safeDialogs: true,
    },
  });
  const wc = win.webContents;
  if (opts.mute) wc.setAudioMuted(true);

  let content: AppContent = opts.source.kind === "dev" ? { kind: "dev", origin: opts.source.url.origin } : { kind: "file", root: opts.source.root };
  let commandListeners = 0;
  let openReady = false;
  const pendingOpens: string[] = [];
  const pendingCommands: SonobeCommandId[] = [];
  let edited = false;
  let baseTitle = opts.appName;
  let titleOverridden = false;
  let forceClose = false;
  let prompting = false;

  const currentState = (): WindowState => {
    const b = win.getNormalBounds();
    return { bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, maximized: win.isMaximized(), fullScreen: win.isFullScreen(), zoomFactor: state.zoomFactor };
  };
  const saveState = () => {
    try {
      saveWindowStateSync(opts.statePath, currentState());
    } catch (err) {
      opts.log("warn", `Couldn't save window state: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!win.isDestroyed()) saveState();
    }, 800);
  };
  for (const event of ["resize", "move", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"] as const) {
    win.on(event as "resize", scheduleSave);
  }

  const applyTitle = () => {
    if (win.isDestroyed()) return;
    win.setTitle(mac || !edited ? baseTitle : `● ${baseTitle}`);
    if (mac) win.setDocumentEdited(edited);
  };

  wc.on("page-title-updated", (event) => {
    if (titleOverridden) event.preventDefault();
  });

  // Navigation guard: stay on app content; hand web links to the browser.
  const guardNavigation = (event: { preventDefault(): void }, url: string) => {
    if (isAppUrl(url, content)) return;
    event.preventDefault();
    if (isExternalUrl(url) || isMailtoUrl(url)) void shell.openExternal(url);
    else opts.log("warn", `Blocked navigation to ${url}`);
  };
  wc.on("will-navigate", (event) => guardNavigation(event, event.url));
  wc.on("will-redirect", (event) => guardNavigation(event, event.url));
  wc.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url) || isMailtoUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  wc.on("did-finish-load", () => {
    if (state.zoomFactor !== 1) wc.setZoomFactor(state.zoomFactor);
  });
  wc.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      commandListeners = 0;
      openReady = false;
    }
  });
  wc.on("render-process-gone", (_event, details) => {
    opts.log("error", `Editor renderer exited (${details.reason}, code ${details.exitCode})`);
  });

  win.once("ready-to-show", () => {
    if (state.maximized) win.maximize();
    if (state.fullScreen) win.setFullScreen(true);
    win.show();
  });

  const promptUnsaved = async () => {
    const canSave = opts.rpc.hasMethod(wc, "document.save") === true;
    const buttons = canSave ? ["Save", "Don't Save", "Cancel"] : ["Don't Save", "Cancel"];
    const { response } = await dialog.showMessageBox(win, {
      type: "warning",
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      message: `Do you want to save the changes you made to “${baseTitle}”?`,
      detail: "Your changes will be lost if you don't save them.",
    });
    const choice = buttons[response];
    if (choice === "Cancel") return;
    if (choice === "Save") {
      try {
        const result = await opts.rpc.invoke(wc, "document.save", undefined, { timeoutMs: 120_000 });
        if (result === false) return;
      } catch (err) {
        await dialog.showMessageBox(win, { type: "error", message: "Sonobe couldn't save your prototype.", detail: err instanceof Error ? err.message : String(err) });
        return;
      }
    }
    forceClose = true;
    win.close();
  };

  win.on("close", (event) => {
    saveState();
    if (!edited || forceClose) return;
    event.preventDefault();
    if (prompting) return;
    prompting = true;
    void promptUnsaved().finally(() => {
      prompting = false;
    });
  });
  win.on("closed", () => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  const deliverOpens = () => {
    if (!openReady || wc.isDestroyed()) return;
    for (const dir of pendingOpens.splice(0)) wc.send(IPC.openProject, dir);
  };
  const deliverCommands = () => {
    if (commandListeners === 0 || wc.isDestroyed()) return;
    for (const id of pendingCommands.splice(0)) wc.send(IPC.command, id);
  };

  const appWindow: AppWindow = {
    win,
    webContents: wc,
    content: () => content,
    setCommandListeners(count) {
      commandListeners = Math.max(0, Math.floor(count));
      deliverCommands();
    },
    sendCommand(id) {
      if (win.isDestroyed()) return;
      if (id === "help.reportIssue") {
        void shell.openExternal(ISSUES_URL);
        return;
      }
      if (commandListeners > 0) wc.send(IPC.command, id);
      else if (wc.isLoading()) pendingCommands.push(id);
      else nativeFallback(win, id);
    },
    openProject(dir) {
      pendingOpens.push(dir);
      deliverOpens();
    },
    markOpenReady() {
      openReady = true;
      deliverOpens();
    },
    setDocumentEdited(value) {
      edited = value;
      applyTitle();
    },
    setTitle(title) {
      baseTitle = title.trim() || opts.appName;
      titleOverridden = true;
      applyTitle();
    },
    setRepresentedDir(dir) {
      if (mac && !win.isDestroyed()) win.setRepresentedFilename(dir);
    },
    zoom(action) {
      const current = state.zoomFactor;
      let next = 1;
      if (action === "interfaceLarger") next = ZOOM_STEPS.find((z) => z > current + 1e-3) ?? ZOOM_MAX;
      else if (action === "interfaceSmaller") next = [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-3) ?? ZOOM_MIN;
      state.zoomFactor = next;
      wc.setZoomFactor(next);
      scheduleSave();
    },
    focus() {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    },
  };

  opts.onCreated?.(appWindow);

  // Load the editor, falling back to the placeholder page.
  const showPlaceholder = async (html: string) => {
    content = { kind: "placeholder" };
    await wc.loadURL(toDataUrl(html));
  };
  try {
    if (opts.source.kind === "dev") {
      try {
        await wc.loadURL(opts.source.url.href);
      } catch (err) {
        opts.log("warn", `Dev server unreachable at ${opts.source.url.href}`);
        await showPlaceholder(placeholderHtml({ kind: "dev-server-unreachable", url: opts.source.url.href, error: err instanceof Error ? (err.message.match(/ERR_[A-Z_]+/)?.[0] ?? err.message) : String(err) }));
      }
    } else if (existsSync(opts.source.index)) {
      await wc.loadFile(opts.source.index);
    } else {
      opts.log("warn", `Editor build not found at ${opts.source.index}; showing setup page`);
      await showPlaceholder(placeholderHtml({ kind: "missing-editor", editorIndex: opts.source.index }));
    }
  } catch (err) {
    opts.log("error", `Failed to load the editor: ${err instanceof Error ? err.message : String(err)}`);
  }

  return appWindow;
}
