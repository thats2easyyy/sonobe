/** Electron main process entry: lifecycle, windows, menus, file IO, and the MCP endpoint. */

import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { createAppWindow, type AppWindow, type WindowContentSource } from "./app-window.ts";
import { isCommandId, toHostPlatform } from "./commands.ts";
import { projectPathsFromArgv, readDesktopEnv } from "./env.ts";
import type { McpStatus, SonobeCommandId } from "./host-api.d.ts";
import { IPC } from "./ipc.ts";
import { defaultSonobeHome, startMcpServer, type McpServerHandle } from "./mcp-server.ts";
import { buildMenuSpec, toMenuTemplate, type NativeAction } from "./menu.ts";
import { OwnWriteRegistry, ProjectAccess, readProject, resolveProjectSelection, writeProject, type WriteProjectInput } from "./project-io.ts";
import { createProjectWatcher, type ProjectWatcher } from "./project-watcher.ts";
import { RecentProjects } from "./recent-projects.ts";
import { createRendererRpcHub, type RendererRpcHub, type RpcIpcEvent } from "./rpc.ts";
import { ALLOWED_PERMISSIONS, isAppUrl } from "./security.ts";

const APP_NAME = "Sonobe";
const VERSION = __SONOBE_VERSION__;
const platform = toHostPlatform(process.platform);

function log(level: "info" | "warn" | "error", message: string): void {
  (level === "info" ? console.log : level === "warn" ? console.warn : console.error)(`[sonobe] ${message}`);
}

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
  let creating: Promise<AppWindow> | null = null;
  let ready = false;

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
    const spec = buildMenuSpec({ platform, appName: APP_NAME, recentProjects: recents?.snapshot() ?? [], dev: !app.isPackaged });
    const template = toMenuTemplate(spec, platform, {
      command: (id: SonobeCommandId) => void ensureWindow().then((w) => w.sendCommand(id)),
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
          for (const [watchId, entry] of watchers) {
            if (entry.ownerId === id) {
              entry.watcher.close();
              watchers.delete(watchId);
            }
          }
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

  app.on("will-quit", () => {
    for (const { watcher } of watchers.values()) watcher.close();
    watchers.clear();
    rpc?.dispose();
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
    const trustedUrl = (url: string | undefined) => !!url && [...windows.values()].some((w) => isAppUrl(url, w.content()));
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
      callback(ALLOWED_PERMISSIONS.has(permission) && trustedUrl(details.requestingUrl));
    });
    // Origins of file: and data: pages are opaque ("file:///", "null"), so judge by the page URL.
    session.defaultSession.setPermissionCheckHandler((wc, permission) => ALLOWED_PERMISSIONS.has(permission) && trustedUrl(wc?.getURL()));

    app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: VERSION, copyright: "MIT License · Sonobe contributors" });

    rpc = createRendererRpcHub(ipcMain, { isTrustedSender: (event: RpcIpcEvent) => !!trustedWindow(event as unknown as IpcMainEvent) });
    registerIpc();

    recents = new RecentProjects(path.join(app.getPath("userData"), "recent-projects.json"));
    for (const dir of await recents.list()) access.approve(dir);
    rebuildMenu();

    if (env.mcpEnabled) {
      try {
        mcp = await startMcpServer({ version: VERSION, port: env.mcpPort, ...(env.home ? { configDir: env.home } : {}), log });
      } catch (err) {
        log("warn", `MCP endpoint disabled: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await ensureWindow();
    ready = true;
    if (pendingOpen.length) await openProjects(pendingOpen.splice(0));

    if (env.testHooks) {
      (globalThis as Record<string, unknown>).__sonobeTest = {
        invokeRenderer: (method: string, params?: unknown, opts?: { timeoutMs?: number }) => {
          const w = primaryWindow();
          if (!w || !rpc) return Promise.reject(new Error("No window"));
          return rpc.invoke(w.webContents, method, params, opts);
        },
        sendCommand: (id: string) => {
          if (isCommandId(id)) primaryWindow()?.sendCommand(id);
        },
        openProject: (dir: string) => openProjects([dir]),
        mcpStatus: () => (mcp ? { running: mcp.running, port: mcp.port, url: mcp.url, tokenFile: mcp.tokenFile } : null),
      };
    }
  });
}

main();
