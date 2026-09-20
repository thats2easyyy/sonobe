/**
 * Main-process wiring for the in-app Assistant: IPC handlers for window.sonobeHost.assistant, the API
 * key from the keychain (sonobeHost.secrets, "anthropic.apiKey"), the Anthropic client, and the
 * in-process MCP tool bridge over the app's SonobeHost. main.ts calls registerAssistant once.
 *
 * The key stays in the main process: the renderer stores it through sonobeHost.secrets and only
 * ever gets a hint ("sk-ant-…3f9a") back from status(). The client is built with the person's key
 * alone (no ambient ANTHROPIC_AUTH_TOKEN, no Claude credentials).
 *
 * Each window's chat is pinned to the document that window shows (documentFor), and a code folder
 * is linked only from the native dialog main shows (pickFolder), never from the renderer's word.
 */

import { homedir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { GuideStore, SonobeHost } from "@sonobe/mcp";
import type { SecretStore } from "../secrets.ts";
import { createAssistantAgent, type AnthropicClientLike, type AssistantAgent } from "./agent.ts";
import { CodeFolderError, createCodeTools, type CodeFolderKey, type CodeFolderStore } from "./codeFolder.ts";
import { sanitizeCanvasContext } from "./design.ts";
import { DEFAULT_MODEL, modelInfos } from "./models.ts";
import {
  ASSISTANT_IPC,
  ASSISTANT_KEY_SECRET,
  type AssistantCodeFolderLinkResult,
  type AssistantCodeFolderStatus,
  type AssistantKeyCheck,
  type AssistantLimits,
  type AssistantRunResult,
  type AssistantSendRequest,
  type AssistantStatus,
} from "./protocol.ts";
import { createMcpToolBridge, type LocalTools, type ToolBridge } from "./toolBridge.ts";

/** The webContents that sent a request (Electron's IpcMainInvokeEvent.sender). */
export interface AssistantSender {
  readonly id: number;
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): unknown;
}

export interface AssistantIpcEvent {
  readonly sender: AssistantSender;
}

/** The subset of Electron's ipcMain used here. */
export interface AssistantIpcMain {
  handle(channel: string, listener: (event: AssistantIpcEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface RegisterAssistantOptions {
  ipcMain: AssistantIpcMain;
  /** Only the editor's main frame may use the Assistant (main.ts trustedWindow). */
  isTrustedSender(event: AssistantIpcEvent): boolean;
  /** The app's SonobeHost (null before it exists). */
  host(): SonobeHost | null;
  secrets(): SecretStore | null;
  version: string;
  /** Guides for get_guide (the bundled packages/mcp/guides). */
  guides?(): GuideStore;
  log?(level: "info" | "warn" | "error", message: string): void;
  /** Default: the Anthropic SDK with the person's key. */
  createClient?(apiKey: string): AnthropicClientLike;
  /** Default: createMcpToolBridge over `host` (tests pass a fake). */
  createToolBridge?(host: SonobeHost, guides: GuideStore | undefined): ToolBridge;
  limits?: Partial<AssistantLimits>;
  /** The document window `targetId` shows (AppHost.targetDocument), or null when it's gone: tool calls are pinned to it, and code folders are linked to its project. */
  documentFor?(targetId: number): Promise<{ docId: string; projectPath: string | null } | null>;
  /** Code folders linked to prototypes (Match my code…). Without it, nothing can be linked and the code tools aren't listed. */
  codeFolders?: CodeFolderStore;
  /** Show the native folder dialog over the sender's window: the folder the person picked, or null when they cancelled. */
  pickFolder?(sender: AssistantSender, options: { defaultPath: string }): Promise<string | null>;
  /** Default: createCodeTools over `codeFolders` (tests pass a fake). */
  createCodeTools?(store: CodeFolderStore): LocalTools;
}

export interface AssistantRegistration {
  readonly agent: AssistantAgent;
  /** Remove the IPC handlers, stop runs, and close the tool bridge. */
  dispose(): Promise<void>;
}

const noCodeFolder = (): AssistantCodeFolderStatus => ({ linked: null, missing: false });

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** "sk-ant-…3f9a" for a stored key; never more than the last four characters. */
export function keyHint(key: string): string {
  const trimmed = key.trim();
  return trimmed.length >= 12 ? `${trimmed.startsWith("sk-ant-") ? "sk-ant-" : ""}…${trimmed.slice(-4)}` : "…";
}

/** The Anthropic client for the person's key, ignoring ambient auth tokens. */
export function createAnthropicClient(apiKey: string): AnthropicClientLike {
  return new Anthropic({ apiKey, authToken: null, maxRetries: 2 }) as unknown as AnthropicClientLike;
}

export function registerAssistant(options: RegisterAssistantOptions): AssistantRegistration {
  const log = options.log ?? (() => undefined);
  let bridge: ToolBridge | null = null;
  let bridgeHost: SonobeHost | null = null;
  let guides: GuideStore | undefined;

  const tools = (): ToolBridge => {
    const host = options.host();
    if (!host) throw new Error("The document host isn't ready");
    if (!bridge || bridgeHost !== host) {
      void bridge?.close();
      guides ??= options.guides?.();
      bridge = options.createToolBridge ? options.createToolBridge(host, guides) : createMcpToolBridge({ host, version: options.version, ...(guides ? { guides } : {}) });
      bridgeHost = host;
    }
    return bridge;
  };

  const apiKey = async (): Promise<string | null> => {
    const store = options.secrets();
    if (!store) throw new Error("Secure storage isn't ready yet.");
    const value = await store.get(ASSISTANT_KEY_SECRET);
    return value?.trim() || null;
  };

  const documentFor = options.documentFor;
  const codeFolders = options.codeFolders;
  const localTools = codeFolders ? (options.createCodeTools ?? createCodeTools)(codeFolders) : undefined;

  /** Where a window's code folder link lives: its saved prototype's path, else the window alone. */
  const folderKey = async (id: string): Promise<CodeFolderKey> => ({ projectPath: (await documentFor?.(Number(id)))?.projectPath ?? null, windowId: id });

  const codeFolderStatus = async (id: string): Promise<AssistantCodeFolderStatus> => {
    if (!codeFolders) return noCodeFolder();
    try {
      return await codeFolders.status(await folderKey(id));
    } catch (err) {
      log("warn", `Couldn't read the linked code folder: ${errorMessage(err)}`);
      return noCodeFolder();
    }
  };

  const agent = createAssistantAgent({
    tools,
    apiKey,
    createClient: options.createClient ?? createAnthropicClient,
    ...(options.limits ? { limits: options.limits } : {}),
    log,
    ...(documentFor ? { documentFor: (id: string) => documentFor(Number(id)) } : {}),
    readDocument: async (docId) => {
      const host = options.host();
      if (!host) throw new Error("The document host isn't ready");
      return (await host.getDocument(docId)).doc;
    },
    ...(localTools ? { localTools } : {}),
    codeFolderName: async (id) => {
      const status = await codeFolderStatus(id);
      return status.linked && !status.missing ? status.linked.name : null;
    },
  });

  const watched = new Set<number>();
  const conversationOf = (event: AssistantIpcEvent): string => {
    if (!options.isTrustedSender(event)) throw new Error("Untrusted sender");
    const sender = event.sender;
    if (!watched.has(sender.id)) {
      watched.add(sender.id);
      sender.once("destroyed", () => {
        watched.delete(sender.id);
        agent.forget(String(sender.id));
        codeFolders?.forgetWindow(String(sender.id));
      });
    }
    return String(sender.id);
  };

  const status = async (id: string): Promise<AssistantStatus> => {
    const store = options.secrets();
    const secrets = store ? store.status() : { available: false, backend: null, reason: "Secure storage isn't ready yet." };
    let key: string | null = null;
    try {
      key = await apiKey();
    } catch {
      key = null;
    }
    const snap = agent.snapshot(id);
    return {
      hasKey: key !== null,
      keyHint: key ? keyHint(key) : null,
      secrets: { available: secrets.available, backend: secrets.backend, reason: secrets.reason },
      models: modelInfos(),
      defaultModel: DEFAULT_MODEL,
      limits: { ...agent.limits },
      usage: snap.usage,
      running: snap.running,
      messageCount: snap.messageCount,
      codeFolder: await codeFolderStatus(id),
    };
  };

  const handlers: Record<string, (event: AssistantIpcEvent, ...args: unknown[]) => unknown> = {
    [ASSISTANT_IPC.status]: (event) => status(conversationOf(event)),
    [ASSISTANT_IPC.send]: (event, request): Promise<AssistantRunResult> => {
      const id = conversationOf(event);
      const sender = event.sender;
      const body = request && typeof request === "object" ? (request as Partial<AssistantSendRequest>) : {};
      const context = body.context === undefined ? null : sanitizeCanvasContext(body.context);
      const run = { text: typeof body.text === "string" ? body.text : "", ...(typeof body.model === "string" ? { model: body.model } : {}), ...(context ? { context } : {}) };
      return agent.run(id, run, (e) => {
        if (!sender.isDestroyed()) sender.send(ASSISTANT_IPC.event, e);
      });
    },
    [ASSISTANT_IPC.stop]: (event) => agent.stop(conversationOf(event)),
    [ASSISTANT_IPC.reset]: (event) => {
      const id = conversationOf(event);
      agent.reset(id);
      return status(id);
    },
    [ASSISTANT_IPC.confirm]: (event, confirmationId, approved) => typeof confirmationId === "string" && agent.confirm(conversationOf(event), confirmationId, approved === true),
    [ASSISTANT_IPC.checkKey]: (event): Promise<AssistantKeyCheck> => {
      conversationOf(event);
      return agent.checkKey();
    },
    [ASSISTANT_IPC.codeFolder]: (event): Promise<AssistantCodeFolderStatus> => codeFolderStatus(conversationOf(event)),
    [ASSISTANT_IPC.linkCodeFolder]: async (event): Promise<AssistantCodeFolderLinkResult> => {
      const id = conversationOf(event);
      if (!codeFolders || !options.pickFolder) return { status: noCodeFolder(), error: "This version of Sonobe can't link a code folder yet." };
      const key = await folderKey(id);
      // The dialog opens where the prototype is saved: its app's repo is often next to it.
      const folder = await options.pickFolder(event.sender, { defaultPath: key.projectPath ? path.dirname(key.projectPath) : homedir() });
      if (folder === null) return { status: await codeFolders.status(key), cancelled: true };
      try {
        return { status: await codeFolders.link(key, folder) };
      } catch (err) {
        if (!(err instanceof CodeFolderError)) throw err;
        return { status: await codeFolders.status(key), error: err.message };
      }
    },
    [ASSISTANT_IPC.unlinkCodeFolder]: async (event): Promise<AssistantCodeFolderStatus> => {
      const id = conversationOf(event);
      return codeFolders ? codeFolders.unlink(await folderKey(id)) : noCodeFolder();
    },
  };

  for (const [channel, handler] of Object.entries(handlers)) options.ipcMain.handle(channel, handler);
  log("info", "Assistant ready (bring your own Anthropic API key)");

  return {
    agent,
    async dispose() {
      for (const channel of Object.keys(handlers)) options.ipcMain.removeHandler(channel);
      for (const id of watched) agent.forget(String(id));
      watched.clear();
      const closing = bridge;
      bridge = null;
      bridgeHost = null;
      await closing?.close();
    },
  };
}
