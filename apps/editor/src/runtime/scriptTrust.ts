/**
 * Script trust: a project opened from disk that contains JavaScript patches runs its scripts only
 * after the person trusts it. Trust is remembered per project path. Documents made in this session
 * (the demo, new prototypes, pasted or agent-added scripts in a trusted document) don't ask.
 *
 * The runtime host gates the `javascript` patch through `withScriptTrust` and restarts the prototype
 * when trust is granted. The shell renders the state (a banner while `required && !trusted`) and
 * calls `trust()` or `request()`.
 */

import type { Id, SonobeDocument } from "@sonobe/core";
import type { EngineRegistry, PatchDefinition } from "@sonobe/engine";
import { createStore, type StoreApi } from "zustand/vanilla";

/** Patch type that runs project scripts. */
export const SCRIPT_PATCH_TYPE = "javascript";

export interface TrustPersistence {
  isTrusted(path: string): boolean;
  trust(path: string): void;
  revoke(path: string): void;
  list(): string[];
}

export function createMemoryTrustPersistence(initial: readonly string[] = []): TrustPersistence {
  const paths = new Set(initial);
  return {
    isTrusted: (path) => paths.has(path),
    trust: (path) => void paths.add(path),
    revoke: (path) => void paths.delete(path),
    list: () => [...paths].sort(),
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Trusted project paths kept in localStorage (memory only when storage is blocked). */
export function createLocalTrustPersistence(options: { storage?: StorageLike | null; key?: string } = {}): TrustPersistence {
  const key = options.key ?? "sonobe.trustedProjects";
  const storage = (): StorageLike | null => {
    if (options.storage !== undefined) return options.storage;
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  const paths = new Set<string>();
  try {
    const value: unknown = JSON.parse(storage()?.getItem(key) ?? "[]");
    if (Array.isArray(value)) for (const p of value) if (typeof p === "string") paths.add(p);
  } catch {
    // Unreadable: start empty.
  }
  const save = () => {
    try {
      storage()?.setItem(key, JSON.stringify([...paths].slice(-500)));
    } catch {
      // Storage blocked: trust lasts for this session.
    }
  };
  return {
    isTrusted: (path) => paths.has(path),
    trust(path) {
      paths.add(path);
      save();
    },
    revoke(path) {
      paths.delete(path);
      save();
    },
    list: () => [...paths].sort(),
  };
}

/** JavaScript patches in every component of a document. */
export function scriptPatchCount(doc: SonobeDocument): number {
  let count = 0;
  for (const component of Object.values(doc.components)) for (const node of Object.values(component.patches)) if (node.type === SCRIPT_PATCH_TYPE) count++;
  return count;
}

export interface ScriptTrustState {
  /** Scripts wait for the person's trust (a project with JavaScript patches opened from disk). */
  required: boolean;
  /** The person trusts this project (always true when trust isn't required). */
  trusted: boolean;
  projectPath: string | null;
  /** JavaScript patches in the document. */
  scriptCount: number;
  /** A trust prompt is open (request). */
  requesting: boolean;
}

export interface TrustPromptInfo {
  projectPath: string;
  scriptCount: number;
  name?: string;
}

export interface ScriptTrustOptions {
  persistence?: TrustPersistence;
  /** Ask the person (the session shows a dialog). Without it, request() resolves false. */
  confirm?: (info: TrustPromptInfo) => Promise<boolean>;
}

export interface ScriptTrustStore extends StoreApi<ScriptTrustState> {
  /** Scripts may run now. */
  allowed(): boolean;
  /** Recompute for a document that was just opened or reloaded. `fromDisk` defaults to projectPath !== null. */
  evaluate(doc: SonobeDocument, projectPath: string | null, options?: { fromDisk?: boolean; name?: string }): void;
  /** Update the script count after an edit (trust doesn't change). */
  noteDocument(doc: SonobeDocument): void;
  /** Trust the current project; remembered for its path unless remember is false. */
  trust(options?: { remember?: boolean }): void;
  /** Stop trusting the current project (and forget it). */
  revoke(): void;
  /** Remember trust for a path (a project the person authored and saved). */
  rememberPath(path: string): void;
  /** Ask the person to trust the project; resolves whether scripts may run. */
  request(): Promise<boolean>;
  /** Called whenever `allowed()` changes. */
  subscribeAllowed(cb: (allowed: boolean) => void): () => void;
}

export function createScriptTrustStore(options: ScriptTrustOptions = {}): ScriptTrustStore {
  const persistence = options.persistence ?? createLocalTrustPersistence();
  const sessionTrusted = new Set<string>();
  let name: string | undefined;
  let pending: Promise<boolean> | null = null;

  const store = createStore<ScriptTrustState>()(() => ({ required: false, trusted: true, projectPath: null, scriptCount: 0, requesting: false }));
  const allowed = () => {
    const s = store.getState();
    return !s.required || s.trusted;
  };
  const isTrustedPath = (path: string) => sessionTrusted.has(path) || persistence.isTrusted(path);

  const api: Omit<ScriptTrustStore, keyof StoreApi<ScriptTrustState>> = {
    allowed,
    evaluate(doc, projectPath, evaluateOptions = {}) {
      name = evaluateOptions.name ?? doc.project.name;
      const scriptCount = scriptPatchCount(doc);
      const fromDisk = evaluateOptions.fromDisk ?? projectPath !== null;
      const required = fromDisk && projectPath !== null && scriptCount > 0;
      store.setState({ required, trusted: !required || isTrustedPath(projectPath!), projectPath, scriptCount });
    },
    noteDocument(doc) {
      const scriptCount = scriptPatchCount(doc);
      if (scriptCount !== store.getState().scriptCount) store.setState({ scriptCount });
    },
    trust(trustOptions = {}) {
      const { projectPath } = store.getState();
      if (projectPath !== null) {
        sessionTrusted.add(projectPath);
        if (trustOptions.remember !== false) persistence.trust(projectPath);
      }
      store.setState({ trusted: true });
    },
    revoke() {
      const { projectPath, required } = store.getState();
      if (projectPath !== null) {
        sessionTrusted.delete(projectPath);
        persistence.revoke(projectPath);
      }
      store.setState({ trusted: !required });
    },
    rememberPath(path) {
      sessionTrusted.add(path);
      persistence.trust(path);
    },
    request() {
      if (allowed()) return Promise.resolve(true);
      if (pending) return pending;
      const { projectPath, scriptCount } = store.getState();
      if (!options.confirm || projectPath === null) return Promise.resolve(false);
      store.setState({ requesting: true });
      pending = options
        .confirm({ projectPath, scriptCount, ...(name !== undefined ? { name } : {}) })
        .catch(() => false)
        .then((ok) => {
          pending = null;
          store.setState({ requesting: false });
          if (ok && store.getState().projectPath === projectPath) api.trust();
          return allowed();
        });
      return pending;
    },
    subscribeAllowed(cb) {
      let last = allowed();
      return store.subscribe(() => {
        const next = allowed();
        if (next !== last) {
          last = next;
          cb(next);
        }
      });
    },
  };
  return Object.assign(store, api);
}

/** A registry whose JavaScript patch evaluates only while `allowed()`; otherwise it raises one "script_untrusted" warning. */
export function withScriptTrust<R extends EngineRegistry>(registry: R, allowed: () => boolean): R {
  const original = registry.definitions.get(SCRIPT_PATCH_TYPE);
  if (!original) return registry;
  const gated: PatchDefinition = {
    ...original,
    evaluate(ctx) {
      if (allowed()) {
        original.evaluate.call(original, ctx);
        return;
      }
      const issue = (ctx.services as Partial<Pick<typeof ctx.services, "issue">>).issue;
      const message = `Scripts in this project are paused. Trust the project to run "${ctx.node.name ?? (ctx.id as Id)}".`;
      if (typeof issue === "function") issue.call(ctx.services, "script_untrusted", "warning", message);
      else ctx.warnOnce?.("script_untrusted", message);
    },
  };
  const definitions = new Map(registry.definitions);
  definitions.set(SCRIPT_PATCH_TYPE, gated);
  const copy = Object.create(Object.getPrototypeOf(registry) as object) as R;
  Object.assign(copy, registry, { definitions });
  return copy;
}
