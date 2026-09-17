/** The Assistant's model catalog, list prices for estimates, and usage totals. Electron-free. */

import type { AssistantModelId, AssistantModelInfo, AssistantUsage } from "./protocol.ts";

export interface ModelSpec extends AssistantModelInfo {
  /** Adaptive thinking with summaries (Sonnet 5, Opus 5). Haiku 4.5 runs without thinking. */
  adaptiveThinking: boolean;
  /** Server-side refusal fallbacks (`fallbacks: "default"`), enabled for Opus 5. */
  fallbacks: boolean;
  /** max_tokens for a streamed reply. */
  maxTokens: number;
}

export const DEFAULT_MODEL: AssistantModelId = "claude-sonnet-5";

/** Beta header for `fallbacks: "default"`. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const MODELS: readonly ModelSpec[] = [
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Fast and capable. The best fit for most prototyping.",
    pricing: { input: 2, output: 10 },
    adaptiveThinking: true,
    fallbacks: false,
    maxTokens: 64_000,
  },
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    description: "Most capable for large or tricky interactions. Costs more.",
    pricing: { input: 5, output: 25 },
    adaptiveThinking: true,
    fallbacks: true,
    maxTokens: 64_000,
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    description: "Quickest and cheapest, for small edits and questions.",
    pricing: { input: 1, output: 5 },
    adaptiveThinking: false,
    fallbacks: false,
    maxTokens: 64_000,
  },
];

export function isModelId(value: unknown): value is AssistantModelId {
  return typeof value === "string" && MODELS.some((m) => m.id === value);
}

/** The model for `id`, or the default when it isn't one of ours. */
export function resolveModel(id: unknown): ModelSpec {
  return MODELS.find((m) => m.id === id) ?? MODELS.find((m) => m.id === DEFAULT_MODEL)!;
}

/** Public catalog entries (no request settings). */
export function modelInfos(): AssistantModelInfo[] {
  return MODELS.map(({ id, label, description, pricing }) => ({ id, label, description, pricing: { ...pricing } }));
}

export function emptyUsage(): AssistantUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, estimatedCostUsd: 0, requests: 0 };
}

/** The usage fields of an API response we count. */
export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

const n = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** Cache writes (5-minute) bill at 1.25× input, cache reads at 0.1× input. */
export function estimateCostUsd(usage: UsageLike, model: ModelSpec): number {
  const { input, output } = model.pricing;
  const dollars = (n(usage.input_tokens) * input + n(usage.cache_creation_input_tokens) * input * 1.25 + n(usage.cache_read_input_tokens) * input * 0.1 + n(usage.output_tokens) * output) / 1_000_000;
  return dollars;
}

/** Add one response's usage to the chat totals. */
export function addUsage(totals: AssistantUsage, usage: UsageLike | null | undefined, model: ModelSpec): AssistantUsage {
  if (!usage) return { ...totals, requests: totals.requests + 1 };
  const inputTokens = totals.inputTokens + n(usage.input_tokens);
  const outputTokens = totals.outputTokens + n(usage.output_tokens);
  const cacheReadTokens = totals.cacheReadTokens + n(usage.cache_read_input_tokens);
  const cacheWriteTokens = totals.cacheWriteTokens + n(usage.cache_creation_input_tokens);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    estimatedCostUsd: totals.estimatedCostUsd + estimateCostUsd(usage, model),
    requests: totals.requests + 1,
  };
}
