/**
 * Structural mirror of the desktop Assistant protocol (apps/desktop/electron/assistant/protocol.ts),
 * so the editor doesn't import from the desktop app. Keep in sync.
 *
 * The Assistant is optional and desktop-only: it runs in Electron's main process with the person's own
 * Anthropic API key, stored in the OS keychain through sonobeHost.secrets ("anthropic.apiKey").
 */

/** Secret name for the person's Anthropic API key (sonobeHost.secrets). */
export const ASSISTANT_KEY_SECRET = "anthropic.apiKey";

/** Where people create an API key. */
export const ANTHROPIC_CONSOLE_KEYS_URL = "https://console.anthropic.com/settings/keys";

export interface AssistantModelInfo {
  id: string;
  label: string;
  description: string;
  pricing: { input: number; output: number };
}

export interface AssistantLimits {
  maxTurns: number;
  tokenBudget: number;
  deleteConfirmThreshold: number;
}

export interface AssistantUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  requests: number;
}

export interface AssistantStatus {
  hasKey: boolean;
  keyHint: string | null;
  secrets: { available: boolean; backend: string | null; reason: string | null };
  models: AssistantModelInfo[];
  defaultModel: string;
  limits: AssistantLimits;
  usage: AssistantUsage;
  running: boolean;
  messageCount: number;
}

export interface AssistantError {
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

export type AssistantOutcome = "completed" | "stopped" | "max_turns" | "budget" | "max_tokens" | "refusal" | "error";

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
  | { type: "run_started"; runId: string; model: string }
  | { type: "turn_started"; runId: string; turn: number }
  | { type: "text_delta"; runId: string; turn: number; delta: string }
  | { type: "thinking_delta"; runId: string; turn: number; delta: string }
  | { type: "tool_started"; runId: string; toolUseId: string; name: string; title: string; detail: string }
  | { type: "tool_finished"; runId: string; toolUseId: string; name: string; status: AssistantToolStatus; detail: string; changedDocument: boolean }
  | { type: "confirm_required"; runId: string; confirmationId: string; toolUseId: string; title: string; message: string; count: number }
  | { type: "confirm_resolved"; runId: string; confirmationId: string; approved: boolean }
  | { type: "usage"; runId: string; usage: AssistantUsage; limits: AssistantLimits }
  | { type: "notice"; runId: string; tone: "info" | "warn"; message: string }
  | { type: "run_finished"; runId: string; outcome: AssistantOutcome; error?: AssistantError; usage: AssistantUsage };

/** `window.sonobeHost.assistant`. */
export interface AssistantApi {
  status(): Promise<AssistantStatus>;
  send(request: { text: string; model?: string }): Promise<AssistantRunResult>;
  stop(): Promise<boolean>;
  reset(): Promise<AssistantStatus>;
  confirm(confirmationId: string, approved: boolean): Promise<boolean>;
  checkKey(): Promise<AssistantKeyCheck>;
  onEvent(cb: (event: AssistantEvent) => void): () => void;
}

/** The parts of window.sonobeHost the Assistant uses. All optional: older preloads lack them. */
export interface AssistantHostLike {
  readonly platform?: string;
  assistant?: AssistantApi;
  secrets?: {
    status(): Promise<{ available: boolean; backend: string | null; reason: string | null }>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<boolean>;
  };
  openExternal?(url: string): boolean | void | Promise<boolean | void>;
}

/** `window.sonobeHost` when running in the desktop app, else null (browser mode). */
export function getAssistantHost(): AssistantHostLike | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { sonobeHost?: AssistantHostLike }).sonobeHost ?? null;
}

/** Whether a host can run the Assistant (desktop with the assistant bridge and keychain secrets). */
export function supportsAssistant(host: AssistantHostLike | null | undefined): host is AssistantHostLike & Required<Pick<AssistantHostLike, "assistant" | "secrets">> {
  return !!host && typeof host.assistant?.send === "function" && typeof host.secrets?.set === "function";
}

/** Shown before the host reports its catalog. Mirrors the desktop catalog. */
export const FALLBACK_MODELS: readonly AssistantModelInfo[] = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", description: "Fast and capable. The best fit for most prototyping.", pricing: { input: 2, output: 10 } },
  { id: "claude-opus-5", label: "Claude Opus 5", description: "Most capable for large or tricky interactions. Costs more.", pricing: { input: 5, output: 25 } },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "Quickest and cheapest, for small edits and questions.", pricing: { input: 1, output: 5 } },
];

export const DEFAULT_MODEL_ID = "claude-sonnet-5";
