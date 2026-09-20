/**
 * The Assistant on the person's Claude subscription (experimental, off by default, not released until
 * Anthropic agrees): the same engine surface as the API key's agent loop (../agent.ts), over ACP.
 * Sonobe runs Claude's agent adapter as one child process for the app (./process.ts), opens one ACP
 * session per window's chat, and gives each session Sonobe's tools over its own loopback MCP endpoint
 * (./toolServer.ts), revoked with it. Every call there runs through the shared tool runner (../toolRunner.ts) with the
 * chat's current reply, so edits are "Assistant", pinned to the window's document, and pass the
 * replace guard and the delete confirmation as on the API key. The canvas draws a design through
 * preview_design (the adapter doesn't forward a tool's input as it's written).
 *
 * Sonobe never reads Claude credentials: the adapter's Claude Code does its own login, and Sign in
 * opens it in Terminal (./signIn.ts). Sessions are isolated from the person's Claude Code setup: no
 * built-in tools, settings, hooks, CLAUDE.md, plugins or MCP servers of theirs, and nothing saved to
 * resume. Tools that reach outside the window's prototype (ASKING_TOOLS) make Claude Code ask, and the
 * question shows in the chat as a permission card.
 */

import { homedir } from "node:os";
import { RequestError, type ContentBlock, type NewSessionRequest, type PromptResponse, type RequestPermissionRequest, type RequestPermissionResponse, type SessionConfigOption, type SessionNotification, type ToolCallContent, type Usage } from "@agentclientprotocol/sdk";
import type { SonobeDocument } from "@sonobe/core";
import { BUSY_ERROR, messageError, resolveLimits, systemPrompt, type AssistantEngine, type ConversationSnapshot } from "../agent.ts";
import { canvasContextBlock } from "../design.ts";
import type { ReplaceGuard } from "../designGuard.ts";
import { emptyUsage, MODELS, resolveModel, type ModelSpec } from "../models.ts";
import type { AssistantConfirmOption, AssistantError, AssistantEvent, AssistantLimits, AssistantOutcome, AssistantRunResult, AssistantSendRequest, AssistantSignInResult, AssistantSubscriptionStatus, AssistantUsage } from "../protocol.ts";
import { describeToolInput, type AssistantToolInfo, type LocalTools, type ToolBridge, type ToolCallResult } from "../toolBridge.ts";
import { createToolRunner, REPLACE_GUARD, type PreviewDraft, type ReplaceGuardKit, type RunGuards, type ToolRunScope, type WindowDocument } from "../toolRunner.ts";
import { locateClaudeAgent } from "./locate.ts";
import { createAcpAgentProcess } from "./process.ts";
import { startAssistantToolServer, type AssistantToolServer, type ToolServerCallOptions, type ToolServerHandler } from "./toolServer.ts";
import { AgentExitedError, CLAUDE_AGENT_PACKAGE, type AcpAgentProcess, type AgentAuthStatus, type AgentExit, type ClaudeSignInOptions, type CreateAcpAgentProcess, type LocateClaudeAgent, type OpenClaudeSignIn } from "./types.ts";

/** Sonobe's MCP server as the adapter names it, and the prefix Claude Code gives its tools. */
const SERVER_NAME = "sonobe";
const TOOL_PREFIX = `mcp__${SERVER_NAME}__`;

/** Tools that reach outside the window's prototype, so Claude Code asks the person before each (a permission card). */
export const ASKING_TOOLS: ReadonlySet<string> = new Set(["save_document", "open_document", "create_document"]);

const INSTALL = `npm install -g ${CLAUDE_AGENT_PACKAGE}`;
export const NOT_INSTALLED = `Sonobe couldn't find Claude's agent adapter. It needs Node.js 22 or later: in Terminal, run ${INSTALL}, then try again.`;
export const USAGE_LIMIT = "Your Claude plan's usage limit is reached. It resets on its own; try again later, or switch the Assistant to your API key.";
export const RESTARTED = "Claude's adapter restarted, so this reply doesn't remember the earlier messages in this chat.";
export const NO_RUN = "No reply is running in this chat.";
const SIGN_IN_ELSEWHERE = "Run claude-agent-acp --cli auth login in a terminal, then check again.";

/** Not signed in: `then` is what to do after ("send your message again" for a reply, "check again" in setup). */
export function notSignedIn(platform: NodeJS.Platform, then: string): string {
  return `Claude isn't signed in on this computer. ${platform === "darwin" ? `Choose Sign in (it opens Terminal), or run claude auth login in Terminal, then ${then}.` : `Run claude-agent-acp --cli auth login in a terminal, then ${then}.`}`;
}

const notStarted = (reason: string) => `Claude's agent adapter didn't start: ${reason.replace(/\.+$/, "")}. Check that it's installed (${INSTALL}), then try again.`;

const USAGE_LIMIT_TEXT = /usage limit|rate.?limit/i;
/** A reply this short that names a usage limit is the limit's notice, not an answer. */
const USAGE_NOTICE_MAX = 300;
/** ACP's auth_required. */
const AUTH_REQUIRED = -32000;
const STOP_GRACE_MS = 10_000;
const AUTH_WAIT_MS = 8_000;

const PERMISSION_LABELS: Record<AssistantConfirmOption["kind"], string> = { allow_once: "Allow", allow_always: "Allow for this chat", reject_once: "Don't allow", reject_always: "Don't allow in this chat" };
const PERMISSION_WHAT: Record<string, string> = { save_document: "save this prototype", open_document: "open another prototype", create_document: "create a new prototype" };
const CANCELLED: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };

export interface SubscriptionAgentOptions {
  /** The in-process MCP tools for this path (hiding nothing: preview_design stays); throws when Sonobe has no document host yet. */
  tools(): ToolBridge;
  localTools?: LocalTools;
  documentFor?(conversationId: string): Promise<WindowDocument | null>;
  readDocument?(docId: string): Promise<SonobeDocument>;
  /** The linked code folder's name for <canvas_context>, or null. */
  codeFolderName?(conversationId: string): Promise<string | null>;
  limits?: Partial<AssistantLimits>;
  log?(level: "info" | "warn" | "error", message: string): void;
  newId?(): string;
  /** Sonobe's version (ACP clientInfo, CLAUDE_AGENT_SDK_CLIENT_APP). */
  version: string;
  /** The adapter's working folder and every session's cwd: a Sonobe-owned, empty folder (userData/assistant/claude). */
  sessionsDir: string;
  /** Default ./locate.ts. */
  locate?: LocateClaudeAgent;
  /** Default ./process.ts. */
  createProcess?: CreateAcpAgentProcess;
  /** Opens the adapter's sign-in in Terminal (./signIn.ts); without it, signIn() says what to run. */
  signIn?: { open: OpenClaudeSignIn; options: ClaudeSignInOptions };
  /** Default designGuard.ts. */
  replaceGuard?: ReplaceGuardKit;
  /** The environment the adapter starts from. Default process.env. */
  env?: Record<string, string | undefined>;
  /** Default: startAssistantToolServer, started on the first session. */
  toolServer?(): Promise<AssistantToolServer>;
  /** For the not-signed-in copy. Default process.platform. */
  platform?: NodeJS.Platform;
  /** Shown as "~" in permission cards. Default os.homedir(). */
  home?: string;
  /** How long a stopped reply may take to settle before it's finished anyway. Default 10 s. */
  stopGraceMs?: number;
  /** How long checkSubscription waits for the adapter to report the login. Default 8 s. */
  authWaitMs?: number;
}

export interface SubscriptionAgent extends AssistantEngine {
  /** The Claude login the adapter last reported (no check). */
  status(): AssistantSubscriptionStatus;
  /** Start a fresh adapter when nothing is running and read the login it reports. Never throws. */
  checkSubscription(): Promise<AssistantSubscriptionStatus>;
  signIn(): Promise<AssistantSignInResult>;
  /** Stop every reply, close every session, and stop the adapter and the tool endpoint. */
  dispose(): Promise<void>;
}

interface Session {
  id: string;
  process: AcpAgentProcess;
  model: string;
  /** The session's model config option (category "model"), when the adapter offers one. */
  modelOption: { id: string; values: string[] } | null;
  /** A message was sent on it, so losing it loses history. */
  used: boolean;
  off(): void;
}

interface Chip {
  name: string;
  title: string;
  detail: string;
  /** It reached Sonobe's endpoint, so the runner reports how it finished. */
  called: boolean;
  finished: boolean;
}

interface ActiveRun extends RunGuards {
  runId: string;
  controller: AbortController;
  send(event: AssistantEvent): void;
  session: Session | null;
  tools: ReadonlyMap<string, AssistantToolInfo>;
  scope: Omit<ToolRunScope, "signal"> | null;
  turn: number;
  lastMessageId: string | null;
  /** Claude's reply text so far (for the usage limit's notice). */
  text: string;
  chips: Map<string, Chip>;
  /** Tool calls the person didn't allow (or that were cancelled) on a permission card. */
  declined: Set<string>;
  closed: boolean;
}

interface Chat {
  /** Tells a chat from the one that replaces it after New chat. */
  key: string;
  session: Session | null;
  /** Sessions opened, for their endpoints' keys. */
  opened: number;
  opening: Promise<Session> | null;
  /** An earlier session with messages went away (a crash, a restart, a Stop that didn't settle): the next reply says so. */
  lost: boolean;
  /** The tool endpoint of the chat's current (or opening) session: a session given up on can't reach the next one's reply. */
  endpoint: { key: string; url: string; token: string } | null;
  usage: AssistantUsage;
  messageCount: number;
  run: ActiveRun | null;
  guard: ReplaceGuard | null;
  previews: Map<string, PreviewDraft>;
}

/** A failure a run reports as its error. */
class RunFailure extends Error {
  readonly error: AssistantError;
  constructor(error: AssistantError) {
    super(error.message);
    this.name = "RunFailure";
    this.error = error;
  }
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "exit code 7: fake crash: something broke": how the adapter ended and its last stderr line (never a key). */
export function exitDetail(exit: AgentExit): string {
  const how = exit.code !== null ? `exit code ${exit.code}` : exit.signal ? `signal ${exit.signal}` : "no exit code";
  const line = exit.stderrTail
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
  return line ? `${how}: ${clip(line.replace(/sk-ant-\S*/g, "sk-ant-…"), 200)}` : how;
}

export const crashedMessage = (exit: AgentExit) => `Claude's agent adapter stopped unexpectedly (${exitDetail(exit)}). Send your message again to restart it. If it keeps happening, update it: ${INSTALL}@latest`;

/** A tool's name without Claude Code's mcp__sonobe__ prefix. */
function sonobeName(call: { name?: string | null; title?: string | null; _meta?: Record<string, unknown> | null }): string | null {
  const claudeCode = isRecord(call._meta?.claudeCode) ? call._meta.claudeCode : {};
  const raw = call.name ?? (typeof claudeCode.toolName === "string" ? claudeCode.toolName : null) ?? call.title ?? null;
  return raw ? (raw.startsWith(TOOL_PREFIX) ? raw.slice(TOOL_PREFIX.length) : raw) : null;
}

/** The first line of a tool call's text content (ACP's own report of a call that never reached Sonobe). */
function firstLine(content: ToolCallContent[] | null | undefined): string | null {
  for (const item of content ?? []) {
    if (item.type !== "content" || item.content.type !== "text") continue;
    const line = item.content.text.split("\n").find((l) => l.trim());
    if (line) return clip(line.trim(), 140);
  }
  return null;
}

/** The model option of session/new's configOptions, with the values it offers. */
function modelOption(options: SessionConfigOption[] | null | undefined): Session["modelOption"] {
  const option = options?.find((o) => o.category === "model" && o.type === "select") ?? options?.find((o) => o.id === "model" && o.type === "select");
  if (!option || option.type !== "select") return null;
  const values = option.options.flatMap((o) => ("group" in o ? o.options.map((g) => g.value) : [o.value]));
  return { id: option.id, values };
}

/** This reply's usage added to the chat's: the plan's own limits apply, so it costs nothing Sonobe counts. */
function addAcpUsage(totals: AssistantUsage, usage: Usage | null | undefined, turns: number): AssistantUsage {
  const n = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
  const inputTokens = totals.inputTokens + n(usage?.inputTokens);
  const outputTokens = totals.outputTokens + n(usage?.outputTokens);
  const cacheReadTokens = totals.cacheReadTokens + n(usage?.cachedReadTokens);
  const cacheWriteTokens = totals.cacheWriteTokens + n(usage?.cachedWriteTokens);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    budgetTokens: Math.round(inputTokens + outputTokens + cacheWriteTokens * 1.25 + cacheReadTokens * 0.1),
    estimatedCostUsd: 0,
    requests: totals.requests + turns,
  };
}

const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;

/** The choice a confirm() names: its option, else the first allow_once (approved) or reject option. */
function pickOption(options: AssistantConfirmOption[], approved: boolean, optionId: string | undefined): AssistantConfirmOption | null {
  const named = optionId === undefined ? undefined : options.find((o) => o.id === optionId);
  if (named) return named;
  if (approved) return options.find((o) => o.kind === "allow_once") ?? options.find((o) => o.kind === "allow_always") ?? null;
  return options.find((o) => o.kind === "reject_once") ?? options.find((o) => o.kind === "reject_always") ?? null;
}

/** A permission card's title and message: what the call would do, from its input. */
export function permissionPrompt(name: string, title: string, input: Record<string, unknown>, home: string): { title: string; message: string } {
  const shown = (value: unknown) => (typeof value === "string" && value.trim() ? (home && (value === home || value.startsWith(`${home}/`)) ? `~${value.slice(home.length)}` : value.trim()) : null);
  const where = shown(input.path) ?? shown(input.ref);
  const detail = describeToolInput(input);
  const sentence =
    name === "save_document"
      ? `Claude wants to save this prototype${where ? ` to ${where}` : ""}.`
      : name === "open_document"
        ? `Claude wants to open ${where ?? "another prototype"}.`
        : name === "create_document"
          ? `Claude wants to create a new prototype${where ? ` at ${where}` : ""}.`
          : `Claude wants to use ${title}${detail ? ` (${detail})` : ""}.`;
  return { title: `Allow Claude to ${PERMISSION_WHAT[name] ?? `use ${title}`}?`, message: `${sentence} Claude Code asks before steps that reach outside this prototype.` };
}

const UNKNOWN_STATUS: AssistantSubscriptionStatus = { state: "unknown", kind: null, label: null, email: null, adapterVersion: null, message: null };

export function createSubscriptionAgent(options: SubscriptionAgentOptions): SubscriptionAgent {
  const limits = resolveLimits(options.limits);
  const log = options.log ?? (() => undefined);
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const locate = options.locate ?? locateClaudeAgent;
  const createProcess = options.createProcess ?? createAcpAgentProcess;
  const replaceGuard = options.replaceGuard ?? REPLACE_GUARD;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const stopGraceMs = options.stopGraceMs ?? STOP_GRACE_MS;
  const authWaitMs = options.authWaitMs ?? AUTH_WAIT_MS;
  const localTools = options.localTools;
  const chats = new Map<string, Chat>();
  let chatSerial = 0;
  let unnamedCalls = 0;

  let status: AssistantSubscriptionStatus = UNKNOWN_STATUS;
  let proc: AcpAgentProcess | null = null;
  let starting: Promise<AcpAgentProcess> | null = null;
  let checking: Promise<AssistantSubscriptionStatus> | null = null;
  let toolServer: Promise<AssistantToolServer> | null = null;
  let server: AssistantToolServer | null = null;

  const setStatus = (next: Partial<AssistantSubscriptionStatus>) => {
    status = { ...status, ...next };
  };

  const setAuth = (auth: AgentAuthStatus) =>
    setStatus({ state: auth.kind === "none" ? "signed_out" : "ready", kind: auth.kind, label: auth.label, email: auth.email, message: auth.kind === "none" ? notSignedIn(platform, "check again") : null });

  const conversation = (id: string): Chat => {
    let chat = chats.get(id);
    if (!chat) {
      chat = { key: `${id}#${++chatSerial}`, session: null, opened: 0, opening: null, lost: false, endpoint: null, usage: emptyUsage(), messageCount: 0, run: null, guard: null, previews: new Map() };
      chats.set(id, chat);
    }
    return chat;
  };

  const revokeEndpoint = (chat: Chat) => {
    if (chat.endpoint) server?.unregister(chat.endpoint.key);
    chat.endpoint = null;
  };

  /** The chat's session is gone (or given up): its endpoint goes with it, and the next message opens a new one. */
  const loseSession = (chat: Chat, { close }: { close: boolean }) => {
    const session = chat.session;
    if (!session) return;
    chat.session = null;
    chat.lost ||= session.used;
    session.off();
    revokeEndpoint(chat);
    if (close) void session.process.closeSession(session.id);
  };

  const onExit = (p: AcpAgentProcess) => {
    for (const chat of chats.values()) if (chat.session?.process === p) loseSession(chat, { close: false });
    if (proc === p) proc = null;
  };

  /** The adapter's process, started when there's none (one for the app). */
  const ensureProcess = (): Promise<AcpAgentProcess> => {
    if (proc?.alive && !starting) return Promise.resolve(proc);
    return (starting ??= startProcess().finally(() => {
      starting = null;
    }));
  };

  async function startProcess(): Promise<AcpAgentProcess> {
    if (proc?.alive) {
      await proc.ready;
      return proc;
    }
    const found = locate(options.env ? { env: options.env } : {});
    if (!found.ok) {
      log("warn", `Claude's agent adapter isn't installed (looked in ${found.searched.join(", ") || "nowhere"}).`);
      setStatus({ state: "not_installed", kind: null, label: null, email: null, adapterVersion: null, message: NOT_INSTALLED });
      throw new RunFailure({ code: "agent_not_installed", message: NOT_INSTALLED });
    }
    setStatus({ state: "checking", adapterVersion: found.spec.version, message: null });
    const p = createProcess({ spec: found.spec, cwd: options.sessionsDir, ...(options.env ? { baseEnv: options.env } : {}), clientVersion: options.version, log });
    proc = p;
    p.onAuthStatus((auth) => {
      if (proc === p) setAuth(auth);
    });
    void p.exited.then(() => onExit(p));
    try {
      const init = await p.ready;
      // No package.json beside it (a build of its own): the version it reports.
      if (!found.spec.version && init.agentInfo?.version && proc === p) setStatus({ adapterVersion: init.agentInfo.version });
    } catch (err) {
      if (proc === p) proc = null;
      void p.dispose();
      const message = notStarted(err instanceof AgentExitedError ? `it exited before answering (${exitDetail(err.exit)})` : errorMessage(err));
      setStatus({ state: "failed", kind: null, label: null, email: null, message });
      throw new RunFailure({ code: "agent_failed", message });
    }
    if (p.authStatus) setAuth(p.authStatus);
    return p;
  }

  /** The first login the adapter reports, or null after `ms` (or when it exits first). */
  const firstAuth = (p: AcpAgentProcess, ms: number): Promise<AgentAuthStatus | null> =>
    p.authStatus
      ? Promise.resolve(p.authStatus)
      : new Promise((resolve) => {
          let off = () => undefined as void;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const done = (auth: AgentAuthStatus | null) => {
            clearTimeout(timer);
            off();
            resolve(auth);
          };
          timer = setTimeout(() => done(null), ms);
          off = p.onAuthStatus(done);
          void p.exited.then(() => done(null));
        });

  const endpointServer = (): Promise<AssistantToolServer> =>
    (toolServer ??= (options.toolServer ?? (() => startAssistantToolServer({ log, version: options.version })))().then(
      (started) => (server = started),
      (err: unknown) => {
        toolServer = null;
        throw err;
      },
    ));

  const failureOf = (err: unknown, chat: Chat, during: "session" | "prompt"): AssistantError => {
    if (err instanceof RunFailure) return err.error;
    if (err instanceof AgentExitedError) return { code: "agent_crashed", message: crashedMessage(err.exit) };
    if (err instanceof RequestError && err.code === AUTH_REQUIRED) {
      setStatus({ state: "signed_out", kind: "none", label: status.label ?? "Not logged in", email: null, message: notSignedIn(platform, "check again") });
      // A session opened while signed out stays signed out: the next message opens one that reads the login again.
      if (chat.session) {
        chat.session.used = false;
        loseSession(chat, { close: true });
      }
      return { code: "not_signed_in", message: notSignedIn(platform, "send your message again") };
    }
    const message = errorMessage(err);
    if (USAGE_LIMIT_TEXT.test(message)) return { code: "usage_limit", message: USAGE_LIMIT };
    if (during === "session") return { code: "agent_failed", message: notStarted(message) };
    return { code: "unknown", message: `Claude's agent adapter couldn't finish the reply: ${message.replace(/\.+$/, "")}. Send your message again.` };
  };

  /** The chat's side of the tool endpoint. */
  const endpointHandler = (chat: Chat): ToolServerHandler => ({
    tools: async () => [...(await options.tools().tools()), ...(localTools?.infos ?? [])],
    call: (name, args, callOptions) => callFromClaude(chat, name, args, callOptions),
  });

  /** The chip a call belongs to: the tool_use id Claude Code sent, else the oldest announced chip of that tool not called yet. */
  const chipFor = (run: ActiveRun, name: string, toolUseId: string | null): string => {
    if (toolUseId) return toolUseId;
    for (const [id, chip] of run.chips) if (chip.name === name && !chip.called && !chip.finished) return id;
    return `sonobe-${++unnamedCalls}`;
  };

  async function callFromClaude(chat: Chat, name: string, args: Record<string, unknown>, call: ToolServerCallOptions): Promise<ToolCallResult> {
    const run = chat.run;
    if (!run || run.closed || !run.scope || run.controller.signal.aborted) return { content: [{ type: "text", text: NO_RUN }], isError: true };
    const id = chipFor(run, name, call.toolUseId);
    let chip = run.chips.get(id);
    const announce = !chip;
    if (!chip) {
      chip = { name, title: run.tools.get(name)?.title ?? name, detail: describeToolInput(args), called: true, finished: false };
      run.chips.set(id, chip);
    }
    chip.called = true;
    const runner = createToolRunner({ ...run.scope, signal: AbortSignal.any([run.controller.signal, call.signal]) });
    try {
      return await runner.run({ id, name, input: args }, { announce, onProgress: call.onProgress });
    } finally {
      chip.finished = true;
    }
  }

  /** Show a chip for a tool call, or update its title and detail when Claude Code tells more. */
  const announce = (run: ActiveRun, id: string, name: string, rawInput: unknown) => {
    const chip = run.chips.get(id);
    if (chip?.finished) return;
    const title = run.tools.get(name)?.title ?? name;
    const detail = describeToolInput(rawInput);
    if (chip) {
      if (!detail || (detail === chip.detail && title === chip.title)) return;
      Object.assign(chip, { title, detail });
    } else run.chips.set(id, { name, title, detail, called: false, finished: false });
    run.send({ type: "tool_started", runId: run.runId, toolUseId: id, name, title, detail });
  };

  const nextTurn = (run: ActiveRun, messageId: string | null | undefined) => {
    if (!messageId || messageId === run.lastMessageId) return;
    if (run.lastMessageId !== null) run.send({ type: "turn_started", runId: run.runId, turn: ++run.turn });
    run.lastMessageId = messageId;
  };

  function onUpdate(chat: Chat, session: Session, notification: SessionNotification): void {
    const run = chat.run;
    if (!run || run.closed || run.session !== session) return;
    const update = notification.update;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        nextTurn(run, update.messageId);
        if (update.content.type !== "text" || !update.content.text) return;
        if (update.sessionUpdate === "agent_message_chunk") {
          run.text += update.content.text;
          run.send({ type: "text_delta", runId: run.runId, turn: run.turn, delta: update.content.text });
        } else run.send({ type: "thinking_delta", runId: run.runId, turn: run.turn, delta: update.content.text });
        return;
      }
      case "tool_call": {
        const name = sonobeName(update);
        if (name) announce(run, update.toolCallId, name, update.rawInput);
        return;
      }
      case "tool_call_update": {
        const name = sonobeName(update) ?? run.chips.get(update.toolCallId)?.name ?? null;
        if (name && isRecord(update.rawInput) && Object.keys(update.rawInput).length) announce(run, update.toolCallId, name, update.rawInput);
        const chip = run.chips.get(update.toolCallId);
        // A call that reached Sonobe is reported by the runner; this is one Claude Code ended itself.
        if ((update.status === "completed" || update.status === "failed") && chip && !chip.called && !chip.finished) {
          chip.finished = true;
          const declined = run.declined.has(update.toolCallId);
          run.send({ type: "tool_finished", runId: run.runId, toolUseId: update.toolCallId, name: chip.name, status: declined ? "declined" : "error", detail: declined ? "You didn't allow it" : (firstLine(update.content) ?? "Failed"), changedDocument: false });
        }
        return;
      }
      default:
        // usage_update, plan, available_commands_update, current_mode_update, config_option_update, session_info_update, user_message_chunk…
        return;
    }
  }

  async function onPermission(chat: Chat, session: Session, request: RequestPermissionRequest, gone: AbortSignal): Promise<RequestPermissionResponse> {
    const run = chat.run;
    if (!run || run.closed || run.session !== session || run.controller.signal.aborted) return CANCELLED;
    const call = request.toolCall;
    const name = sonobeName(call) ?? run.chips.get(call.toolCallId)?.name ?? "a tool";
    announce(run, call.toolCallId, name, call.rawInput);
    const options = request.options.flatMap((o): AssistantConfirmOption[] => (o.kind in PERMISSION_LABELS ? [{ id: o.optionId, label: PERMISSION_LABELS[o.kind as AssistantConfirmOption["kind"]], kind: o.kind as AssistantConfirmOption["kind"] }] : []));
    if (!options.length) return CANCELLED;
    const prompt = permissionPrompt(name, run.tools.get(name)?.title ?? name, isRecord(call.rawInput) ? call.rawInput : {}, home);
    const confirmationId = newId();
    const signal = run.controller.signal;
    const picked = await new Promise<AssistantConfirmOption | null>((resolve) => {
      const done = (choice: AssistantConfirmOption | null) => {
        if (!run.confirmations.delete(confirmationId)) return;
        signal.removeEventListener("abort", onAbort);
        gone.removeEventListener("abort", onAbort);
        run.send({ type: "confirm_resolved", runId: run.runId, confirmationId, approved: choice?.kind.startsWith("allow") ?? false, ...(choice ? { optionId: choice.id } : {}) });
        resolve(choice);
      };
      // Stop, or the adapter going away, cancels the question rather than answering it.
      const onAbort = () => done(null);
      run.confirmations.set(confirmationId, (approved, optionId) => done(pickOption(options, approved, optionId)));
      signal.addEventListener("abort", onAbort, { once: true });
      gone.addEventListener("abort", onAbort, { once: true });
      run.send({ type: "confirm_required", runId: run.runId, confirmationId, toolUseId: call.toolCallId, title: prompt.title, message: prompt.message, count: 0, kind: "permission", options });
    });
    if (!picked || picked.kind.startsWith("reject")) run.declined.add(call.toolCallId);
    return picked ? { outcome: { outcome: "selected", optionId: picked.id } } : CANCELLED;
  }

  /** The chat's session on `p`: its current one, or a new one with Sonobe's tools, prompt and options. */
  function openSession(conversationId: string, chat: Chat, p: AcpAgentProcess, model: ModelSpec, instructions: string, toolNames: readonly string[]): Promise<Session> {
    if (chat.session && chat.session.process === p && p.alive) return Promise.resolve(chat.session);
    loseSession(chat, { close: true });
    return (chat.opening ??= (async (): Promise<Session> => {
      revokeEndpoint(chat);
      let endpoint: NonNullable<Chat["endpoint"]>;
      try {
        const key = `${chat.key}/${++chat.opened}`;
        endpoint = { key, ...(await endpointServer()).register(key, endpointHandler(chat)) };
      } catch (err) {
        log("error", `The Assistant's tool endpoint didn't start: ${errorMessage(err)}`);
        throw new RunFailure({ code: "unknown", message: `Sonobe couldn't open its tools to Claude: ${errorMessage(err).replace(/\.+$/, "")}. Try again.` });
      }
      chat.endpoint = endpoint;
      const params: NewSessionRequest = {
        cwd: options.sessionsDir,
        mcpServers: [{ type: "http", name: SERVER_NAME, url: endpoint.url, headers: [{ name: "Authorization", value: `Bearer ${endpoint.token}` }] }],
        _meta: {
          // The SDK leaves MCP server instructions out under a custom prompt, so the tool guide rides in it.
          systemPrompt: systemPrompt(instructions, { drawing: "preview" }),
          claudeCode: {
            options: {
              tools: [],
              settingSources: [],
              persistSession: false,
              strictMcpConfig: true,
              model: model.id,
              maxTurns: limits.maxTurns,
              allowedTools: toolNames.filter((name) => !ASKING_TOOLS.has(name)).map((name) => `${TOOL_PREFIX}${name}`),
              env: { ENABLE_TOOL_SEARCH: "false", MCP_TOOL_TIMEOUT: "1800000", CLAUDE_AGENT_SDK_CLIENT_APP: `sonobe/${options.version}` },
            },
          },
        },
      };
      let response: Awaited<ReturnType<AcpAgentProcess["newSession"]>>;
      try {
        response = await p.newSession(params);
      } catch (err) {
        if (chat.endpoint === endpoint) revokeEndpoint(chat);
        throw err;
      }
      // New chat (or the window closing) while it opened: nobody needs it.
      if (chats.get(conversationId) !== chat) {
        server?.unregister(endpoint.key);
        void p.closeSession(response.sessionId);
        throw new RunFailure({ code: "unknown", message: "This chat was closed." });
      }
      const session: Session = { id: response.sessionId, process: p, model: model.id, modelOption: modelOption(response.configOptions), used: false, off: () => undefined };
      const offUpdates = p.onSessionUpdate(session.id, (n) => onUpdate(chat, session, n));
      p.setPermissionHandler(session.id, (req, gone) => onPermission(chat, session, req, gone));
      session.off = () => {
        offUpdates();
        p.setPermissionHandler(session.id, null);
      };
      chat.session = session;
      return session;
    })().finally(() => {
      chat.opening = null;
    }));
  }

  /** Keep the session's model in step with the picker, or say the chat keeps its own. */
  async function matchModel(session: Session, model: ModelSpec, send: (event: AssistantEvent) => void, runId: string): Promise<void> {
    if (session.model === model.id) return;
    const option = session.modelOption;
    if (option?.values.includes(model.id)) {
      try {
        await session.process.setSessionConfigOption({ sessionId: session.id, configId: option.id, value: model.id });
        session.model = model.id;
        return;
      } catch (err) {
        if (err instanceof AgentExitedError) throw err;
        log("warn", `Claude's agent adapter didn't switch the model: ${errorMessage(err)}`);
      }
    }
    send({ type: "notice", runId, tone: "info", message: `This chat keeps ${modelLabel(session.model)}. Start a new chat to use ${modelLabel(model.id)}.` });
  }

  const stop = (id: string) => {
    const run = chats.get(id)?.run;
    if (!run || run.closed || run.controller.signal.aborted) return false;
    run.controller.abort();
    return true;
  };

  const drop = (id: string) => {
    const chat = chats.get(id);
    stop(id);
    chats.delete(id);
    if (chat) {
      loseSession(chat, { close: true });
      revokeEndpoint(chat);
    }
    localTools?.forget(id);
  };

  /** Resolves with ABORTED when `signal` aborts first; `promise` goes on (a session still opens for next time). */
  const ABORTED = Symbol("aborted");
  const untilAborted = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> => {
    if (signal.aborted) {
      promise.catch(() => undefined);
      return Promise.resolve(ABORTED);
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => resolve(ABORTED);
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (err: unknown) => {
          signal.removeEventListener("abort", onAbort);
          if (signal.aborted) resolve(ABORTED);
          else reject(err);
        },
      );
    });
  };

  async function run(conversationId: string, request: AssistantSendRequest, emit: (event: AssistantEvent) => void): Promise<AssistantRunResult> {
    const chat = conversation(conversationId);
    const runId = newId();
    const fail = (error: AssistantError): AssistantRunResult => ({ runId, outcome: "error", error, usage: chat.usage });

    if (chat.run) return fail(BUSY_ERROR);
    const text = typeof request?.text === "string" ? request.text.trim() : "";
    const invalid = messageError(text);
    if (invalid) return fail(invalid);
    const model = resolveModel(request.model);

    const active: ActiveRun = {
      runId,
      controller: new AbortController(),
      confirmations: new Map(),
      removedWithoutAsking: 0,
      send: (event) => {
        if (!active.closed) emit(event);
      },
      session: null,
      tools: new Map(),
      scope: null,
      turn: 1,
      lastMessageId: null,
      text: "",
      chips: new Map(),
      declined: new Set(),
      closed: false,
    };
    chat.run = active;
    const { send } = active;
    const signal = active.controller.signal;

    let bridge: ToolBridge;
    let tools: AssistantToolInfo[];
    let instructions: string;
    try {
      bridge = options.tools();
      tools = [...(await bridge.tools()), ...(localTools?.infos ?? [])];
      instructions = await bridge.instructions();
    } catch (err) {
      chat.run = null;
      log("warn", `Assistant tools unavailable: ${errorMessage(err)}`);
      return fail({ code: "no_document", message: "Sonobe's editing tools aren't ready yet. Open a prototype and try again." });
    }
    active.tools = new Map(tools.map((t) => [t.name, t]));
    active.scope = {
      conversationId,
      runId,
      request,
      emit: send,
      bridge,
      ...(localTools ? { localTools } : {}),
      tools: active.tools,
      limits,
      log,
      newId,
      ...(options.documentFor ? { documentFor: options.documentFor } : {}),
      ...(options.readDocument ? { readDocument: options.readDocument } : {}),
      guard: () => (chat.guard ??= replaceGuard.create()),
      guardIfAny: () => chat.guard,
      replaceGuard,
      active,
      previews: chat.previews,
      announce: false,
      readOnlyNoticeSent: { value: false },
    };

    // A message from the canvas's Design with Claude box leads with what the canvas shows.
    const prompt: ContentBlock[] = [{ type: "text", text }];
    if (request.context) {
      let codeFolder: string | null = null;
      try {
        codeFolder = (await options.codeFolderName?.(conversationId)) ?? null;
      } catch (err) {
        log("warn", `Assistant couldn't read the linked code folder: ${errorMessage(err)}`);
      }
      prompt.unshift({ type: "text", text: canvasContextBlock(request.context, { codeFolder }) });
    }

    const finish = (outcome: AssistantOutcome, error?: AssistantError): AssistantRunResult => {
      const result: AssistantRunResult = { runId, outcome, ...(error ? { error } : {}), usage: chat.usage };
      if (active.closed) return result;
      // Chips Claude Code never finished: the reply ended under them.
      for (const [toolUseId, chip] of active.chips) {
        if (chip.finished) continue;
        chip.finished = true;
        send({ type: "tool_finished", runId, toolUseId, name: chip.name, status: chip.called ? "error" : "skipped", detail: chip.called ? "Stopped" : "Not run", changedDocument: false });
      }
      send({ type: "run_finished", runId, outcome, ...(error ? { error } : {}), usage: chat.usage });
      active.closed = true;
      if (chat.run === active) chat.run = null;
      return result;
    };

    send({ type: "run_started", runId, model: model.id, provider: "subscription" });
    chat.messageCount++;
    // The session that knew this chat's earlier messages is gone (a crash, a restart, a Stop that didn't settle).
    if (chat.lost || (chat.session?.used && (chat.session.process !== proc || !chat.session.process.alive))) {
      chat.lost = false;
      send({ type: "notice", runId, tone: "info", message: RESTARTED });
    }
    send({ type: "turn_started", runId, turn: 1 });

    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const p = await untilAborted(ensureProcess(), signal);
      if (p === ABORTED) return finish("stopped");
      let session: Session | typeof ABORTED;
      try {
        session = await untilAborted(openSession(conversationId, chat, p, model, instructions, tools.map((t) => t.name)), signal);
      } catch (err) {
        return finish("error", failureOf(err, chat, "session"));
      }
      if (session === ABORTED) return finish("stopped");
      await matchModel(session, model, send, runId);
      if (signal.aborted) return finish("stopped");

      active.session = session;
      session.used = true;
      const prompting = session.process.prompt({ sessionId: session.id, prompt });
      // Stop cancels the prompt; one that hasn't settled STOP_GRACE_MS later is given up.
      const gaveUp = new Promise<"gave_up">((resolve) => {
        const onStop = () => {
          void session.process.cancel(session.id);
          stopTimer = setTimeout(() => resolve("gave_up"), stopGraceMs);
        };
        if (signal.aborted) onStop();
        else signal.addEventListener("abort", onStop, { once: true });
      });
      const settled = await Promise.race([prompting.then((response): { response: PromptResponse } => ({ response }), (error: unknown): { error: unknown } => ({ error })), gaveUp]);
      if (settled === "gave_up") {
        log("warn", `Claude's agent adapter didn't stop within ${Math.round(stopGraceMs / 1000)} s, so its session was given up.`);
        loseSession(chat, { close: true });
        return finish("stopped");
      }
      if ("error" in settled) return signal.aborted ? finish("stopped") : finish("error", failureOf(settled.error, chat, "prompt"));

      const { response } = settled;
      chat.usage = addAcpUsage(chat.usage, response.usage, active.turn);
      send({ type: "usage", runId, usage: chat.usage, limits });
      if (status.state === "checking") setStatus({ state: "ready" });
      if (signal.aborted || response.stopReason === "cancelled") return finish("stopped");
      const said = active.text.trim();
      switch (response.stopReason) {
        case "max_tokens":
          if (said) chat.messageCount++;
          send({ type: "notice", runId, tone: "warn", message: "The reply reached the length limit and was cut off." });
          return finish("max_tokens");
        case "max_turn_requests":
          send({ type: "notice", runId, tone: "info", message: `The Assistant paused after ${limits.maxTurns} steps. Send a message (like “keep going”) to continue.` });
          return finish("max_turns");
        case "refusal":
          send({ type: "notice", runId, tone: "warn", message: "Claude declined this request. Try rephrasing what you'd like to build." });
          return finish("refusal");
        default:
          if (said.length <= USAGE_NOTICE_MAX && USAGE_LIMIT_TEXT.test(said) && active.chips.size === 0) return finish("error", { code: "usage_limit", message: USAGE_LIMIT });
          chat.messageCount++;
          return finish("completed");
      }
    } catch (err) {
      if (err instanceof RunFailure || err instanceof AgentExitedError) return finish("error", failureOf(err, chat, "prompt"));
      log("error", `Assistant run failed: ${errorMessage(err)}`);
      return finish("error", { code: "unknown", message: errorMessage(err) });
    } finally {
      clearTimeout(stopTimer);
      for (const settle of [...active.confirmations.values()]) settle(false);
      if (!active.closed) finish("stopped");
    }
  }

  return {
    limits,
    run,
    stop,
    reset: drop,
    forget: drop,
    confirm(id, confirmationId, approved, optionId) {
      const settle = chats.get(id)?.run?.confirmations.get(confirmationId);
      if (!settle) return false;
      settle(approved === true, typeof optionId === "string" ? optionId : undefined);
      return true;
    },
    snapshot(id): ConversationSnapshot {
      const chat = chats.get(id);
      return chat ? { usage: chat.usage, running: chat.run !== null, messageCount: chat.messageCount } : { usage: emptyUsage(), running: false, messageCount: 0 };
    },
    status: () => status,
    checkSubscription() {
      if ([...chats.values()].some((chat) => chat.run)) return Promise.resolve(status);
      return (checking ??= (async () => {
        try {
          // A fresh adapter reads the login again (one done in Terminal since).
          const old = proc;
          proc = null;
          if (old) {
            onExit(old);
            await old.dispose();
          }
          setStatus({ state: "checking", message: null });
          const p = await ensureProcess();
          const auth = await firstAuth(p, authWaitMs);
          if (auth) setAuth(auth);
          else if (p.alive) setStatus({ state: "ready", kind: null, label: null, email: null, message: null });
        } catch (err) {
          if (!(err instanceof RunFailure)) {
            log("error", `Checking Claude's agent adapter failed: ${errorMessage(err)}`);
            setStatus({ state: "failed", message: notStarted(errorMessage(err)) });
          }
        }
        return status;
      })().finally(() => {
        checking = null;
      }));
    },
    async signIn() {
      const found = locate(options.env ? { env: options.env } : {});
      if (!found.ok) {
        setStatus({ state: "not_installed", kind: null, label: null, email: null, adapterVersion: null, message: NOT_INSTALLED });
        return { ok: false, error: NOT_INSTALLED };
      }
      if (!options.signIn) return { ok: false, error: SIGN_IN_ELSEWHERE };
      try {
        return await options.signIn.open(found.spec, options.signIn.options);
      } catch (err) {
        log("warn", `Sonobe couldn't open Claude's sign-in: ${errorMessage(err)}`);
        return { ok: false, error: `Sonobe couldn't open Terminal: ${errorMessage(err).replace(/\.+$/, "")}. ${SIGN_IN_ELSEWHERE}` };
      }
    },
    async dispose() {
      for (const id of [...chats.keys()]) drop(id);
      const p = proc;
      proc = null;
      await p?.dispose();
      const started = await toolServer?.catch(() => null);
      toolServer = null;
      server = null;
      await started?.close();
    },
  };
}
