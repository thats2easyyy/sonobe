/**
 * A fake in-app Assistant for Playwright. The editor's getAssistantHost() returns
 * `window.__sonobeFakeAssistant` under Vite's DEV only, and `window.sonobeHost` stays unset, so the rest
 * of the editor stays in browser mode. Each send() plays one design reply the way the desktop agent
 * streams it: import_design's html arrives as design_draft events (held at a gate when asked), then
 * the page is imported through the test hook's importHtml, as the Assistant's import_design would, and
 * the run finishes with a short reply. No test uses an API key or the network.
 */

import type { Page } from "@playwright/test";
import type { SonobeTestHook } from "../apps/editor/src/app/testHook.ts";
import type {
  AssistantCanvasContext,
  AssistantCodeFolderStatus,
  AssistantDesignFields,
  AssistantEvent,
  AssistantHostLike,
  AssistantImported,
  AssistantModelInfo,
  AssistantRunResult,
  AssistantStatus,
  AssistantUsage,
} from "../apps/editor/src/panels/assistant/types.ts";

export interface FakeAssistantOptions {
  /** Whether an API key is stored. Default true. */
  hasKey?: boolean;
  /** The page Claude writes, streamed in DRAFT_EVENTS pieces and then imported. */
  html: string;
  /** import_design's name for a new screen. Default "Profile". A redesign keeps the picked layer's name. */
  name?: string;
  /** The design_draft (0 to DRAFT_EVENTS - 1) that waits until window.__releaseFakeGate() is called. */
  hold?: number;
}

/** What the box sent: AssistantApi.send's request. */
export interface FakeSendRequest {
  text: string;
  model?: string;
  context?: AssistantCanvasContext;
}

/** design_draft events per reply; the last one is done and carries the whole html. */
export const DRAFT_EVENTS = 40;

/** The linked folder linkCodeFolder() reports. */
export const FAKE_CODE_FOLDER = { name: "placemark", path: "~/code/placemark", persisted: true } as const;

declare global {
  interface Window {
    __sonobeFakeAssistant?: AssistantHostLike;
    /** Every request send() received, oldest first. */
    __fakeAssistantSent?: FakeSendRequest[];
    /** Every prompt openInClaudeCode() received, oldest first. */
    __fakeHandoffs?: string[];
    /** Resolves when __releaseFakeGate() is called; a reply waits on it at `hold`. */
    __fakeGate?: Promise<void>;
    __releaseFakeGate?: () => void;
  }
}

/** Define window.__sonobeFakeAssistant before the app loads (per page; call before openEditor). */
export async function installFakeAssistant(page: Page, options: FakeAssistantOptions): Promise<void> {
  await page.addInitScript(fakeAssistant, { ...options, draftEvents: DRAFT_EVENTS, codeFolder: FAKE_CODE_FOLDER });
}

/** The prompts Open in Claude Code handed off so far. */
export function fakeHandoffs(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__fakeHandoffs ?? []);
}

/** Let a held reply go on (it imports the page and finishes). */
export async function releaseFakeGate(page: Page): Promise<void> {
  await page.evaluate(() => window.__releaseFakeGate?.());
}

/** The requests the box sent so far. */
export function fakeAssistantSent(page: Page): Promise<FakeSendRequest[]> {
  return page.evaluate(() => window.__fakeAssistantSent ?? []);
}

/** Runs in the page before the app's scripts, so it uses nothing from this module but its argument. */
function fakeAssistant(options: FakeAssistantOptions & { draftEvents: number; codeFolder: { name: string; path: string; persisted: boolean } }): void {
  const KEY_SECRET = "anthropic.apiKey";
  const MODELS: AssistantModelInfo[] = [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", description: "Fast and capable. The best fit for most prototyping.", pricing: { input: 2, output: 10 } },
    { id: "claude-opus-5", label: "Claude Opus 5", description: "Most capable for large or tricky interactions. Costs more.", pricing: { input: 5, output: 25 } },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "Quickest and cheapest, for small edits and questions.", pricing: { input: 1, output: 5 } },
  ];
  const LIMITS = { maxTurns: 30, tokenBudget: 1_500_000, deleteConfirmThreshold: 10 };
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const listeners = new Set<(event: AssistantEvent) => void>();
  const emit = (event: AssistantEvent) => {
    for (const listener of [...listeners]) listener(copy(event));
  };
  const sent: FakeSendRequest[] = [];
  window.__fakeAssistantSent = sent;
  const handoffs: string[] = [];
  window.__fakeHandoffs = handoffs;
  let openGate: () => void = () => undefined;
  window.__fakeGate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  window.__releaseFakeGate = () => openGate();

  let key: string | null = options.hasKey === false ? null : "sk-ant-api03-fake-e2e-key-123";
  let codeFolder: AssistantCodeFolderStatus = { linked: null, missing: false };
  let usage: AssistantUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, budgetTokens: 0, estimatedCostUsd: 0, requests: 0 };
  let messageCount = 0;
  let runs = 0;
  let stopRun: (() => void) | null = null;

  const status = (): AssistantStatus => ({
    hasKey: key !== null,
    keyHint: key ? `sk-ant-…${key.slice(-4)}` : null,
    secrets: { available: true, backend: "keychain", reason: null },
    models: MODELS,
    defaultModel: MODELS[0]!.id,
    limits: LIMITS,
    usage,
    running: stopRun !== null,
    messageCount,
    codeFolder,
  });

  const addUsage = (input: number, output: number) => {
    const inputTokens = usage.inputTokens + input;
    const outputTokens = usage.outputTokens + output;
    usage = { ...usage, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, budgetTokens: inputTokens + outputTokens, estimatedCostUsd: (inputTokens * 2 + outputTokens * 10) / 1_000_000, requests: usage.requests + 2 };
  };

  /** [id, name, parent id] of every layer under `rootId`, in the current component. */
  const subtree = (hook: SonobeTestHook, component: string, rootId: string): [string, string, string][] => {
    type Node = { id: string; name: string; children?: Node[] };
    const out: [string, string, string][] = [];
    const walk = (nodes: Node[], inside: boolean, parent: string) => {
      for (const node of nodes) {
        if (inside) out.push([node.id, node.name, parent]);
        walk(node.children ?? [], inside || node.id === rootId, node.id);
      }
    };
    walk((hook.doc().components[component]?.layers ?? []) as Node[], false, "");
    return out;
  };

  const allIds = (hook: SonobeTestHook, component: string): Set<string> => {
    type Node = { id: string; children?: Node[] };
    const ids = new Set<string>();
    const walk = (nodes: Node[]) => {
      for (const node of nodes) {
        ids.add(node.id);
        walk(node.children ?? []);
      }
    };
    walk((hook.doc().components[component]?.layers ?? []) as Node[]);
    return ids;
  };

  /** One design reply: stream the html, import it, reply, finish. */
  const reply = async (request: FakeSendRequest): Promise<AssistantRunResult> => {
    const runId = `fake-run-${++runs}`;
    let stopped = false;
    let onStop: () => void = () => undefined;
    const stopSignal = new Promise<void>((resolve) => {
      onStop = () => {
        stopped = true;
        resolve();
      };
    });
    stopRun = onStop;
    messageCount++;
    const finish = (outcome: AssistantRunResult["outcome"]): AssistantRunResult => {
      stopRun = null;
      emit({ type: "usage", runId, usage, limits: LIMITS });
      emit({ type: "run_finished", runId, outcome, usage });
      return { runId, outcome, usage: copy(usage) };
    };

    // Events reach the editor over IPC, after send() was called.
    await pause(0);
    emit({ type: "run_started", runId, model: request.model ?? MODELS[0]!.id });
    emit({ type: "turn_started", runId, turn: 1 });

    const html = options.html;
    const target = request.context?.target;
    const name = target ? target.name : (options.name ?? "Profile");
    const fields: AssistantDesignFields = { name, ...(target ? { replace: target.id } : {}) };
    const toolUseId = `toolu_fake_${runs}`;
    const count = options.draftEvents;
    // Cut points in UTF-16 code units that never split a surrogate pair.
    const cuts: number[] = [];
    for (let i = 0; i <= count; i++) {
      let at = Math.round((html.length * i) / count);
      if (at > 0 && at < html.length && /[\uD800-\uDBFF]/.test(html[at - 1]!)) at++;
      cuts.push(Math.max(at, cuts[i - 1] ?? 0));
    }
    for (let i = 0; i < count; i++) {
      // The last piece before the gate comes well after the one before it, so a throttled preview
      // (at most one post per 120 ms) has posted everything written so far when the reply waits.
      if (i > 0) await Promise.race([pause(options.hold !== undefined && i === options.hold - 1 ? 200 : 16), stopSignal]);
      if (i === options.hold) await Promise.race([window.__fakeGate, stopSignal]);
      if (stopped) return finish("stopped");
      const done = i === count - 1;
      emit({ type: "design_draft", runId, turn: 1, toolUseId, offset: cuts[i]!, append: html.slice(cuts[i], cuts[i + 1]), ...(i === 0 || done ? { fields } : {}), done, ...(done ? { html } : {}) });
    }
    await Promise.race([pause(16), stopSignal]);
    if (stopped) return finish("stopped");

    emit({ type: "tool_started", runId, toolUseId, name: "import_design", title: "Import design", detail: name });
    const hook = window.__sonobe;
    if (!hook) {
      emit({ type: "tool_finished", runId, toolUseId, name: "import_design", status: "error", detail: "The test hook isn't installed.", changedDocument: false });
      return finish("error");
    }
    const component = hook.session.currentComponentId();
    const before = target ? subtree(hook, component, target.id) : [];
    const outcome = await hook.importHtml(html, { name, ...(target ? { replace: target.id } : {}) });
    if (!outcome.ok) {
      emit({ type: "tool_finished", runId, toolUseId, name: "import_design", status: "error", detail: outcome.message ?? "The design couldn't be added.", changedDocument: false });
    } else {
      const screenId = outcome.screenId ?? target?.id ?? "";
      const after = allIds(hook, component);
      const gone = new Set(before.filter(([id]) => !after.has(id)).map(([id]) => id));
      const dropped = before.filter(([id, , parent]) => gone.has(id) && !gone.has(parent)).map(([, layerName]) => layerName);
      const imported: AssistantImported = {
        docId: "fake-doc",
        screenId,
        txnId: hook.session.document.getState().lastChange?.txnId ?? null,
        name: outcome.screenName ?? name,
        replaced: target?.id ?? null,
        dropped: dropped.slice(0, 20),
        droppedCount: gone.size,
        lostConnections: outcome.summary?.lostConnections ?? 0,
      };
      emit({ type: "tool_finished", runId, toolUseId, name: "import_design", status: "done", detail: `${target ? "Re-imported" : "Imported"} "${imported.name}" as layer ${screenId}.`, changedDocument: true, imported });
    }
    addUsage(12_000, Math.round(html.length / 3));
    emit({ type: "turn_started", runId, turn: 2 });
    emit({ type: "text_delta", runId, turn: 2, delta: target ? `Updated “${name}”.` : "Added a profile screen." });
    return finish("completed");
  };

  const host: AssistantHostLike = {
    assistant: {
      status: async () => copy(status()),
      send: async (request) => {
        sent.push(copy(request));
        if (!key) return { runId: "", outcome: "error", error: { code: "no_key", message: "Add your Anthropic API key to use the Assistant." }, usage: copy(usage) };
        if (stopRun) return { runId: "", outcome: "error", error: { code: "busy", message: "The Assistant is still working on your last message. Stop it or wait for it to finish." }, usage: copy(usage) };
        return reply(request);
      },
      stop: async () => {
        if (!stopRun) return false;
        stopRun();
        return true;
      },
      reset: async () => {
        stopRun?.();
        messageCount = 0;
        usage = { ...usage, inputTokens: 0, outputTokens: 0, totalTokens: 0, budgetTokens: 0, estimatedCostUsd: 0, requests: 0 };
        return copy(status());
      },
      confirm: async () => true,
      checkKey: async () => (key ? { ok: true } : { ok: false, error: { code: "no_key", message: "Add your Anthropic API key first." } }),
      onEvent(cb) {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
      codeFolder: async () => copy(codeFolder),
      linkCodeFolder: async () => {
        codeFolder = { linked: { ...options.codeFolder }, missing: false };
        return { status: copy(codeFolder) };
      },
      unlinkCodeFolder: async () => {
        codeFolder = { linked: null, missing: false };
        return copy(codeFolder);
      },
      // The desktop opens a one-time script in Terminal, in the linked folder (linking one first); this records the prompt.
      openInClaudeCode: async (request) => {
        handoffs.push(request.prompt);
        if (!codeFolder.linked) codeFolder = { linked: { ...options.codeFolder }, missing: false };
        return { ok: true, folder: options.codeFolder.path };
      },
    },
    secrets: {
      status: async () => ({ available: true, backend: "keychain", reason: null }),
      set: async (name, value) => {
        if (name === KEY_SECRET) key = value;
      },
      delete: async (name) => {
        const had = name === KEY_SECRET && key !== null;
        if (name === KEY_SECRET) key = null;
        return had;
      },
    },
    openExternal: () => true,
  };
  window.__sonobeFakeAssistant = host;
}
