/**
 * Console ring buffer for prototype logs, runtime problems, and editor notices. Identical
 * consecutive messages collapse into one entry with a count. Store updates are batched per
 * microtask so a patch logging every frame doesn't re-render the HUD per message.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

export type ConsoleLevel = "log" | "info" | "warn" | "error";

export interface ConsoleEntry {
  id: string;
  /** Epoch ms of the latest occurrence. */
  timestamp: number;
  level: ConsoleLevel;
  /** Patch id, layer id, "prototype", "editor", "claude"... */
  source: string;
  /** "main" or "main/card" for patches inside component instances. */
  componentPath?: string;
  message: string;
  /** Occurrences collapsed into this entry. */
  count: number;
}

export interface ConsolePushOptions {
  source?: string;
  componentPath?: string;
}

export interface ConsoleState {
  /** Oldest first. */
  entries: ConsoleEntry[];
  counts: Record<ConsoleLevel, number>;
  push: (level: ConsoleLevel, args: string | readonly unknown[], options?: ConsolePushOptions) => void;
  clear: () => void;
  /** Apply pending pushes now (normally done on the next microtask). */
  flush: () => void;
}

export type ConsoleStore = StoreApi<ConsoleState>;

export interface ConsoleStoreOptions {
  /** Maximum entries kept. Default 1000. */
  capacity?: number;
  now?: () => number;
  /** Defers store updates; default queueMicrotask. Pass a synchronous runner in tests. */
  schedule?: (fn: () => void) => void;
}

const MAX_MESSAGE = 4000;

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack?.split("\n")[0] ?? arg.message;
  if (arg === undefined) return "undefined";
  if (typeof arg === "number" || typeof arg === "boolean" || arg === null || typeof arg === "bigint") return String(arg);
  if (typeof arg === "function") return `[function ${arg.name || "anonymous"}]`;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

/** Format log arguments into one line, the way a browser console joins them. */
export function formatConsoleArgs(args: string | readonly unknown[]): string {
  const text = typeof args === "string" ? args : args.map(formatArg).join(" ");
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

export function createConsoleStore(options: ConsoleStoreOptions = {}): ConsoleStore {
  const capacity = Math.max(1, options.capacity ?? 1000);
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((fn: () => void) => queueMicrotask(fn));
  let buffer: ConsoleEntry[] = [];
  let counts: Record<ConsoleLevel, number> = { log: 0, info: 0, warn: 0, error: 0 };
  let counter = 0;
  let scheduled = false;
  let dirty = false;

  const store = createStore<ConsoleState>()((set) => {
    const flush = () => {
      scheduled = false;
      if (!dirty) return;
      dirty = false;
      set({ entries: buffer.slice(), counts: { ...counts } });
    };
    return {
      entries: [],
      counts: { ...counts },
      push(level, args, pushOptions = {}) {
        const message = formatConsoleArgs(args);
        const source = pushOptions.source ?? "prototype";
        const last = buffer.at(-1);
        counts = { ...counts, [level]: counts[level] + 1 };
        if (last && last.level === level && last.source === source && last.message === message && last.componentPath === pushOptions.componentPath) {
          buffer[buffer.length - 1] = { ...last, count: last.count + 1, timestamp: now() };
        } else {
          const entry: ConsoleEntry = { id: `log_${++counter}`, timestamp: now(), level, source, message, count: 1 };
          if (pushOptions.componentPath !== undefined) entry.componentPath = pushOptions.componentPath;
          buffer.push(entry);
          if (buffer.length > capacity) buffer = buffer.slice(buffer.length - capacity);
        }
        dirty = true;
        if (!scheduled) {
          scheduled = true;
          schedule(flush);
        }
      },
      clear() {
        buffer = [];
        counts = { log: 0, info: 0, warn: 0, error: 0 };
        dirty = false;
        set({ entries: [], counts: { ...counts } });
      },
      flush,
    };
  });
  return store;
}
