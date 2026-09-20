/** A fake window.sonobeHost for Assistant tests (assistant bridge, secrets, openExternal). Not imported by app code. */

import {
  ASSISTANT_KEY_SECRET,
  FALLBACK_MODELS,
  type AssistantCanvasContext,
  type AssistantCodeFolderLinkResult,
  type AssistantCodeFolderStatus,
  type AssistantDesignFields,
  type AssistantEvent,
  type AssistantHostLike,
  type AssistantRunResult,
  type AssistantStatus,
  type AssistantUsage,
  type HandoffResult,
} from "./types.ts";

export const usage = (totalTokens = 0, budgetTokens = totalTokens): AssistantUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens, budgetTokens, estimatedCostUsd: 0, requests: 0 });

type SendRequest = { text: string; model?: string; context?: AssistantCanvasContext };

export interface FakeAssistantHost extends AssistantHostLike {
  secretsMap: Map<string, string>;
  sent: SendRequest[];
  confirmations: [string, boolean][];
  opened: string[];
  stops: number;
  resets: number;
  keyOk: boolean;
  /** What status().codeFolder reports; the code folder methods change it. */
  folder: AssistantCodeFolderStatus;
  /** Code folder calls, in order. */
  folderCalls: ("codeFolder" | "link" | "unlink")[];
  /** What linkCodeFolder() answers (default: links ~/code/placemark, remembered for the project). */
  nextLink: () => AssistantCodeFolderLinkResult;
  /** The prompts openInClaudeCode() was given, in order. */
  handoffs: string[];
  /** What openInClaudeCode() answers (default: opens in ~/code/placemark, linking it when no folder is). */
  nextHandoff: () => HandoffResult;
  listeners: Set<(event: AssistantEvent) => void>;
  emit(event: AssistantEvent): void;
  /** Stream `html` as import_design's draft: `chunks` design_draft events with their offsets, the last one done with the whole html. */
  emitDesign(runId: string, toolUseId: string, html: string, options?: { chunks?: number; fields?: AssistantDesignFields; turn?: number }): void;
  /** How send() behaves; emits the run's events through `emit`. */
  nextResult: (request: SendRequest, emit: (event: AssistantEvent) => void) => AssistantRunResult | Promise<AssistantRunResult>;
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
    folder: { linked: null, missing: false },
    folderCalls: [],
    nextLink: () => ({ status: { linked: { name: "placemark", path: "~/code/placemark", persisted: true }, missing: false } }),
    handoffs: [],
    nextHandoff: () => {
      if (!host.folder.linked) host.folder = host.nextLink().status;
      return host.folder.linked ? { ok: true, folder: host.folder.linked.path } : { ok: false, cancelled: true };
    },
    listeners: new Set(),
    emit(event) {
      for (const l of [...host.listeners]) l(event);
    },
    emitDesign(runId, toolUseId, html, { chunks = 8, fields, turn = 1 } = {}) {
      const size = Math.ceil(html.length / chunks);
      for (let i = 0; i < chunks; i++) {
        const offset = Math.min(html.length, i * size);
        const done = i === chunks - 1;
        host.emit({ type: "design_draft", runId, turn, toolUseId, offset, append: html.slice(offset, done ? html.length : offset + size), ...(fields && (i === 0 || done) ? { fields } : {}), done, ...(done ? { html } : {}) });
      }
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
          codeFolder: host.folder,
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
      codeFolder: async () => {
        host.folderCalls.push("codeFolder");
        return host.folder;
      },
      linkCodeFolder: async () => {
        host.folderCalls.push("link");
        const result = host.nextLink();
        host.folder = result.status;
        return result;
      },
      unlinkCodeFolder: async () => {
        host.folderCalls.push("unlink");
        host.folder = { linked: null, missing: false };
        return host.folder;
      },
      openInClaudeCode: async (request) => {
        host.handoffs.push(request.prompt);
        return host.nextHandoff();
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
