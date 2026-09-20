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
  type AssistantSignInResult,
  type AssistantStatus,
  type AssistantSubscriptionStatus,
  type HandoffResult,
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
    // A permission card's choice goes as its option id alone; main picks the option by it.
    confirm: (confirmationId, approved, optionId) => invoke<boolean>(ASSISTANT_IPC.confirm, String(confirmationId), approved === true, ...(typeof optionId === "string" && optionId.length <= 200 ? [optionId] : [])),
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
    openInClaudeCode: (request) => invoke<HandoffResult>(ASSISTANT_IPC.openInClaudeCode, { prompt: String(request?.prompt ?? "") }),
    setConnection: (update) =>
      invoke<AssistantStatus>(ASSISTANT_IPC.setConnection, {
        ...(typeof update?.subscriptionEnabled === "boolean" ? { subscriptionEnabled: update.subscriptionEnabled } : {}),
        ...(update?.provider === "api_key" || update?.provider === "subscription" ? { provider: update.provider } : {}),
      }),
    checkSubscription: () => invoke<AssistantSubscriptionStatus>(ASSISTANT_IPC.checkSubscription),
    signInToClaude: () => invoke<AssistantSignInResult>(ASSISTANT_IPC.signInToClaude),
  };
}

/** Add `assistant` to the host object before contextBridge.exposeInMainWorld("sonobeHost", host). */
export function attachAssistantBridge(host: object, ipcRenderer: AssistantIpcRenderer): void {
  Object.assign(host, { assistant: createAssistantApi(ipcRenderer) });
}
