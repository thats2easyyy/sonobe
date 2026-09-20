/**
 * Structural mirror of the desktop Assistant protocol (apps/desktop/electron/assistant/protocol.ts),
 * so the editor doesn't import from the desktop app. Keep in sync.
 *
 * The Assistant is optional and desktop-only: it runs in Electron's main process with the person's own
 * Anthropic API key, stored in the OS keychain through sonobeHost.secrets ("anthropic.apiKey"). With the
 * experimental subscription switch on (off by default, awaiting Anthropic's permission), it can run on
 * the person's Claude subscription instead, through Claude's agent adapter.
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
  /** Budget tokens (AssistantUsage.budgetTokens) one chat may use before it pauses. */
  tokenBudget: number;
  deleteConfirmThreshold: number;
}

export interface AssistantUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  /** What the budget counts (cache reads at a tenth, cache writes at 1.25×). Older preloads don't send it. */
  budgetTokens?: number;
  estimatedCostUsd: number;
  requests: number;
}

/** What the Assistant runs on: the person's Anthropic API key, or (experimental) their Claude subscription through Claude's agent adapter. */
export type AssistantProvider = "api_key" | "subscription";

/** The Assistant's connection settings, app-wide and kept by the main process. */
export interface AssistantConnection {
  /**
   * This build offers the experimental switch: only Sonobe run from a source checkout (npm run desktop).
   * A packaged build, which every release is, never does, so no release offers it until Anthropic agrees.
   * False: the switch is hidden and off. Older preloads don't send it (treat as true).
   */
  available?: boolean;
  /** The experimental switch in Settings → Claude. Off by default: awaiting Anthropic's permission. */
  subscriptionEnabled: boolean;
  /** The person's pick in the Assistant's setup. "subscription" counts only while subscriptionEnabled is on. */
  provider: AssistantProvider;
  /** What a new chat runs on: `provider` while the switch is on, else "api_key". */
  active: AssistantProvider;
}

export interface AssistantConnectionUpdate {
  subscriptionEnabled?: boolean;
  provider?: AssistantProvider;
}

/**
 * unknown: not checked in this launch. checking: the adapter is starting or reading the login. ready: signed in.
 * signed_out: the adapter reports no login. not_installed: Sonobe couldn't find the adapter. failed: it wouldn't start or answer.
 */
export type AssistantSubscriptionState = "unknown" | "checking" | "ready" | "signed_out" | "not_installed" | "failed";

/** The Claude login the adapter last reported, and whether Sonobe found the adapter. */
export interface AssistantSubscriptionStatus {
  state: AssistantSubscriptionState;
  /** account: a Claude plan pays. api_key: an API key or an Anthropic Console login pays, at API rates. gateway, external: another provider. none: signed out. */
  kind: "account" | "api_key" | "gateway" | "external" | "none" | null;
  /** The adapter's label ("Claude Max", "Anthropic API key", "Not logged in"). */
  label: string | null;
  email: string | null;
  adapterVersion: string | null;
  /** What to do, for signed_out, not_installed and failed. */
  message: string | null;
}

export type AssistantSignInResult = { ok: true } | { ok: false; error: string };

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
  /** Older preloads don't send it. */
  codeFolder?: AssistantCodeFolderStatus;
  /** Older preloads don't send these: treat them as the API key only. */
  connection?: AssistantConnection;
  subscription?: AssistantSubscriptionStatus;
  /** What this window's chat runs on: set by its first message, kept until New chat. Null before the first message. */
  chatProvider?: AssistantProvider | null;
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
  /** `path` shows home as "~". `persisted`: remembered for the saved project (false: this window only). */
  linked: { name: string; path: string; persisted: boolean } | null;
  /** The linked folder is gone, or something else now stands at its path. */
  missing: boolean;
}

export interface AssistantCodeFolderLinkResult {
  status: AssistantCodeFolderStatus;
  /** The person closed the dialog. */
  cancelled?: boolean;
  /** Why the folder wasn't linked. */
  error?: string;
}

/** Open in Claude Code: the prompt the person's own `claude` starts with, at most 20,000 characters. */
export interface HandoffRequest {
  prompt: string;
}

/** `folder` shows home as "~". `withoutSonobe`: the organization's managed MCP config leaves Sonobe's server out. `cancelled`: the person closed the folder dialog. `error`: why nothing opened. */
export type HandoffResult = { ok: true; folder: string; withoutSonobe?: true } | { ok: false; cancelled?: boolean; error?: string };

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

/** One choice on a permission card (the agent's session/request_permission), in the agent's order. */
export interface AssistantConfirmOption {
  id: string;
  label: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export type AssistantEvent =
  | { type: "run_started"; runId: string; model: string; provider?: AssistantProvider }
  | { type: "turn_started"; runId: string; turn: number }
  | { type: "text_delta"; runId: string; turn: number; delta: string }
  | { type: "thinking_delta"; runId: string; turn: number; delta: string }
  /** A repeat for a toolUseId already started updates its title and detail. */
  | { type: "tool_started"; runId: string; toolUseId: string; name: string; title: string; detail: string }
  /** Where a running tool is ("Downloading images: 7 of 28"), from its progress notifications. */
  | { type: "tool_progress"; runId: string; toolUseId: string; detail: string }
  | { type: "tool_finished"; runId: string; toolUseId: string; name: string; status: AssistantToolStatus; detail: string; changedDocument: boolean; imported?: AssistantImported }
  /** kind "permission": the agent asks before a tool runs; `options` are its choices, answered with confirm(id, approved, optionId). */
  | { type: "confirm_required"; runId: string; confirmationId: string; toolUseId: string; title: string; message: string; count: number; kind?: "delete" | "replace" | "permission"; approveLabel?: string; declineLabel?: string; options?: AssistantConfirmOption[] }
  | { type: "confirm_resolved"; runId: string; confirmationId: string; approved: boolean; optionId?: string }
  | { type: "usage"; runId: string; usage: AssistantUsage; limits: AssistantLimits }
  | { type: "notice"; runId: string; tone: "info" | "warn"; message: string }
  | { type: "run_finished"; runId: string; outcome: AssistantOutcome; error?: AssistantError; usage: AssistantUsage }
  /**
   * import_design's html while Claude writes it (the tool hasn't run): `append` continues the html at
   * `offset`; the last event has done: true and the whole html. A retried turn drops that turn's drafts.
   */
  | { type: "design_draft"; runId: string; turn: number; toolUseId: string; offset: number; append: string; fields?: AssistantDesignFields; done: boolean; html?: string };

/** `window.sonobeHost.assistant`. */
export interface AssistantApi {
  status(): Promise<AssistantStatus>;
  send(request: { text: string; model?: string; context?: AssistantCanvasContext }): Promise<AssistantRunResult>;
  stop(): Promise<boolean>;
  reset(): Promise<AssistantStatus>;
  confirm(confirmationId: string, approved: boolean, optionId?: string): Promise<boolean>;
  checkKey(): Promise<AssistantKeyCheck>;
  onEvent(cb: (event: AssistantEvent) => void): () => void;
  /** Optional: older preloads lack the code folder methods. */
  codeFolder?(): Promise<AssistantCodeFolderStatus>;
  linkCodeFolder?(): Promise<AssistantCodeFolderLinkResult>;
  unlinkCodeFolder?(): Promise<AssistantCodeFolderStatus>;
  /** Optional: older preloads lack it. Opens Terminal in the linked code folder running the person's own `claude` (macOS). */
  openInClaudeCode?(request: HandoffRequest): Promise<HandoffResult>;
  /** Optional: older preloads lack the subscription methods. */
  setConnection?(update: AssistantConnectionUpdate): Promise<AssistantStatus>;
  checkSubscription?(): Promise<AssistantSubscriptionStatus>;
  signInToClaude?(): Promise<AssistantSignInResult>;
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
  const w = window as unknown as { sonobeHost?: AssistantHostLike; __sonobeFakeAssistant?: AssistantHostLike };
  // e2e only (e2e/fakeAssistant.ts); never in a production build.
  if (import.meta.env?.DEV && w.__sonobeFakeAssistant) return w.__sonobeFakeAssistant;
  return w.sonobeHost ?? null;
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
