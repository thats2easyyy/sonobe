/**
 * Main-process wiring for the in-app Assistant: IPC handlers for window.sonobeHost.assistant, the API
 * key from the keychain (sonobeHost.secrets, "anthropic.apiKey"), the Anthropic client, and the
 * in-process MCP tool bridge over the app's SonobeHost. main.ts calls registerAssistant once.
 *
 * The key stays in the main process: the renderer stores it through sonobeHost.secrets and only
 * ever gets a hint ("sk-ant-…3f9a") back from status(). The client is built with the person's key
 * alone (no ambient ANTHROPIC_AUTH_TOKEN, no Claude credentials).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { GuideStore, SonobeHost } from "@sonobe/mcp";
import type { SecretStore } from "../secrets.ts";
import { createAssistantAgent, type AnthropicClientLike, type AssistantAgent } from "./agent.ts";
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
import { createMcpToolBridge, type ToolBridge } from "./toolBridge.ts";

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
}

export interface AssistantRegistration {
  readonly agent: AssistantAgent;
  /** Remove the IPC handlers, stop runs, and close the tool bridge. */
  dispose(): Promise<void>;
}

/** No code folder is linked (code folders aren't wired in yet). */
const noCodeFolder = (): AssistantCodeFolderStatus => ({ linked: null, missing: false });

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

  const agent = createAssistantAgent({
    tools,
    apiKey,
    createClient: options.createClient ?? createAnthropicClient,
    ...(options.limits ? { limits: options.limits } : {}),
    log,
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
      codeFolder: noCodeFolder(),
    };
  };

  const handlers: Record<string, (event: AssistantIpcEvent, ...args: unknown[]) => unknown> = {
    [ASSISTANT_IPC.status]: (event) => status(conversationOf(event)),
    [ASSISTANT_IPC.send]: (event, request): Promise<AssistantRunResult> => {
      const id = conversationOf(event);
      const sender = event.sender;
      const body = request && typeof request === "object" ? (request as Partial<AssistantSendRequest>) : {};
      return agent.run(id, { text: typeof body.text === "string" ? body.text : "", ...(typeof body.model === "string" ? { model: body.model } : {}) }, (e) => {
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
    [ASSISTANT_IPC.codeFolder]: (event): AssistantCodeFolderStatus => {
      conversationOf(event);
      return noCodeFolder();
    },
    [ASSISTANT_IPC.linkCodeFolder]: (event): AssistantCodeFolderLinkResult => {
      conversationOf(event);
      return { status: noCodeFolder(), error: "This version of Sonobe can't link a code folder yet." };
    },
    [ASSISTANT_IPC.unlinkCodeFolder]: (event): AssistantCodeFolderStatus => {
      conversationOf(event);
      return noCodeFolder();
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
