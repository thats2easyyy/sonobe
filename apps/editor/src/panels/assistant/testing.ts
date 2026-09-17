/** A fake window.sonobeHost for Assistant tests (assistant bridge, secrets, openExternal). Not imported by app code. */

import { ASSISTANT_KEY_SECRET, FALLBACK_MODELS, type AssistantEvent, type AssistantHostLike, type AssistantRunResult, type AssistantStatus, type AssistantUsage } from "./types.ts";

export const usage = (totalTokens = 0): AssistantUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens, estimatedCostUsd: 0, requests: 0 });

export interface FakeAssistantHost extends AssistantHostLike {
  secretsMap: Map<string, string>;
  sent: { text: string; model?: string }[];
  confirmations: [string, boolean][];
  opened: string[];
  stops: number;
  resets: number;
  keyOk: boolean;
  listeners: Set<(event: AssistantEvent) => void>;
  emit(event: AssistantEvent): void;
  /** How send() behaves; emits the run's events through `emit`. */
  nextResult: (request: { text: string; model?: string }, emit: (event: AssistantEvent) => void) => AssistantRunResult | Promise<AssistantRunResult>;
}

export function fakeAssistantHost(options: { secretsAvailable?: boolean; key?: string } = {}): FakeAssistantHost {
  const host: FakeAssistantHost = {
    platform: "darwin",
    secretsMap: new Map(options.key ? [[ASSISTANT_KEY_SECRET, options.key]] : []),
    sent: [],
    confirmations: [],
    opened: [],
    stops: 0,
    resets: 0,
    keyOk: true,
    listeners: new Set(),
    emit(event) {
      for (const l of [...host.listeners]) l(event);
    },
    nextResult: (_request, emit) => {
      emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
      emit({ type: "turn_started", runId: "r1", turn: 1 });
      emit({ type: "text_delta", runId: "r1", turn: 1, delta: "Hello!" });
      emit({ type: "run_finished", runId: "r1", outcome: "completed", usage: usage(1200) });
      return { runId: "r1", outcome: "completed", usage: usage(1200) };
    },
    assistant: {
      status: async (): Promise<AssistantStatus> => {
        const key = host.secretsMap.get(ASSISTANT_KEY_SECRET);
        return {
          hasKey: !!key,
          keyHint: key ? `sk-ant-…${key.slice(-4)}` : null,
          secrets: options.secretsAvailable === false ? { available: false, backend: null, reason: "No system keyring was found." } : { available: true, backend: "keychain", reason: null },
          models: [...FALLBACK_MODELS],
          defaultModel: "claude-sonnet-5",
          limits: { maxTurns: 30, tokenBudget: 1_500_000, deleteConfirmThreshold: 10 },
          usage: usage(),
          running: false,
          messageCount: 0,
        };
      },
      send: async (request) => {
        host.sent.push(request);
        return host.nextResult(request, (e) => host.emit(e));
      },
      stop: async () => {
        host.stops++;
        return true;
      },
      reset: async () => {
        host.resets++;
        return host.assistant!.status();
      },
      confirm: async (id, approved) => {
        host.confirmations.push([id, approved]);
        return true;
      },
      checkKey: async () => (host.keyOk ? { ok: true } : { ok: false, error: { code: "invalid_key", message: "Anthropic didn't accept this API key." } }),
      onEvent(cb) {
        host.listeners.add(cb);
        return () => {
          host.listeners.delete(cb);
        };
      },
    },
    secrets: {
      status: async () => ({ available: options.secretsAvailable !== false, backend: "keychain", reason: null }),
      set: async (name, value) => {
        if (options.secretsAvailable === false) throw new Error("Secure storage isn't available");
        host.secretsMap.set(name, value);
      },
      delete: async (name) => host.secretsMap.delete(name),
    },
    openExternal: (url) => {
      host.opened.push(url);
      return true;
    },
  };
  return host;
}
