/**
 * Preload (sandboxed): exposes `window.sonobeHost` (see host-api.d.ts). Imports nothing but
 * `electron` at runtime, so it works with `sandbox: true`.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { attachAssistantBridge } from "./assistant/preload.ts";
import type { McpStatus, PreviewStatus, ProjectChange, ProjectFiles, ProjectWrite, RpcHandler, SecretsStatus, SonobeCommandId, SonobeHost, ViewerWindowStatus } from "./host-api.d.ts";
import { isCommandId, listCommands, toHostPlatform } from "./commands.ts";
import { IPC } from "./ipc.ts";
import { createRpcFailure, createRpcServer } from "./rpc.ts";

const platform = toHostPlatform(process.platform);

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const rpcServer = createRpcServer({
  send: (response) => ipcRenderer.send(IPC.rpcResponse, response),
  onMethodsChanged: (methods) => ipcRenderer.send(IPC.rpcMethods, methods),
});
ipcRenderer.on(IPC.rpcRequest, (_event, message: unknown) => {
  void rpcServer.dispatch(message);
});
ipcRenderer.send(IPC.rpcMethods, []);

const commandListeners = new Set<(id: SonobeCommandId) => void>();
ipcRenderer.on(IPC.command, (_event, id: unknown) => {
  if (!isCommandId(id)) return;
  for (const listener of [...commandListeners]) {
    try {
      listener(id);
    } catch (err) {
      console.error(`[sonobe] command handler for ${id} failed`, err);
    }
  }
});

const openListeners = new Set<(dir: string) => void>();
ipcRenderer.on(IPC.openProject, (_event, dir: unknown) => {
  if (typeof dir !== "string") return;
  for (const listener of [...openListeners]) listener(dir);
});

let watchCounter = 0;

/** invoke() whose errors carry the main process's message without Electron's "Error invoking remote method" prefix. */
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return (ipcRenderer.invoke(channel, ...args) as Promise<T>).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message.replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, ""));
  });
}

const host: SonobeHost = {
  platform,
  version: __SONOBE_VERSION__,

  openProjectDialog: () => ipcRenderer.invoke(IPC.dialogOpenProject) as Promise<string | null>,
  saveProjectDialog: (defaultName) => ipcRenderer.invoke(IPC.dialogSaveProject, String(defaultName ?? "Untitled")) as Promise<string | null>,

  async readProject(dir): Promise<ProjectFiles> {
    const result = (await ipcRenderer.invoke(IPC.readProject, dir)) as { files: Record<string, string>; binaries: Record<string, Uint8Array> };
    const binaries: Record<string, ArrayBuffer> = {};
    for (const [rel, bytes] of Object.entries(result.binaries)) binaries[rel] = toArrayBuffer(bytes);
    return { files: result.files, binaries };
  },

  async writeProject(dir, changes: ProjectWrite) {
    await ipcRenderer.invoke(IPC.writeProject, dir, {
      files: changes.files ?? {},
      binaries: changes.binaries ?? {},
      deleted: changes.deleted ?? [],
    });
  },

  watchProject(dir, cb) {
    const id = `w${++watchCounter}-${Date.now().toString(36)}`;
    const listener = (_event: IpcRendererEvent, change: { id: string } & ProjectChange) => {
      if (change?.id === id) cb({ dir: change.dir, paths: change.paths });
    };
    ipcRenderer.on(IPC.projectChanged, listener);
    ipcRenderer.invoke(IPC.watchProject, id, dir).catch((err: unknown) => {
      console.warn(`[sonobe] couldn't watch ${dir}:`, err);
    });
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      ipcRenderer.removeListener(IPC.projectChanged, listener);
      void ipcRenderer.invoke(IPC.unwatchProject, id).catch(() => undefined);
    };
  },

  revealInFinder(path) {
    void ipcRenderer.invoke(IPC.revealInFinder, String(path)).catch(() => undefined);
  },

  recentProjects: () => ipcRenderer.invoke(IPC.recentProjects) as Promise<string[]>,

  onCommand(cb) {
    const listener = (id: SonobeCommandId) => cb(id);
    commandListeners.add(listener);
    ipcRenderer.send(IPC.commandListeners, commandListeners.size);
    return () => {
      if (commandListeners.delete(listener)) ipcRenderer.send(IPC.commandListeners, commandListeners.size);
    };
  },

  onOpenProject(cb) {
    const listener = (dir: string) => cb(dir);
    openListeners.add(listener);
    ipcRenderer.send(IPC.openProjectReady);
    return () => {
      openListeners.delete(listener);
    };
  },

  commands: () => listCommands(platform),

  setDocumentEdited(edited) {
    ipcRenderer.send(IPC.setDocumentEdited, edited === true);
  },

  setTitle(title) {
    ipcRenderer.send(IPC.setTitle, String(title));
  },

  rpc: {
    handle: (method: string, fn: RpcHandler) => rpcServer.handle(method, fn),
    methods: () => rpcServer.methods(),
    fail: (code: string, message: string, data?: unknown) => createRpcFailure(code, message, data),
  },

  getMcpStatus: () => ipcRenderer.invoke(IPC.mcpStatus) as Promise<McpStatus>,

  getPreviewStatus: () => ipcRenderer.invoke(IPC.previewStatus) as Promise<PreviewStatus>,
  startPreview: () => ipcRenderer.invoke(IPC.previewStart) as Promise<PreviewStatus>,
  stopPreview: () => ipcRenderer.invoke(IPC.previewStop) as Promise<PreviewStatus>,
  onPreviewStatus(cb) {
    const listener = (_event: IpcRendererEvent, status: PreviewStatus) => cb(status);
    ipcRenderer.on(IPC.previewChanged, listener);
    return () => {
      ipcRenderer.removeListener(IPC.previewChanged, listener);
    };
  },

  notifyDocumentChanged(revision, history) {
    if (typeof revision !== "number" || !Number.isFinite(revision)) return;
    const labels = history && typeof history.undo === "string" && typeof history.redo === "string" ? { undo: history.undo.slice(0, 120), redo: history.redo.slice(0, 120) } : undefined;
    ipcRenderer.send(IPC.documentChanged, revision, labels);
  },

  secrets: {
    status: () => invoke<SecretsStatus>(IPC.secretsStatus),
    get: (name) => invoke<string | null>(IPC.secretsGet, name),
    set: (name, value) => invoke<void>(IPC.secretsSet, name, value),
    delete: (name) => invoke<boolean>(IPC.secretsDelete, name),
  },

  openExternal: (url) => invoke<boolean>(IPC.openExternal, String(url)),

  popOutViewer: (options) => invoke<ViewerWindowStatus>(IPC.viewerWindowOpen, typeof options?.alwaysOnTop === "boolean" ? { alwaysOnTop: options.alwaysOnTop } : {}),
  closeViewerWindow: () => invoke<ViewerWindowStatus>(IPC.viewerWindowClose),
  getViewerWindowStatus: () => invoke<ViewerWindowStatus>(IPC.viewerWindowStatus),
  onViewerWindowStatus(cb) {
    const listener = (_event: IpcRendererEvent, status: ViewerWindowStatus) => cb(status);
    ipcRenderer.on(IPC.viewerWindowChanged, listener);
    return () => {
      ipcRenderer.removeListener(IPC.viewerWindowChanged, listener);
    };
  },
};

attachAssistantBridge(host, ipcRenderer);
contextBridge.exposeInMainWorld("sonobeHost", host);
