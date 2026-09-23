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
 * built-in tools, and no settings, hooks, CLAUDE.md, plugins or MCP servers of theirs in Claude Code,
 * and nothing saved to resume. The adapter still reads their settings itself for the permission mode a
 * session starts in, so each session is put back in Claude Code's "default" mode, which asks. Tools that reach outside the window's prototype (ASKING_TOOLS) then make
 * Claude Code ask, and the question shows in the chat as a permission card; Sonobe asks the same
 * question itself when one of them reaches its endpoint without an answer. The endpoint runs only the
 * tool calls Claude announced on the ACP stream.
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { RequestError, type ContentBlock, type NewSessionRequest, type NewSessionResponse, type PromptResponse, type RequestPermissionRequest, type RequestPermissionResponse, type SessionConfigOption, type SessionNotification, type ToolCallContent, type Usage } from "@agentclientprotocol/sdk";
import type { SonobeDocument } from "@sonobe/core";
import { BUSY_ERROR, messageError, resolveLimits, systemPrompt, type AssistantEngine, type ConversationSnapshot } from "../agent.ts";
import { canvasContextBlock } from "../design.ts";
import type { ReplaceGuard } from "../designGuard.ts";
import { emptyUsage, MODELS, resolveModel, type ModelSpec } from "../models.ts";
import type { AssistantConfirmOption, AssistantError, AssistantEvent, AssistantLimits, AssistantOutcome, AssistantRunResult, AssistantSendRequest, AssistantSignInResult, AssistantSubscriptionStatus, AssistantUsage } from "../protocol.ts";
import { describeToolInput, type AssistantToolInfo, type LocalTools, type ToolBridge, type ToolCallResult } from "../toolBridge.ts";
import { createToolRunner, REPLACE_GUARD, type PreviewDraft, type ReplaceGuardKit, type RunGuards, type ToolRunScope, type WindowDocument } from "../toolRunner.ts";
import { locateClaudeAgent } from "./locate.ts";
import { agentEnvironment, createAcpAgentProcess, detailsOf, messageOf } from "./process.ts";
import { startAssistantToolServer, type AssistantToolServer, type ToolServerCallOptions, type ToolServerHandler } from "./toolServer.ts";
import { AgentExitedError, CLAUDE_AGENT_PACKAGE, type AcpAgentProcess, type AgentAuthStatus, type AgentExit, type ClaudeAgentSpec, type ClaudeSignInOptions, type CreateAcpAgentProcess, type LocateClaudeAgent, type OpenClaudeSignIn } from "./types.ts";

/** Sonobe's MCP server as the adapter names it, and the prefix Claude Code gives its tools. */
const SERVER_NAME = "sonobe";
const TOOL_PREFIX = `mcp__${SERVER_NAME}__`;

/** Tools that reach outside the window's prototype, so Claude Code asks the person before each (a permission card). */
export const ASKING_TOOLS: ReadonlySet<string> = new Set(["save_document", "open_document", "create_document"]);

const INSTALL = `npm install -g ${CLAUDE_AGENT_PACKAGE}`;
const UPDATE = `update the adapter: ${INSTALL}@latest`;
export const NOT_INSTALLED = `Sonobe couldn't find Claude's agent adapter. It needs Node.js 22 or later: in Terminal, run ${INSTALL}, then try again.`;
export const RATE_LIMITED = "Claude is limiting requests right now (not your plan's usage limit). Wait a minute, then send your message again.";
export const RESTARTED = "Claude's adapter restarted, so this reply doesn't remember the earlier messages in this chat.";
export const SESSION_ENDED = `Claude Code stopped unexpectedly during this reply. Send your message again to restart it; it won't remember the earlier messages in this chat. If it keeps happening, ${UPDATE}`;
export const MODE_NOT_SET = `Sonobe couldn't set Claude Code to ask before it saves or opens files, so nothing ran. Try again; if it keeps happening, ${UPDATE}`;
export const NO_RUN = "No reply is running in this chat.";
/** A tools/call no tool_call on the chat's ACP stream announced. */
export const UNANNOUNCED = "Sonobe only runs tools Claude asked for in this chat.";
const SIGN_IN_ELSEWHERE = "Run claude-agent-acp --cli auth login in a terminal, then check again.";
/** A reply still waiting for an adapter when the switch went off (it was stopped too, so this is rarely seen). */
const SHUT_DOWN = "Sonobe stopped Claude's agent adapter because the Claude subscription was turned off in Settings → Claude.";

/** Not signed in: `then` is what to do after ("send your message again" for a reply, "choose Check again" in setup). */
export function notSignedIn(platform: NodeJS.Platform, then: string): string {
  return `Claude isn't signed in on this computer. ${platform === "darwin" ? `Choose Sign in… (it opens Terminal), or run claude-agent-acp --cli auth login in Terminal, then ${then}.` : `In a terminal, run claude-agent-acp --cli auth login, then ${then}.`}`;
}

/** The plan's usage limit, quoting the CLI's own notice ("You've hit your limit · resets 3pm") when there is one. */
export function usageLimitMessage(notice: string | null): string {
  return `Your Claude plan's usage limit is reached${notice ? ` (“${notice}”)` : ""}. Try again once it resets, or switch the Assistant to your API key.`;
}

/** A billing error or an account on hold, quoting the CLI's text: unlike the plan's limit, it doesn't reset on its own. */
export function accountBlockedMessage(notice: string | null): string {
  return `Your Claude account can't take more requests right now${notice ? ` (“${notice}”)` : ""}. Check your plan or billing at claude.ai, or switch the Assistant to your API key.`;
}

/** An organization that doesn't allow its members' Claude plans in Claude Code, quoting the CLI's text. */
export function orgNotAllowedMessage(notice: string | null): string {
  return `Your organization doesn't allow Claude subscription use in Claude Code${notice ? ` (“${notice}”)` : ""}, so signing in again won't help. Ask your organization's admin, or switch the Assistant to your API key.`;
}

const notStarted = (reason: string) => `Claude's agent adapter didn't start: ${reason.replace(/\.+$/, "")}. Check that it's installed (${INSTALL}), then try again.`;

/**
 * How Claude Code's notice of a plan's usage limit starts: USAGE_LIMIT_ERROR_PREFIXES in
 * @anthropic-ai/claude-agent-sdk 0.3.274 (sdk.d.ts), which claude-agent-acp 0.79.0 matches the same way
 * (session-failure-extension.js). A transient 429 ("not your usage limit") starts with none of them.
 */
const USAGE_LIMIT_PREFIXES = [
  "You've hit your",
  "You've reached your",
  "You're out of usage credits",
  "Your org is out of usage · add funds to continue",
  "Your org is out of usage · contact your admin",
  "Your seat type doesn't include usage credits",
  "Your seat type doesn't include usage",
  "Your usage allocation has been disabled by your admin",
  "Your group's usage limit is set to $0",
  "Fable 5 requires usage credits",
  "You're out of extra usage",
  "Your seat type doesn't include extra usage",
] as const;
/**
 * The guide names Sonobe's tools without Claude Code's prefix ("get_outline"), and Claude sometimes calls one
 * that way. Claude Code has no tool of that name, and a call to one comes with no schema to follow, so its
 * numbers and booleans arrive as strings: say what the tools are called here.
 */
export const TOOL_NAMES_NOTE = `In this app your Sonobe tools are named ${TOOL_PREFIX}<tool>: ${TOOL_PREFIX}get_outline, ${TOOL_PREFIX}preview_design, ${TOOL_PREFIX}import_design and so on. The guide below writes them without that prefix; always call them by their full ${TOOL_PREFIX} names.`;

/** The subscription's system prompt: the API key's, with the preview drawing guide and the tools' names as Claude Code gives them. */
export const subscriptionPrompt = (instructions: string): string => systemPrompt(`${TOOL_NAMES_NOTE}\n${instructions}`, { drawing: "preview" });

/** The adapter's error kinds (RequestError data.errorKind) that mean the account can't pay for more: no credit left, or on hold. */
const PLAN_ERROR_KINDS: ReadonlySet<string> = new Set(["billing_error", "account_on_hold"]);
/**
 * The adapter's error kind for a login Claude Code couldn't use (an OAuth token that expired or was
 * revoked). It sends it as an internal error, not auth_required, when the CLI's text doesn't say
 * "Please run /login", which it never does under the SDK.
 */
const LOGIN_FAILED_KIND = "authentication_failed";
/** The adapter's error kind for an organization that doesn't allow its members' Claude plans in Claude Code: signing in again or resending won't help. */
const ORG_NOT_ALLOWED_KIND = "oauth_org_not_allowed";
/** How long a reason from the adapter may be in a message. */
const REASON_MAX = 200;
/** A reply this short that starts like a usage-limit notice is the notice, not an answer. */
const USAGE_NOTICE_MAX = 300;
/** How the adapter says it ended a session while it keeps running (its Claude Code died, or the session's stream closed). */
const SESSION_ENDED_TEXT = /process exited unexpectedly|session has ended|session not found/i;
/** ACP's auth_required. */
const AUTH_REQUIRED = -32000;
const STOP_GRACE_MS = 10_000;
const AUTH_WAIT_MS = 8_000;
/** How long a tools/call that got here before its tool_call notification waits for it. */
const ANNOUNCE_WAIT_MS = 2_000;
const HEARTBEAT_MS = 10_000;
const WAITING = "Waiting for your answer in Sonobe";
/** Claude Code's permission mode that asks before a tool outside allowedTools ("Manual"). */
const ASKING_MODE = "default";
/** The longest path or name a permission card quotes. */
const QUOTED_MAX = 120;

const PERMISSION_LABELS: Record<AssistantConfirmOption["kind"], string> = { allow_once: "Allow", allow_always: "Allow for this chat", reject_once: "Don't allow", reject_always: "Don't allow in this chat" };
const PERMISSION_WHAT: Record<string, string> = { save_document: "save this prototype", open_document: "open another prototype", create_document: "create a new prototype" };
/** Sonobe's own permission card, for an asking tool Claude Code ran without asking. */
const OWN_OPTIONS: AssistantConfirmOption[] = [
  { id: "sonobe-allow-once", label: PERMISSION_LABELS.allow_once, kind: "allow_once" },
  { id: "sonobe-allow-always", label: PERMISSION_LABELS.allow_always, kind: "allow_always" },
  { id: "sonobe-reject", label: PERMISSION_LABELS.reject_once, kind: "reject_once" },
];
/** A card's choices for a call "Allow for this chat" can't cover (a forced save): allow_always left out, when there's another way to allow it. */
const onceOnly = (options: AssistantConfirmOption[]) => (options.some((o) => o.kind === "allow_once") ? options.filter((o) => o.kind !== "allow_always") : options);
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
  /** The login a one-off `<adapter> --cli auth status --json` reports (checkSubscription while chats have sessions). Default readCliLogin. */
  readLogin?(spec: ClaudeAgentSpec, options: CliLoginOptions): Promise<AgentAuthStatus | null>;
  /** How long a tool call that reaches the endpoint before its ACP tool_call waits for it. Default 2 s. */
  announceWaitMs?: number;
  /** How often a call waiting on Sonobe's own permission card tells Claude Code it's alive. Default 10 s. */
  heartbeatMs?: number;
}

export interface SubscriptionAgent extends AssistantEngine {
  /** The Claude login the adapter last reported (no check). */
  status(): AssistantSubscriptionStatus;
  /**
   * Read the Claude login again. With no chat on the adapter, start a fresh one (it reads the login
   * afresh); otherwise ask Claude Code with a one-off `--cli auth status`, leaving the chats' sessions be.
   * Never throws, and never returns "checking".
   */
  checkSubscription(): Promise<AssistantSubscriptionStatus>;
  signIn(): Promise<AssistantSignInResult>;
  /** The switch went off: stop every reply, close every session and revoke its endpoint, and stop the adapter. Chats keep their transcripts and usage; the engine stays usable. */
  shutdown(): Promise<void>;
  /** Stop every reply, close every session, and stop the adapter and the tool endpoint. */
  dispose(): Promise<void>;
}

interface Session {
  id: string;
  process: AcpAgentProcess;
  model: string;
  /** The session's model config option (category "model"), when the adapter offers one. */
  modelOption: { id: string; values: string[] } | null;
  /** Asking tools the person allowed for this chat ("Allow for this chat"), which Claude Code no longer asks about. */
  allowed: Set<string>;
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
  /** The person allowed it on Claude Code's permission card. */
  permitted: boolean;
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
  /** Tool calls waiting for their chip (a tools/call that got here before its tool_call): woken on each new chip. */
  chipWaiters: Set<() => void>;
  /** Tool calls the person didn't allow (or that were cancelled) on a permission card. */
  declined: Set<string>;
  /** The reply has started: text, thinking or a tool call arrived. */
  replied: boolean;
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

/** A key never goes into copy or the log. */
const redact = (text: string) => text.replace(/sk-ant-\S*/g, "sk-ant-…");

/**
 * stderr lines that never say what went wrong: Node's version footer, stack frames, carets, Node's
 * hints, the adapter's timing lines, V8's banners around a fatal error, and what process.ts left out.
 */
const STDERR_NOISE = [/^Node\.js v\d/, /^at\s/, /^\^+$/, /^\(Use `node --trace-/, /^\[session\//, /^<--- .* --->$/, /^-+ Native stack trace -+$/, /^\[left out: /];
/** A frame of Node's native stack trace (" 1: 0x1028ff10c node::OOMErrorHandler(…)"), which names no reason even when it says "Error". */
const NATIVE_FRAME = [/^\d+: 0x[0-9a-f]+ /i, /\bnode::|\bv8::/];
/** V8's own reason for a fatal error: "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory". */
const OUT_OF_MEMORY = /out of memory|\bheap\b/i;

/**
 * "exit code 7: fake crash: something broke": how the adapter ended and its most telling stderr line
 * (never a key): the last one saying it ran out of memory, else the last naming an error, else the
 * last that isn't noise. Native stack frames never count.
 */
export function exitDetail(exit: AgentExit): string {
  const how = exit.code !== null ? `exit code ${exit.code}` : exit.signal ? `signal ${exit.signal}` : "no exit code";
  const lines = exit.stderrTail
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !NATIVE_FRAME.some((frame) => frame.test(l)));
  const telling = lines.filter((l) => !STDERR_NOISE.some((noise) => noise.test(l)));
  const line = telling.findLast((l) => OUT_OF_MEMORY.test(l)) ?? telling.findLast((l) => /Error|Exception/.test(l)) ?? telling.at(-1) ?? lines.at(-1);
  return line ? `${how}: ${clip(redact(line), 200)}` : how;
}

export const crashedMessage = (exit: AgentExit) => `Claude's agent adapter stopped unexpectedly (${exitDetail(exit)}). Send your message again to restart it. If it keeps happening, update it: ${INSTALL}@latest`;

/** The adapter's own notice text from an error message: "Internal error: You've hit your limit" → "You've hit your limit". */
const noticeOf = (message: string) => message.replace(/^Internal error(?::\s*|$)/i, "").trim();
const isUsageLimitNotice = (text: string) => USAGE_LIMIT_PREFIXES.some((prefix) => text.startsWith(prefix));
const errorKindOf = (err: unknown) => (err instanceof RequestError && isRecord(err.data) && typeof err.data.errorKind === "string" ? err.data.errorKind : null);

/**
 * What went wrong, from an error the adapter sent, for the person (never a key). A plain Error in the
 * adapter reaches Sonobe as -32603 "Internal error" with its text in data.details ("Claude Code
 * executable not found at …"): that's the reason, not the bare "Internal error". Empty when the error
 * says nothing more.
 */
function reasonOf(err: unknown): string {
  const notice = noticeOf(err instanceof Error ? err.message : String(err));
  const details = detailsOf(err)?.trim() ?? "";
  return redact(details && !notice.includes(details) ? (notice ? `${notice}: ${details}` : details) : notice);
}

/** The reason as a message quotes it: clipped, and the error's own message when it gave none. */
const reasonText = (err: unknown, reason: string) => clip(reason || redact(err instanceof Error ? err.message : String(err)), REASON_MAX);

/** The adapter ended the session but keeps running: its Claude Code died, or the session's stream closed, so the session is gone. */
function sessionEnded(err: unknown): boolean {
  if (!(err instanceof RequestError)) return false;
  return SESSION_ENDED_TEXT.test(err.message) || (isRecord(err.data) && typeof err.data.details === "string" && SESSION_ENDED_TEXT.test(err.data.details));
}

/** A tool's name without Claude Code's mcp__sonobe__ prefix. */
function sonobeName(call: { name?: string | null; title?: string | null; _meta?: Record<string, unknown> | null }): string | null {
  const claudeCode = isRecord(call._meta?.claudeCode) ? call._meta.claudeCode : {};
  const raw = call.name ?? (typeof claudeCode.toolName === "string" ? claudeCode.toolName : null) ?? call.title ?? null;
  return raw ? (raw.startsWith(TOOL_PREFIX) ? raw.slice(TOOL_PREFIX.length) : raw) : null;
}

/** A tool call's text content (ACP's own report of a call that never reached Sonobe). */
function contentText(content: ToolCallContent[] | null | undefined): string {
  return (content ?? []).flatMap((item) => (item.type === "content" && item.content.type === "text" ? [item.content.text] : [])).join("\n");
}

/** Its first line that says something: Claude Code wraps errors in a ``` fence. */
function firstLine(content: ToolCallContent[] | null | undefined): string | null {
  const line = contentText(content)
    .split("\n")
    .find((l) => l.trim() && !/^```\w*$/.test(l.trim()));
  return line ? clip(line.trim(), 140) : null;
}

/** The model option of session/new's configOptions, with the values it offers. */
function modelOption(options: SessionConfigOption[] | null | undefined): Session["modelOption"] {
  const option = options?.find((o) => o.category === "model" && o.type === "select") ?? options?.find((o) => o.id === "model" && o.type === "select");
  if (!option || option.type !== "select") return null;
  const values = option.options.flatMap((o) => ("group" in o ? o.options.map((g) => g.value) : [o.value]));
  return { id: option.id, values };
}

/**
 * The model option's value for a Sonobe model id: the id itself when offered, else its family's alias.
 * The real adapter offers aliases ("default", "opus[1m]", "sonnet", "sonnet[1m]", "haiku"), not model ids.
 */
export function modelValue(values: readonly string[], modelId: string): string | null {
  if (values.includes(modelId)) return modelId;
  const family = /\b(opus|sonnet|haiku)\b/i.exec(modelId)?.[1]?.toLowerCase();
  if (!family) return null;
  return values.find((v) => v.toLowerCase() === family) ?? values.find((v) => v.toLowerCase().startsWith(family)) ?? null;
}

/** The session's permission mode, from session/new's modes or its "mode" config option (null when the adapter has none). */
function modeOption(response: Pick<NewSessionResponse, "modes" | "configOptions">): { option: { id: string } | null; current: string[] } {
  const options = response.configOptions ?? [];
  const option = options.find((o) => o.id === "mode" && o.type === "select") ?? options.find((o) => o.category === "mode" && o.type === "select") ?? null;
  const current = [response.modes?.currentModeId, option?.type === "select" ? option.currentValue : undefined].filter((mode): mode is string => typeof mode === "string");
  return { option, current };
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

/** `text` at most `max` characters, cut in the middle: a path's end says where it really goes. */
const clipMiddle = (text: string, max: number) => {
  if (text.length <= max) return text;
  const head = Math.floor((max - 1) / 3);
  return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`;
};

/**
 * A path or name from Claude's input as a permission card quotes it: one line, "~" for home, ".."
 * resolved, at most 120 characters, in curly quotes, so it can't pass for the card's own words.
 */
export function quotedInput(value: unknown, home: string): string | null {
  if (typeof value !== "string") return null;
  let text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (home && (text === "~" || text.startsWith("~/"))) text = `${home}${text.slice(1)}`;
  if (path.isAbsolute(text)) text = path.normalize(text);
  if (home && (text === home || text.startsWith(`${home}${path.sep}`))) text = `~${text.slice(home.length)}`;
  return `“${clipMiddle(text, QUOTED_MAX)}”`;
}

/**
 * save_document with force: it writes over changes made to the project outside Sonobe, and they're
 * lost. So it always asks, and "Allow for this chat" never covers it.
 */
export const isForcedSave = (name: string, input: unknown) => name === "save_document" && isRecord(input) && input.force === true;

/** A permission card's title and message: what the call would do, from its input. */
export function permissionPrompt(name: string, title: string, input: Record<string, unknown>, home: string): { title: string; message: string } {
  const where = quotedInput(input.path, home) ?? quotedInput(input.ref, home);
  const detail = describeToolInput(input);
  if (isForcedSave(name, input)) {
    const sentence = `Claude wants to save this prototype${where ? ` to ${where}` : ""} over changes made to the project outside Sonobe since it was opened or last saved. Those changes will be lost.`;
    return { title: "Allow Claude to save over outside changes?", message: `${sentence} Claude Code asks before steps that reach outside this prototype.` };
  }
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

const EXTERNAL_PROVIDERS: Record<string, string> = { bedrock: "AWS Bedrock", vertex: "Google Vertex AI", foundry: "Azure AI Foundry", anthropicAws: "Anthropic on AWS", anthropicGoogleCloud: "Anthropic on Google Cloud", mantle: "Mantle" };

/** `claude auth status --json`'s stdout as Sonobe keeps a login, mapped like the adapter's fromCliStatus (auth-status.js, 0.79.0); null when it isn't that JSON. */
export function parseCliLogin(stdout: string): AgentAuthStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.loggedIn !== "boolean") return null;
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  const provider = text(parsed.apiProvider);
  const keySource = text(parsed.apiKeySource);
  const plan = text(parsed.subscriptionType);
  const none: AgentAuthStatus = { kind: "none", label: "Not logged in", email: null, plan: null, detail: null };
  if (provider === "gateway") return { kind: "gateway", label: "Custom model gateway", email: null, plan: null, detail: null };
  // A cloud backend (Bedrock, Vertex, …) keeps its credentials outside Claude Code, so loggedIn is false there.
  if (provider && provider !== "firstParty") return { kind: "external", label: EXTERNAL_PROVIDERS[provider] ?? provider, email: null, plan: null, detail: null };
  if (!parsed.loggedIn && !keySource) return none;
  if (keySource) return { kind: "api_key", label: "Anthropic API key", email: null, plan: null, detail: keySource };
  if (!plan) return none;
  const titled = plan.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
  return { kind: "account", label: /^claude(\s|$)/i.test(plan) ? titled : `Claude ${titled}`, email: text(parsed.email), plan, detail: null };
}

/** How a one-off `--cli auth status` runs: the adapter's environment, and its folder. */
export interface CliLoginOptions {
  env: Record<string, string>;
  /** The sessions folder, as for the adapter: Claude Code reads project settings (an apiKeyHelper, an env) from its cwd. */
  cwd: string;
  timeoutMs: number;
}

/** The login Claude Code reports to a one-off `<adapter> --cli auth status --json` (no ACP, no session), or null when it can't tell in time. */
export function readCliLogin(spec: ClaudeAgentSpec, { env, cwd, timeoutMs }: CliLoginOptions): Promise<AgentAuthStatus | null> {
  return new Promise((resolve) => {
    // Signed out, the CLI exits 1 and still prints its JSON.
    execFile(spec.command, [...spec.args, "--cli", "auth", "status", "--json"], { cwd, env, timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (_err, stdout) => resolve(parseCliLogin(String(stdout ?? ""))));
  });
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
  const readLogin = options.readLogin ?? readCliLogin;
  const announceWaitMs = options.announceWaitMs ?? ANNOUNCE_WAIT_MS;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const localTools = options.localTools;
  const chats = new Map<string, Chat>();
  let chatSerial = 0;

  let status: AssistantSubscriptionStatus = UNKNOWN_STATUS;
  let proc: AcpAgentProcess | null = null;
  let starting: Promise<AcpAgentProcess> | null = null;
  /** Counts shutdowns: an adapter that finishes starting after one isn't wanted. */
  let epoch = 0;
  let checking: Promise<AssistantSubscriptionStatus> | null = null;
  let toolServer: Promise<AssistantToolServer> | null = null;
  let server: AssistantToolServer | null = null;

  const setStatus = (next: Partial<AssistantSubscriptionStatus>) => {
    status = { ...status, ...next };
  };

  const setAuth = (auth: AgentAuthStatus) =>
    setStatus({ state: auth.kind === "none" ? "signed_out" : "ready", kind: auth.kind, label: auth.label, email: auth.email, message: auth.kind === "none" ? notSignedIn(platform, "choose Check again") : null });

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

  const onExit = (p: AcpAgentProcess, exit?: AgentExit) => {
    for (const chat of chats.values()) if (chat.session?.process === p) loseSession(chat, { close: false });
    if (proc !== p) return;
    proc = null;
    // It went before it reported a login: say so, rather than "checking" with no way out.
    if (status.state === "checking" && exit) setStatus({ state: "failed", kind: null, label: null, email: null, message: notStarted(`it exited (${exitDetail(exit)})`) });
  };

  /** The adapter's process, started when there's none (one for the app). */
  const ensureProcess = (): Promise<AcpAgentProcess> => {
    if (proc?.alive && !starting) return Promise.resolve(proc);
    if (!starting) {
      const start: Promise<AcpAgentProcess> = startProcess().finally(() => {
        if (starting === start) starting = null;
      });
      starting = start;
    }
    return starting;
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
    const started = epoch;
    setStatus({ state: "checking", adapterVersion: found.spec.version, message: null });
    const p = createProcess({ spec: found.spec, cwd: options.sessionsDir, ...(options.env ? { baseEnv: options.env } : {}), clientVersion: options.version, log });
    proc = p;
    p.onAuthStatus((auth) => {
      if (proc === p) setAuth(auth);
    });
    void p.exited.then((exit) => onExit(p, exit));
    try {
      const init = await p.ready;
      // No package.json beside it (a build of its own): the version it reports.
      if (!found.spec.version && init.agentInfo?.version && proc === p) setStatus({ adapterVersion: init.agentInfo.version });
    } catch (err) {
      if (proc === p) proc = null;
      void p.dispose();
      if (started !== epoch) throw new RunFailure({ code: "unknown", message: SHUT_DOWN });
      const message = notStarted(err instanceof AgentExitedError ? `it exited before answering (${exitDetail(err.exit)})` : reasonText(err, reasonOf(err)));
      setStatus({ state: "failed", kind: null, label: null, email: null, message });
      throw new RunFailure({ code: "agent_failed", message });
    }
    // The switch went off while it started.
    if (started !== epoch) {
      if (proc === p) proc = null;
      void p.dispose();
      throw new RunFailure({ code: "unknown", message: SHUT_DOWN });
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
    const kind = errorKindOf(err);
    // Signed out (auth_required), or a login Claude Code couldn't use (an expired or revoked token), which it reports as an internal error.
    if (err instanceof RequestError && (err.code === AUTH_REQUIRED || kind === LOGIN_FAILED_KIND)) {
      if (kind === LOGIN_FAILED_KIND) log("warn", `Claude Code couldn't use the Claude login on this computer: ${redact(messageOf(err))}`);
      // Not the last login's plan: the header and the meter stop naming it.
      setStatus({ state: "signed_out", kind: "none", label: "Not logged in", email: null, message: notSignedIn(platform, "choose Check again") });
      // A session opened while signed out stays signed out: the next message opens one that reads the login again.
      if (chat.session) {
        chat.session.used = false;
        loseSession(chat, { close: true });
      }
      return { code: "not_signed_in", message: notSignedIn(platform, "send your message again") };
    }
    // The adapter streams Claude Code's limit notice, then rejects with it as "Internal error: <notice>".
    const reason = reasonOf(err);
    if (isUsageLimitNotice(reason)) return { code: "usage_limit", message: usageLimitMessage(clip(reason, 160)) };
    if (kind !== null && PLAN_ERROR_KINDS.has(kind)) return { code: "usage_limit", message: accountBlockedMessage(reason ? clip(reason, 160) : null) };
    if (kind === "rate_limit") return { code: "rate_limited", message: RATE_LIMITED };
    if (kind === ORG_NOT_ALLOWED_KIND) return { code: "permission_denied", message: orgNotAllowedMessage(reason ? clip(reason, 160) : null) };
    if (during === "session") {
      log("warn", `Claude's agent adapter didn't open a session: ${redact(messageOf(err))}`);
      return { code: "agent_failed", message: notStarted(reasonText(err, reason)) };
    }
    if (sessionEnded(err)) {
      // The adapter lives on without this session: the next message opens a new one (and says it starts over).
      log("warn", `Claude's agent adapter ended this chat's session: ${redact(messageOf(err))}`);
      loseSession(chat, { close: true });
      return { code: "agent_crashed", message: SESSION_ENDED };
    }
    log("warn", `Claude's agent adapter couldn't finish a reply: ${redact(messageOf(err))}`);
    return { code: "unknown", message: `Claude's agent adapter couldn't finish the reply: ${reasonText(err, reason).replace(/\.+$/, "")}. Send your message again.` };
  };

  /** The chat's side of the tool endpoint. */
  const endpointHandler = (chat: Chat): ToolServerHandler => ({
    tools: async () => [...(await options.tools().tools()), ...(localTools?.infos ?? [])],
    call: (name, args, callOptions) => callFromClaude(chat, name, args, callOptions),
  });

  /** The chip `toolUseId` names, waiting up to announceWaitMs for a call that got here before its tool_call notification. */
  const chipOf = (run: ActiveRun, toolUseId: string, signal: AbortSignal): Promise<Chip | null> => {
    const chip = run.chips.get(toolUseId);
    if (chip || signal.aborted) return Promise.resolve(chip ?? null);
    return new Promise((resolve) => {
      const done = (found: Chip | null) => {
        clearTimeout(timer);
        run.chipWaiters.delete(check);
        signal.removeEventListener("abort", onAbort);
        resolve(found);
      };
      const check = () => {
        const found = run.chips.get(toolUseId);
        if (found) done(found);
      };
      const onAbort = () => done(null);
      const timer = setTimeout(() => done(null), announceWaitMs);
      run.chipWaiters.add(check);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  };

  /**
   * Ask the person on a permission card; Stop (or `signals`) cancels it. `beat`: the MCP call waiting
   * on the answer, told every heartbeatMs that it's alive (an ACP question needs none).
   */
  const ask = (run: ActiveRun, toolUseId: string, prompt: { title: string; message: string }, choices: AssistantConfirmOption[], signals: AbortSignal[], beat?: (message: string) => void): Promise<AssistantConfirmOption | null> =>
    new Promise((resolve) => {
      const confirmationId = newId();
      const heartbeat = beat ? setInterval(() => beat(WAITING), heartbeatMs) : null;
      const done = (choice: AssistantConfirmOption | null) => {
        if (!run.confirmations.delete(confirmationId)) return;
        if (heartbeat) clearInterval(heartbeat);
        for (const signal of signals) signal.removeEventListener("abort", onAbort);
        run.send({ type: "confirm_resolved", runId: run.runId, confirmationId, approved: choice?.kind.startsWith("allow") ?? false, ...(choice ? { optionId: choice.id } : {}) });
        resolve(choice);
      };
      // Stop, or the adapter going away, cancels the question rather than answering it.
      const onAbort = () => done(null);
      run.confirmations.set(confirmationId, (approved, optionId) => done(pickOption(choices, approved, optionId)));
      for (const signal of signals) signal.addEventListener("abort", onAbort, { once: true });
      run.send({ type: "confirm_required", runId: run.runId, confirmationId, toolUseId, title: prompt.title, message: prompt.message, count: 0, kind: "permission", options: choices });
      beat?.(WAITING);
      if (signals.some((signal) => signal.aborted)) onAbort();
    });

  const refused = (text: string): ToolCallResult => ({ content: [{ type: "text", text }], isError: true });

  async function callFromClaude(chat: Chat, name: string, args: Record<string, unknown>, call: ToolServerCallOptions): Promise<ToolCallResult> {
    const run = chat.run;
    if (!run || run.closed || !run.scope || run.controller.signal.aborted) return refused(NO_RUN);
    // Only a call Claude announced on this chat's ACP stream runs: the endpoint's URL and token sit in
    // Claude Code's command line (--mcp-config), where other accounts on the Mac can read them, but the
    // tool_use ids travel only over the adapter's stdio.
    const signal = AbortSignal.any([run.controller.signal, call.signal]);
    const id = call.toolUseId;
    const chip = id ? await chipOf(run, id, signal) : null;
    if (!id || !chip || chip.name !== name || chip.called || chip.finished || run.closed || signal.aborted) {
      if (!run.closed && !signal.aborted) log("warn", `The Assistant's tool endpoint refused ${name}${id ? ` (${id})` : ""}: no tool call Claude announced in this chat matches it.`);
      return refused(signal.aborted ? NO_RUN : UNANNOUNCED);
    }
    chip.called = true;
    try {
      // Claude Code runs these without asking in a mode that doesn't ask, or after "Allow for this chat":
      // Sonobe asks, once per call. A save over outside changes asks whatever was allowed for the chat.
      const session = run.session;
      const forced = isForcedSave(name, args);
      if (ASKING_TOOLS.has(name) && !chip.permitted && (forced || !session?.allowed.has(name))) {
        const prompt = permissionPrompt(name, chip.title, args, home);
        const picked = await ask(run, id, prompt, forced ? onceOnly(OWN_OPTIONS) : OWN_OPTIONS, [signal], call.onProgress);
        if (!picked || picked.kind.startsWith("reject")) {
          run.send({ type: "tool_finished", runId: run.runId, toolUseId: id, name, status: "declined", detail: "You didn't allow it", changedDocument: false });
          return { content: [{ type: "text", text: `The person chose not to allow ${name} in Sonobe, so it didn't run. Ask what they'd like to do instead.` }] };
        }
        if (picked.kind === "allow_always") session?.allowed.add(name);
      }
      const runner = createToolRunner({ ...run.scope, signal });
      return await runner.run({ id, name, input: args }, { onProgress: call.onProgress });
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
    } else run.chips.set(id, { name, title, detail, called: false, finished: false, permitted: false });
    run.send({ type: "tool_started", runId: run.runId, toolUseId: id, name, title, detail });
    for (const wake of [...run.chipWaiters]) wake();
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
    if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk" || update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") run.replied = true;
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
          if (!declined && update.status === "failed") log("warn", `Claude Code ended ${chip.name} before it reached Sonobe: ${clip(contentText(update.content).replace(/\s+/g, " ").trim(), 500) || "no message"}`);
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
    const offered = request.options.flatMap((o): AssistantConfirmOption[] => (o.kind in PERMISSION_LABELS ? [{ id: o.optionId, label: PERMISSION_LABELS[o.kind as AssistantConfirmOption["kind"]], kind: o.kind as AssistantConfirmOption["kind"] }] : []));
    if (!offered.length) return CANCELLED;
    const input = isRecord(call.rawInput) ? call.rawInput : {};
    // "Allow for this chat" wouldn't cover the next save over outside changes, so its card doesn't offer it.
    const options = isForcedSave(name, input) ? onceOnly(offered) : offered;
    const prompt = permissionPrompt(name, run.tools.get(name)?.title ?? name, input, home);
    const picked = await ask(run, call.toolCallId, prompt, options, [run.controller.signal, gone]);
    if (!picked || picked.kind.startsWith("reject")) run.declined.add(call.toolCallId);
    else {
      // Allowed here, so the endpoint doesn't ask again; "Allow for this chat" covers the tool's later calls, which Claude Code no longer asks about.
      const chip = run.chips.get(call.toolCallId);
      if (chip) chip.permitted = true;
      if (picked.kind === "allow_always") session.allowed.add(name);
    }
    return picked ? { outcome: { outcome: "selected", optionId: picked.id } } : CANCELLED;
  }

  /**
   * Put a new session in Claude Code's mode that asks. The adapter starts it in the person's own
   * permissions.defaultMode (it reads their settings whatever settingSources says), and in "auto",
   * "acceptEdits" or "plan" the asking tools would run without a card, or not at all. Throws when the
   * mode can't be set, so no reply runs in one of those.
   */
  async function askingMode(p: AcpAgentProcess, response: NewSessionResponse): Promise<void> {
    const { option, current } = modeOption(response);
    if (current.every((mode) => mode === ASKING_MODE)) return;
    if (!option) throw new Error(`the session is in "${current.join(", ")}" mode, and the adapter offers no mode option`);
    const set = await p.setSessionConfigOption({ sessionId: response.sessionId, configId: option.id, value: ASKING_MODE });
    const after = set.configOptions?.find((o) => o.id === option.id);
    if (after?.type === "select" && after.currentValue !== ASKING_MODE) throw new Error(`the session stayed in "${after.currentValue}" mode`);
    log("info", `Claude Code started this chat's session in "${current.find((mode) => mode !== ASKING_MODE)}" mode (from the person's own settings); Sonobe put it in "${ASKING_MODE}", which asks.`);
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
          // The tool guide rides in the system prompt, cached from the first request. The endpoint sends
          // no MCP instructions: Claude Code would add them to the first message as a reminder, sending the guide twice.
          systemPrompt: subscriptionPrompt(instructions),
          claudeCode: {
            options: {
              tools: [],
              settingSources: [],
              persistSession: false,
              strictMcpConfig: true,
              // The adapter takes the starting mode from the person's own settings; this keeps it out of bypassPermissions.
              allowDangerouslySkipPermissions: false,
              model: model.id,
              // No step cap: the plan's own usage limits apply, and a design can take many steps.
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
      try {
        await askingMode(p, response);
      } catch (err) {
        if (chat.endpoint === endpoint) revokeEndpoint(chat);
        void p.closeSession(response.sessionId);
        if (err instanceof AgentExitedError) throw err;
        log("error", `Claude's agent adapter didn't put the session in its "${ASKING_MODE}" mode: ${redact(messageOf(err))}`);
        throw new RunFailure({ code: "agent_failed", message: MODE_NOT_SET });
      }
      // New chat (or the window closing) while it opened: nobody needs it.
      if (chats.get(conversationId) !== chat) {
        server?.unregister(endpoint.key);
        void p.closeSession(response.sessionId);
        throw new RunFailure({ code: "unknown", message: "This chat was closed." });
      }
      const session: Session = { id: response.sessionId, process: p, model: model.id, modelOption: modelOption(response.configOptions), allowed: new Set(), used: false, off: () => undefined };
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
    const value = option ? modelValue(option.values, model.id) : null;
    if (option && value) {
      try {
        await session.process.setSessionConfigOption({ sessionId: session.id, configId: option.id, value });
        session.model = model.id;
        return;
      } catch (err) {
        if (err instanceof AgentExitedError) throw err;
        log("warn", `Claude's agent adapter didn't switch the model: ${redact(messageOf(err))}`);
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
      chipWaiters: new Set(),
      declined: new Set(),
      replied: false,
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
      let settled: { response: PromptResponse } | { error: unknown } | "gave_up";
      for (let attempt = 1; ; attempt++) {
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
        const hadMessages = session.used;
        session.used = true;
        const current = session;
        const prompting = current.process.prompt({ sessionId: current.id, prompt });
        // Stop cancels the prompt; one that hasn't settled STOP_GRACE_MS later is given up.
        const gaveUp = new Promise<"gave_up">((resolve) => {
          const onStop = () => {
            void current.process.cancel(current.id);
            stopTimer = setTimeout(() => resolve("gave_up"), stopGraceMs);
          };
          if (signal.aborted) onStop();
          else signal.addEventListener("abort", onStop, { once: true });
        });
        settled = await Promise.race([prompting.then((response): { response: PromptResponse } => ({ response }), (error: unknown): { error: unknown } => ({ error })), gaveUp]);
        // A session the adapter ended after an earlier error (its stream closed) refuses the next prompt before
        // anything runs. Nothing of this reply happened, so open a new session and send it again, once.
        if (attempt === 1 && settled !== "gave_up" && "error" in settled && !signal.aborted && !active.replied && active.chips.size === 0 && sessionEnded(settled.error)) {
          log("warn", `Claude's agent adapter had ended this chat's session, so the message goes to a new one: ${redact(messageOf(settled.error))}`);
          loseSession(chat, { close: true });
          chat.lost = false;
          if (hadMessages) send({ type: "notice", runId, tone: "info", message: RESTARTED });
          continue;
        }
        break;
      }
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
          if (said.length <= USAGE_NOTICE_MAX && isUsageLimitNotice(said) && active.chips.size === 0) return finish("error", { code: "usage_limit", message: usageLimitMessage(clip(said, 160)) });
          chat.messageCount++;
          return finish("completed");
      }
    } catch (err) {
      if (err instanceof RunFailure || err instanceof AgentExitedError) return finish("error", failureOf(err, chat, "prompt"));
      log("error", `Assistant run failed: ${redact(messageOf(err))}`);
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
      return (checking ??= (async () => {
        const began = epoch;
        try {
          const p = proc;
          const inUse = [...chats.values()].some((chat) => chat.run || chat.opening || (chat.session && chat.session.process === p));
          if (inUse && p?.alive && !starting) {
            // Chats have sessions on this adapter, and restarting it would cost them their history:
            // Claude Code reads the login itself (the adapter reads it again at each prompt, too).
            const auth = await readLogin(p.spec, { env: agentEnvironment(options.env ?? process.env, p.spec), cwd: options.sessionsDir, timeoutMs: authWaitMs });
            if (began !== epoch) return status;
            if (auth) setAuth(auth);
            else {
              log("warn", "Claude Code didn't report its login to `--cli auth status`, so the Assistant keeps the last one the adapter reported.");
              if (status.state !== "ready" && status.state !== "signed_out") setStatus({ state: "ready", kind: null, label: null, email: null, message: null });
            }
            return status;
          }
          if (!inUse) {
            // A fresh adapter reads the login again (one done in Terminal since).
            const old = p;
            proc = null;
            if (old) {
              onExit(old);
              await old.dispose();
            }
            if (began !== epoch) return status;
          }
          setStatus({ state: "checking", message: null });
          const started = await ensureProcess();
          const auth = await firstAuth(started, authWaitMs);
          if (began !== epoch) return status;
          if (auth) setAuth(auth);
          else if (started.alive) setStatus({ state: "ready", kind: null, label: null, email: null, message: null });
          else setStatus({ state: "failed", kind: null, label: null, email: null, message: notStarted(`it exited (${exitDetail(await started.exited)})`) });
        } catch (err) {
          if (!(err instanceof RunFailure)) {
            log("error", `Checking Claude's agent adapter failed: ${errorMessage(err)}`);
            setStatus({ state: "failed", message: notStarted(errorMessage(err)) });
          }
        }
        // Whatever happened, the setup gets an answer it can act on.
        if (status.state === "checking") setStatus({ state: "failed", message: status.message ?? notStarted("it didn't say whether Claude is signed in") });
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
    async shutdown() {
      epoch++;
      for (const [id, chat] of chats) {
        stop(id);
        loseSession(chat, { close: true });
        revokeEndpoint(chat);
      }
      const p = proc;
      proc = null;
      // An adapter still starting stops itself once it has (startProcess sees the epoch changed).
      starting = null;
      if (status.state === "checking") setStatus({ state: "unknown", message: null });
      if (p) {
        onExit(p);
        await p.dispose();
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
