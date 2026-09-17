/**
 * The document store: the SonobeDocument, its revision, undo history (core History), dirty
 * tracking, and the project on disk. Every mutation goes through `apply`, which wraps core
 * `applyOps` (atomic by default) and records an author-attributed history group.
 */

import {
  applyOps,
  componentItemIds,
  createEmptyDocument,
  createHistory,
  describeHistoryEntry,
  makeError,
  serializeDocument,
  type Affected,
  type ApplyOpsResult,
  type Author,
  type CreateDocumentOptions,
  type HistoryEntry,
  type HistoryOptions,
  type HistoryStep,
  type Id,
  type Op,
  type Registry,
  type SonobeDocument,
  type SonobeError,
} from "@sonobe/core";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { HostAdapter } from "../host/types.ts";

export const HUMAN_AUTHOR: Author = { kind: "human", name: "You" };
export const CLAUDE_AUTHOR: Author = { kind: "agent", name: "Claude" };

export interface ApplyInput {
  /** Human-first history label: "Add Card", "added press animation". */
  label: string;
  /** Default {kind: "human", name: "You"}. */
  author?: Author;
  /**
   * Consecutive applies with the same key and author merge into one undo group. Without `gesture`
   * they merge while they arrive within the history's coalesce window (1 s by default).
   */
  coalesceKey?: string;
  /**
   * Explicit gesture phases for `coalesceKey` (a scrub, a drag): "begin" starts a new group, and
   * "update" and "end" merge into it however long the gesture lasts, until "end" or `endGesture`.
   * An "update" or "end" without an open gesture starts one.
   */
  gesture?: "begin" | "update" | "end";
  dryRun?: boolean;
  /** Fail with "revision_mismatch" unless the store is at this revision. */
  expectedRevision?: number;
  /** Default true. */
  atomic?: boolean;
  /** Component for ops without `component`. */
  defaultComponent?: Id;
}

export type DocumentChangeKind = "apply" | "undo" | "redo" | "replace" | "reload";

export interface DocumentChange {
  kind: DocumentChangeKind;
  revision: number;
  /** Who made the change (for undo/redo: who undid it). */
  author: Author;
  label: string;
  txnId?: string;
  affected: Affected;
  opCount: number;
  timestamp: number;
}

export interface HistoryListEntry {
  txnId: string;
  label: string;
  author: Author;
  revision: number;
  opCount: number;
  timestamp: number;
  /** "Claude: added press animation (12 ops)" */
  description: string;
}

export interface HistoryStepResult {
  ok: boolean;
  /** Groups undone or redone. */
  entries: HistoryEntry[];
  errors: SonobeError[];
  revision: number;
}

export interface FileResult {
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  error?: string;
  errorCode?: string;
}

export interface PendingExternalChange {
  path: string;
  paths: string[];
  document: SonobeDocument;
  detectedAt: number;
}

export type DocumentStatus = "idle" | "opening" | "saving";

export interface ReplaceOptions {
  /** Default: keep the current path. */
  projectPath?: string | null;
  /** Keep undo history (external reloads). Default false. */
  keepHistory?: boolean;
  /** The new document matches what's on disk. Default true. */
  saved?: boolean;
  kind?: "replace" | "reload";
  label?: string;
  author?: Author;
}

export interface DocumentState {
  doc: SonobeDocument;
  /** Increments on every apply, undo, redo, and replace. */
  revision: number;
  lastSavedRevision: number;
  /** Unsaved changes (undoing back to the saved state clears it). */
  dirty: boolean;
  projectPath: string | null;
  status: DocumentStatus;
  canUndo: boolean;
  canRedo: boolean;
  /** "You: Add Card" */
  undoLabel: string | null;
  redoLabel: string | null;
  lastChange: DocumentChange | null;
  /** External edits that arrived while there were unsaved changes. */
  externalChange: PendingExternalChange | null;

  apply: (ops: readonly Op[], input: ApplyInput) => ApplyOpsResult;
  /** Close the open gesture (optionally only when it has this coalesce key); the next apply starts a new undo group. */
  endGesture: (coalesceKey?: string) => void;
  undo: (author?: Author) => HistoryStepResult;
  redo: (author?: Author) => HistoryStepResult;
  /** Undo every group up to and including `txnId`. */
  undoTo: (txnId: string, author?: Author) => HistoryStepResult;
  replaceDocument: (doc: SonobeDocument, options?: ReplaceOptions) => void;
  /** Start an unsaved document: empty (from `options`), or `document` when given (templates). */
  newDocument: (options?: CreateDocumentOptions, document?: SonobeDocument) => void;
  /** Open `path`, or ask the host for one. */
  open: (path?: string) => Promise<FileResult>;
  save: () => Promise<FileResult>;
  saveAs: () => Promise<FileResult>;
  /** Re-read the project from disk; reloads when clean, otherwise sets `externalChange`. */
  checkExternalChanges: (paths?: readonly string[]) => Promise<void>;
  /** Replace the document with the pending external version. */
  acceptExternalChange: () => void;
  /** Keep local edits; the document stays dirty. */
  dismissExternalChange: () => void;
  /** Undoable groups, newest first. */
  historyEntries: (limit?: number) => HistoryListEntry[];
  /** Redoable groups, next redo first. */
  redoEntries: (limit?: number) => HistoryListEntry[];
  /** Called after every revision change with the new and previous state. */
  subscribeRevision: (cb: (state: DocumentState, previous: DocumentState) => void) => () => void;
  /** True for ids removed this session, which new items never reuse. */
  isReservedId: (id: Id) => boolean;
  dispose: () => void;
}

export type DocumentStore = StoreApi<DocumentState>;

export interface DocumentStoreOptions {
  registry: Registry;
  host?: HostAdapter | null;
  document?: SonobeDocument;
  projectPath?: string | null;
  history?: HistoryOptions;
  now?: () => number;
}

const EMPTY_AFFECTED: Affected = { components: [], layers: [], patches: [] };

/** A valid author, or the human default. */
export function normalizeAuthor(input: unknown, fallback: Author = HUMAN_AUTHOR): Author {
  if (!input || typeof input !== "object") return { ...fallback };
  const a = input as { kind?: unknown; name?: unknown };
  const kind = a.kind === "agent" || a.kind === "human" ? a.kind : fallback.kind;
  const name = typeof a.name === "string" && a.name.trim() ? a.name.trim().slice(0, 64) : fallback.name;
  return { kind, name };
}

const toListEntry = (entry: HistoryEntry): HistoryListEntry => ({
  txnId: entry.txnId,
  label: entry.label,
  author: { ...entry.author },
  revision: entry.revision,
  opCount: entry.ops.length,
  timestamp: entry.timestamp,
  description: describeHistoryEntry(entry),
});

function mergeAffected(into: { components: Set<Id>; layers: Set<Id>; patches: Set<Id> }, a: Affected): void {
  for (const id of a.components) into.components.add(id);
  for (const id of a.layers) into.layers.add(id);
  for (const id of a.patches) into.patches.add(id);
}

function sameDocumentContent(a: SonobeDocument, b: SonobeDocument): boolean {
  if (a === b) return true;
  const fa = serializeDocument(a);
  const fb = serializeDocument(b);
  const ka = Object.keys(fa);
  return ka.length === Object.keys(fb).length && ka.every((k) => fa[k] === fb[k]);
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const errorCode = (err: unknown) => (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : "io_error");

const sameAuthor = (a: Author, b: Author) => a.kind === b.kind && a.name === b.name;

/** The undo group applies with a coalesce key are merging into. */
interface CoalesceGroup {
  key: string;
  /** Unique per group, so core History merges only what this store decides to merge. */
  stored: string;
  author: Author;
  txnId: string;
  at: number;
  /** Started by an explicit gesture (no time window). */
  gesture: boolean;
  /** The gesture hasn't ended. */
  open: boolean;
}

export function createDocumentStore(options: DocumentStoreOptions): DocumentStore {
  const registry = options.registry;
  const host = options.host ?? null;
  const now = options.now ?? (() => Date.now());
  const coalesceWindowMs = options.history?.coalesceWindowMs ?? 1000;
  // The store decides what merges (time windows and gestures); History merges whatever shares a key.
  const history = createHistory({ ...options.history, coalesceWindowMs: Number.POSITIVE_INFINITY, now: options.history?.now ?? now });
  let group: CoalesceGroup | null = null;
  let groupCounter = 0;
  /** Ids removed this session; never generated again (ARCHITECTURE §3.2). */
  const removedIds = new Set<Id>();
  let savedKey = "";
  let forcedDirty = false;
  let unwatch: (() => void) | null = null;
  let disposed = false;

  const positionKey = () => {
    const top = history.peekUndo();
    return top ? `${top.txnId}@${top.revision}` : "empty";
  };
  const isDirty = () => forcedDirty || positionKey() !== savedKey;
  const historyFlags = () => {
    const undo = history.peekUndo();
    const redo = history.peekRedo();
    return { canUndo: !!undo, canRedo: !!redo, undoLabel: undo ? describeHistoryEntry(undo) : null, redoLabel: redo ? describeHistoryEntry(redo) : null };
  };
  savedKey = positionKey();

  const store: DocumentStore = createStore<DocumentState>()((set, get) => {
    const commit = (doc: SonobeDocument, change: DocumentChange) => {
      set({ doc, revision: history.revision, lastChange: change, dirty: isDirty(), ...historyFlags() });
    };

    const trackRemoved = (before: SonobeDocument, after: SonobeDocument, components: readonly Id[]) => {
      for (const id of components) {
        const b = before.components[id];
        if (!b) continue;
        const a = after.components[id];
        const keep = a ? componentItemIds(a) : new Set<Id>();
        for (const item of componentItemIds(b)) if (!keep.has(item)) removedIds.add(item);
      }
    };

    const replay = (kind: "undo" | "redo", steps: HistoryStep[], author: Author): HistoryStepResult => {
      group = null;
      let doc = get().doc;
      const affected = { components: new Set<Id>(), layers: new Set<Id>(), patches: new Set<Id>() };
      let opCount = 0;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        const r = applyOps(doc, step.ops, { registry, lenient: true });
        if (!r.ok) {
          // Put the popped groups back where they were; the document is untouched.
          for (let j = 0; j <= i; j++) {
            if (kind === "undo") history.redo();
            else history.undo();
          }
          set({ revision: history.revision, ...historyFlags(), dirty: isDirty() });
          const reason = r.errors[0];
          const error = makeError("history_conflict", `Couldn't ${kind} "${step.entry.label}": ${reason?.message ?? "the document changed underneath it"}`, {
            hint: "The document was edited in a way this step can't reverse.",
          });
          return { ok: false, entries: [], errors: [error, ...r.errors], revision: history.revision };
        }
        doc = r.doc;
        mergeAffected(affected, r.affected);
        opCount += step.ops.length;
      }
      const last = steps.at(-1)!.entry;
      const label = steps.length === 1 ? `${kind === "undo" ? "Undo" : "Redo"} ${describeHistoryEntry(last)}` : `${kind === "undo" ? "Undo" : "Redo"} ${steps.length} changes`;
      commit(doc, {
        kind,
        revision: history.revision,
        author,
        label,
        txnId: last.txnId,
        affected: { components: [...affected.components].sort(), layers: [...affected.layers].sort(), patches: [...affected.patches].sort() },
        opCount,
        timestamp: now(),
      });
      return { ok: true, entries: steps.map((s) => s.entry), errors: [], revision: history.revision };
    };

    const watch = (path: string | null) => {
      unwatch?.();
      unwatch = null;
      if (!path || !host?.capabilities.watch || disposed) return;
      unwatch = host.watchProject(path, (paths) => {
        void get().checkExternalChanges(paths);
      });
    };

    const replaceDocument = (doc: SonobeDocument, replaceOptions: ReplaceOptions = {}) => {
      group = null;
      if (replaceOptions.keepHistory) history.bump();
      else {
        history.clear();
        removedIds.clear();
      }
      const saved = replaceOptions.saved !== false;
      if (saved) {
        savedKey = positionKey();
        forcedDirty = false;
      } else {
        forcedDirty = true;
      }
      const projectPath = replaceOptions.projectPath === undefined ? get().projectPath : replaceOptions.projectPath;
      set({
        doc,
        revision: history.revision,
        lastSavedRevision: saved ? history.revision : get().lastSavedRevision,
        projectPath,
        externalChange: null,
        dirty: isDirty(),
        ...historyFlags(),
        lastChange: {
          kind: replaceOptions.kind ?? "replace",
          revision: history.revision,
          author: normalizeAuthor(replaceOptions.author),
          label: replaceOptions.label ?? (replaceOptions.kind === "reload" ? "Reloaded from disk" : "Opened document"),
          affected: { ...EMPTY_AFFECTED, components: Object.keys(doc.components).sort() },
          opCount: 0,
          timestamp: now(),
        },
      });
    };

    const writeTo = async (path: string, copyAssetsFrom: string | null): Promise<FileResult> => {
      if (!host) return { ok: false, error: "There's nowhere to save in this environment.", errorCode: "no_host" };
      const name = host.displayName(path);
      const current = get();
      if (current.doc.project.name === "Untitled" && name && name !== "Untitled") {
        current.apply([{ op: "setProject", changes: { name } }], { label: `Name prototype "${name}"` });
      }
      const { doc, revision } = get();
      const key = positionKey();
      set({ status: "saving" });
      try {
        await host.writeProject(path, doc, { copyAssetsFrom: copyAssetsFrom && copyAssetsFrom !== path ? copyAssetsFrom : null });
        savedKey = key;
        forcedDirty = false;
        const moved = get().projectPath !== path;
        set({ projectPath: path, lastSavedRevision: revision, dirty: isDirty(), externalChange: null });
        if (moved || !unwatch) watch(path);
        return { ok: true, path };
      } catch (err) {
        return { ok: false, path, error: errorMessage(err), errorCode: errorCode(err) };
      } finally {
        set({ status: "idle" });
      }
    };

    return {
      doc: options.document ?? createEmptyDocument(),
      revision: history.revision,
      lastSavedRevision: history.revision,
      dirty: false,
      projectPath: options.projectPath ?? null,
      status: "idle",
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      lastChange: null,
      externalChange: null,

      apply(ops, input) {
        const s = get();
        const author = normalizeAuthor(input.author);
        if (input.expectedRevision !== undefined && input.expectedRevision !== s.revision) {
          const error = makeError("revision_mismatch", `The document is at revision ${s.revision}, not ${input.expectedRevision}: it changed since you last read it.`, {
            hint: "Read the document again, then retry.",
          });
          return { ok: false, doc: s.doc, results: [], errors: [error], idMap: {}, inverse: [], applied: [], affected: { ...EMPTY_AFFECTED } };
        }
        const result = applyOps(s.doc, ops, {
          registry,
          atomic: input.atomic,
          dryRun: input.dryRun,
          defaultComponent: input.defaultComponent,
          reservedIds: removedIds,
        });
        if (input.dryRun) return result;
        if (result.doc === s.doc || result.applied.length === 0) {
          if (input.gesture === "end") get().endGesture(input.coalesceKey);
          return result;
        }
        trackRemoved(s.doc, result.doc, result.affected.components);
        const key = input.coalesceKey;
        if (key !== undefined) {
          const top = history.peekUndo();
          const sameGroup = group !== null && group.key === key && sameAuthor(group.author, author) && top?.txnId === group.txnId;
          const continuing =
            sameGroup && (group!.gesture ? group!.open && input.gesture !== "begin" : input.gesture === undefined && now() - group!.at <= coalesceWindowMs);
          if (!continuing) {
            const gesture = input.gesture !== undefined;
            group = { key, stored: `${key} ${++groupCounter}`, author: { ...author }, txnId: "", at: 0, gesture, open: gesture };
          }
        }
        const coalescing = key !== undefined ? group : null;
        const entry = history.push({
          label: input.label,
          author,
          ops: result.applied,
          inverse: result.inverse,
          ...(coalescing ? { coalesceKey: coalescing.stored } : {}),
        });
        if (coalescing) {
          coalescing.txnId = entry.txnId;
          coalescing.at = now();
          if (input.gesture === "end") coalescing.open = false;
        } else {
          group = null;
        }
        commit(result.doc, { kind: "apply", revision: history.revision, author, label: input.label, txnId: entry.txnId, affected: result.affected, opCount: result.applied.length, timestamp: now() });
        return result;
      },

      endGesture(coalesceKey) {
        if (group?.gesture && (coalesceKey === undefined || group.key === coalesceKey)) group.open = false;
      },

      undo(author = HUMAN_AUTHOR) {
        const step = history.undo();
        return step ? replay("undo", [step], normalizeAuthor(author)) : { ok: false, entries: [], errors: [], revision: history.revision };
      },

      redo(author = HUMAN_AUTHOR) {
        const step = history.redo();
        return step ? replay("redo", [step], normalizeAuthor(author)) : { ok: false, entries: [], errors: [], revision: history.revision };
      },

      undoTo(txnId, author = HUMAN_AUTHOR) {
        const steps = history.undoTo(txnId);
        if (!steps?.length) {
          return { ok: false, entries: [], errors: [makeError("not_found", `There's no undoable change "${txnId}".`, { hint: "List the history to see which changes can be undone." })], revision: history.revision };
        }
        return replay("undo", steps, normalizeAuthor(author));
      },

      replaceDocument,

      newDocument(createOptions, document) {
        watch(null);
        replaceDocument(document ?? createEmptyDocument(createOptions), { projectPath: null, saved: true, label: "New prototype" });
      },

      async open(path) {
        if (!host) return { ok: false, error: "Opening projects isn't available here.", errorCode: "no_host" };
        let target: string | null = path ?? null;
        if (target === null) {
          try {
            target = await host.openProjectDialog();
          } catch (err) {
            return { ok: false, error: errorMessage(err), errorCode: errorCode(err) };
          }
        }
        if (!target) return { ok: false, cancelled: true };
        set({ status: "opening" });
        try {
          const doc = await host.readProject(target);
          replaceDocument(doc, { projectPath: target, saved: true, label: `Opened ${host.displayName(target)}` });
          watch(target);
          return { ok: true, path: target };
        } catch (err) {
          return { ok: false, path: target, error: errorMessage(err), errorCode: errorCode(err) };
        } finally {
          set({ status: "idle" });
        }
      },

      async save() {
        const path = get().projectPath;
        if (!path) return get().saveAs();
        return writeTo(path, null);
      },

      async saveAs() {
        if (!host) return { ok: false, error: "There's nowhere to save in this environment.", errorCode: "no_host" };
        let target: string | null;
        try {
          target = await host.saveProjectDialog(get().doc.project.name);
        } catch (err) {
          return { ok: false, error: errorMessage(err), errorCode: errorCode(err) };
        }
        if (!target) return { ok: false, cancelled: true };
        return writeTo(target, get().projectPath);
      },

      async checkExternalChanges(paths = ["."]) {
        const path = get().projectPath;
        if (!host || !path || get().status !== "idle") return;
        let next: SonobeDocument;
        try {
          next = await host.readProject(path);
        } catch {
          // A half-written or invalid file: wait for the next change.
          return;
        }
        if (get().projectPath !== path || sameDocumentContent(next, get().doc)) return;
        if (!get().dirty) {
          replaceDocument(next, { projectPath: path, keepHistory: true, saved: true, kind: "reload" });
          return;
        }
        set({ externalChange: { path, paths: [...paths], document: next, detectedAt: now() } });
      },

      acceptExternalChange() {
        const pending = get().externalChange;
        if (!pending) return;
        replaceDocument(pending.document, { projectPath: pending.path, keepHistory: true, saved: true, kind: "reload" });
      },

      dismissExternalChange() {
        if (!get().externalChange) return;
        forcedDirty = true;
        set({ externalChange: null, dirty: true });
      },

      historyEntries: (limit) => history.entries(limit).map(toListEntry),
      redoEntries: (limit) => history.redoEntries(limit).map(toListEntry),

      subscribeRevision(cb) {
        return store.subscribe((state, previous) => {
          if (state.revision !== previous.revision) cb(state, previous);
        });
      },

      isReservedId: (id) => removedIds.has(id),

      dispose() {
        disposed = true;
        unwatch?.();
        unwatch = null;
      },
    };
  });
  return store;
}
