/**
 * The subscription engine against an in-memory stand-in for Claude's agent adapter (FakeAgent below:
 * scripted session updates, permission questions, prompt results, login pushes and exits) and a
 * stand-in tool endpoint whose calls the script makes the way Claude Code does. No process, no
 * network, no Claude account.
 */

import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RequestError, type InitializeResponse, type NewSessionRequest, type NewSessionResponse, type PermissionOption, type PromptRequest, type PromptResponse, type RequestPermissionResponse, type SessionConfigOption, type SessionNotification, type SessionUpdate, type SetSessionConfigOptionRequest } from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemPrompt } from "../agent.ts";
import { canvasContextBlock } from "../design.ts";
import type { AssistantCanvasContext, AssistantEvent, AssistantSendRequest } from "../protocol.ts";
import { FAKE_TOOLS, fakeBridge, text } from "../testing.ts";
import type { AssistantToolInfo, LocalTools, ToolCallResult } from "../toolBridge.ts";
import { accountBlockedMessage, createSubscriptionAgent, orgNotAllowedMessage, exitDetail, MODE_NOT_SET, modelValue, NO_RUN, NOT_INSTALLED, parseCliLogin, permissionPrompt, RATE_LIMITED, readCliLogin, RESTARTED, SESSION_ENDED, UNANNOUNCED, usageLimitMessage, type SubscriptionAgentOptions } from "./engine.ts";
import type { AssistantToolServer, ToolServerHandler } from "./toolServer.ts";
import { AgentExitedError, AgentStartError, type AcpAgentProcess, type AcpAgentProcessOptions, type AgentAuthStatus, type AgentExit, type ClaudeAgentSpec, type PermissionHandler } from "./types.ts";

const SPEC: ClaudeAgentSpec = { command: "/Applications/Sonobe.app/Contents/MacOS/Sonobe", args: ["/opt/homebrew/lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"], env: { ELECTRON_RUN_AS_NODE: "1" }, displayPath: "/opt/homebrew/bin/claude-agent-acp", version: "0.79.0", source: "path" };
const ACCOUNT: AgentAuthStatus = { kind: "account", label: "Claude Max", email: "tyler@example.com", plan: "max", detail: null };
const SIGNED_OUT: AgentAuthStatus = { kind: "none", label: "Not logged in", email: null, plan: null, detail: null };
const USAGE = { inputTokens: 1200, outputTokens: 300, cachedReadTokens: 20_000, cachedWriteTokens: 0, totalTokens: 21_500 };
const END: PromptResponse = { stopReason: "end_turn", usage: USAGE };
const INIT = { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: {} } }, agentInfo: { name: "fake", version: "0" }, authMethods: [] } as unknown as InitializeResponse;
const OPTIONS: PermissionOption[] = [
  { optionId: "allow-once", name: "Yes", kind: "allow_once" },
  { optionId: "allow-with-updates", name: "Yes, and don't ask again for Save commands", kind: "allow_always" },
  { optionId: "reject", name: "No", kind: "reject_once" },
];
/** The real adapter's model option (0.79.0): aliases, not model ids. */
const MODEL_OPTIONS: SessionConfigOption[] = [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "default", options: ["default", "opus[1m]", "sonnet", "sonnet[1m]", "haiku"].map((value) => ({ value, name: value })) }];
const MODES = ["default", "acceptEdits", "plan", "auto"].map((id) => ({ id, name: id }));
const modeConfig = (mode: string): SessionConfigOption => ({ id: "mode", name: "Mode", category: "mode", type: "select", currentValue: mode, options: MODES.map((m) => ({ value: m.id, name: m.name })) });

const tool = (name: string, properties: Record<string, unknown> = {}, readOnly = false): AssistantToolInfo => ({ name, title: name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), description: `${name}.`, inputSchema: { type: "object", properties: { docId: { type: "string" }, ...properties } }, readOnly });
const TOOLS: AssistantToolInfo[] = [...FAKE_TOOLS, tool("preview_design", { component: { type: "string" }, name: { type: "string" }, html: { type: "string" }, append: { type: "string" } }), tool("save_document", { path: { type: "string" } }), tool("open_document", { ref: { type: "string" } })];

/** One prompt as the fake adapter plays it: Claude Code's updates, questions and MCP calls. */
interface Turn {
  agent: FakeAgent;
  sessionId: string;
  /** The prompt's text blocks; the last is the person's message. */
  blocks: string[];
  message: string;
  say(text: string, messageId?: string): void;
  think(text: string, messageId?: string): void;
  update(update: SessionUpdate): void;
  ask(toolCallId: string, name: string, input: Record<string, unknown>, options?: PermissionOption[]): Promise<RequestPermissionResponse>;
  /** Claude Code's tools/call through the chat's endpoint. */
  call(name: string, args: Record<string, unknown>, options?: { toolUseId?: string | null; signal?: AbortSignal }): Promise<ToolCallResult>;
  /** A whole tool call: tool_call, its input, a question first when `ask`, the MCP call and its result. Null when the person didn't allow it. */
  tool(id: string, name: string, input: Record<string, unknown>, options?: { ask?: boolean }): Promise<ToolCallResult | null>;
  /** Resolves when session/cancel arrives. */
  cancelled: Promise<void>;
  progress: string[];
}

type Script = (turn: Turn) => Promise<PromptResponse>;

interface Behavior {
  /** Pushed right after initialize (default ACCOUNT); null pushes nothing. */
  auth?: AgentAuthStatus | null;
  startError?: Error;
  /** initialize's answer waits for it. */
  starting?: Promise<void>;
  newSessionError?: Error;
  /** session/new waits for it. */
  opening?: Promise<void>;
  configOptions?: SessionConfigOption[];
  /** The permission mode session/new reports, with a "mode" config option (the person's own default); none when unset. */
  mode?: string;
  /** Setting the mode fails with it. */
  modeError?: Error;
  /** The mode a set leaves the session in (default: the one asked for). */
  modeAfter?: string;
  /** Setting the model fails with it. */
  modelError?: Error;
  /** What `--cli auth status --json` reports (null: nothing it could read). */
  cliLogin?: AgentAuthStatus | null;
  script: Script;
}

interface FakeSession {
  params: NewSessionRequest;
  listeners: Set<(notification: SessionNotification) => void>;
  permission: PermissionHandler | null;
  mode: string | null;
}

/** An in-memory AcpAgentProcess: what the engine sees of Claude's agent adapter. */
class FakeAgent implements AcpAgentProcess {
  readonly spec: ClaudeAgentSpec;
  readonly options: AcpAgentProcessOptions;
  readonly ready: Promise<InitializeResponse>;
  readonly exited: Promise<AgentExit>;
  authStatus: AgentAuthStatus | null = null;
  alive = true;
  disposed = false;
  readonly sessions = new Map<string, FakeSession>();
  readonly prompts: PromptRequest[] = [];
  readonly cancels: string[] = [];
  readonly closed: string[] = [];
  readonly configs: SetSessionConfigOptionRequest[] = [];
  private readonly behavior: Behavior;
  private readonly endpoints: Map<string, ToolServerHandler>;
  private readonly authListeners = new Set<(status: AgentAuthStatus) => void>();
  private readonly lifetime = new AbortController();
  private readonly pending = new Set<(err: Error) => void>();
  private readonly cancelWaiters = new Map<string, (() => void)[]>();
  private exit: AgentExit | null = null;
  private settleExit: (exit: AgentExit) => void = () => undefined;
  private count = 0;

  constructor(options: AcpAgentProcessOptions, behavior: Behavior, endpoints: Map<string, ToolServerHandler>) {
    this.options = options;
    this.spec = options.spec;
    this.behavior = behavior;
    this.endpoints = endpoints;
    this.exited = new Promise((resolve) => (this.settleExit = resolve));
    this.ready = behavior.startError ? Promise.reject(behavior.startError) : (behavior.starting ?? Promise.resolve()).then(() => INIT);
    this.ready.catch(() => undefined);
    if (!behavior.startError && behavior.auth !== null) queueMicrotask(() => this.pushAuth(behavior.auth ?? ACCOUNT));
  }

  /** A request that rejects with AgentExitedError when the process goes first. */
  private guard<T>(work: () => Promise<T>): Promise<T> {
    if (this.exit) return Promise.reject(new AgentExitedError(this.exit));
    return new Promise<T>((resolve, reject) => {
      this.pending.add(reject);
      work()
        .then(resolve, reject)
        .finally(() => this.pending.delete(reject));
    });
  }

  pushAuth(status: AgentAuthStatus) {
    this.authStatus = status;
    for (const listener of [...this.authListeners]) listener(status);
  }

  crash(code: number | null, stderrTail = "", signal: string | null = null) {
    if (this.exit) return;
    this.alive = false;
    this.exit = { code, signal, stderrTail };
    this.lifetime.abort();
    for (const reject of [...this.pending]) reject(new AgentExitedError(this.exit));
    this.settleExit(this.exit);
  }

  onAuthStatus(listener: (status: AgentAuthStatus) => void) {
    this.authListeners.add(listener);
    return () => void this.authListeners.delete(listener);
  }

  newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    return this.guard(async () => {
      await this.behavior.opening;
      if (this.behavior.newSessionError) throw this.behavior.newSessionError;
      const sessionId = `fake-${++this.count}`;
      const mode = this.behavior.mode ?? null;
      this.sessions.set(sessionId, { params, listeners: new Set(), permission: null, mode });
      const configOptions = [...(this.behavior.configOptions ?? []), ...(mode !== null ? [modeConfig(mode)] : [])];
      return { sessionId, ...(mode !== null ? { modes: { currentModeId: mode, availableModes: MODES } } : {}), ...(configOptions.length ? { configOptions } : {}) };
    });
  }

  prompt(params: PromptRequest): Promise<PromptResponse> {
    this.prompts.push(params);
    return this.guard(() => this.behavior.script(this.turn(params)));
  }

  async cancel(sessionId: string) {
    this.cancels.push(sessionId);
    for (const wake of this.cancelWaiters.get(sessionId)?.splice(0) ?? []) wake();
  }

  async setSessionConfigOption(params: SetSessionConfigOptionRequest) {
    this.configs.push(params);
    if (params.configId === "mode") {
      if (this.behavior.modeError) throw this.behavior.modeError;
      const session = this.sessions.get(params.sessionId)!;
      session.mode = this.behavior.modeAfter ?? String(params.value);
      return { configOptions: [modeConfig(session.mode)] };
    }
    if (this.behavior.modelError) throw this.behavior.modelError;
    return { configOptions: [] };
  }

  async closeSession(sessionId: string) {
    this.closed.push(sessionId);
    this.sessions.delete(sessionId);
  }

  onSessionUpdate(sessionId: string, listener: (notification: SessionNotification) => void) {
    const session = this.sessions.get(sessionId)!;
    session.listeners.add(listener);
    return () => void session.listeners.delete(listener);
  }

  setPermissionHandler(sessionId: string, handler: PermissionHandler | null) {
    const session = this.sessions.get(sessionId);
    if (session) session.permission = handler;
  }

  async dispose() {
    this.disposed = true;
    this.crash(null, "", "SIGTERM");
  }

  /** Sends one session/update for `sessionId`. */
  push(sessionId: string, update: SessionUpdate) {
    for (const listener of [...(this.sessions.get(sessionId)?.listeners ?? [])]) listener({ sessionId, update });
  }

  /** session/request_permission, as the adapter asks it. */
  ask(sessionId: string, toolCallId: string, name: string, input: Record<string, unknown>, options = OPTIONS): Promise<RequestPermissionResponse> {
    const handler = this.sessions.get(sessionId)?.permission;
    if (!handler) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    return handler({ sessionId, toolCall: { toolCallId, name: `mcp__sonobe__${name}`, title: `mcp__sonobe__${name}`, kind: "other", status: "pending", rawInput: input }, options }, this.lifetime.signal);
  }

  private turn(params: PromptRequest): Turn {
    const sessionId = params.sessionId;
    const blocks = params.prompt.flatMap((b) => (b.type === "text" ? [b.text] : []));
    const url = (this.sessions.get(sessionId)!.params.mcpServers[0] as { url: string }).url;
    const progress: string[] = [];
    const push = (update: SessionUpdate) => this.push(sessionId, update);
    const call: Turn["call"] = (name, args, options = {}) => {
      const endpoint = this.endpoints.get(url);
      if (!endpoint) return Promise.reject(new Error("401: the chat's endpoint is gone"));
      return endpoint.call(name, args, { toolUseId: options.toolUseId === undefined ? null : options.toolUseId, signal: options.signal ?? new AbortController().signal, onProgress: (message) => progress.push(message) });
    };
    const ask: Turn["ask"] = (toolCallId, name, input, options) => this.ask(sessionId, toolCallId, name, input, options);
    return {
      agent: this,
      sessionId,
      blocks,
      message: blocks.at(-1) ?? "",
      progress,
      say: (value, messageId = "msg_1") => push({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: value }, messageId }),
      think: (value, messageId = "msg_1") => push({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: value }, messageId }),
      update: push,
      ask,
      call,
      async tool(id, name, input, options = {}) {
        push({ sessionUpdate: "tool_call", toolCallId: id, name: `mcp__sonobe__${name}`, title: `mcp__sonobe__${name}`, kind: "other", status: "pending", rawInput: {} });
        push({ sessionUpdate: "tool_call_update", toolCallId: id, rawInput: input });
        if (options.ask) {
          const answer = await ask(id, name, input);
          if (answer.outcome.outcome !== "selected" || answer.outcome.optionId === "reject") {
            push({ sessionUpdate: "tool_call_update", toolCallId: id, status: "failed", content: [{ type: "content", content: { type: "text", text: "The user doesn't want to proceed with this tool use." } }] });
            return null;
          }
        }
        const result = await call(name, input, { toolUseId: id });
        const first = result.content.find((c) => c.type === "text")?.text ?? "";
        push({ sessionUpdate: "tool_call_update", toolCallId: id, status: result.isError ? "failed" : "completed", content: [{ type: "content", content: { type: "text", text: first } }], rawOutput: result.content });
        return result;
      },
      cancelled: new Promise<void>((resolve) => {
        const waiters = this.cancelWaiters.get(sessionId) ?? [];
        waiters.push(resolve);
        this.cancelWaiters.set(sessionId, waiters);
      }),
    };
  }
}

const echo: Script = async (turn) => {
  for (let i = 0; i < 3; i++) turn.say(i === 0 ? `Echo: ${turn.message}` : "");
  return END;
};

function harness(behavior: Partial<Behavior> = {}, options: Partial<SubscriptionAgentOptions> = {}) {
  const agents: FakeAgent[] = [];
  const endpoints = new Map<string, ToolServerHandler>();
  const registered: string[] = [];
  const revoked: string[] = [];
  const server: AssistantToolServer = {
    register(key, handler) {
      registered.push(key);
      const url = `http://127.0.0.1:4321/c/${encodeURIComponent(key)}/mcp`;
      endpoints.set(url, handler);
      return { url, token: `token-${registered.length}` };
    },
    unregister(key) {
      revoked.push(key);
      endpoints.delete(`http://127.0.0.1:4321/c/${encodeURIComponent(key)}/mcp`);
    },
    close: async () => undefined,
  };
  const b: Behavior = { script: echo, ...behavior };
  const bridge = fakeBridge((name, args) => (name === "import_design" ? text("Imported “Checkout”") : name === "preview_design" ? { content: [{ type: "text", text: "Showing “Checkout” on the canvas" }], structuredContent: { docId: args.docId } } : text(`${name}: ok`)));
  bridge.tools = async () => TOOLS;
  const events: AssistantEvent[] = [];
  const logs: string[] = [];
  const logins: { spec: ClaudeAgentSpec; env: Record<string, string>; cwd: string }[] = [];
  let ids = 0;
  const agent = createSubscriptionAgent({
    tools: () => bridge,
    version: "0.1.0-test",
    sessionsDir: "/tmp/sonobe-test/assistant/claude",
    locate: () => ({ ok: true, spec: SPEC }),
    createProcess: (o) => {
      const fake = new FakeAgent(o, b, endpoints);
      agents.push(fake);
      return fake;
    },
    toolServer: async () => server,
    newId: () => `id${++ids}`,
    platform: "darwin",
    home: "/Users/test",
    documentFor: async () => ({ docId: "noddit", projectPath: "/Users/test/Noddit.sonobe" }),
    log: (level, message) => void logs.push(`${level}: ${message}`),
    readLogin: async (spec, { env, cwd }) => {
      logins.push({ spec, env, cwd });
      return b.cliLogin ?? null;
    },
    announceWaitMs: 100,
    ...options,
  });
  const send = (message: string, extra: Partial<AssistantSendRequest> = {}, onEvent?: (event: AssistantEvent) => void, id = "w1") =>
    agent.run(id, { text: message, ...extra }, (event) => {
      events.push(event);
      onEvent?.(event);
    });
  return { agent, agents, bridge, events, logs, logins, send, registered, revoked, endpoints, behavior: b, last: () => agents.at(-1)! };
}

const ofType = <T extends AssistantEvent["type"]>(events: AssistantEvent[], type: T) => events.filter((e): e is Extract<AssistantEvent, { type: T }> => e.type === type);
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await tick();
  return check();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("subscription engine: sessions", () => {
  it("opens one ACP session per chat, isolated, with Sonobe's tools, prompt and options", async () => {
    const h = harness();
    expect(await h.send("hello")).toMatchObject({ runId: "id1", outcome: "completed" });
    expect(h.agents).toHaveLength(1);
    expect(h.last().options).toMatchObject({ spec: SPEC, cwd: "/tmp/sonobe-test/assistant/claude", clientVersion: "0.1.0-test" });

    const params = [...h.last().sessions.values()][0]!.params;
    expect(params).toEqual({
      cwd: "/tmp/sonobe-test/assistant/claude",
      mcpServers: [{ type: "http", name: "sonobe", url: `http://127.0.0.1:4321/c/${encodeURIComponent(h.registered[0]!)}/mcp`, headers: [{ name: "Authorization", value: "Bearer token-1" }] }],
      _meta: {
        systemPrompt: systemPrompt("Call get_outline before editing.", { drawing: "preview" }),
        claudeCode: {
          options: {
            tools: [],
            settingSources: [],
            persistSession: false,
            strictMcpConfig: true,
            allowDangerouslySkipPermissions: false,
            model: "claude-sonnet-5",
            maxTurns: 30,
            // Every tool but the ones that reach outside the prototype, which ask first.
            allowedTools: ["get_outline", "add_layers", "delete_items", "apply_ops", "import_design", "preview_design"].map((n) => `mcp__sonobe__${n}`),
            // Every tool's short name resolves to it (Claude sometimes calls one that way).
            toolAliases: Object.fromEntries(TOOLS.map((t) => [t.name, `mcp__sonobe__${t.name}`])),
            env: { ENABLE_TOOL_SEARCH: "false", MCP_TOOL_TIMEOUT: "1800000", CLAUDE_AGENT_SDK_CLIENT_APP: "sonobe/0.1.0-test" },
          },
        },
      },
    });

    // The same chat keeps its session; another window gets its own session and endpoint.
    await h.send("again");
    await h.send("other window", {}, undefined, "w2");
    expect(h.agents).toHaveLength(1);
    expect(h.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-1", "fake-2"]);
    expect(h.registered).toEqual(["w1#1/1", "w2#2/1"]);
    expect(h.agent.snapshot("w1")).toMatchObject({ running: false, messageCount: 4 });
  });

  it("streams the reply, starting a turn for each new message id, and leads a box message with the canvas context", async () => {
    const context: AssistantCanvasContext = { component: { id: "main", name: "Main", size: [402, 874] }, screens: [{ id: "home", name: "Home" }] };
    const h = harness({
      script: async (turn) => {
        turn.update({ sessionUpdate: "usage_update", used: 100, size: 200_000 } as unknown as SessionUpdate);
        turn.think("Plan the screen", "msg_1");
        turn.say("Let me look. ", "msg_1");
        await turn.tool("toolu_1", "get_outline", { detail: "styles" });
        turn.update({ sessionUpdate: "available_commands_update", availableCommands: [] });
        turn.say("Added a checkout.", "msg_2");
        return END;
      },
    });
    const result = await h.send("a checkout", { context });
    expect(result.outcome).toBe("completed");
    expect(h.last().prompts[0]!.prompt).toEqual([
      { type: "text", text: canvasContextBlock(context, { codeFolder: null }) },
      { type: "text", text: "a checkout" },
    ]);
    // get_outline's input says nothing a chip shows, so its tool_call_update changes nothing.
    expect(h.events.map((e) => e.type)).toEqual(["run_started", "turn_started", "thinking_delta", "text_delta", "tool_started", "tool_finished", "turn_started", "text_delta", "usage", "run_finished"]);
    expect(h.events[0]).toEqual({ type: "run_started", runId: "id1", model: "claude-sonnet-5", provider: "subscription" });
    expect(ofType(h.events, "turn_started").map((e) => e.turn)).toEqual([1, 2]);
    expect(ofType(h.events, "text_delta").map((e) => [e.turn, e.delta])).toEqual([
      [1, "Let me look. "],
      [2, "Added a checkout."],
    ]);
    expect(ofType(h.events, "thinking_delta")).toEqual([{ type: "thinking_delta", runId: "id1", turn: 1, delta: "Plan the screen" }]);
  });
});

describe("subscription engine: tools", () => {
  it("shows chips from Claude Code's tool calls, runs each call through the runner by its tool_use id, and reports it once", async () => {
    const h = harness({
      script: async (turn) => {
        await turn.tool("toolu_add", "add_layers", { layers: [{ type: "rectangle", name: "Card" }] });
        return END;
      },
    });
    await h.send("add a card");
    expect(ofType(h.events, "tool_started")).toEqual([
      { type: "tool_started", runId: "id1", toolUseId: "toolu_add", name: "add_layers", title: "Add layers", detail: "" },
      { type: "tool_started", runId: "id1", toolUseId: "toolu_add", name: "add_layers", title: "Add layers", detail: "Card" },
    ]);
    expect(h.bridge.calls).toEqual([{ name: "add_layers", args: { layers: [{ type: "rectangle", name: "Card" }] } }]);
    expect(ofType(h.events, "tool_finished")).toEqual([{ type: "tool_finished", runId: "id1", toolUseId: "toolu_add", name: "add_layers", status: "done", detail: "add_layers: ok", changedDocument: true }]);
  });

  it("pins a call to the window's document and a design from the box to its component", async () => {
    const context: AssistantCanvasContext = { component: { id: "main", name: "Main", size: [402, 874] }, screens: [] };
    const h = harness({
      script: async (turn) => {
        await turn.tool("toolu_p", "preview_design", { name: "Checkout", html: "<main>" });
        await turn.tool("toolu_i", "import_design", { preview: true });
        return END;
      },
    });
    await h.send("a checkout", { context });
    expect(h.bridge.calls).toEqual([
      { name: "preview_design", args: { name: "Checkout", html: "<main>", docId: "noddit", component: "main" } },
      // The draft already has its component.
      { name: "import_design", args: { preview: true, docId: "noddit" } },
    ]);
  });

  it("keeps each window's chat in its own window's prototype", async () => {
    const shows: Record<string, string> = { w1: "noddit", w2: "onboarding" };
    const results = new Map<string, (ToolCallResult | null)[]>();
    const h = harness(
      {
        script: async (turn) => {
          // Each window's message is its own id; each tries the other window's prototype too.
          const other = turn.message === "w1" ? shows.w2! : shows.w1!;
          const drawn = await turn.tool(`toolu_${turn.message}_1`, "preview_design", { name: "Checkout", html: "<main>" });
          const elsewhere = await turn.tool(`toolu_${turn.message}_2`, "preview_design", { docId: other, html: "<main>" });
          results.set(turn.message, [drawn, elsewhere]);
          return END;
        },
      },
      { documentFor: async (id) => ({ docId: shows[id]!, projectPath: null }) },
    );
    // Both at once, on one adapter.
    await Promise.all([h.send("w1", {}, undefined, "w1"), h.send("w2", {}, undefined, "w2")]);
    expect(h.agents).toHaveLength(1);
    expect(h.bridge.calls).toEqual(expect.arrayContaining([{ name: "preview_design", args: { name: "Checkout", html: "<main>", docId: "noddit" } }, { name: "preview_design", args: { name: "Checkout", html: "<main>", docId: "onboarding" } }]));
    expect(h.bridge.calls).toHaveLength(2);
    const refusal = (other: string) => `This chat edits the prototype in its own window, so preview_design didn't run on “${other}”. Leave out docId to change this window's prototype, or ask the person to open the chat in the other window.`;
    expect(results.get("w1")).toEqual([expect.objectContaining({ structuredContent: { docId: "noddit" } }), expect.objectContaining({ isError: true, content: [{ type: "text", text: refusal("onboarding") }] })]);
    expect(results.get("w2")).toEqual([expect.objectContaining({ structuredContent: { docId: "onboarding" } }), expect.objectContaining({ isError: true, content: [{ type: "text", text: refusal("noddit") }] })]);
  });

  it("runs a call that reaches Sonobe just before its tool_call, once the tool_call comes", async () => {
    const h = harness({
      script: async (turn) => {
        const early = turn.call("get_outline", { detail: "compact" }, { toolUseId: "toolu_early" });
        await tick();
        turn.update({ sessionUpdate: "tool_call", toolCallId: "toolu_early", name: "mcp__sonobe__get_outline", title: "mcp__sonobe__get_outline", kind: "other", status: "pending", rawInput: {} });
        expect((await early).isError).toBeFalsy();
        turn.update({ sessionUpdate: "tool_call_update", toolCallId: "toolu_early", status: "completed", content: [] });
        return END;
      },
    });
    await h.send("go");
    expect(h.bridge.calls).toEqual([{ name: "get_outline", args: { detail: "compact" } }]);
    expect(ofType(h.events, "tool_started").map((e) => e.toolUseId)).toEqual(["toolu_early"]);
    expect(ofType(h.events, "tool_finished").map((e) => [e.toolUseId, e.status])).toEqual([["toolu_early", "done"]]);
  });

  it("runs only calls Claude announced on the ACP stream, each once, for the tool it named", async () => {
    // The endpoint's URL and token sit in Claude Code's command line; the tool_use ids don't.
    const results: ToolCallResult[] = [];
    const h = harness({
      script: async (turn) => {
        turn.update({ sessionUpdate: "tool_call", toolCallId: "toolu_a", name: "mcp__sonobe__add_layers", title: "mcp__sonobe__add_layers", kind: "other", status: "pending", rawInput: {} });
        results.push(await turn.call("add_layers", { layers: [] }, { toolUseId: null }));
        results.push(await turn.call("add_layers", { layers: [] }, { toolUseId: "toolu_forged" }));
        results.push(await turn.call("delete_items", { ids: ["card"] }, { toolUseId: "toolu_a" }));
        results.push(await turn.call("add_layers", { layers: [] }, { toolUseId: "toolu_a" }));
        results.push(await turn.call("add_layers", { layers: [] }, { toolUseId: "toolu_a" }));
        return END;
      },
    });
    await h.send("go");
    const refused = { content: [{ type: "text", text: UNANNOUNCED }], isError: true };
    expect(UNANNOUNCED).toBe("Sonobe only runs tools Claude asked for in this chat.");
    expect(results).toEqual([refused, refused, refused, text("add_layers: ok"), refused]);
    expect(h.bridge.calls).toEqual([{ name: "add_layers", args: { layers: [] } }]);
    expect(h.logs.filter((l) => l.includes("refused"))).toHaveLength(4);
    expect(ofType(h.events, "tool_finished").map((e) => [e.toolUseId, e.status])).toEqual([["toolu_a", "done"]]);
  });

  it("reports a call Claude Code ended before it reached Sonobe by its first line that says something, and logs all of it", async () => {
    const h = harness({
      script: async (turn) => {
        turn.update({ sessionUpdate: "tool_call", toolCallId: "toolu_x", name: "mcp__sonobe__get_outline", title: "mcp__sonobe__get_outline", kind: "other", status: "pending", rawInput: {} });
        turn.update({ sessionUpdate: "tool_call_update", toolCallId: "toolu_x", status: "failed", content: [{ type: "content", content: { type: "text", text: "```\nError: MCP server \"sonobe\" isn't connected\n  (it's still starting)\n```" } }] });
        return END;
      },
    });
    await h.send("go");
    expect(ofType(h.events, "tool_finished")).toEqual([expect.objectContaining({ toolUseId: "toolu_x", status: "error", detail: 'Error: MCP server "sonobe" isn\'t connected' })]);
    expect(h.logs).toContain('warn: Claude Code ended get_outline before it reached Sonobe: ``` Error: MCP server "sonobe" isn\'t connected (it\'s still starting) ```');
  });

  it("answers a call that comes when no reply is running", async () => {
    const h = harness();
    await h.send("hello");
    const endpoint = [...h.endpoints.values()][0]!;
    expect(await endpoint.call("get_outline", {}, { toolUseId: "toolu_late", signal: new AbortController().signal, onProgress: () => undefined })).toEqual({ content: [{ type: "text", text: NO_RUN }], isError: true });
    expect(h.bridge.calls).toEqual([]);
    expect(await endpoint.tools()).toEqual(TOOLS);
  });

  it("forwards a call's progress to Claude Code, and a heartbeat while Sonobe's own confirmation waits", async () => {
    const confirmation = { content: [{ type: "text", text: "Confirmation required" }], structuredContent: { status: "confirmation_required", confirmToken: "tok", summary: "Deleting 14 items from main: Card and 13 more." } };
    let progress: string[] = [];
    const h = harness({
      script: async (turn) => {
        progress = turn.progress;
        await turn.tool("toolu_del", "delete_items", { ids: ["card"] });
        return END;
      },
    });
    h.bridge.call = async (name, args) => {
      h.bridge.calls.push({ name, args });
      return args.confirmToken ? text("Deleted 14 items") : confirmation;
    };
    await h.send("clear it", {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => h.agent.confirm("w1", e.confirmationId, true));
    });
    expect(ofType(h.events, "confirm_required")[0]).toMatchObject({ toolUseId: "toolu_del", title: "Delete 14 items?", count: 14 });
    expect(progress).toEqual(["Waiting for your answer in Sonobe"]);
    expect(h.bridge.calls.map((c) => c.args)).toEqual([{ ids: ["card"] }, { ids: ["card"], confirmToken: "tok" }]);
  });
});

describe("subscription engine: permission cards", () => {
  const save = (path?: string): Script => async (turn) => {
    const result = await turn.tool("toolu_save", "save_document", path ? { path } : {}, { ask: true });
    turn.say(result ? "Saved." : "Okay, I won't.", "msg_2");
    return END;
  };

  it("asks with the agent's choices, and sends the one the person picked back", async () => {
    const h = harness({ script: save("/Users/test/Documents/Checkout.sonobe") });
    const answers: RequestPermissionResponse[] = [];
    const ask = FakeAgent.prototype.ask;
    const spy = vi.spyOn(FakeAgent.prototype, "ask").mockImplementation(async function (this: FakeAgent, ...args) {
      const answer = await ask.apply(this, args);
      answers.push(answer);
      return answer;
    });
    await h.send("save it", {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => h.agent.confirm("w1", e.confirmationId, true, "allow-with-updates"));
    });
    spy.mockRestore();
    const card = ofType(h.events, "confirm_required")[0]!;
    expect(card).toEqual({
      type: "confirm_required",
      runId: "id1",
      confirmationId: "id2",
      toolUseId: "toolu_save",
      title: "Allow Claude to save this prototype?",
      message: "Claude wants to save this prototype to “~/Documents/Checkout.sonobe”. Claude Code asks before steps that reach outside this prototype.",
      count: 0,
      kind: "permission",
      options: [
        { id: "allow-once", label: "Allow", kind: "allow_once" },
        { id: "allow-with-updates", label: "Allow for this chat", kind: "allow_always" },
        { id: "reject", label: "Don't allow", kind: "reject_once" },
      ],
    });
    expect(ofType(h.events, "confirm_resolved")).toEqual([{ type: "confirm_resolved", runId: "id1", confirmationId: "id2", approved: true, optionId: "allow-with-updates" }]);
    expect(h.bridge.calls).toEqual([{ name: "save_document", args: { path: "/Users/test/Documents/Checkout.sonobe", docId: "noddit" } }]);
    expect(ofType(h.events, "tool_finished")).toEqual([expect.objectContaining({ toolUseId: "toolu_save", status: "done" })]);
    expect(answers).toEqual([{ outcome: { outcome: "selected", optionId: "allow-with-updates" } }]);
  });

  it("takes approved as a fallback for a missing or unknown choice, and reports a call the person didn't allow", async () => {
    const h = harness({ script: save() });
    const answers: (boolean | string | undefined)[][] = [[true, "bogus"], [false, undefined]];
    await h.send("save it", {}, (e) => {
      if (e.type === "confirm_required") {
        const [approved, optionId] = answers.shift()!;
        queueMicrotask(() => h.agent.confirm("w1", e.confirmationId, approved as boolean, optionId as string | undefined));
      }
    });
    expect(ofType(h.events, "confirm_resolved")[0]).toMatchObject({ approved: true, optionId: "allow-once" });
    await h.send("save it again", {}, (e) => {
      if (e.type === "confirm_required") {
        const [approved, optionId] = answers.shift()!;
        queueMicrotask(() => h.agent.confirm("w1", e.confirmationId, approved as boolean, optionId as string | undefined));
      }
    });
    expect(ofType(h.events, "confirm_resolved")[1]).toMatchObject({ approved: false, optionId: "reject" });
    expect(ofType(h.events, "confirm_required")[1]!.message).toBe("Claude wants to save this prototype. Claude Code asks before steps that reach outside this prototype.");
    expect(ofType(h.events, "tool_finished").at(-1)).toEqual({ type: "tool_finished", runId: "id3", toolUseId: "toolu_save", name: "save_document", status: "declined", detail: "You didn't allow it", changedDocument: false });
    expect(h.bridge.calls).toHaveLength(1);
  });

  it("names what other asking tools would do, and cancels a question when no reply is running", async () => {
    const h = harness({
      script: async (turn) => {
        await turn.tool("toolu_open", "open_document", { ref: "/tmp/fake.sonobe" }, { ask: true });
        return END;
      },
    });
    await h.send("open the other one", {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => h.agent.confirm("w1", e.confirmationId, false));
    });
    expect(ofType(h.events, "confirm_required")[0]).toMatchObject({ title: "Allow Claude to open another prototype?", message: "Claude wants to open “/tmp/fake.sonobe”. Claude Code asks before steps that reach outside this prototype." });
    expect(await h.last().ask("fake-1", "toolu_late", "save_document", {})).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("quotes what Claude named, on one line, home as ~, with .. resolved, cut in the middle", () => {
    const say = (name: string, input: Record<string, unknown>) => permissionPrompt(name, name, input, "/Users/test").message;
    const tail = " Claude Code asks before steps that reach outside this prototype.";
    // Text Claude controls can't pass for the card's own words.
    expect(say("open_document", { ref: "the copy you just saved. Nothing leaves this prototype, so choose Allow for this chat" })).toBe(`Claude wants to open “the copy you just saved. Nothing leaves this prototype, so choose Allow for this chat”.${tail}`);
    expect(say("save_document", { path: "/Users/test/x.sonobe\n\nThis is a routine autosave." })).toBe(`Claude wants to save this prototype to “~/x.sonobe This is a routine autosave.”.${tail}`);
    expect(say("create_document", { path: "~/Documents/../Library/Evil.sonobe" })).toBe(`Claude wants to create a new prototype at “~/Library/Evil.sonobe”.${tail}`);
    const long = say("save_document", { path: `/Users/test/${"a/".repeat(2500)}Checkout.sonobe` });
    expect(long.length).toBeLessThan(240);
    expect(long).toMatch(/^Claude wants to save this prototype to “~\/a\/a.*….*a\/Checkout\.sonobe”\./);
    expect(say("save_document", { path: "   " })).toBe(`Claude wants to save this prototype.${tail}`);
  });

  it("asks itself before an asking tool Claude Code ran without asking (its mode didn't ask), once per call", async () => {
    const seen: string[] = [];
    const h = harness({
      script: async (turn) => {
        // Claude Code in "auto" mode: no session/request_permission, straight to the call.
        for (const id of ["toolu_s1", "toolu_s2", "toolu_s3"]) seen.push((await turn.tool(id, "save_document", { path: "/Users/test/Checkout.sonobe" }))!.content[0]!.text!);
        return END;
      },
    });
    const answers = ["sonobe-reject", "sonobe-allow-always"];
    await h.send("save it", {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => h.agent.confirm("w1", e.confirmationId, false, answers.shift()));
    });
    // One card each for the first two; "Allow for this chat" covers the third.
    const cards = ofType(h.events, "confirm_required");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      toolUseId: "toolu_s1",
      kind: "permission",
      title: "Allow Claude to save this prototype?",
      message: "Claude wants to save this prototype to “~/Checkout.sonobe”. Claude Code asks before steps that reach outside this prototype.",
      options: [
        { id: "sonobe-allow-once", label: "Allow", kind: "allow_once" },
        { id: "sonobe-allow-always", label: "Allow for this chat", kind: "allow_always" },
        { id: "sonobe-reject", label: "Don't allow", kind: "reject_once" },
      ],
    });
    expect(ofType(h.events, "confirm_resolved").map((e) => [e.approved, e.optionId])).toEqual([
      [false, "sonobe-reject"],
      [true, "sonobe-allow-always"],
    ]);
    expect(seen[0]).toBe("The person chose not to allow save_document in Sonobe, so it didn't run. Ask what they'd like to do instead.");
    expect(h.bridge.calls.map((c) => c.name)).toEqual(["save_document", "save_document"]);
    expect(ofType(h.events, "tool_finished").map((e) => [e.toolUseId, e.status])).toEqual([
      ["toolu_s1", "declined"],
      ["toolu_s2", "done"],
      ["toolu_s3", "done"],
    ]);
  });

  it("doesn't ask again for a call the person allowed on Claude Code's card, or a tool they allowed for this chat there", async () => {
    const h = harness({
      script: async (turn) => {
        await turn.tool("toolu_o1", "open_document", { ref: "/tmp/a.sonobe" }, { ask: true });
        // Allowed for this chat: Claude Code doesn't ask about the next one.
        await turn.tool("toolu_o2", "open_document", { ref: "/tmp/b.sonobe" });
        return END;
      },
    });
    await h.send("open both", {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => h.agent.confirm("w1", e.confirmationId, true, "allow-with-updates"));
    });
    expect(ofType(h.events, "confirm_required").map((e) => e.toolUseId)).toEqual(["toolu_o1"]);
    expect(h.bridge.calls.map((c) => c.args.ref)).toEqual(["/tmp/a.sonobe", "/tmp/b.sonobe"]);
  });

  it("says a forced save writes over outside changes, and asks before every one, whatever was allowed for this chat", async () => {
    const forced = permissionPrompt("save_document", "Save document", { path: "/Users/test/Checkout.sonobe", force: true }, "/Users/test");
    expect(forced).toEqual({
      title: "Allow Claude to save over outside changes?",
      message: "Claude wants to save this prototype to “~/Checkout.sonobe” over changes made to the project outside Sonobe since it was opened or last saved. Those changes will be lost. Claude Code asks before steps that reach outside this prototype.",
    });
    expect(permissionPrompt("save_document", "Save document", { force: true }, "/Users/test").message).toMatch(/^Claude wants to save this prototype over changes made to the project outside Sonobe since/);

    // Allowed for this chat on Claude Code's card, which then stops asking about save_document; and on Sonobe's own card, in a mode that never asked.
    for (const [first, allowAlways] of [[{ ask: true }, "allow-with-updates"], [{}, "sonobe-allow-always"]] as const) {
      const h = harness({
        script: async (turn) => {
          await turn.tool("toolu_s1", "save_document", {}, first);
          await turn.tool("toolu_s2", "save_document", {});
          await turn.tool("toolu_s3", "save_document", { force: true });
          return END;
        },
      });
      const answers = [allowAlways, "sonobe-allow-once"];
      await h.send("save it", {}, (e) => {
        if (e.type === "confirm_required") queueMicrotask(() => h.agent.confirm("w1", e.confirmationId, true, answers.shift()));
      });
      const cards = ofType(h.events, "confirm_required");
      expect(cards.map((c) => c.toolUseId)).toEqual(["toolu_s1", "toolu_s3"]);
      // "Allow for this chat" wouldn't cover the next forced save, so the card doesn't offer it.
      expect(cards[1]).toMatchObject({ title: "Allow Claude to save over outside changes?", message: expect.stringContaining("Those changes will be lost."), options: [expect.objectContaining({ id: "sonobe-allow-once" }), expect.objectContaining({ id: "sonobe-reject" })] });
      expect(cards[1]!.options).toHaveLength(2);
      expect(h.bridge.calls.map((c) => c.args)).toEqual([{ docId: "noddit" }, { docId: "noddit" }, { force: true, docId: "noddit" }]);
    }
  });

  it("offers no “Allow for this chat” on Claude Code's card for a forced save", async () => {
    const h = harness({
      script: async (turn) => {
        await turn.tool("toolu_f1", "save_document", { force: true }, { ask: true });
        await turn.tool("toolu_f2", "save_document", { force: true }, { ask: true });
        return END;
      },
    });
    await h.send("save over it", {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => h.agent.confirm("w1", e.confirmationId, true));
    });
    const cards = ofType(h.events, "confirm_required");
    expect(cards.map((c) => [c.title, c.options?.map((o) => o.id)])).toEqual([
      ["Allow Claude to save over outside changes?", ["allow-once", "reject"]],
      ["Allow Claude to save over outside changes?", ["allow-once", "reject"]],
    ]);
    // Allowed on Claude Code's card, so Sonobe doesn't ask again for that call.
    expect(h.bridge.calls).toHaveLength(2);
  });

  it("cancels its own question on Stop, and the call doesn't run", async () => {
    const h = harness({
      script: async (turn) => {
        const result = await turn.tool("toolu_s", "save_document", {});
        expect(result!.content[0]!.text).toMatch(/^The person chose not to allow save_document/);
        await turn.cancelled;
        return { stopReason: "cancelled" };
      },
    });
    const result = await h.send("save it", {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => h.agent.stop("w1"));
    });
    expect(result.outcome).toBe("stopped");
    expect(ofType(h.events, "confirm_resolved")).toEqual([expect.objectContaining({ approved: false })]);
    expect(h.bridge.calls).toEqual([]);
  });
});

describe("subscription engine: Claude Code's permission mode", () => {
  it("puts a session the adapter started in the person's own mode back in the mode that asks", async () => {
    const h = harness({ mode: "auto" });
    expect((await h.send("hello")).outcome).toBe("completed");
    expect(h.last().configs).toEqual([{ sessionId: "fake-1", configId: "mode", value: "default" }]);
    expect(h.last().sessions.get("fake-1")!.mode).toBe("default");
    expect(h.logs).toContain('info: Claude Code started this chat\'s session in "auto" mode (from the person\'s own settings); Sonobe put it in "default", which asks.');
    // Already asking: nothing to set.
    const asking = harness({ mode: "default" });
    await asking.send("hello");
    expect(asking.last().configs).toEqual([]);
  });

  it("runs nothing when the mode can't be set", async () => {
    for (const behavior of [{ mode: "acceptEdits", modeError: new RequestError(-32603, "Internal error", { details: "Invalid Mode" }) }, { mode: "plan", modeAfter: "plan" }]) {
      const h = harness(behavior);
      const result = await h.send("save it");
      expect(result).toMatchObject({ outcome: "error", error: { code: "agent_failed", message: MODE_NOT_SET } });
      expect(MODE_NOT_SET).toBe("Sonobe couldn't set Claude Code to ask before it saves or opens files, so nothing ran. Try again; if it keeps happening, update the adapter: npm install -g @agentclientprotocol/claude-agent-acp@latest");
      expect(h.last().prompts).toEqual([]);
      expect(h.last().closed).toEqual(["fake-1"]);
      expect(h.revoked).toEqual(["w1#1/1"]);
    }
    // The log keeps the adapter's reason, from its internal error's details.
    const locked = harness({ mode: "auto", modeError: new RequestError(-32603, "Internal error", { details: "Invalid Mode" }) });
    await locked.send("save it");
    expect(locked.logs).toContain('error: Claude\'s agent adapter didn\'t put the session in its "default" mode: Internal error: Invalid Mode');
  });
});

describe("subscription engine: Stop", () => {
  it("cancels the prompt, and a question or tool call waiting on it", async () => {
    const h = harness({
      script: async (turn) => {
        turn.say("Working on it…");
        const answer = await turn.ask("toolu_save", "save_document", {});
        expect(answer).toEqual({ outcome: { outcome: "cancelled" } });
        await turn.cancelled;
        return { stopReason: "cancelled" };
      },
    });
    const result = await h.send("hang", {}, (e) => {
      if (e.type === "confirm_required") queueMicrotask(() => h.agent.stop("w1"));
    });
    expect(result.outcome).toBe("stopped");
    expect(h.last().cancels).toEqual(["fake-1"]);
    expect(ofType(h.events, "confirm_resolved")).toEqual([{ type: "confirm_resolved", runId: "id1", confirmationId: "id2", approved: false }]);
    expect(h.agent.stop("w1")).toBe(false);
    // The session settled, so the next message keeps it.
    h.behavior.script = echo;
    expect((await h.send("next")).outcome).toBe("completed");
    expect(h.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-1"]);
    expect(ofType(h.events, "notice")).toEqual([]);
  });

  it("gives up on a prompt that hasn't settled 10 s after Stop, and the next message opens a new session with a notice", async () => {
    vi.useFakeTimers();
    let stuck: Turn | null = null;
    const h = harness({
      script: (turn) => {
        stuck = turn;
        turn.say("Working on it…");
        return new Promise<PromptResponse>(() => undefined);
      },
    });
    const running = h.send("stuck");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.agent.snapshot("w1").running).toBe(true);
    expect(h.agent.stop("w1")).toBe(true);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(h.agent.snapshot("w1").running).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect((await running).outcome).toBe("stopped");
    expect(h.last().cancels).toEqual(["fake-1"]);
    expect(h.last().closed).toEqual(["fake-1"]);

    h.behavior.script = async (turn) => {
      // The session given up on can't reach this reply's tools: its endpoint went with it.
      await expect(stuck!.call("add_layers", { layers: [] }, { toolUseId: "toolu_late" })).rejects.toThrow("endpoint is gone");
      return echo(turn);
    };
    h.events.length = 0;
    expect((await h.send("again")).outcome).toBe("completed");
    expect(h.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-2"]);
    expect(h.revoked).toEqual(["w1#1/1"]);
    expect(h.bridge.calls).toEqual([]);
    expect(h.events.slice(0, 3).map((e) => e.type)).toEqual(["run_started", "notice", "turn_started"]);
    expect(ofType(h.events, "notice")).toEqual([{ type: "notice", runId: expect.any(String), tone: "info", message: RESTARTED }]);
  });

  it("stops before the prompt when Stop comes while the session opens, and keeps the session for next time", async () => {
    let open: () => void = () => undefined;
    const h = harness({ opening: new Promise<void>((resolve) => (open = resolve)) });
    const running = h.send("hi");
    await waitFor(() => h.agents.length === 1);
    h.agent.stop("w1");
    expect((await running).outcome).toBe("stopped");
    open();
    await tick();
    expect(h.last().prompts).toEqual([]);
    expect((await h.send("hi again")).outcome).toBe("completed");
    expect(h.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1"]);
  });
});

describe("subscription engine: when the adapter fails", () => {
  it("ends the reply with agent_crashed when the adapter exits, then restarts it for the next message with a notice", async () => {
    const h = harness({
      script: async (turn) => {
        if (turn.message !== "crash") return echo(turn);
        turn.say("About to crash.");
        turn.agent.crash(7, "[session/create] 120 ms\nfake crash: something broke with sk-ant-api03-SECRET");
        return new Promise<PromptResponse>(() => undefined);
      },
    });
    await h.send("hello", {}, undefined, "w2");
    const result = await h.send("crash");
    expect(result).toMatchObject({ outcome: "error", error: { code: "agent_crashed", message: "Claude's agent adapter stopped unexpectedly (exit code 7: fake crash: something broke with sk-ant-…). Send your message again to restart it. If it keeps happening, update it: npm install -g @agentclientprotocol/claude-agent-acp@latest" } });
    expect(JSON.stringify(h.events)).not.toContain("SECRET");
    expect(h.events.at(-1)).toMatchObject({ type: "run_finished", outcome: "error", error: { code: "agent_crashed" } });

    h.events.length = 0;
    expect((await h.send("hello again")).outcome).toBe("completed");
    expect(h.agents).toHaveLength(2);
    expect(h.events.slice(0, 3)).toEqual([expect.objectContaining({ type: "run_started" }), { type: "notice", runId: expect.any(String), tone: "info", message: RESTARTED }, expect.objectContaining({ type: "turn_started", turn: 1 })]);
    // The other window's chat lost its session too, and says so once.
    h.events.length = 0;
    await h.send("and here", {}, undefined, "w2");
    expect(ofType(h.events, "notice").map((n) => n.message)).toEqual([RESTARTED]);
    h.events.length = 0;
    await h.send("and here again", {}, undefined, "w2");
    expect(ofType(h.events, "notice")).toEqual([]);
  });

  it("says Claude isn't signed in when a session or prompt needs auth, and opens a fresh session next time", async () => {
    const h = harness({ auth: SIGNED_OUT, script: async () => Promise.reject(RequestError.authRequired()) });
    const result = await h.send("hello");
    expect(result).toMatchObject({ outcome: "error", error: { code: "not_signed_in", message: "Claude isn't signed in on this computer. Choose Sign in… (it opens Terminal), or run claude-agent-acp --cli auth login in Terminal, then send your message again." } });
    expect(h.agent.status()).toMatchObject({ state: "signed_out", kind: "none", label: "Not logged in", message: "Claude isn't signed in on this computer. Choose Sign in… (it opens Terminal), or run claude-agent-acp --cli auth login in Terminal, then choose Check again." });
    expect(h.last().closed).toEqual(["fake-1"]);
    // Signed in since: a new session, with no restart notice (the old one remembered nothing).
    h.behavior.script = echo;
    h.last().pushAuth(ACCOUNT);
    h.events.length = 0;
    expect((await h.send("hello")).outcome).toBe("completed");
    expect(h.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-2"]);
    expect(ofType(h.events, "notice")).toEqual([]);
    expect(h.agent.status()).toMatchObject({ state: "ready", kind: "account", label: "Claude Max", email: "tyler@example.com", message: null });

    const other = harness({ newSessionError: new RequestError(-32000, "Authentication required") }, { platform: "linux" });
    expect(await other.send("hello")).toMatchObject({ error: { code: "not_signed_in", message: "Claude isn't signed in on this computer. In a terminal, run claude-agent-acp --cli auth login, then send your message again." } });
    expect(other.agent.status().message).toBe("Claude isn't signed in on this computer. In a terminal, run claude-agent-acp --cli auth login, then choose Check again.");
  });

  it("says Claude isn't signed in when a signed-in chat's login stops working, and stops naming the old plan", async () => {
    // Signed out in Terminal (auth_required), or a token that expired or was revoked, which Claude Code under the SDK reports as an internal error.
    for (const refusal of [RequestError.authRequired(), RequestError.internalError({ errorKind: "authentication_failed" }, "Failed to authenticate: OAuth session expired and could not be refreshed")]) {
      const h = harness({ script: async (turn) => (turn.message === "again" ? Promise.reject(refusal) : echo(turn)) });
      await h.send("hello");
      expect(h.agent.status()).toMatchObject({ state: "ready", kind: "account", label: "Claude Max", email: "tyler@example.com" });
      expect(await h.send("again")).toMatchObject({ outcome: "error", error: { code: "not_signed_in", message: "Claude isn't signed in on this computer. Choose Sign in… (it opens Terminal), or run claude-agent-acp --cli auth login in Terminal, then send your message again." } });
      expect(h.agent.status()).toEqual({ state: "signed_out", kind: "none", label: "Not logged in", email: null, adapterVersion: "0.79.0", message: "Claude isn't signed in on this computer. Choose Sign in… (it opens Terminal), or run claude-agent-acp --cli auth login in Terminal, then choose Check again." });
      expect(h.last().closed).toEqual(["fake-1"]);
      if (refusal.code !== -32000) expect(h.logs).toContain("warn: Claude Code couldn't use the Claude login on this computer: Internal error: Failed to authenticate: OAuth session expired and could not be refreshed");
      // Signed in again: the next message opens a fresh session, which reads the login again.
      h.behavior.script = echo;
      h.last().pushAuth(ACCOUNT);
      expect((await h.send("hello again")).outcome).toBe("completed");
      expect(h.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-1", "fake-2"]);
    }
  });

  it("teaches the install when Sonobe can't find the adapter", async () => {
    const created: unknown[] = [];
    const h = harness(
      {},
      {
        locate: () => ({ ok: false, searched: ["/opt/homebrew/bin", "~/.npm-global/bin"] }),
        createProcess: (o) => {
          created.push(o);
          throw new Error("not reached");
        },
      },
    );
    expect(await h.send("hello")).toMatchObject({ outcome: "error", error: { code: "agent_not_installed", message: NOT_INSTALLED } });
    expect(NOT_INSTALLED).toBe("Sonobe couldn't find Claude's agent adapter. It needs Node.js 22 or later: in Terminal, run npm install -g @agentclientprotocol/claude-agent-acp, then try again.");
    expect(h.events.map((e) => e.type)).toEqual(["run_started", "turn_started", "run_finished"]);
    expect(created).toEqual([]);
    expect(h.agent.status()).toEqual({ state: "not_installed", kind: null, label: null, email: null, adapterVersion: null, message: NOT_INSTALLED });
  });

  it("says the adapter didn't start when it won't spawn, answer or open a session", async () => {
    const hint = "Check that it's installed (npm install -g @agentclientprotocol/claude-agent-acp), then try again.";
    const timeout = harness({ startError: new AgentStartError("it didn't answer within 20 seconds") });
    expect(await timeout.send("hello")).toMatchObject({ error: { code: "agent_failed", message: `Claude's agent adapter didn't start: it didn't answer within 20 seconds. ${hint}` } });
    expect(timeout.agent.status()).toMatchObject({ state: "failed", message: `Claude's agent adapter didn't start: it didn't answer within 20 seconds. ${hint}` });
    expect(timeout.last().disposed).toBe(true);

    const exited = harness({ startError: new AgentExitedError({ code: 1, signal: null, stderrTail: "Error: Node.js 22 or later is required\n\nNode.js v24.21.0" }) });
    expect(await exited.send("hello")).toMatchObject({ error: { code: "agent_failed", message: `Claude's agent adapter didn't start: it exited before answering (exit code 1: Error: Node.js 22 or later is required). ${hint}` } });

    // A plain Error in the adapter arrives as -32603 "Internal error", with its text in data.details.
    const session = harness({ newSessionError: new RequestError(-32603, "Internal error", { details: "Claude Code native binary not found at /opt/homebrew/lib/node_modules/@agentclientprotocol/claude-agent-acp/vendor/claude" }) });
    expect(await session.send("hello")).toMatchObject({ error: { code: "agent_failed", message: `Claude's agent adapter didn't start: Claude Code native binary not found at /opt/homebrew/lib/node_modules/@agentclientprotocol/claude-agent-acp/vendor/claude. ${hint}` } });
    expect(session.logs).toContain("warn: Claude's agent adapter didn't open a session: Internal error: Claude Code native binary not found at /opt/homebrew/lib/node_modules/@agentclientprotocol/claude-agent-acp/vendor/claude");
  });

  it("says what went wrong when the adapter can't finish a reply, from the details of its internal error, and logs it", async () => {
    const failing = (err: Error) => harness({ script: async (turn) => (turn.message === "fail" ? Promise.reject(err) : echo(turn)) });
    const exited = failing(new RequestError(-32603, "Internal error", { details: "Claude Code process exited with code 1" }));
    expect(await exited.send("fail")).toMatchObject({ outcome: "error", error: { code: "unknown", message: "Claude's agent adapter couldn't finish the reply: Claude Code process exited with code 1. Send your message again." } });
    expect(exited.logs).toContain("warn: Claude's agent adapter couldn't finish a reply: Internal error: Claude Code process exited with code 1");
    // The chat keeps its session.
    expect((await exited.send("hello")).outcome).toBe("completed");
    expect(exited.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-1"]);

    // Never a key, and never more than about 200 characters of it.
    const leaky = failing(new RequestError(-32603, "Internal error", { details: `Invalid API key sk-ant-api03-SECRET ${"x".repeat(400)}` }));
    const { error } = await leaky.send("fail");
    expect(error!.message).toMatch(/^Claude's agent adapter couldn't finish the reply: Invalid API key sk-ant-… x+…\. Send your message again\.$/);
    expect(error!.message.length).toBeLessThan(300);
    expect(`${JSON.stringify(leaky.events)}\n${leaky.logs.join("\n")}`).not.toContain("SECRET");
    // An error with nothing more to say still says what it is.
    expect(await failing(new RequestError(-32603, "Internal error")).send("fail")).toMatchObject({ error: { code: "unknown", message: "Claude's agent adapter couldn't finish the reply: Internal error. Send your message again." } });
  });

  it("says the plan's usage limit is reached, quoting Claude Code's notice, from a rejection or the notice as the reply", async () => {
    const limit = (text: string, data?: Record<string, unknown>) =>
      harness({
        script: async (turn) => {
          // The adapter streams the notice, then rejects with it.
          turn.say(text);
          throw RequestError.internalError(data, text);
        },
      });
    expect(await limit("You've hit your limit · resets 3pm", { errorKind: "rate_limit" }).send("hello")).toMatchObject({ outcome: "error", error: { code: "usage_limit", message: "Your Claude plan's usage limit is reached (“You've hit your limit · resets 3pm”). Try again once it resets, or switch the Assistant to your API key." } });
    for (const text of ["You've reached your weekly limit · resets Mon 9am", "You're out of extra usage · resets 5pm", "Your org is out of usage · contact your admin"]) {
      expect(await limit(text).send("hello")).toMatchObject({ error: { code: "usage_limit", message: usageLimitMessage(text) } });
    }
    expect(usageLimitMessage(null)).toBe("Your Claude plan's usage limit is reached. Try again once it resets, or switch the Assistant to your API key.");
    // No credit left, or an account on hold: the same code, but nothing resets on its own.
    expect(await limit("Credit balance is too low", { errorKind: "billing_error" }).send("hello")).toMatchObject({ error: { code: "usage_limit", message: "Your Claude account can't take more requests right now (“Credit balance is too low”). Check your plan or billing at claude.ai, or switch the Assistant to your API key." } });
    const hold = "Your account is on hold and can't use Claude Code. View details or appeal: https://claude.ai/restricted";
    expect(await limit(hold, { errorKind: "account_on_hold" }).send("hello")).toMatchObject({ error: { code: "usage_limit", message: accountBlockedMessage(hold) } });
    const bare = harness({ script: async () => Promise.reject(new RequestError(-32603, "Internal error", { errorKind: "billing_error" })) });
    expect(await bare.send("hello")).toMatchObject({ error: { code: "usage_limit", message: "Your Claude account can't take more requests right now. Check your plan or billing at claude.ai, or switch the Assistant to your API key." } });
    const replied = harness({
      script: async (turn) => {
        turn.say("You've hit your limit · resets 5pm");
        return END;
      },
    });
    expect(await replied.send("hello")).toMatchObject({ outcome: "error", error: { code: "usage_limit", message: usageLimitMessage("You've hit your limit · resets 5pm") } });
  });

  it("tells a transient rate limit from the plan's limit", async () => {
    for (const text of ["API Error: 429 rate_limit_error", "Server is temporarily limiting requests (not your usage limit)"]) {
      const h = harness({ script: async () => Promise.reject(RequestError.internalError({ errorKind: "rate_limit" }, text)) });
      expect(await h.send("hello")).toMatchObject({ error: { code: "rate_limited", message: RATE_LIMITED } });
    }
    expect(RATE_LIMITED).toBe("Claude is limiting requests right now (not your plan's usage limit). Wait a minute, then send your message again.");
    // Without the adapter's error kind, it's any other failure.
    const plain = harness({ script: async () => Promise.reject(RequestError.internalError(undefined, "Server is temporarily limiting requests (not your usage limit)")) });
    expect(await plain.send("hello")).toMatchObject({ error: { code: "unknown" } });
    // A real answer that mentions limits is just an answer.
    const answer = harness({
      script: async (turn) => {
        turn.say("Here's a usage limit banner for your settings screen.");
        return END;
      },
    });
    expect((await answer.send("a usage limit banner")).outcome).toBe("completed");
  });

  it("starts a new session after the adapter ended this one while it kept running", async () => {
    for (const ended of [RequestError.internalError(undefined, "The Claude Agent process exited unexpectedly. Please start a new session."), new RequestError(-32603, "Internal error", { details: "Session not found" }), RequestError.internalError(undefined, "The Claude Agent session has ended. Please start a new session.")]) {
      const h = harness({
        script: async (turn) => {
          if (turn.message === "crash") {
            turn.say("Working on it…");
            throw ended;
          }
          return echo(turn);
        },
      });
      await h.send("hello");
      expect(await h.send("crash")).toMatchObject({ outcome: "error", error: { code: "agent_crashed", message: SESSION_ENDED } });
      h.events.length = 0;
      expect((await h.send("again")).outcome).toBe("completed");
      expect(h.agents).toHaveLength(1);
      expect(h.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-1", "fake-2"]);
      expect(h.last().closed).toEqual(["fake-1"]);
      expect(ofType(h.events, "notice").map((n) => n.message)).toEqual([RESTARTED]);
    }
    expect(SESSION_ENDED).toBe("Claude Code stopped unexpectedly during this reply. Send your message again to restart it; it won't remember the earlier messages in this chat. If it keeps happening, update the adapter: npm install -g @agentclientprotocol/claude-agent-acp@latest");
    // Another internal error keeps the session (and the chat's history).
    const flaky = harness({ script: async (turn) => (turn.message === "fail" ? Promise.reject(RequestError.internalError(undefined, "API Error: 500 overloaded")) : echo(turn)) });
    expect(await flaky.send("fail")).toMatchObject({ error: { code: "unknown", message: "Claude's agent adapter couldn't finish the reply: API Error: 500 overloaded. Send your message again." } });
    await flaky.send("hello");
    expect(flaky.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-1"]);
  });

  it("sends a message again on a new session when the adapter ended the old one before the reply started", async () => {
    // The adapter closes a session's stream after some errors and then refuses every prompt on it.
    const ended = new Set<string>();
    const h = harness({
      script: async (turn) => {
        if (ended.has(turn.sessionId)) throw RequestError.internalError(undefined, "The Claude Agent session has ended. Please start a new session.");
        if (turn.message === "fail") {
          ended.add(turn.sessionId);
          throw RequestError.internalError(undefined, "API Error: 500 overloaded");
        }
        return echo(turn);
      },
    });
    await h.send("hello");
    expect(await h.send("fail")).toMatchObject({ error: { code: "unknown" } });
    h.events.length = 0;
    expect((await h.send("again")).outcome).toBe("completed");
    expect(h.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-1", "fake-1", "fake-2"]);
    expect(h.last().closed).toEqual(["fake-1"]);
    expect(ofType(h.events, "notice").map((n) => n.message)).toEqual([RESTARTED]);
    expect(ofType(h.events, "run_finished")).toHaveLength(1);
    expect(h.logs.some((l) => l.includes("had ended this chat's session"))).toBe(true);
    // Only once: a new session that refuses too fails the reply.
    const stubborn = harness({ script: async (turn) => (turn.message === "hello" ? echo(turn) : Promise.reject(RequestError.internalError(undefined, "The Claude Agent session has ended. Please start a new session."))) });
    await stubborn.send("hello");
    expect(await stubborn.send("again")).toMatchObject({ error: { code: "agent_crashed", message: SESSION_ENDED } });
    expect(stubborn.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-1", "fake-2"]);
  });

  it("says signing in again won't help when the organization doesn't allow Claude plans in Claude Code", async () => {
    const h = harness({ script: async () => Promise.reject(RequestError.internalError({ errorKind: "oauth_org_not_allowed" }, "Your organization has disabled Claude subscription access for Claude Code")) });
    expect(await h.send("hello")).toMatchObject({ error: { code: "permission_denied", message: orgNotAllowedMessage("Your organization has disabled Claude subscription access for Claude Code") } });
    expect(orgNotAllowedMessage("x")).toBe("Your organization doesn't allow Claude subscription use in Claude Code (“x”), so signing in again won't help. Ask your organization's admin, or switch the Assistant to your API key.");
  });

  it("names the stderr line that says what went wrong", () => {
    const crash = "file:///x.mjs:1\nthrow new TypeError(\"adapter needs X\");\n^\n\nTypeError: adapter needs X\n    at file:///x.mjs:1:7\n    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)\n\nNode.js v24.21.0";
    expect(exitDetail({ code: 1, signal: null, stderrTail: crash })).toBe("exit code 1: TypeError: adapter needs X");
    expect(exitDetail({ code: null, signal: "SIGKILL", stderrTail: "[session/create] phase=cli 812 ms\nfetching the model list\n[session/prompt] phase=send 3 ms" })).toBe("signal SIGKILL: fetching the model list");
    expect(exitDetail({ code: 1, signal: null, stderrTail: "Error: bad key sk-ant-api03-SECRET\nNode.js v24.21.0" })).toBe("exit code 1: Error: bad key sk-ant-…");
    expect(exitDetail({ code: 1, signal: null, stderrTail: "Node.js v24.21.0" })).toBe("exit code 1: Node.js v24.21.0");
    expect(exitDetail({ code: 3, signal: null, stderrTail: "" })).toBe("exit code 3");
  });

  it("names V8's reason when the adapter runs out of memory, not a native stack frame", () => {
    const fatal = "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory";
    const frames = [
      " 1: 0x1028ff10c node::OOMErrorHandler(char const*, v8::OOMDetails const&) [/Applications/Sonobe.app/Contents/Frameworks/Electron Framework]",
      " 2: 0x102b7123c v8::internal::V8::FatalProcessOutOfMemory(v8::internal::Isolate*, char const*, v8::OOMDetails const&) [/Applications/Sonobe.app/Contents/Frameworks/Electron Framework]",
      ...Array.from({ length: 40 }, (_, i) => `${i + 3}: 0x${(0x102dd0664 + i * 0x1000).toString(16)} v8::internal::Heap::CollectGarbage(v8::internal::AllocationSpace, v8::internal::GarbageCollectionReason) [/Applications/Sonobe.app/Contents/Frameworks/Electron Framework]`),
      "43: 0x18e2b84e4 start [/usr/lib/dyld]",
    ];
    const gcs = "[5083:0xb2bc00000]       35 ms: Mark-Compact 15.6 (32.5) -> 15.6 (32.3) MB, pooled: 0 MB, 9.67 / 0.00 ms  (average mu = 0.353, current mu = 0.029) allocation failure; scavenge might not succeed";
    const oom = ["", "<--- Last few GCs --->", "", gcs, "", fatal, "----- Native stack trace -----", "", ...frames].join("\n");
    expect(exitDetail({ code: null, signal: "SIGABRT", stderrTail: oom })).toBe(`signal SIGABRT: ${fatal}`);
    // As process.ts keeps it: the frames folded into one line.
    expect(exitDetail({ code: null, signal: "SIGABRT", stderrTail: `${gcs}\n\n${fatal}\n----- Native stack trace -----\n\n[left out: Node's native stack trace]` })).toBe(`signal SIGABRT: ${fatal}`);
    // Frames alone say nothing: just how it ended.
    expect(exitDetail({ code: null, signal: "SIGABRT", stderrTail: frames.join("\n") })).toBe("signal SIGABRT");
  });

  it("maps the prompt's stop reasons like the API key's", async () => {
    const reasons: [PromptResponse["stopReason"], string, string][] = [
      ["max_turn_requests", "max_turns", "The Assistant paused after 30 steps. Send a message (like “keep going”) to continue."],
      ["max_tokens", "max_tokens", "The reply reached the length limit and was cut off."],
      ["refusal", "refusal", "Claude declined this request. Try rephrasing what you'd like to build."],
    ];
    for (const [stopReason, outcome, notice] of reasons) {
      const h = harness({ script: async () => ({ stopReason, usage: USAGE }) });
      expect((await h.send("go")).outcome).toBe(outcome);
      expect(ofType(h.events, "notice").map((n) => n.message)).toEqual([notice]);
    }
  });
});

describe("subscription engine: usage and models", () => {
  it("adds each reply's tokens to the chat, counting its turns as requests, at no cost", async () => {
    const h = harness({
      script: async (turn) => {
        turn.say("One.", "msg_1");
        turn.say("Two.", "msg_2");
        return END;
      },
    });
    await h.send("first");
    h.behavior.script = echo;
    const result = await h.send("second");
    const usage = { inputTokens: 2400, outputTokens: 600, cacheReadTokens: 40_000, cacheWriteTokens: 0, totalTokens: 43_000, budgetTokens: 7000, estimatedCostUsd: 0, requests: 3 };
    expect(result.usage).toEqual(usage);
    expect(ofType(h.events, "usage").at(-1)).toMatchObject({ usage, limits: { maxTurns: 30, tokenBudget: 1_500_000 } });
    expect(h.agent.snapshot("w1").usage).toEqual(usage);
    // The plan's own limits apply: no budget stops a subscription chat.
    const big = harness(
      {
        script: async (turn) => {
          turn.say("ok");
          return { stopReason: "end_turn", usage: { inputTokens: 5_000_000, outputTokens: 0, totalTokens: 5_000_000 } };
        },
      },
      { limits: { tokenBudget: 10_000 } },
    );
    await big.send("one");
    expect((await big.send("two")).outcome).toBe("completed");
  });

  it("switches the session's model to the adapter's value for it, and otherwise says the chat keeps its own", async () => {
    const h = harness({ configOptions: MODEL_OPTIONS });
    await h.send("hi");
    await h.send("hi", { model: "claude-opus-5" });
    await h.send("hi", { model: "claude-opus-5" });
    await h.send("hi", { model: "claude-haiku-4-5-20251001" });
    expect(h.last().configs).toEqual([
      { sessionId: "fake-1", configId: "model", value: "opus[1m]" },
      { sessionId: "fake-1", configId: "model", value: "haiku" },
    ]);
    expect(ofType(h.events, "notice")).toEqual([]);
    expect([modelValue(["default", "sonnet", "sonnet[1m]"], "claude-sonnet-5"), modelValue(["claude-opus-5", "opus"], "claude-opus-5"), modelValue(["default", "sonnet"], "claude-haiku-4-5-20251001"), modelValue(["default"], "gpt-5")]).toEqual(["sonnet", "claude-opus-5", null, null]);

    // The adapter refuses the switch: the chat keeps its model, and says so.
    const refused = harness({ configOptions: MODEL_OPTIONS, modelError: new RequestError(-32603, "Internal error", { details: "Invalid value for config option model: opus[1m]" }) });
    await refused.send("hi");
    await refused.send("hi", { model: "claude-opus-5" });
    expect(ofType(refused.events, "notice").map((n) => n.message)).toEqual(["This chat keeps Claude Sonnet 5. Start a new chat to use Claude Opus 5."]);
    expect(refused.logs).toContain("warn: Claude's agent adapter didn't switch the model: Internal error: Invalid value for config option model: opus[1m]");

    const fixed = harness();
    await fixed.send("hi", { model: "claude-haiku-4-5-20251001" });
    expect(([...fixed.last().sessions.values()][0]!.params._meta as { claudeCode: { options: { model: string } } }).claudeCode.options.model).toBe("claude-haiku-4-5-20251001");
    expect((await fixed.send("hi", { model: "claude-opus-5" })).outcome).toBe("completed");
    expect(ofType(fixed.events, "notice").map((n) => n.message)).toEqual(["This chat keeps Claude Haiku 4.5. Start a new chat to use Claude Opus 5."]);
  });
});

describe("subscription engine: chats", () => {
  it("refuses empty, too long and concurrent messages, and says when the tools aren't ready", async () => {
    const h = harness({ script: (turn) => turn.cancelled.then(() => ({ stopReason: "cancelled" as const })) });
    expect(await h.send("   ")).toMatchObject({ error: { code: "empty_message" } });
    expect(await h.send("x".repeat(50_001))).toMatchObject({ error: { code: "bad_request" } });
    const first = h.send("hang");
    await waitFor(() => h.last()?.prompts.length === 1);
    expect(await h.send("again")).toMatchObject({ outcome: "error", error: { code: "busy" } });
    h.agent.stop("w1");
    expect((await first).outcome).toBe("stopped");

    const none = createSubscriptionAgent({
      tools: () => {
        throw new Error("no host");
      },
      version: "0",
      sessionsDir: "/tmp/x",
      locate: () => ({ ok: false, searched: [] }),
    });
    expect(await none.run("w1", { text: "hi" }, () => undefined)).toMatchObject({ outcome: "error", error: { code: "no_document" } });
    expect(none.snapshot("w1").running).toBe(false);
  });

  it("closes the session and revokes the endpoint on New chat and when the window closes", async () => {
    const forgotten: string[] = [];
    const localTools: LocalTools = { infos: [{ name: "read_code_file", title: "Read code file", description: "Read a file.", inputSchema: { type: "object", properties: { path: { type: "string" } } }, readOnly: true }], call: async () => text("export const accent = '#8B5CF6';"), forget: (id) => void forgotten.push(id) };
    const h = harness({}, { localTools });
    await h.send("hi");
    const allowed = ([...h.last().sessions.values()][0]!.params._meta as { claudeCode: { options: { allowedTools: string[] } } }).claudeCode.options.allowedTools;
    expect(allowed.at(-1)).toBe("mcp__sonobe__read_code_file");
    h.agent.reset("w1");
    expect(h.last().closed).toEqual(["fake-1"]);
    expect(h.revoked).toEqual(["w1#1/1"]);
    expect(h.agent.snapshot("w1")).toMatchObject({ messageCount: 0, usage: { totalTokens: 0 } });
    await h.send("hi");
    expect(h.registered).toEqual(["w1#1/1", "w1#2/1"]);
    expect(h.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-2"]);
    h.agent.forget("w1");
    expect(h.last().closed).toEqual(["fake-1", "fake-2"]);
    expect(h.revoked).toEqual(["w1#1/1", "w1#2/1"]);
    expect(forgotten).toEqual(["w1", "w1"]);
  });

  it("stops a running reply on New chat", async () => {
    const h = harness({ script: (turn) => turn.cancelled.then(() => ({ stopReason: "cancelled" as const })) });
    const running = h.send("hang");
    await waitFor(() => h.last()?.prompts.length === 1);
    h.agent.reset("w1");
    expect((await running).outcome).toBe("stopped");
    expect(h.last().cancels).toEqual(["fake-1"]);
  });
});

describe("subscription engine: the Claude login", () => {
  it("reports what the adapter says, from unknown to checking to ready or signed out", async () => {
    const h = harness({ script: (turn) => turn.cancelled.then(() => ({ stopReason: "cancelled" as const })) });
    expect(h.agent.status()).toEqual({ state: "unknown", kind: null, label: null, email: null, adapterVersion: null, message: null });
    const running = h.send("hi");
    await waitFor(() => h.agent.status().state === "ready");
    expect(h.agent.status()).toEqual({ state: "ready", kind: "account", label: "Claude Max", email: "tyler@example.com", adapterVersion: "0.79.0", message: null });
    h.last().pushAuth({ kind: "api_key", label: "Anthropic API key", email: null, plan: null, detail: "ANTHROPIC_API_KEY" });
    expect(h.agent.status()).toMatchObject({ state: "ready", kind: "api_key", label: "Anthropic API key" });
    h.last().pushAuth(SIGNED_OUT);
    expect(h.agent.status()).toMatchObject({ state: "signed_out", kind: "none", message: expect.stringContaining("Choose Sign in…") });
    // While a reply runs, a check reads the login without restarting the adapter.
    h.behavior.cliLogin = ACCOUNT;
    expect(await h.agent.checkSubscription()).toMatchObject({ state: "ready", kind: "account" });
    expect(h.agents).toHaveLength(1);
    // In the sessions folder, as the adapter runs: Claude Code reads project settings from its cwd.
    expect(h.logins).toEqual([{ spec: SPEC, env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1" }), cwd: "/tmp/sonobe-test/assistant/claude" }]);
    h.agent.stop("w1");
    await running;
  });

  it("checks with a fresh adapter when no chat is on it, so a login done in Terminal is seen", async () => {
    const h = harness({ auth: SIGNED_OUT });
    expect(await h.agent.checkSubscription()).toMatchObject({ state: "signed_out", adapterVersion: "0.79.0" });
    h.behavior.auth = ACCOUNT;
    expect(await h.agent.checkSubscription()).toMatchObject({ state: "ready", kind: "account", email: "tyler@example.com" });
    expect(h.agents.map((a) => a.disposed)).toEqual([true, false]);
    expect(h.logins).toEqual([]);

    const quiet = harness({ auth: null }, { authWaitMs: 20 });
    expect(await quiet.agent.checkSubscription()).toMatchObject({ state: "ready", kind: null, label: null });
    const missing = harness({}, { locate: () => ({ ok: false, searched: [] }) });
    expect(await missing.agent.checkSubscription()).toMatchObject({ state: "not_installed", message: NOT_INSTALLED });
    const broken = harness({ startError: new AgentStartError("Sonobe couldn't run ~/bin/claude-agent-acp (EACCES)") });
    expect(await broken.agent.checkSubscription()).toMatchObject({ state: "failed", message: expect.stringContaining("(EACCES)") });
  });

  it("leaves other windows' chats their sessions when one window checks the login", async () => {
    const h = harness({}, { authWaitMs: 20 });
    await h.send("hello", {}, undefined, "w1");
    // Another window's setup: Check again, signed out in Terminal meanwhile.
    h.behavior.cliLogin = SIGNED_OUT;
    expect(await h.agent.checkSubscription()).toMatchObject({ state: "signed_out", kind: "none" });
    expect(h.agents.map((a) => a.disposed)).toEqual([false]);
    h.events.length = 0;
    h.last().pushAuth(ACCOUNT);
    expect((await h.send("still here?", {}, undefined, "w1")).outcome).toBe("completed");
    expect(h.last().prompts.map((p) => p.sessionId)).toEqual(["fake-1", "fake-1"]);
    expect(ofType(h.events, "notice")).toEqual([]);
    // Claude Code couldn't say: the last login the adapter reported stands.
    h.behavior.cliLogin = null;
    expect(await h.agent.checkSubscription()).toMatchObject({ state: "ready", kind: "account" });
  });

  it("never leaves the login at checking: an adapter that exits before reporting one says why", async () => {
    // It answers initialize, then exits during the wait for its login.
    const h = harness({ auth: null }, { authWaitMs: 500 });
    const checking = h.agent.checkSubscription();
    await waitFor(() => h.agents.length === 1);
    await tick();
    h.last().crash(1, "Error: the native Claude Code binary is missing\n\nNode.js v24.21.0");
    expect(await checking).toMatchObject({ state: "failed", message: "Claude's agent adapter didn't start: it exited (exit code 1: Error: the native Claude Code binary is missing). Check that it's installed (npm install -g @agentclientprotocol/claude-agent-acp), then try again." });

    // A reply whose adapter goes before it reports a login.
    const run = harness({
      auth: null,
      script: async (turn) => {
        turn.agent.crash(7, "fake crash: something broke");
        return new Promise<PromptResponse>(() => undefined);
      },
    });
    expect(await run.send("hi")).toMatchObject({ error: { code: "agent_crashed" } });
    expect(run.agent.status()).toMatchObject({ state: "failed", message: expect.stringContaining("it exited (exit code 7: fake crash: something broke)") });
  });

  it("reads Claude Code's own login report like the adapter does", () => {
    expect(parseCliLogin('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"fake@example.com","subscriptionType":"max"}')).toEqual({ kind: "account", label: "Claude Max", email: "fake@example.com", plan: "max", detail: null });
    expect(parseCliLogin('{"loggedIn":true,"subscriptionType":"Claude Pro"}')).toMatchObject({ kind: "account", label: "Claude Pro" });
    expect(parseCliLogin('{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}')).toEqual({ kind: "none", label: "Not logged in", email: null, plan: null, detail: null });
    expect(parseCliLogin('{"loggedIn":false,"apiKeySource":"ANTHROPIC_API_KEY"}')).toMatchObject({ kind: "api_key", label: "Anthropic API key", detail: "ANTHROPIC_API_KEY" });
    expect(parseCliLogin('{"loggedIn":false,"apiProvider":"bedrock"}')).toMatchObject({ kind: "external", label: "AWS Bedrock" });
    for (const junk of ["", "not json", "[]", '{"email":"x"}']) expect(parseCliLogin(junk)).toBeNull();
  });

  it("runs the one-off login check in the folder it names, not the app's", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sonobe-cli-login-"));
    try {
      // A stand-in CLI that reports the folder it ran in as the account's email.
      const script = 'process.stdout.write(JSON.stringify({ loggedIn: true, subscriptionType: "max", email: process.cwd() }))';
      const spec: ClaudeAgentSpec = { command: process.execPath, args: ["-e", script, "--"], env: {}, displayPath: "claude-agent-acp", version: null, source: "path" };
      const login = await readCliLogin(spec, { env: { PATH: process.env.PATH ?? "" }, cwd: dir, timeoutMs: 10_000 });
      expect(login).toEqual({ kind: "account", label: "Claude Max", email: realpathSync(dir), plan: "max", detail: null });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("opens the sign-in with the adapter it found, and teaches when it can't", async () => {
    const opened: unknown[] = [];
    const signInOptions = { platform: "darwin" as const, dir: "/tmp/handoff", openPath: async () => "" };
    const h = harness({}, { signIn: { open: async (spec, o) => (opened.push([spec, o]), { ok: true }), options: signInOptions } });
    expect(await h.agent.signIn()).toEqual({ ok: true });
    expect(opened).toEqual([[SPEC, signInOptions]]);
    expect(await harness().agent.signIn()).toEqual({ ok: false, error: "Run claude-agent-acp --cli auth login in a terminal, then check again." });
    expect(await harness({}, { locate: () => ({ ok: false, searched: [] }) }).agent.signIn()).toEqual({ ok: false, error: NOT_INSTALLED });
    const failing = harness({}, { signIn: { open: async () => Promise.reject(new Error("EACCES")), options: signInOptions } });
    expect(await failing.agent.signIn()).toEqual({ ok: false, error: "Sonobe couldn't open Terminal: EACCES. Run claude-agent-acp --cli auth login in a terminal, then check again." });
  });

  it("stops every reply, session and the adapter when the switch goes off, and starts over when it's back on", async () => {
    const h = harness({ script: async (turn) => (turn.message === "hang" ? turn.cancelled.then(() => ({ stopReason: "cancelled" as const })) : echo(turn)) });
    await h.send("hello", {}, undefined, "w1");
    const running = h.send("hang", {}, undefined, "w2");
    await waitFor(() => h.last()?.prompts.length === 2);
    await h.agent.shutdown();
    expect((await running).outcome).toBe("stopped");
    expect(h.last().disposed).toBe(true);
    expect(h.last().closed).toEqual(["fake-1", "fake-2"]);
    expect(h.revoked).toEqual(["w1#1/1", "w2#2/1"]);
    // The chats keep what they had, and say the next reply starts over.
    expect(h.agent.snapshot("w1")).toMatchObject({ messageCount: 2, usage: { inputTokens: 1200 } });
    h.events.length = 0;
    expect((await h.send("back on", {}, undefined, "w1")).outcome).toBe("completed");
    expect(h.agents).toHaveLength(2);
    expect(ofType(h.events, "notice").map((n) => n.message)).toEqual([RESTARTED]);
  });

  it("stops an adapter that was still starting when the switch went off", async () => {
    let started: () => void = () => undefined;
    const h = harness({ auth: null, starting: new Promise<void>((resolve) => (started = resolve)) });
    const running = h.send("hi");
    await waitFor(() => h.agents.length === 1);
    expect(h.agent.status().state).toBe("checking");
    await h.agent.shutdown();
    expect((await running).outcome).toBe("stopped");
    expect(h.agent.status().state).toBe("unknown");
    started();
    await waitFor(() => h.agents[0]!.disposed);
    expect(h.agents[0]!.disposed).toBe(true);
    // Back on: a fresh adapter.
    h.behavior.starting = undefined;
    expect((await h.send("hi again")).outcome).toBe("completed");
    expect(h.agents).toHaveLength(2);
    expect(h.agents[0]!.prompts).toEqual([]);
  });

  it("stops everything on dispose", async () => {
    const h = harness({ script: (turn) => turn.cancelled.then(() => ({ stopReason: "cancelled" as const })) });
    const running = h.send("hang");
    await waitFor(() => h.last()?.prompts.length === 1);
    await h.agent.dispose();
    expect((await running).outcome).toBe("stopped");
    expect(h.last().disposed).toBe(true);
    expect(h.revoked).toEqual(["w1#1/1"]);
  });
});
