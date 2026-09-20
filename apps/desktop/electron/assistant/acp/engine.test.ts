/**
 * The subscription engine against an in-memory stand-in for Claude's agent adapter (FakeAgent below:
 * scripted session updates, permission questions, prompt results, login pushes and exits) and a
 * stand-in tool endpoint whose calls the script makes the way Claude Code does. No process, no
 * network, no Claude account.
 */

import { RequestError, type InitializeResponse, type NewSessionRequest, type NewSessionResponse, type PermissionOption, type PromptRequest, type PromptResponse, type RequestPermissionResponse, type SessionConfigOption, type SessionNotification, type SessionUpdate, type SetSessionConfigOptionRequest } from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemPrompt } from "../agent.ts";
import { canvasContextBlock } from "../design.ts";
import type { AssistantCanvasContext, AssistantEvent, AssistantSendRequest } from "../protocol.ts";
import { FAKE_TOOLS, fakeBridge, text } from "../testing.ts";
import type { AssistantToolInfo, LocalTools, ToolCallResult } from "../toolBridge.ts";
import { createSubscriptionAgent, NO_RUN, NOT_INSTALLED, RESTARTED, USAGE_LIMIT, type SubscriptionAgentOptions } from "./engine.ts";
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
const MODEL_OPTIONS: SessionConfigOption[] = [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "claude-sonnet-5", options: [{ value: "claude-sonnet-5", name: "Sonnet" }, { value: "claude-opus-5", name: "Opus" }, { value: "claude-haiku-4-5-20251001", name: "Haiku" }] }];

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
  newSessionError?: Error;
  /** session/new waits for it. */
  opening?: Promise<void>;
  configOptions?: SessionConfigOption[];
  script: Script;
}

interface FakeSession {
  params: NewSessionRequest;
  listeners: Set<(notification: SessionNotification) => void>;
  permission: PermissionHandler | null;
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
    this.ready = behavior.startError ? Promise.reject(behavior.startError) : Promise.resolve(INIT);
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
      this.sessions.set(sessionId, { params, listeners: new Set(), permission: null });
      return { sessionId, ...(this.behavior.configOptions ? { configOptions: this.behavior.configOptions } : {}) };
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
    ...options,
  });
  const send = (message: string, extra: Partial<AssistantSendRequest> = {}, onEvent?: (event: AssistantEvent) => void, id = "w1") =>
    agent.run(id, { text: message, ...extra }, (event) => {
      events.push(event);
      onEvent?.(event);
    });
  return { agent, agents, bridge, events, send, registered, revoked, endpoints, behavior: b, last: () => agents.at(-1)! };
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
            model: "claude-sonnet-5",
            maxTurns: 30,
            // Every tool but the ones that reach outside the prototype, which ask first.
            allowedTools: ["get_outline", "add_layers", "delete_items", "apply_ops", "import_design", "preview_design"].map((n) => `mcp__sonobe__${n}`),
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
      { name: "import_design", args: { preview: true, docId: "noddit", component: "main" } },
    ]);
  });

  it("announces a call that reaches Sonobe before its tool_call, and finds the chip of a call without a tool_use id", async () => {
    const h = harness({
      script: async (turn) => {
        await turn.call("get_outline", { detail: "compact" }, { toolUseId: "toolu_early" });
        turn.update({ sessionUpdate: "tool_call", toolCallId: "toolu_early", name: "mcp__sonobe__get_outline", title: "mcp__sonobe__get_outline", kind: "other", status: "pending", rawInput: {} });
        turn.update({ sessionUpdate: "tool_call_update", toolCallId: "toolu_early", rawInput: { detail: "compact" } });
        turn.update({ sessionUpdate: "tool_call_update", toolCallId: "toolu_early", status: "completed", content: [] });
        turn.update({ sessionUpdate: "tool_call", toolCallId: "toolu_a", name: "mcp__sonobe__add_layers", title: "mcp__sonobe__add_layers", kind: "other", status: "pending", rawInput: {} });
        turn.update({ sessionUpdate: "tool_call", toolCallId: "toolu_b", name: "mcp__sonobe__add_layers", title: "mcp__sonobe__add_layers", kind: "other", status: "pending", rawInput: {} });
        await turn.call("add_layers", { layers: [] }, { toolUseId: null });
        await turn.call("apply_ops", { ops: [] }, { toolUseId: null });
        return END;
      },
    });
    await h.send("go");
    expect(ofType(h.events, "tool_started").map((e) => [e.toolUseId, e.detail])).toEqual([
      ["toolu_early", ""],
      ["toolu_a", ""],
      ["toolu_b", ""],
      ["sonobe-1", "0 ops"],
    ]);
    expect(ofType(h.events, "tool_finished").map((e) => [e.toolUseId, e.status])).toEqual([
      ["toolu_early", "done"],
      ["toolu_a", "done"],
      ["sonobe-1", "done"],
      // Announced, never called: the reply ended under it.
      ["toolu_b", "skipped"],
    ]);
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
      message: "Claude wants to save this prototype to ~/Documents/Checkout.sonobe. Claude Code asks before steps that reach outside this prototype.",
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
    expect(ofType(h.events, "confirm_required")[0]).toMatchObject({ title: "Allow Claude to open another prototype?", message: "Claude wants to open /tmp/fake.sonobe. Claude Code asks before steps that reach outside this prototype." });
    expect(await h.last().ask("fake-1", "toolu_late", "save_document", {})).toEqual({ outcome: { outcome: "cancelled" } });
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
    expect(result).toMatchObject({ outcome: "error", error: { code: "not_signed_in", message: "Claude isn't signed in on this computer. Choose Sign in (it opens Terminal), or run claude auth login in Terminal, then send your message again." } });
    expect(h.agent.status()).toMatchObject({ state: "signed_out", kind: "none", label: "Not logged in", message: "Claude isn't signed in on this computer. Choose Sign in (it opens Terminal), or run claude auth login in Terminal, then check again." });
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
    expect(await other.send("hello")).toMatchObject({ error: { code: "not_signed_in", message: "Claude isn't signed in on this computer. Run claude-agent-acp --cli auth login in a terminal, then send your message again." } });
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

    const exited = harness({ startError: new AgentExitedError({ code: 1, signal: null, stderrTail: "Error: Node.js 22 or later is required" }) });
    expect(await exited.send("hello")).toMatchObject({ error: { code: "agent_failed", message: `Claude's agent adapter didn't start: it exited before answering (exit code 1: Error: Node.js 22 or later is required). ${hint}` } });

    const session = harness({ newSessionError: new Error("Internal error: the CLI didn't start.") });
    expect(await session.send("hello")).toMatchObject({ error: { code: "agent_failed", message: `Claude's agent adapter didn't start: Internal error: the CLI didn't start. ${hint}` } });
  });

  it("says the plan's usage limit is reached, from a rejection or the limit's short reply", async () => {
    const rejected = harness({ script: async () => Promise.reject(new RequestError(-32603, "Claude AI usage limit reached|1760000000")) });
    expect(await rejected.send("hello")).toMatchObject({ error: { code: "usage_limit", message: USAGE_LIMIT } });
    const replied = harness({
      script: async (turn) => {
        turn.say("Claude AI usage limit reached. Your limit resets at 5pm.");
        return END;
      },
    });
    expect(await replied.send("hello")).toMatchObject({ outcome: "error", error: { code: "usage_limit" } });
    // A real answer that mentions rate limits is just an answer.
    const answer = harness({
      script: async (turn) => {
        turn.say("Here's a rate limit banner for your settings screen.");
        await turn.tool("toolu_1", "add_layers", { layers: [] });
        return END;
      },
    });
    expect((await answer.send("a rate limit banner")).outcome).toBe("completed");
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

  it("switches the session's model when the adapter offers it, and otherwise says the chat keeps its own", async () => {
    const h = harness({ configOptions: MODEL_OPTIONS });
    await h.send("hi");
    await h.send("hi", { model: "claude-opus-5" });
    await h.send("hi", { model: "claude-opus-5" });
    expect(h.last().configs).toEqual([{ sessionId: "fake-1", configId: "model", value: "claude-opus-5" }]);
    expect(ofType(h.events, "notice")).toEqual([]);

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
    expect(h.agent.status()).toMatchObject({ state: "signed_out", kind: "none", message: expect.stringContaining("Choose Sign in") });
    // While a reply runs, a check doesn't restart the adapter.
    expect(await h.agent.checkSubscription()).toMatchObject({ state: "signed_out" });
    expect(h.agents).toHaveLength(1);
    h.agent.stop("w1");
    await running;
  });

  it("checks with a fresh adapter each time nothing is running, so a login done in Terminal is seen", async () => {
    const h = harness({ auth: SIGNED_OUT });
    expect(await h.agent.checkSubscription()).toMatchObject({ state: "signed_out", adapterVersion: "0.79.0" });
    await h.send("hi");
    h.behavior.auth = ACCOUNT;
    expect(await h.agent.checkSubscription()).toMatchObject({ state: "ready", kind: "account", email: "tyler@example.com" });
    expect(h.agents.map((a) => a.disposed)).toEqual([true, false]);
    // A chat whose session went with the old adapter says so.
    h.events.length = 0;
    await h.send("hi");
    expect(ofType(h.events, "notice").map((n) => n.message)).toEqual([RESTARTED]);

    const quiet = harness({ auth: null }, { authWaitMs: 20 });
    expect(await quiet.agent.checkSubscription()).toMatchObject({ state: "ready", kind: null, label: null });
    const missing = harness({}, { locate: () => ({ ok: false, searched: [] }) });
    expect(await missing.agent.checkSubscription()).toMatchObject({ state: "not_installed", message: NOT_INSTALLED });
    const broken = harness({ startError: new AgentStartError("Sonobe couldn't run ~/bin/claude-agent-acp (EACCES)") });
    expect(await broken.agent.checkSubscription()).toMatchObject({ state: "failed", message: expect.stringContaining("(EACCES)") });
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
