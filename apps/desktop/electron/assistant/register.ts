/**
 * Main-process wiring for the in-app Assistant: IPC handlers for window.sonobeHost.assistant, the API
 * key from the keychain (sonobeHost.secrets, "anthropic.apiKey"), the Anthropic client, and the
 * in-process MCP tool bridge over the app's SonobeHost. main.ts calls registerAssistant once.
 *
 * The key stays in the main process: the renderer stores it through sonobeHost.secrets and only
 * ever gets a hint ("sk-ant-…3f9a") back from status(). The client is built with the person's key
 * alone (no ambient ANTHROPIC_AUTH_TOKEN, no Claude credentials).
 *
 * Two engines run chats: the API key's agent loop (agent.ts), and, behind the experimental switch
 * (off by default, awaiting Anthropic's permission), the Claude subscription's (acp/engine.ts). The
 * switch and the pick live here (connection.ts), and main enforces them. A build offers the switch
 * only when main says so (SubscriptionSetup.available: Sonobe run from a source checkout, never a
 * packaged build), so no release offers it. A window's chat keeps the engine its first message ran on until
 * New chat; turning the switch off stops every subscription reply and the adapter.
 *
 * Each window's chat is pinned to the document that window shows (documentFor), and a code folder
 * is linked only from the native dialog main shows (pickFolder), never from the renderer's word.
 */

import { homedir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { GuideStore, SonobeHost } from "@sonobe/mcp";
import { handoffFolder, openInClaudeCode, type HandoffOptions } from "../claude-handoff.ts";
import type { SecretStore } from "../secrets.ts";
import { createSubscriptionAgent, type SubscriptionAgent, type SubscriptionAgentOptions } from "./acp/engine.ts";
import { openClaudeSignIn } from "./acp/signIn.ts";
import type { AssistantToolServer } from "./acp/toolServer.ts";
import type { ClaudeSignInOptions, CreateAcpAgentProcess, LocateClaudeAgent, OpenClaudeSignIn } from "./acp/types.ts";
import { BUSY_ERROR, createAssistantAgent, type AnthropicClientLike, type AssistantAgent, type AssistantEngine } from "./agent.ts";
import { CodeFolderError, createCodeTools, type CodeFolderKey, type CodeFolderStore } from "./codeFolder.ts";
import { createConnectionStore, type ConnectionStore } from "./connection.ts";
import { sanitizeCanvasContext } from "./design.ts";
import { DEFAULT_MODEL, modelInfos } from "./models.ts";
import {
  ASSISTANT_IPC,
  ASSISTANT_KEY_SECRET,
  type AssistantCodeFolderLinkResult,
  type AssistantCodeFolderStatus,
  type AssistantConnection,
  type AssistantError,
  type AssistantEvent,
  type AssistantKeyCheck,
  type AssistantLimits,
  type AssistantProvider,
  type AssistantRunResult,
  type AssistantSendRequest,
  type AssistantSignInResult,
  type AssistantStatus,
  type AssistantSubscriptionStatus,
  type HandoffRequest,
  type HandoffResult,
} from "./protocol.ts";
import { ASSISTANT_HIDDEN_TOOLS, createMcpToolBridge, type LocalTools, type ToolBridge } from "./toolBridge.ts";

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
  /** Default: createMcpToolBridge over `host`, hiding preview_design from the API key's engine only (tests pass a fake). */
  createToolBridge?(host: SonobeHost, guides: GuideStore | undefined, provider: AssistantProvider): ToolBridge;
  limits?: Partial<AssistantLimits>;
  /** The document window `targetId` shows (AppHost.targetDocument), or null when it's gone: tool calls are pinned to it, and code folders are linked to its project. */
  documentFor?(targetId: number): Promise<{ docId: string; projectPath: string | null } | null>;
  /** Code folders linked to prototypes (Match my code…). Without it, nothing can be linked and the code tools aren't listed. */
  codeFolders?: CodeFolderStore;
  /** Show the native folder dialog over the sender's window: the folder the person picked, or null when they cancelled. */
  pickFolder?(sender: AssistantSender, options: { defaultPath: string }): Promise<string | null>;
  /** Default: createCodeTools over `codeFolders` (tests pass a fake). */
  createCodeTools?(store: CodeFolderStore): LocalTools;
  /** Open in Claude Code (claude-handoff.ts): the platform, where scripts go, the relay's launch spec and shell.openPath. The folder is the window's code folder, picked with `pickFolder` when none is linked. */
  handoff?: Omit<HandoffOptions, "folder">;
  /** The subscription switch and the pick (connection.ts). Default: kept in memory, the switch off. */
  connection?: ConnectionStore;
  /** The Assistant on the Claude subscription (experimental). Without it, only the API key runs chats. */
  subscription?: SubscriptionSetup;
}

export interface SubscriptionSetup {
  /**
   * This build offers the switch (main's build gate: only an unpackaged build, run from a source
   * checkout; every release is packaged). False: the switch reads off, can't be turned on, and no
   * subscription reply, check or sign-in starts. Default true.
   */
  available?: boolean;
  /** The adapter's working folder and every session's cwd (userData/assistant/claude). */
  sessionsDir: string;
  /** Sign in (macOS Terminal): where the one-time script goes and shell.openPath. */
  signIn?: ClaudeSignInOptions;
  /** Defaults: acp/locate.ts, acp/process.ts, acp/signIn.ts, acp/toolServer.ts (tests pass fakes). */
  locate?: LocateClaudeAgent;
  createProcess?: CreateAcpAgentProcess;
  openSignIn?: OpenClaudeSignIn;
  toolServer?(): Promise<AssistantToolServer>;
  /** The environment the adapter starts from. Default process.env. */
  env?: Record<string, string | undefined>;
  /** Default createSubscriptionAgent (tests pass a fake). */
  createAgent?(options: SubscriptionAgentOptions): SubscriptionAgent;
}

export interface AssistantRegistration {
  readonly agent: AssistantAgent;
  /** The Claude subscription's engine, when it's set up. */
  readonly subscription: SubscriptionAgent | null;
  /** Remove the IPC handlers, stop runs, and close the tool bridge. */
  dispose(): Promise<void>;
}

const noCodeFolder = (): AssistantCodeFolderStatus => ({ linked: null, missing: false });

const NO_SUBSCRIPTION: AssistantSubscriptionStatus = { state: "unknown", kind: null, label: null, email: null, adapterVersion: null, message: null };
const SUBSCRIPTION_OFF: AssistantError = { code: "subscription_off", message: "Claude subscription is off in Settings → Claude. Turn it back on, or start a new chat to use your API key." };
const SWITCH_OFF = "Turn on “Use my Claude subscription in the Assistant” in Settings → Claude first.";
const NOT_SET_UP = "This version of Sonobe can't run the Assistant on your Claude subscription. Start a new chat to use your API key.";

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
  const connections = options.connection ?? createConnectionStore({ log });
  const bridges = new Map<AssistantProvider, { bridge: ToolBridge; host: SonobeHost }>();
  let guides: GuideStore | undefined;

  /** The in-process tools for an engine: the API key's hides preview_design (its canvas draws the streamed html), the subscription's hides nothing. */
  const toolsFor = (provider: AssistantProvider) => (): ToolBridge => {
    const host = options.host();
    if (!host) throw new Error("The document host isn't ready");
    const current = bridges.get(provider);
    if (current && current.host === host) return current.bridge;
    void current?.bridge.close();
    guides ??= options.guides?.();
    const hidden = provider === "api_key" ? ASSISTANT_HIDDEN_TOOLS : new Map<string, string>();
    const bridge = options.createToolBridge ? options.createToolBridge(host, guides, provider) : createMcpToolBridge({ host, version: options.version, hidden, ...(guides ? { guides } : {}) });
    bridges.set(provider, { bridge, host });
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
  const pickFolder = options.pickFolder;
  const localTools = codeFolders ? (options.createCodeTools ?? createCodeTools)(codeFolders) : undefined;

  /** Where a window's code folder link lives: its saved prototype's path, else the window alone. */
  const folderKey = async (id: string): Promise<CodeFolderKey> => ({ projectPath: (await documentFor?.(Number(id)))?.projectPath ?? null, windowId: id });
  // The folder dialog opens where the prototype is saved: its app's repo is often next to it.
  const dialogPath = (key: CodeFolderKey) => (key.projectPath ? path.dirname(key.projectPath) : homedir());

  const codeFolderStatus = async (id: string): Promise<AssistantCodeFolderStatus> => {
    if (!codeFolders) return noCodeFolder();
    try {
      return await codeFolders.status(await folderKey(id));
    } catch (err) {
      log("warn", `Couldn't read the linked code folder: ${errorMessage(err)}`);
      return noCodeFolder();
    }
  };

  const readDocument = async (docId: string) => {
    const host = options.host();
    if (!host) throw new Error("The document host isn't ready");
    return (await host.getDocument(docId)).doc;
  };
  const codeFolderName = async (id: string) => {
    const status = await codeFolderStatus(id);
    return status.linked && !status.missing ? status.linked.name : null;
  };
  const windowDocument = documentFor ? { documentFor: (id: string) => documentFor(Number(id)) } : {};

  const agent = createAssistantAgent({
    tools: toolsFor("api_key"),
    apiKey,
    createClient: options.createClient ?? createAnthropicClient,
    ...(options.limits ? { limits: options.limits } : {}),
    log,
    ...windowDocument,
    readDocument,
    ...(localTools ? { localTools } : {}),
    codeFolderName,
  });

  const setup = options.subscription;
  const subscription: SubscriptionAgent | null = setup
    ? (setup.createAgent ?? createSubscriptionAgent)({
        tools: toolsFor("subscription"),
        ...(localTools ? { localTools } : {}),
        ...windowDocument,
        readDocument,
        codeFolderName,
        ...(options.limits ? { limits: options.limits } : {}),
        log,
        version: options.version,
        sessionsDir: setup.sessionsDir,
        ...(setup.locate ? { locate: setup.locate } : {}),
        ...(setup.createProcess ? { createProcess: setup.createProcess } : {}),
        ...(setup.signIn ? { signIn: { open: setup.openSignIn ?? openClaudeSignIn, options: setup.signIn } } : {}),
        ...(setup.toolServer ? { toolServer: setup.toolServer } : {}),
        ...(setup.env ? { env: setup.env } : {}),
      })
    : null;

  /** The switch and the pick as this build applies them: a build that doesn't offer the switch runs every chat on the API key. */
  const available = !!subscription && setup?.available !== false;
  const connection = (): AssistantConnection => {
    const saved = connections.get();
    return available ? { available: true, ...saved } : { available: false, subscriptionEnabled: false, provider: saved.provider, active: "api_key" };
  };

  /** What each window's chat runs on: set by its first message that got going, kept until New chat. */
  const chatProviders = new Map<string, AssistantProvider>();
  const engineOf = (provider: AssistantProvider): AssistantEngine | null => (provider === "subscription" ? subscription : agent);
  const chatEngine = (id: string): AssistantEngine => (chatProviders.get(id) === "subscription" && subscription) || agent;
  const engines = (): AssistantEngine[] => (subscription ? [agent, subscription] : [agent]);
  const resetChat = (id: string) => {
    for (const engine of engines()) engine.reset(id);
    chatProviders.delete(id);
  };

  const watched = new Set<number>();
  const conversationOf = (event: AssistantIpcEvent): string => {
    if (!options.isTrustedSender(event)) throw new Error("Untrusted sender");
    const sender = event.sender;
    if (!watched.has(sender.id)) {
      watched.add(sender.id);
      sender.once("destroyed", () => {
        watched.delete(sender.id);
        for (const engine of engines()) engine.forget(String(sender.id));
        chatProviders.delete(String(sender.id));
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
    const chatProvider = chatProviders.get(id) ?? null;
    const snap = chatEngine(id).snapshot(id);
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
      connection: connection(),
      subscription: subscription?.status() ?? NO_SUBSCRIPTION,
      chatProvider,
    };
  };

  const send = async (id: string, request: AssistantSendRequest, emit: (event: AssistantEvent) => void): Promise<AssistantRunResult> => {
    const fail = (error: AssistantError): AssistantRunResult => ({ runId: globalThis.crypto.randomUUID(), outcome: "error", error, usage: chatEngine(id).snapshot(id).usage });
    // One reply at a time per window, whichever engine runs it.
    if (engines().some((engine) => engine.snapshot(id).running)) return fail(BUSY_ERROR);
    const current = connection();
    const provider = chatProviders.get(id) ?? current.active;
    if (provider === "subscription" && !current.subscriptionEnabled) return fail(SUBSCRIPTION_OFF);
    const engine = engineOf(provider);
    if (!engine) return fail({ code: "agent_failed", message: NOT_SET_UP });
    chatProviders.set(id, provider);
    const result = await engine.run(id, request, emit);
    // A first message that never got going (no key, no document) doesn't pick the chat's engine.
    if (engine.snapshot(id).messageCount === 0 && chatProviders.get(id) === provider) chatProviders.delete(id);
    return result;
  };

  const handlers: Record<string, (event: AssistantIpcEvent, ...args: unknown[]) => unknown> = {
    [ASSISTANT_IPC.status]: (event) => status(conversationOf(event)),
    [ASSISTANT_IPC.send]: (event, request): Promise<AssistantRunResult> => {
      const id = conversationOf(event);
      const sender = event.sender;
      const body = request && typeof request === "object" ? (request as Partial<AssistantSendRequest>) : {};
      const context = body.context === undefined ? null : sanitizeCanvasContext(body.context);
      const run = { text: typeof body.text === "string" ? body.text : "", ...(typeof body.model === "string" ? { model: body.model } : {}), ...(context ? { context } : {}) };
      return send(id, run, (e) => {
        if (!sender.isDestroyed()) sender.send(ASSISTANT_IPC.event, e);
      });
    },
    [ASSISTANT_IPC.stop]: (event) => {
      const id = conversationOf(event);
      return engines().filter((engine) => engine.stop(id)).length > 0;
    },
    [ASSISTANT_IPC.reset]: (event) => {
      const id = conversationOf(event);
      resetChat(id);
      return status(id);
    },
    [ASSISTANT_IPC.confirm]: (event, confirmationId, approved, optionId) => {
      const id = conversationOf(event);
      if (typeof confirmationId !== "string") return false;
      const choice = typeof optionId === "string" && optionId.length <= 200 ? optionId : undefined;
      return engines().some((engine) => engine.confirm(id, confirmationId, approved === true, choice));
    },
    // The switch and the pick are the app's; a change of what this window's chat runs on starts a new chat in it.
    [ASSISTANT_IPC.setConnection]: (event, update) => {
      const id = conversationOf(event);
      // A build that doesn't offer the switch keeps it off, whatever the renderer asks.
      if (!available) return status(id);
      const body = update && typeof update === "object" ? (update as Record<string, unknown>) : {};
      const before = connection();
      connections.update({
        ...(typeof body.subscriptionEnabled === "boolean" ? { subscriptionEnabled: body.subscriptionEnabled } : {}),
        ...(body.provider === "api_key" || body.provider === "subscription" ? { provider: body.provider } : {}),
      });
      const after = connection();
      if (after.active !== before.active) resetChat(id);
      // Off means off in every window: their replies stop (their transcripts stay), and so does the adapter.
      if (before.subscriptionEnabled && !after.subscriptionEnabled && subscription) {
        log("info", "Claude subscription turned off: stopping its replies and Claude's agent adapter.");
        subscription.shutdown().catch((err: unknown) => log("warn", `Stopping Claude's agent adapter failed: ${errorMessage(err)}`));
      }
      return status(id);
    },
    // Off by default: Sonobe never starts Claude's agent adapter while the switch is off.
    [ASSISTANT_IPC.checkSubscription]: (event): Promise<AssistantSubscriptionStatus> => {
      conversationOf(event);
      if (!subscription) return Promise.resolve(NO_SUBSCRIPTION);
      if (!connection().subscriptionEnabled) return Promise.resolve(subscription.status());
      return subscription.checkSubscription();
    },
    [ASSISTANT_IPC.signInToClaude]: async (event): Promise<AssistantSignInResult> => {
      conversationOf(event);
      if (!subscription || !available) return { ok: false, error: NOT_SET_UP };
      if (!connection().subscriptionEnabled) return { ok: false, error: SWITCH_OFF };
      return subscription.signIn();
    },
    [ASSISTANT_IPC.checkKey]: (event): Promise<AssistantKeyCheck> => {
      conversationOf(event);
      return agent.checkKey();
    },
    [ASSISTANT_IPC.codeFolder]: (event): Promise<AssistantCodeFolderStatus> => codeFolderStatus(conversationOf(event)),
    [ASSISTANT_IPC.linkCodeFolder]: async (event): Promise<AssistantCodeFolderLinkResult> => {
      const id = conversationOf(event);
      if (!codeFolders || !pickFolder) return { status: noCodeFolder(), error: "This version of Sonobe can't link a code folder yet." };
      const key = await folderKey(id);
      const folder = await pickFolder(event.sender, { defaultPath: dialogPath(key) });
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
    // Needs no API key: it starts the person's own `claude`, signed in with their plan.
    [ASSISTANT_IPC.openInClaudeCode]: async (event, request): Promise<HandoffResult> => {
      const id = conversationOf(event);
      if (!options.handoff) return { ok: false, error: "This version of Sonobe can't open Claude Code. Copy the prompt instead, and paste it into Claude Code in your app's folder." };
      const prompt = request && typeof request === "object" ? (request as Partial<HandoffRequest>).prompt : undefined;
      return openInClaudeCode(typeof prompt === "string" ? { prompt } : {}, {
        ...options.handoff,
        folder: async () => {
          if (!codeFolders || !pickFolder) return { error: "This version of Sonobe can't link a code folder yet." };
          const key = await folderKey(id);
          return handoffFolder(codeFolders, key, () => pickFolder(event.sender, { defaultPath: dialogPath(key) }));
        },
      });
    },
  };

  for (const [channel, handler] of Object.entries(handlers)) options.ipcMain.handle(channel, handler);
  log("info", `Assistant ready (your Anthropic API key; Claude subscription: ${!available ? "not offered in a packaged build" : connection().subscriptionEnabled ? "on" : "off"})`);

  return {
    agent,
    subscription,
    async dispose() {
      for (const channel of Object.keys(handlers)) options.ipcMain.removeHandler(channel);
      for (const id of watched) for (const engine of engines()) engine.forget(String(id));
      watched.clear();
      chatProviders.clear();
      await subscription?.dispose();
      const closing = [...bridges.values()];
      bridges.clear();
      await Promise.all(closing.map(({ bridge }) => bridge.close()));
    },
  };
}
