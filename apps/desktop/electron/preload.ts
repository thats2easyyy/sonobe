/**
 * Preload (sandboxed): exposes `window.sonobeHost` (see host-api.d.ts). Imports nothing but
 * `electron` at runtime, so it works with `sandbox: true`.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { McpStatus, ProjectChange, ProjectFiles, ProjectWrite, RpcHandler, SonobeCommandId, SonobeHost } from "./host-api.d.ts";
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
};

contextBridge.exposeInMainWorld("sonobeHost", host);
