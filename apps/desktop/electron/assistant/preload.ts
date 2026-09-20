/**
 * Preload side of the Assistant: `window.sonobeHost.assistant` (SonobeAssistantApi). Imports only the
 * protocol constants, so it bundles into the sandboxed preload.
 */

import {
  ASSISTANT_IPC,
  type AssistantCodeFolderLinkResult,
  type AssistantCodeFolderStatus,
  type AssistantEvent,
  type AssistantKeyCheck,
  type AssistantRunResult,
  type AssistantStatus,
  type SonobeAssistantApi,
} from "./protocol.ts";

const isPlainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** The subset of Electron's ipcRenderer used here. */
export interface AssistantIpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
}

export function createAssistantApi(ipcRenderer: AssistantIpcRenderer): SonobeAssistantApi {
  /** Errors carry the main process's message without Electron's "Error invoking remote method" prefix. */
  const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    (ipcRenderer.invoke(channel, ...args) as Promise<T>).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message.replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, ""));
    });

  return {
    status: () => invoke<AssistantStatus>(ASSISTANT_IPC.status),
    // The main process sanitizes the canvas context field by field, so this bundle stays free of imports.
    send: (request) =>
      invoke<AssistantRunResult>(ASSISTANT_IPC.send, {
        text: String(request?.text ?? ""),
        ...(typeof request?.model === "string" ? { model: request.model } : {}),
        ...(isPlainObject(request?.context) ? { context: request.context } : {}),
      }),
    stop: () => invoke<boolean>(ASSISTANT_IPC.stop),
    reset: () => invoke<AssistantStatus>(ASSISTANT_IPC.reset),
    confirm: (confirmationId, approved) => invoke<boolean>(ASSISTANT_IPC.confirm, String(confirmationId), approved === true),
    checkKey: () => invoke<AssistantKeyCheck>(ASSISTANT_IPC.checkKey),
    onEvent(cb) {
      const listener = (_event: unknown, payload: unknown) => {
        if (payload && typeof payload === "object" && typeof (payload as { type?: unknown }).type === "string") cb(payload as AssistantEvent);
      };
      ipcRenderer.on(ASSISTANT_IPC.event, listener);
      return () => {
        ipcRenderer.removeListener(ASSISTANT_IPC.event, listener);
      };
    },
    codeFolder: () => invoke<AssistantCodeFolderStatus>(ASSISTANT_IPC.codeFolder),
    linkCodeFolder: () => invoke<AssistantCodeFolderLinkResult>(ASSISTANT_IPC.linkCodeFolder),
    unlinkCodeFolder: () => invoke<AssistantCodeFolderStatus>(ASSISTANT_IPC.unlinkCodeFolder),
  };
}

/** Add `assistant` to the host object before contextBridge.exposeInMainWorld("sonobeHost", host). */
export function attachAssistantBridge(host: object, ipcRenderer: AssistantIpcRenderer): void {
  Object.assign(host, { assistant: createAssistantApi(ipcRenderer) });
}
