/**
 * The Assistant's controller, shared by the drawer and the canvas's Design with Claude box: talks to
 * window.sonobeHost (assistant, secrets, openExternal) and folds everything into an AssistantState
 * store. Host-agnostic and DOM-free, so it's unit-tested with a fake host. In the browser (no host)
 * every action is a no-op and the drawer shows a desktop-only notice.
 */

import type { StoreApi } from "zustand/vanilla";
import { assistantStore, nextItemId, reduceEvent, type AssistantState } from "./assistantStore.ts";
import { validateApiKey } from "./format.ts";
import {
  ANTHROPIC_CONSOLE_KEYS_URL,
  ASSISTANT_KEY_SECRET,
  getAssistantHost,
  supportsAssistant,
  type AssistantCanvasContext,
  type AssistantCodeFolderLinkResult,
  type AssistantCodeFolderStatus,
  type AssistantHostLike,
  type AssistantRunResult,
} from "./types.ts";

export interface SaveKeyResult {
  ok: boolean;
  /** Why it wasn't saved or didn't work. */
  message?: string;
}

export interface AssistantController {
  /** False in the browser or with an older desktop preload. */
  readonly available: boolean;
  refresh(): Promise<void>;
  /** Validate, store in the keychain, then check it with one small API call. */
  saveKey(raw: string): Promise<SaveKeyResult>;
  removeKey(): Promise<void>;
  checkKey(): Promise<void>;
  /** With `context`, the message comes from the canvas's Design with Claude box (its transcript item says so). */
  send(text: string, options?: { context?: AssistantCanvasContext }): Promise<AssistantRunResult | null>;
  stop(): Promise<void>;
  newChat(): Promise<void>;
  confirm(confirmationId: string, approved: boolean): Promise<void>;
  /** The code folder linked to this window's prototype, into status.codeFolder. Null when the host can't link one. */
  codeFolder(): Promise<AssistantCodeFolderStatus | null>;
  /** Shows the native folder dialog (Match my code…). Null when the host can't link one. */
  linkCodeFolder(): Promise<AssistantCodeFolderLinkResult | null>;
  unlinkCodeFolder(): Promise<AssistantCodeFolderStatus | null>;
  /** Open console.anthropic.com's API keys page in the browser. */
  openConsole(): void;
  /** Subscribe to host events again after dispose() (React StrictMode remounts). Controllers start attached. */
  attach(): void;
  /** Stop folding host events into the store. */
  dispose(): void;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createAssistantController(host: AssistantHostLike | null, store: StoreApi<AssistantState>): AssistantController {
  if (!supportsAssistant(host)) {
    const noop = async () => undefined;
    return {
      available: false,
      refresh: noop,
      saveKey: async () => ({ ok: false, message: "The Assistant runs in the Sonobe desktop app." }),
      removeKey: noop,
      checkKey: noop,
      send: async () => null,
      stop: noop,
      newChat: noop,
      confirm: noop,
      codeFolder: async () => null,
      linkCodeFolder: async () => null,
      unlinkCodeFolder: async () => null,
      openConsole: () => openLink(host, ANTHROPIC_CONSOLE_KEYS_URL),
      attach: () => undefined,
      dispose: () => undefined,
    };
  }
  const { assistant, secrets } = host;
  let disposed = false;
  let unsubscribe: (() => void) | null = null;

  const attach = () => {
    disposed = false;
    unsubscribe ??= assistant.onEvent((event) => {
      if (!disposed) store.setState((state) => reduceEvent(state, event));
    });
  };
  attach();

  const addNotice = (tone: "info" | "warn" | "error", text: string, code?: string) =>
    store.setState((s) => ({ items: [...s.items, { kind: "notice", id: nextItemId("notice"), tone, text, ...(code ? { code } : {}) }] }));

  const refresh = async () => {
    try {
      const status = await assistant.status();
      if (disposed) return;
      store.setState((s) => {
        const model = status.models.some((m) => m.id === s.model) ? s.model : status.defaultModel;
        return { status, statusError: null, usage: status.usage, limits: status.limits, model, ...(status.running ? {} : s.runId === null ? { running: false } : {}) };
      });
    } catch (err) {
      if (!disposed) store.setState({ statusError: messageOf(err) });
    }
  };

  const setCodeFolder = (codeFolder: AssistantCodeFolderStatus) => store.setState((s) => (s.status ? { status: { ...s.status, codeFolder } } : {}));

  const checkKey = async () => {
    store.setState({ keyCheck: { state: "checking" } });
    try {
      const result = await assistant.checkKey();
      store.setState({ keyCheck: result.ok ? { state: "ok" } : { state: "error", message: result.error?.message ?? "The key didn't work." } });
    } catch (err) {
      store.setState({ keyCheck: { state: "error", message: messageOf(err) } });
    }
  };

  return {
    available: true,
    refresh,
    async saveKey(raw) {
      const check = validateApiKey(raw);
      if (!check.ok) return { ok: false, message: check.error! };
      try {
        await secrets.set(ASSISTANT_KEY_SECRET, check.value);
      } catch (err) {
        return { ok: false, message: `Sonobe couldn't save the key: ${messageOf(err)}` };
      }
      await refresh();
      await checkKey();
      const keyCheck = store.getState().keyCheck;
      return keyCheck.state === "error" ? { ok: false, message: keyCheck.message } : { ok: true };
    },
    async removeKey() {
      try {
        await secrets.delete(ASSISTANT_KEY_SECRET);
      } catch (err) {
        addNotice("error", `Sonobe couldn't remove the key: ${messageOf(err)}`);
      }
      store.setState({ keyCheck: { state: "idle" } });
      await refresh();
    },
    checkKey,
    async send(raw, options = {}) {
      const text = raw.trim();
      const state = store.getState();
      if (!text || state.running) return null;
      const { context } = options;
      store.setState((s) => ({ items: [...s.items, { kind: "user", id: nextItemId("user"), text, ...(context ? { origin: "canvas" as const } : {}) }], running: true, runId: null }));
      let result: AssistantRunResult;
      try {
        result = await assistant.send({ text, model: store.getState().model, ...(context ? { context } : {}) });
      } catch (err) {
        store.setState({ running: false, runId: null, thinking: false });
        addNotice("error", `The Assistant couldn't start: ${messageOf(err)}`);
        return null;
      }
      const now = store.getState();
      // Failures before the run started (no key, busy…) arrive only through the result.
      if (now.running && (now.runId === null || now.runId === result.runId)) {
        store.setState({ running: false, runId: null, thinking: false, usage: result.usage });
        if (result.error) addNotice("error", result.error.message, result.error.code);
      }
      if (result.error?.code === "no_key" || result.error?.code === "invalid_key") await refresh();
      return result;
    },
    async stop() {
      try {
        await assistant.stop();
      } catch (err) {
        addNotice("error", `Couldn't stop the Assistant: ${messageOf(err)}`);
      }
    },
    async newChat() {
      try {
        const status = await assistant.reset();
        store.setState({ items: [], running: false, runId: null, thinking: false, status, usage: status.usage, limits: status.limits });
      } catch (err) {
        addNotice("error", `Couldn't start a new chat: ${messageOf(err)}`);
      }
    },
    async confirm(confirmationId, approved) {
      store.setState((s) => ({ items: s.items.map((i) => (i.kind === "confirm" && i.id === confirmationId && i.status === "pending" ? { ...i, status: approved ? "approved" : "declined" } : i)) }));
      try {
        await assistant.confirm(confirmationId, approved);
      } catch (err) {
        addNotice("error", `Couldn't send your answer: ${messageOf(err)}`);
      }
    },
    async codeFolder() {
      if (!assistant.codeFolder) return null;
      try {
        const status = await assistant.codeFolder();
        setCodeFolder(status);
        return status;
      } catch {
        // The status keeps the last folder it knew; the next refresh tries again.
        return null;
      }
    },
    async linkCodeFolder() {
      if (!assistant.linkCodeFolder) return null;
      try {
        const result = await assistant.linkCodeFolder();
        setCodeFolder(result.status);
        return result;
      } catch (err) {
        return { status: store.getState().status?.codeFolder ?? { linked: null, missing: false }, error: `Sonobe couldn't link the folder: ${messageOf(err)}` };
      }
    },
    async unlinkCodeFolder() {
      if (!assistant.unlinkCodeFolder) return null;
      try {
        const status = await assistant.unlinkCodeFolder();
        setCodeFolder(status);
        return status;
      } catch (err) {
        addNotice("error", `Couldn't unlink the code folder: ${messageOf(err)}`);
        return null;
      }
    },
    openConsole: () => openLink(host, ANTHROPIC_CONSOLE_KEYS_URL),
    attach,
    dispose() {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}

let shared: AssistantController | null = null;

/**
 * The app-wide controller for window.sonobeHost and assistantStore. It's never disposed, so a reply
 * keeps streaming into the transcript while the drawer is closed or remounting.
 */
export function sharedAssistantController(): AssistantController {
  return (shared ??= createAssistantController(getAssistantHost(), assistantStore));
}

/** Open a link in the system browser (desktop) or a new tab. */
export function openLink(host: AssistantHostLike | null, url: string): void {
  if (host?.openExternal) {
    void Promise.resolve(host.openExternal(url)).catch(() => undefined);
    return;
  }
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}
