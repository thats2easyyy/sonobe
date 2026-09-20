/**
 * A fake in-app Assistant for Playwright. The editor's getAssistantHost() returns
 * `window.__sonobeFakeAssistant` under Vite's DEV only, and `window.sonobeHost` stays unset, so the rest
 * of the editor stays in browser mode. Each send() plays one design reply the way the desktop agent
 * streams it: import_design's html arrives as design_draft events (held at a gate when asked), then
 * the page is imported through the test hook's importHtml, as the Assistant's import_design would, and
 * the run finishes with a short reply. No test uses an API key or the network.
 *
 * With the experimental subscription switch on and the subscription picked (`connection`), a send plays
 * what the desktop's ACP engine sends instead: the page arrives as the Assistant's own preview_design
 * drafts through the test hook's previewDesign (the design.preview RPC's path), then import_design
 * { preview: true } imports it; or (`subscriptionReply: "permission"`) Claude Code asks before saving.
 */

import type { Page } from "@playwright/test";
import type { SonobeTestHook } from "../apps/editor/src/app/testHook.ts";
import type {
  AssistantCanvasContext,
  AssistantCodeFolderStatus,
  AssistantConnection,
  AssistantConnectionUpdate,
  AssistantDesignFields,
  AssistantEvent,
  AssistantHostLike,
  AssistantImported,
  AssistantModelInfo,
  AssistantProvider,
  AssistantRunResult,
  AssistantStatus,
  AssistantSubscriptionStatus,
  AssistantUsage,
} from "../apps/editor/src/panels/assistant/types.ts";

export interface FakeAssistantOptions {
  /** Whether an API key is stored. Default true. */
  hasKey?: boolean;
  /** The page Claude writes, streamed in DRAFT_EVENTS pieces and then imported. */
  html: string;
  /** import_design's name for a new screen. Default "Profile". A redesign keeps the picked layer's name. */
  name?: string;
  /** The design_draft (0 to DRAFT_EVENTS - 1) that waits until window.__releaseFakeGate() is called. On the subscription: any value holds the reply after its first two preview_design calls. */
  hold?: number;
  /** The experimental switch and the setup's pick (main keeps them). Default: off, the API key. */
  connection?: { subscriptionEnabled?: boolean; provider?: AssistantProvider };
  /** What checkSubscription() finds; status() says "unknown" until the first check. Default: signed in with Claude Max. */
  subscription?: Partial<AssistantSubscriptionStatus>;
  /** A send on the subscription: "design" draws the page through preview_design and imports it; "permission" asks before saving. Default "design". */
  subscriptionReply?: "design" | "permission";
  /** The pieces the subscription's design sends with preview_design (html, then appends); they join to `html`. Default: `html` in thirds. */
  previewParts?: string[];
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
export const FAKE_CODE_FOLDER = { name: "noddit", path: "~/code/noddit", persisted: true } as const;

/** The engine's words on macOS while Claude is signed out: status.subscription.message (it says Check again), and a reply's not_signed_in error. */
export const SIGNED_OUT_STATUS = "Claude isn't signed in on this computer. Choose Sign in… (it opens Terminal), or run claude-agent-acp --cli auth login in Terminal, then choose Check again.";
export const SIGNED_OUT_ERROR = "Claude isn't signed in on this computer. Choose Sign in… (it opens Terminal), or run claude-agent-acp --cli auth login in Terminal, then send your message again.";

declare global {
  interface Window {
    __sonobeFakeAssistant?: AssistantHostLike;
    /** Every request send() received, oldest first. */
    __fakeAssistantSent?: FakeSendRequest[];
    /** Every prompt openInClaudeCode() received, oldest first. */
    __fakeHandoffs?: string[];
    /** confirm() calls: [confirmationId, approved, optionId]. */
    __fakeConfirms?: [string, boolean, string | null][];
    /** setConnection() calls, oldest first. */
    __fakeConnectionCalls?: AssistantConnectionUpdate[];
    /** How many times signInToClaude() was called. */
    __fakeSignIns?: number;
    /** Resolves when __releaseFakeGate() is called; a reply waits on it at `hold`. */
    __fakeGate?: Promise<void>;
    __releaseFakeGate?: () => void;
  }
}

/** Define window.__sonobeFakeAssistant before the app loads (per page; call before openEditor). */
export async function installFakeAssistant(page: Page, options: FakeAssistantOptions): Promise<void> {
  await page.addInitScript(fakeAssistant, { ...options, draftEvents: DRAFT_EVENTS, codeFolder: FAKE_CODE_FOLDER, signedOutError: SIGNED_OUT_ERROR });
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

/** The answers given to confirmations and permission cards: [confirmationId, approved, optionId]. */
export function fakeConfirms(page: Page): Promise<[string, boolean, string | null][]> {
  return page.evaluate(() => window.__fakeConfirms ?? []);
}

/** What the Settings switch and the setup asked main to change. */
export function fakeConnectionCalls(page: Page): Promise<AssistantConnectionUpdate[]> {
  return page.evaluate(() => window.__fakeConnectionCalls ?? []);
}

/** How many times Sign in… opened Claude's login. */
export function fakeSignIns(page: Page): Promise<number> {
  return page.evaluate(() => window.__fakeSignIns ?? 0);
}

/** Runs in the page before the app's scripts, so it uses nothing from this module but its argument. */
function fakeAssistant(options: FakeAssistantOptions & { draftEvents: number; codeFolder: { name: string; path: string; persisted: boolean }; signedOutError: string }): void {
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
  const confirms: [string, boolean, string | null][] = [];
  window.__fakeConfirms = confirms;
  const connectionCalls: AssistantConnectionUpdate[] = [];
  window.__fakeConnectionCalls = connectionCalls;
  window.__fakeSignIns = 0;
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

  const connectionOf = (c: { subscriptionEnabled?: boolean; provider?: AssistantProvider } = {}): AssistantConnection => {
    const subscriptionEnabled = c.subscriptionEnabled ?? false;
    const provider = c.provider ?? "api_key";
    return { available: true, subscriptionEnabled, provider, active: subscriptionEnabled ? provider : "api_key" };
  };
  let connection = connectionOf(options.connection);
  const found: AssistantSubscriptionStatus = { state: "ready", kind: "account", label: "Claude Max", email: "ava@example.com", adapterVersion: "0.79.0", message: null, ...options.subscription };
  let subscription: AssistantSubscriptionStatus = { state: "unknown", kind: null, label: null, email: null, adapterVersion: null, message: null };
  let chatProvider: AssistantProvider | null = null;
  /** Permission cards waiting on confirm(), by confirmationId. */
  const answers = new Map<string, (answer: { approved: boolean; optionId: string | null }) => void>();

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
    connection: { ...connection },
    subscription: { ...subscription },
    chatProvider,
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

  /** Splits the page into the three pieces Claude sends with preview_design (html, then two appends), never inside a surrogate pair. */
  const previewParts = (html: string): string[] => {
    const cuts = [0, Math.round(html.length / 3), Math.round((html.length * 2) / 3), html.length].map((at) => (at > 0 && at < html.length && /[\uD800-\uDBFF]/.test(html[at - 1]!) ? at + 1 : at));
    return [html.slice(cuts[0], cuts[1]), html.slice(cuts[1], cuts[2]), html.slice(cuts[2])];
  };

  /** One reply on the Claude subscription, as the ACP engine sends it. */
  const subscriptionReply = async (request: FakeSendRequest): Promise<AssistantRunResult> => {
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
    const plan = (input: number, output: number): AssistantUsage => ({ ...usage, inputTokens: usage.inputTokens + input, outputTokens: usage.outputTokens + output, cacheReadTokens: usage.cacheReadTokens + 20_000, totalTokens: usage.totalTokens + input + output + 20_000, budgetTokens: 0, estimatedCostUsd: 0, requests: usage.requests + 1 });
    const finish = (outcome: AssistantRunResult["outcome"]): AssistantRunResult => {
      stopRun = null;
      usage = plan(1200, 300);
      emit({ type: "usage", runId, usage, limits: LIMITS });
      emit({ type: "run_finished", runId, outcome, usage });
      return { runId, outcome, usage: copy(usage) };
    };
    let turn = 0;
    const say = (text: string) => {
      emit({ type: "turn_started", runId, turn: ++turn });
      emit({ type: "text_delta", runId, turn, delta: text });
    };
    let calls = 0;
    const toolUseId = () => `toolu_fake_${runs}_${++calls}`;

    await pause(0);
    emit({ type: "run_started", runId, model: request.model ?? MODELS[0]!.id, provider: "subscription" });

    if (options.subscriptionReply === "permission") {
      say("The checkout is wired up. I'll save the prototype so the change sticks.");
      const id = toolUseId();
      emit({ type: "tool_started", runId, toolUseId: id, name: "save_document", title: "Save document", detail: "" });
      const confirmationId = `perm-${runs}`;
      const answered = new Promise<{ approved: boolean; optionId: string | null }>((resolve) => answers.set(confirmationId, resolve));
      emit({
        type: "confirm_required",
        runId,
        confirmationId,
        toolUseId: id,
        kind: "permission",
        title: "Allow Claude to save this prototype?",
        message: "Claude wants to save this prototype. Claude Code asks before steps that reach outside this prototype.",
        count: 0,
        options: [
          { id: "allow-once", label: "Allow", kind: "allow_once" },
          { id: "allow-with-updates", label: "Allow for this chat", kind: "allow_always" },
          { id: "reject", label: "Don't allow", kind: "reject_once" },
        ],
      });
      const answer = await Promise.race([answered, stopSignal.then(() => ({ approved: false, optionId: null }))]);
      answers.delete(confirmationId);
      emit({ type: "confirm_resolved", runId, confirmationId, approved: answer.approved, ...(answer.optionId ? { optionId: answer.optionId } : {}) });
      if (stopped) return finish("stopped");
      if (answer.approved) {
        emit({ type: "tool_finished", runId, toolUseId: id, name: "save_document", status: "done", detail: "Saved", changedDocument: false });
        say("Saved.");
      } else {
        emit({ type: "tool_finished", runId, toolUseId: id, name: "save_document", status: "declined", detail: "You didn't allow it", changedDocument: false });
        say("Okay, I won't.");
      }
      return finish("completed");
    }

    // The design flow: preview_design with the page's head and first section, two appends, then import_design { preview: true }.
    say("I'll design a checkout screen that matches your prototype.");
    const hook = window.__sonobe;
    if (!hook) return finish("error");
    const target = request.context?.target;
    const name = target ? target.name : (options.name ?? "Checkout");
    const component = request.context?.component.id ?? hook.session.currentComponentId();
    const parts = options.previewParts ?? previewParts(options.html);
    let revision = 0;
    const show = (html: string | null, status: "writing" | "adding" | "cleared") =>
      hook.previewDesign({ docId: "fake-doc", key: "Assistant", author: { kind: "agent", name: "Assistant" }, name, component, replace: target?.id ?? null, width: null, height: null, position: null, html, status, draftRevision: ++revision });
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await Promise.race([pause(150), stopSignal]);
      if (i === 2 && options.hold !== undefined) await Promise.race([window.__fakeGate, stopSignal]);
      if (stopped) return finish("stopped");
      const id = toolUseId();
      emit({ type: "turn_started", runId, turn: ++turn });
      emit({ type: "tool_started", runId, toolUseId: id, name: "preview_design", title: "Preview design", detail: i === 0 ? name : "" });
      show(parts.slice(0, i + 1).join(""), "writing");
      emit({ type: "tool_finished", runId, toolUseId: id, name: "preview_design", status: "done", detail: `Showing “${name}” on the canvas`, changedDocument: false });
    }
    await Promise.race([pause(150), stopSignal]);
    if (stopped) return finish("stopped");
    const id = toolUseId();
    emit({ type: "turn_started", runId, turn: ++turn });
    emit({ type: "tool_started", runId, toolUseId: id, name: "import_design", title: "Import design", detail: name });
    show(options.html, "adding");
    const outcome = await hook.importHtml(options.html, { name, ...(target ? { replace: target.id } : {}) });
    show(null, outcome.ok ? "cleared" : "writing");
    if (!outcome.ok) {
      emit({ type: "tool_finished", runId, toolUseId: id, name: "import_design", status: "error", detail: outcome.message ?? "The design couldn't be added.", changedDocument: false });
      return finish("error");
    }
    const screenId = outcome.screenId ?? target?.id ?? "";
    const imported: AssistantImported = { docId: "fake-doc", screenId, txnId: hook.session.document.getState().lastChange?.txnId ?? null, name: outcome.screenName ?? name, replaced: target?.id ?? null, dropped: [], droppedCount: 0, lostConnections: outcome.summary?.lostConnections ?? 0 };
    emit({ type: "tool_finished", runId, toolUseId: id, name: "import_design", status: "done", detail: `Imported "${imported.name}" as layer ${screenId}.`, changedDocument: true, imported });
    say("Added a checkout screen with Apple Pay and a promo code. Try “Make it interactive” next.");
    return finish("completed");
  };

  /** What a send on the subscription fails with before it starts, as the engine says it. */
  const subscriptionError = (): AssistantRunResult | null => {
    if (!connection.subscriptionEnabled) return { runId: "", outcome: "error", error: { code: "subscription_off", message: "Claude subscription is off in Settings → Claude. Turn it back on, or start a new chat to use your API key." }, usage: copy(usage) };
    if (subscription.state === "signed_out") return { runId: "", outcome: "error", error: { code: "not_signed_in", message: options.signedOutError }, usage: copy(usage) };
    if (subscription.state === "not_installed") return { runId: "", outcome: "error", error: { code: "agent_not_installed", message: subscription.message ?? "Sonobe couldn't find Claude's agent adapter." }, usage: copy(usage) };
    return null;
  };

  const resetChat = () => {
    stopRun?.();
    messageCount = 0;
    chatProvider = null;
    usage = { ...usage, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, budgetTokens: 0, estimatedCostUsd: 0, requests: 0 };
  };

  const host: AssistantHostLike = {
    assistant: {
      status: async () => copy(status()),
      send: async (request) => {
        sent.push(copy(request));
        if (stopRun) return { runId: "", outcome: "error", error: { code: "busy", message: "The Assistant is still working on your last message. Stop it or wait for it to finish." }, usage: copy(usage) };
        if ((chatProvider ?? connection.active) === "subscription") {
          const failed = subscriptionError();
          if (failed) return failed;
          chatProvider = "subscription";
          return subscriptionReply(request);
        }
        if (!key) return { runId: "", outcome: "error", error: { code: "no_key", message: "Add your Anthropic API key to use the Assistant." }, usage: copy(usage) };
        chatProvider = "api_key";
        return reply(request);
      },
      stop: async () => {
        if (!stopRun) return false;
        stopRun();
        return true;
      },
      reset: async () => {
        resetChat();
        return copy(status());
      },
      confirm: async (confirmationId, approved, optionId) => {
        confirms.push([confirmationId, approved, optionId ?? null]);
        answers.get(confirmationId)?.({ approved, optionId: optionId ?? null });
        return true;
      },
      setConnection: async (update) => {
        connectionCalls.push(copy(update));
        const before = connection.active;
        connection = connectionOf({ ...connection, ...update });
        // Main resets this window's chat when what a new chat runs on changes.
        if (connection.active !== before) resetChat();
        return copy(status());
      },
      checkSubscription: async () => {
        await pause(50);
        subscription = { ...found };
        return copy(subscription);
      },
      signInToClaude: async () => {
        window.__fakeSignIns = (window.__fakeSignIns ?? 0) + 1;
        return { ok: true };
      },
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
