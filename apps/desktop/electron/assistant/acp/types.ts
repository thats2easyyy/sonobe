/**
 * The Assistant on the person's Claude subscription (experimental, off by default, not released until
 * Anthropic agrees): Sonobe is an ACP client of Claude's agent adapter (@agentclientprotocol/claude-agent-acp,
 * built on the Claude Agent SDK), which it runs as a child process. These are the seams between the
 * subscription engine (./engine.ts) and the adapter's process (./process.ts, ./locate.ts, ./signIn.ts),
 * so tests can stand in for either side.
 */

import type {
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";

/** The npm package people install to run the Assistant on their Claude subscription. */
export const CLAUDE_AGENT_PACKAGE = "@agentclientprotocol/claude-agent-acp";
/** Its command (the package's bin). */
export const CLAUDE_AGENT_BIN = "claude-agent-acp";
/** Overrides where Sonobe looks for the adapter: an absolute path to its JS entry or an executable (tests point it at the fake agent). */
export const CLAUDE_AGENT_ENV = "SONOBE_CLAUDE_AGENT";

/** How to start the adapter Sonobe found. */
export interface ClaudeAgentSpec {
  /** Electron's own binary (run as Node through ELECTRON_RUN_AS_NODE) for a JS entry, else the executable itself. */
  command: string;
  /** The JS entry first, for a JS entry; then any fixed arguments. */
  args: string[];
  /** Added to the child's environment (ELECTRON_RUN_AS_NODE=1 for a JS entry). */
  env: Record<string, string>;
  /** Where it was found, home shown as "~" (for messages and logs). */
  displayPath: string;
  /** Its package version, when a package.json sits next to it. */
  version: string | null;
  /** "env": CLAUDE_AGENT_ENV named it. "path": found as CLAUDE_AGENT_BIN on PATH or in a well-known bin folder. */
  source: "env" | "path";
}

/** `searched`: the folders looked in, home shown as "~" (for the not-installed message and logs). */
export type LocateClaudeAgentResult = { ok: true; spec: ClaudeAgentSpec } | { ok: false; searched: string[] };

/** The adapter's `_auth/status_update` payload, as Sonobe keeps it. */
export interface AgentAuthStatus {
  kind: "account" | "api_key" | "gateway" | "external" | "none";
  label: string;
  email: string | null;
  plan: string | null;
  /** api_key's source ("ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key"), a gateway's host. */
  detail: string | null;
}

/** How the adapter's process ended. `stderrTail`: its last lines of stderr, at most 2,000 characters. */
export interface AgentExit {
  code: number | null;
  signal: string | null;
  stderrTail: string;
}

/** A request that was pending, or sent, after the adapter's process exited. */
export class AgentExitedError extends Error {
  readonly exit: AgentExit;
  constructor(exit: AgentExit) {
    super(`Claude's agent adapter exited${exit.code !== null ? ` with code ${exit.code}` : exit.signal ? ` (${exit.signal})` : ""}.`);
    this.name = "AgentExitedError";
    this.exit = exit;
  }
}

/** The adapter didn't answer initialize in time, or the process couldn't be spawned. */
export class AgentStartError extends Error {
  readonly exit: AgentExit | null;
  constructor(message: string, exit: AgentExit | null = null) {
    super(message);
    this.name = "AgentStartError";
    this.exit = exit;
  }
}

export type PermissionHandler = (request: RequestPermissionRequest, signal: AbortSignal) => Promise<RequestPermissionResponse>;

/**
 * One running adapter process and its ACP connection (the client side). Sonobe runs one for the whole
 * app and opens one ACP session per window's chat. Requests reject with the SDK's RequestError when
 * the agent refuses (code -32000 is auth_required), and with AgentExitedError once the process is gone.
 */
export interface AcpAgentProcess {
  readonly spec: ClaudeAgentSpec;
  /** initialize's response. Rejects with AgentStartError (spawn failed, no answer in time) or AgentExitedError. */
  readonly ready: Promise<InitializeResponse>;
  /** The login the adapter last pushed, or null before its first push. */
  readonly authStatus: AgentAuthStatus | null;
  /** Each push of the adapter's `_auth/status_update`. Returns unsubscribe. */
  onAuthStatus(listener: (status: AgentAuthStatus) => void): () => void;
  newSession(params: NewSessionRequest): Promise<NewSessionResponse>;
  prompt(params: PromptRequest): Promise<PromptResponse>;
  /** session/cancel (a notification): the running prompt resolves with stopReason "cancelled". */
  cancel(sessionId: string): Promise<void>;
  setSessionConfigOption(params: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse>;
  /** session/close when the adapter offers it; otherwise nothing. Never rejects. */
  closeSession(sessionId: string): Promise<void>;
  /** session/update notifications for one session. Returns unsubscribe. */
  onSessionUpdate(sessionId: string, listener: (notification: SessionNotification) => void): () => void;
  /** Who answers session/request_permission for a session. With none, or after the signal aborts, the answer is { outcome: "cancelled" }. */
  setPermissionHandler(sessionId: string, handler: PermissionHandler | null): void;
  /** Resolves once the process has exited (never rejects). */
  readonly exited: Promise<AgentExit>;
  readonly alive: boolean;
  /** Close stdin, then SIGTERM, then SIGKILL after 3 s. Resolves once it's gone. */
  dispose(): Promise<void>;
}

export interface AcpAgentProcessOptions {
  spec: ClaudeAgentSpec;
  /** The child's working folder (a Sonobe-owned, empty folder). */
  cwd: string;
  /** The environment to start from (default process.env); see agentEnvironment() in ./process.ts for what's removed and added. */
  baseEnv?: Record<string, string | undefined>;
  /** Sonobe's version, for clientInfo. */
  clientVersion: string;
  /** Default 20 s. */
  initializeTimeoutMs?: number;
  log?(level: "info" | "warn" | "error", message: string): void;
}

export type CreateAcpAgentProcess = (options: AcpAgentProcessOptions) => AcpAgentProcess;

export interface LocateClaudeAgentOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  home?: string;
  /** Electron's binary: runs a JS entry as Node. Default process.execPath. */
  execPath?: string;
}

export type LocateClaudeAgent = (options?: LocateClaudeAgentOptions) => LocateClaudeAgentResult;

/** Opening the adapter's Claude sign-in (`<adapter> --cli auth login --claudeai`) in the person's Terminal (macOS). */
export interface ClaudeSignInOptions {
  platform: NodeJS.Platform;
  /** Where the one-time script goes (userData/handoff). */
  dir: string;
  /** shell.openPath: "" on success, else an error message. */
  openPath(file: string): Promise<string>;
}

export type OpenClaudeSignIn = (spec: ClaudeAgentSpec, options: ClaudeSignInOptions) => Promise<{ ok: true } | { ok: false; error: string }>;
