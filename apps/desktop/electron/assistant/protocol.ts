/**
 * The in-app Assistant's IPC protocol: channel names and the plain data that crosses the context
 * bridge between the main-process agent loop and the editor's Assistant drawer. Imports nothing, so
 * the sandboxed preload can bundle it. The editor mirrors these types structurally
 * (apps/editor/src/panels/assistant/types.ts).
 *
 * Policy: the Assistant uses only the person's own Anthropic API key, kept in the OS keychain through
 * sonobeHost.secrets under ASSISTANT_KEY_SECRET. It never offers claude.ai login and never reads Claude
 * credentials; people with a Claude plan connect Claude Desktop or Claude Code over MCP instead, or
 * choose Open in Claude Code, which starts their own `claude` in Terminal (../claude-handoff.ts).
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
  /** invoke → AssistantCodeFolderStatus (the folder linked to this window's prototype) */
  codeFolder: "sonobe:assistant:code-folder",
  /** invoke → AssistantCodeFolderLinkResult (shows the native folder dialog) */
  linkCodeFolder: "sonobe:assistant:link-code-folder",
  /** invoke → AssistantCodeFolderStatus */
  unlinkCodeFolder: "sonobe:assistant:unlink-code-folder",
  /** invoke(HandoffRequest) → HandoffResult (writes a one-time script and opens it in Terminal; needs no API key) */
  openInClaudeCode: "sonobe:assistant:open-claude-code",
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
  /** Budget tokens (AssistantUsage.budgetTokens) one chat may use before it pauses. */
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
  /** inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens (shown in the meter's tooltip). */
  totalTokens: number;
  /** input + output + 1.25 × cache writes + 0.1 × cache reads, rounded: what the budget counts (the billed weights). */
  budgetTokens: number;
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
  /** The code folder linked to this window's prototype (Match my code…). */
  codeFolder: AssistantCodeFolderStatus;
}

/** What the canvas knows when the person asks from the Design with Claude box. Every name comes from the document: data, not instructions. */
export interface AssistantCanvasContext {
  /** The component on the canvas and its artboard size in points. */
  component: { id: string; name: string; size: [number, number] };
  /** Its top-level layers (its screens), in layer-list order, at most 30. */
  screens: { id: string; name: string }[];
  /** The layer the person picked to redesign: its frame [x, y, width, height] in the component, and the screen holding it. Absent for a new screen. */
  target?: { id: string; name: string; type: string; frame: [number, number, number, number]; screen?: { id: string; name: string } };
  /** formatStyleDigest text for the component (at most 1,500 characters). */
  styles?: string;
}

export interface AssistantSendRequest {
  text: string;
  model?: string;
  /** Present when the message comes from the canvas's Design with Claude box. */
  context?: AssistantCanvasContext;
}

/** import_design's small fields as they stream, before its html. */
export interface AssistantDesignFields {
  name?: string;
  replace?: string;
  component?: string;
  width?: number;
  height?: number;
  position?: [number, number];
}

/** A screen import_design added or replaced (read from its result's _meta). */
export interface AssistantImported {
  docId: string;
  screenId: string;
  txnId: string | null;
  name: string;
  /** The layer it replaced, or null for a new screen. */
  replaced: string | null;
  /** Top-most layers of the replaced one that weren't found again (display names, at most 20). */
  dropped: string[];
  droppedCount: number;
  lostConnections: number;
}

export interface AssistantCodeFolderStatus {
  /** The folder linked to this window's prototype. `path` shows home as "~". `persisted`: remembered for the saved project (false: this window only). */
  linked: { name: string; path: string; persisted: boolean } | null;
  /** The linked folder is gone, or something else now stands at its path. */
  missing: boolean;
}

export interface AssistantCodeFolderLinkResult {
  status: AssistantCodeFolderStatus;
  /** The person closed the dialog. */
  cancelled?: boolean;
  /** Why the folder wasn't linked (teaching copy, §2.2). */
  error?: string;
}

/** Open in Claude Code: the prompt the person's own `claude` starts with, at most 20,000 characters. */
export interface HandoffRequest {
  prompt: string;
}

/** `folder` shows home as "~". `cancelled`: the person closed the folder dialog. `error`: why nothing opened (teaching copy). */
export type HandoffResult = { ok: true; folder: string } | { ok: false; cancelled?: boolean; error?: string };

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
  /** Where a running tool is ("Downloading images: 7 of 28"), from its progress notifications. */
  | { type: "tool_progress"; runId: string; toolUseId: string; detail: string }
  | { type: "tool_finished"; runId: string; toolUseId: string; name: string; status: AssistantToolStatus; detail: string; changedDocument: boolean; imported?: AssistantImported }
  | { type: "confirm_required"; runId: string; confirmationId: string; toolUseId: string; title: string; message: string; count: number; kind?: "delete" | "replace"; approveLabel?: string; declineLabel?: string }
  | { type: "confirm_resolved"; runId: string; confirmationId: string; approved: boolean }
  | { type: "usage"; runId: string; usage: AssistantUsage; limits: AssistantLimits }
  | { type: "notice"; runId: string; tone: "info" | "warn"; message: string }
  | { type: "run_finished"; runId: string; outcome: AssistantOutcome; error?: AssistantError; usage: AssistantUsage }
  /**
   * import_design's html while Claude writes it (the tool hasn't run). `append` continues the decoded
   * html at `offset` (UTF-16 code units). The last event of a call has done: true and carries the whole
   * html. A retried turn (turn_started again with the same turn number) drops that turn's drafts.
   */
  | { type: "design_draft"; runId: string; turn: number; toolUseId: string; offset: number; append: string; fields?: AssistantDesignFields; done: boolean; html?: string };

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
  /** The code folder linked to this window's prototype. */
  codeFolder(): Promise<AssistantCodeFolderStatus>;
  /** Show the native folder dialog and link the folder the person picks. */
  linkCodeFolder(): Promise<AssistantCodeFolderLinkResult>;
  unlinkCodeFolder(): Promise<AssistantCodeFolderStatus>;
  /** Open Terminal in the linked code folder (asking for one first when none is linked), running the person's own `claude` with the prompt. macOS only. */
  openInClaudeCode(request: HandoffRequest): Promise<HandoffResult>;
}
