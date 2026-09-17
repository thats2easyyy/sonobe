/**
 * The in-app Assistant's IPC protocol: channel names and the plain data that crosses the context
 * bridge between the main-process agent loop and the editor's Assistant drawer. Imports nothing, so
 * the sandboxed preload can bundle it. The editor mirrors these types structurally
 * (apps/editor/src/panels/assistant/types.ts).
 *
 * Policy: the Assistant uses only the person's own Anthropic API key, kept in the OS keychain through
 * sonobeHost.secrets under ASSISTANT_KEY_SECRET. It never offers claude.ai login and never reads Claude
 * credentials; people with a Claude plan connect Claude Desktop or Claude Code over MCP instead.
 */

/** Secret name for the person's Anthropic API key (sonobeHost.secrets). */
export const ASSISTANT_KEY_SECRET = "anthropic.apiKey";

export const ASSISTANT_IPC = {
  /** invoke → AssistantStatus */
  status: "sonobe:assistant:status",
  /** invoke(AssistantSendRequest) → AssistantRunResult, resolved when the run ends. */
  send: "sonobe:assistant:send",
  /** invoke → boolean (a run was stopped) */
  stop: "sonobe:assistant:stop",
  /** invoke → AssistantStatus (after clearing the conversation) */
  reset: "sonobe:assistant:reset",
  /** invoke(confirmationId, approved) → boolean (a pending confirmation was settled) */
  confirm: "sonobe:assistant:confirm",
  /** invoke → AssistantKeyCheck */
  checkKey: "sonobe:assistant:check-key",
  /** main → renderer: AssistantEvent */
  event: "sonobe:assistant:event",
} as const;

export type AssistantModelId = "claude-sonnet-5" | "claude-opus-5" | "claude-haiku-4-5-20251001";

export interface AssistantModelInfo {
  id: AssistantModelId;
  label: string;
  description: string;
  /** US$ per million tokens (list prices; for estimates only). */
  pricing: { input: number; output: number };
}

export interface AssistantLimits {
  /** API requests one message may make (each tool round is one). */
  maxTurns: number;
  /** Tokens (input, cache reads and writes, output) one chat may use before it pauses. */
  tokenBudget: number;
  /** Deleting more than this many items asks the person first. */
  deleteConfirmThreshold: number;
}

/** Totals for the current chat. */
export interface AssistantUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens (what the budget counts). */
  totalTokens: number;
  /** Rough cost at list prices, US$. */
  estimatedCostUsd: number;
  requests: number;
}

export interface AssistantSecretsStatus {
  available: boolean;
  backend: string | null;
  reason: string | null;
}

export interface AssistantStatus {
  /** An API key is stored. */
  hasKey: boolean;
  /** e.g. "sk-ant-…3f9a"; never the key itself. */
  keyHint: string | null;
  secrets: AssistantSecretsStatus;
  models: AssistantModelInfo[];
  defaultModel: AssistantModelId;
  limits: AssistantLimits;
  usage: AssistantUsage;
  /** A run is in progress for this window. */
  running: boolean;
  /** Messages in this window's chat (user and assistant turns, not tool rounds). */
  messageCount: number;
}

export interface AssistantSendRequest {
  text: string;
  model?: string;
}

export type AssistantErrorCode =
  | "no_key"
  | "invalid_key"
  | "secrets_unavailable"
  | "permission_denied"
  | "rate_limited"
  | "overloaded"
  | "network"
  | "model_unavailable"
  | "bad_request"
  | "server_error"
  | "busy"
  | "empty_message"
  | "no_document"
  | "unknown";

export interface AssistantError {
  code: AssistantErrorCode;
  message: string;
  /** Seconds to wait before retrying, when the API said. */
  retryAfterSeconds?: number;
}

export type AssistantOutcome =
  /** Claude finished its reply. */
  | "completed"
  /** The person pressed Stop. */
  | "stopped"
  /** The reply used every allowed step (limits.maxTurns). */
  | "max_turns"
  /** The chat reached limits.tokenBudget. */
  | "budget"
  /** The reply was cut off by the output limit. */
  | "max_tokens"
  /** Claude declined the request. */
  | "refusal"
  | "error";

export interface AssistantRunResult {
  runId: string;
  outcome: AssistantOutcome;
  error?: AssistantError;
  usage: AssistantUsage;
}

export interface AssistantKeyCheck {
  ok: boolean;
  error?: AssistantError;
}

export type AssistantToolStatus = "running" | "done" | "error" | "declined" | "skipped";

export type AssistantEvent =
  | { type: "run_started"; runId: string; model: AssistantModelId }
  /** One API request (a reply, or the reply after a round of tools). */
  | { type: "turn_started"; runId: string; turn: number }
  | { type: "text_delta"; runId: string; turn: number; delta: string }
  /** Summarized thinking, for a quiet "thinking" indicator. */
  | { type: "thinking_delta"; runId: string; turn: number; delta: string }
  | { type: "tool_started"; runId: string; toolUseId: string; name: string; title: string; detail: string }
  | { type: "tool_finished"; runId: string; toolUseId: string; name: string; status: AssistantToolStatus; detail: string; changedDocument: boolean }
  | { type: "confirm_required"; runId: string; confirmationId: string; toolUseId: string; title: string; message: string; count: number }
  | { type: "confirm_resolved"; runId: string; confirmationId: string; approved: boolean }
  | { type: "usage"; runId: string; usage: AssistantUsage; limits: AssistantLimits }
  | { type: "notice"; runId: string; tone: "info" | "warn"; message: string }
  | { type: "run_finished"; runId: string; outcome: AssistantOutcome; error?: AssistantError; usage: AssistantUsage };

/** What the preload exposes as `window.sonobeHost.assistant`. */
export interface SonobeAssistantApi {
  status(): Promise<AssistantStatus>;
  /** Starts a reply and resolves when it ends. Expected failures resolve with outcome "error" (never reject). */
  send(request: AssistantSendRequest): Promise<AssistantRunResult>;
  stop(): Promise<boolean>;
  /** Start a new chat (stops any run). */
  reset(): Promise<AssistantStatus>;
  confirm(confirmationId: string, approved: boolean): Promise<boolean>;
  /** Check the stored key with one small API call. */
  checkKey(): Promise<AssistantKeyCheck>;
  /** Events for this window's runs. Returns unsubscribe. */
  onEvent(cb: (event: AssistantEvent) => void): () => void;
}
