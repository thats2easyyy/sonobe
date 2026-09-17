import { watch as fsWatch } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isIgnoredProjectPath, type OwnWriteRegistry } from "./project-io.ts";

export interface WatchHandle {
  on(event: "error", listener: (err: Error) => void): unknown;
  close(): void;
}

export type WatchFn = (dir: string, listener: (eventType: string, filename: string | null) => void) => WatchHandle;

export interface ProjectWatcherOptions {
  dir: string;
  /** Sorted POSIX paths. "." means "something changed but the platform didn't say what". */
  onChange(paths: string[]): void;
  onError?(err: Error): void;
  /** Quiet period before reporting. Default 200 ms. */
  debounceMs?: number;
  ownWrites?: OwnWriteRegistry;
  /** Injectable for tests; defaults to recursive fs.watch. */
  watch?: WatchFn;
}

export interface ProjectWatcher {
  close(): void;
  /** Report pending changes now (tests, and before a reload). */
  flush(): Promise<void>;
}

const defaultWatch: WatchFn = (dir, listener) => fsWatch(dir, { recursive: true, persistent: false }, (eventType, filename) => listener(eventType, filename ? String(filename) : null));

/** Debounced recursive watcher that ignores this process's own writes. */
export function createProjectWatcher(opts: ProjectWatcherOptions): ProjectWatcher {
  const root = path.resolve(opts.dir);
  const debounceMs = opts.debounceMs ?? 200;
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let flushing: Promise<void> = Promise.resolve();

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
  };

  const readCurrent = async (rel: string): Promise<Uint8Array | null> => {
    try {
      return await readFile(path.join(root, ...rel.split("/")));
    } catch {
      return null;
    }
  };

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    flushing = flushing.then(async () => {
      if (closed || pending.size === 0) return;
      const batch = [...pending];
      pending.clear();
      const report: string[] = [];
      for (const rel of batch) {
        if (rel !== "." && opts.ownWrites?.has(root, rel)) {
          const current = await readCurrent(rel);
          if (opts.ownWrites.matches(root, rel, current)) continue;
          opts.ownWrites.forget(root, rel);
        }
        report.push(rel);
      }
      if (report.length && !closed) opts.onChange(report.sort());
    });
    return flushing;
  };

  const handle = (opts.watch ?? defaultWatch)(root, (_eventType, filename) => {
    if (closed) return;
    const rel = filename ? filename.split(path.sep).join("/").replace(/^\.\//, "") : ".";
    if (rel !== "." && (isIgnoredProjectPath(rel) || rel.startsWith(".sonobe/") || rel === ".sonobe")) return;
    pending.add(rel);
    schedule();
  });
  handle.on("error", (err) => {
    opts.onError?.(err);
  });

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      pending.clear();
      handle.close();
    },
    flush,
  };
}
