/**
 * The document store: the SonobeDocument, its revision, undo history (core History), dirty
 * tracking, and the project on disk. Every mutation goes through `apply`, which wraps core
 * `applyOps` (atomic by default) and records an author-attributed history group.
 */

import {
  applyOps,
  createEmptyDocument,
  createHistory,
  createIdLedger,
  describeHistoryEntry,
  makeError,
  ProjectFormatError,
  retiredIds,
  seenIdsExcept,
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
  /** Instead of saving, the person chose to load the version on disk. */
  reloaded?: boolean;
  error?: string;
  /** "disk_changed": the project changed on disk while there were unsaved changes (see SaveDocumentOptions). */
  errorCode?: string;
}

export interface SaveDocumentOptions {
  /** Save even though an external change is pending (the person chose to keep their version). */
  overwriteExternal?: boolean;
}

export interface PendingExternalChange {
  path: string;
  paths: string[];
  document: SonobeDocument;
  detectedAt: number;
}

/** A change outside Sonobe left a document file that can't be read (a merge conflict, a typo). */
export interface DiskProblem {
  path: string;
  paths: string[];
  /** ProjectFormatError code. */
  code: string;
  message: string;
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
  /** The coalesce key of the explicit gesture (a scrub, a drag) that's still open, else null. Views that are slow to update can lag while it's open. */
  gesture: string | null;
  /** External edits that arrived while there were unsaved changes. */
  externalChange: PendingExternalChange | null;
  /** The project on disk can't be read since an outside change; saving writes this document over it. */
  diskProblem: DiskProblem | null;

  apply: (ops: readonly Op[], input: ApplyInput) => ApplyOpsResult;
  /** Close the open gesture (optionally only when it has this coalesce key); the next apply starts a new undo group. */
  endGesture: (coalesceKey?: string) => void;
  undo: (author?: Author) => HistoryStepResult;
  redo: (author?: Author) => HistoryStepResult;
  /** Undo every group up to and including `txnId`. */
  undoTo: (txnId: string, author?: Author) => HistoryStepResult;
  /**
   * Fold a gesture's provisional steps into its final edit: undo every group up to and including
   * `txnId`, then apply `ops` as one group. Ids those groups created aren't retired here, so the final
   * ops can create the same items again. When the apply fails, the undone groups come back.
   */
  amend: (txnId: string, ops: readonly Op[], input: ApplyInput) => ApplyOpsResult;
  replaceDocument: (doc: SonobeDocument, options?: ReplaceOptions) => void;
  /** Start an unsaved document: empty (from `options`), or `document` when given (templates). */
  newDocument: (options?: CreateDocumentOptions, document?: SonobeDocument) => void;
  /** Open `path`, or ask the host for one. */
  open: (path?: string) => Promise<FileResult>;
  /** Refuses with errorCode "disk_changed" while `externalChange` is pending, unless `overwriteExternal`. */
  save: (options?: SaveDocumentOptions) => Promise<FileResult>;
  saveAs: () => Promise<FileResult>;
  /**
   * Re-read the project from disk; reloads when clean, otherwise sets `externalChange`. Unreadable
   * files set `diskProblem`. Changes reported while saving or opening are checked once that's done.
   */
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
  /** True for an id that belonged to an item of `component` this session and is gone from it: new items never get it (ARCHITECTURE §3.2). */
  isRetiredId: (component: Id, id: Id) => boolean;
  /** Component id → its retired item ids (only components that have any). */
  retiredIds: () => Record<Id, Id[]>;
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

/** A history group as history.list and history.undo report it. */
export const historyListEntry = (entry: HistoryEntry): HistoryListEntry => ({
  txnId: entry.txnId,
  label: entry.label,
  author: { ...entry.author },
  revision: entry.revision,
  opCount: entry.ops.length,
  timestamp: entry.timestamp,
  description: describeHistoryEntry(entry),
});

/** Who a reload from disk is attributed to in the undo history. */
export const RELOAD_AUTHOR: Author = { kind: "human", name: "Outside Sonobe" };

function mergeAffected(into: { components: Set<Id>; layers: Set<Id>; patches: Set<Id> }, a: Affected): void {
  for (const id of a.components) into.components.add(id);
  for (const id of a.layers) into.layers.add(id);
  for (const id of a.patches) into.patches.add(id);
}

function sameFiles(fa: Readonly<Record<string, string>>, fb: Readonly<Record<string, string>>): boolean {
  const ka = Object.keys(fa);
  return ka.length === Object.keys(fb).length && ka.every((k) => Object.hasOwn(fb, k) && fa[k] === fb[k]);
}

function sameDocumentContent(a: SonobeDocument, b: SonobeDocument): boolean {
  return a === b || sameFiles(serializeDocument(a), serializeDocument(b));
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const errorCode = (err: unknown) => (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : "io_error");
const FORMAT_PROBLEM_CODES: ReadonlySet<string> = new Set(["corrupt", "invalidFormat", "migrationFailed", "tooNew"]);
const isFormatProblem = (err: unknown) => err instanceof ProjectFormatError || FORMAT_PROBLEM_CODES.has(errorCode(err));

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
  const initialDoc = options.document ?? createEmptyDocument();
  /** Every id seen this session; ids gone from their component are retired there (ARCHITECTURE §3.2). */
  const ids = createIdLedger(initialDoc);
  /** While amending: the document before its undo, whose ids the final ops may use again. */
  let amending: SonobeDocument | null = null;
  let savedKey = "";
  /** The document as last opened, saved or reloaded, and its files (computed when needed). */
  let savedDoc = initialDoc;
  let savedFiles: Record<string, string> | null = null;
  let forcedDirty = false;
  /** The files on disk can't be read (diskProblem), so there's something to write. */
  let diskDirty = false;
  let unwatch: (() => void) | null = null;
  let disposed = false;
  /** Paths reported changed while a save or open was in flight; checked once it's done. */
  const skippedExternal = new Set<string>();
  /** Bumped when a write starts, so a read that raced our own save is noticed. */
  let writeCount = 0;
  /** Reload undo groups: the documents before and after, swapped in by undo and redo. */
  const reloads = new Map<string, { before: SonobeDocument; after: SonobeDocument }>();

  const positionKey = () => {
    const top = history.peekUndo();
    return top ? `${top.txnId}@${top.revision}` : "empty";
  };
  const isDirty = (doc: SonobeDocument) => {
    if (forcedDirty || diskDirty || positionKey() !== savedKey) return true;
    if (doc === savedDoc) return false;
    // Back at the saved position with a different document object: clean only when the content matches.
    savedFiles ??= serializeDocument(savedDoc);
    return !sameFiles(serializeDocument(doc), savedFiles);
  };
  const pruneReloads = () => {
    if (!reloads.size) return;
    const live = new Set([...history.entries(), ...history.redoEntries()].map((e) => e.txnId));
    for (const id of [...reloads.keys()]) if (!live.has(id)) reloads.delete(id);
  };
  const historyFlags = () => {
    const undo = history.peekUndo();
    const redo = history.peekRedo();
    return { canUndo: !!undo, canRedo: !!redo, undoLabel: undo ? describeHistoryEntry(undo) : null, redoLabel: redo ? describeHistoryEntry(redo) : null };
  };
  savedKey = positionKey();

  const store: DocumentStore = createStore<DocumentState>()((set, get) => {
    const openGesture = () => (group?.gesture && group.open ? group.key : null);
    /** Publish the open gesture when it changed (commits publish it with the document). */
    const syncGesture = () => {
      const gesture = openGesture();
      if (get().gesture !== gesture) set({ gesture });
    };

    const commit = (doc: SonobeDocument, change: DocumentChange) => {
      set({ doc, revision: history.revision, lastChange: change, dirty: isDirty(doc), gesture: openGesture(), ...historyFlags() });
    };

    const replay = (kind: "undo" | "redo", steps: HistoryStep[], author: Author): HistoryStepResult => {
      group = null;
      let doc = get().doc;
      const affected = { components: new Set<Id>(), layers: new Set<Id>(), patches: new Set<Id>() };
      let opCount = 0;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        const reload = reloads.get(step.entry.txnId);
        if (reload) {
          // Older steps were recorded against the document before the reload; newer ones against the reloaded one.
          const next = kind === "undo" ? reload.before : reload.after;
          for (const id of new Set([...Object.keys(doc.components), ...Object.keys(next.components)])) affected.components.add(id);
          doc = next;
          continue;
        }
        const r = applyOps(doc, step.ops, { registry, lenient: true });
        if (!r.ok) {
          // Put the popped groups back where they were; the document is untouched.
          for (let j = 0; j <= i; j++) {
            if (kind === "undo") history.redo();
            else history.undo();
          }
          set({ revision: history.revision, ...historyFlags(), dirty: isDirty(get().doc) });
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
      ids.observe(doc, affected.components);
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
      const previous = get().doc;
      const reloading = replaceOptions.kind === "reload" && replaceOptions.keepHistory === true;
      const label = replaceOptions.label ?? (replaceOptions.kind === "reload" ? "Reloaded from disk" : "Opened document");
      const author = replaceOptions.author ? normalizeAuthor(replaceOptions.author) : reloading ? { ...RELOAD_AUTHOR } : normalizeAuthor(undefined);
      let txnId: string | undefined;
      if (reloading) {
        // A reload is its own undo step. Undoing past it restores the document older steps were recorded
        // against, instead of replaying their inverses over the outside changes; redo brings the reloaded
        // version back exactly.
        ids.observe(doc);
        const entry = history.push({ label, author, ops: [], inverse: [] });
        reloads.set(entry.txnId, { before: previous, after: doc });
        txnId = entry.txnId;
        pruneReloads();
      } else if (replaceOptions.keepHistory) {
        history.bump();
        ids.observe(doc);
      } else {
        // A new document starts a new session.
        history.clear();
        ids.clear();
        ids.observe(doc);
        reloads.clear();
      }
      diskDirty = false;
      const saved = replaceOptions.saved !== false;
      if (saved) {
        savedKey = positionKey();
        savedDoc = doc;
        savedFiles = null;
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
        diskProblem: null,
        dirty: isDirty(doc),
        ...historyFlags(),
        lastChange: {
          kind: replaceOptions.kind ?? "replace",
          revision: history.revision,
          author,
          label,
          ...(txnId !== undefined ? { txnId } : {}),
          affected: { ...EMPTY_AFFECTED, components: [...new Set([...Object.keys(previous.components), ...Object.keys(doc.components)])].sort() },
          opCount: 0,
          timestamp: now(),
        },
      });
    };

    /** Back to idle after a save or open, then look at outside changes reported meanwhile. */
    const becomeIdle = () => {
      set({ status: "idle" });
      if (!skippedExternal.size || disposed) return;
      const queued = [...skippedExternal];
      skippedExternal.clear();
      void get().checkExternalChanges(queued);
    };

    const writeTo = async (path: string, copyAssetsFrom: string | null, saveOptions: SaveDocumentOptions = {}): Promise<FileResult> => {
      if (!host) return { ok: false, error: "There's nowhere to save in this environment.", errorCode: "no_host" };
      const pending = get().externalChange;
      if (pending && pending.path === path && !saveOptions.overwriteExternal) {
        const files = pending.paths.filter((p) => p !== ".");
        return {
          ok: false,
          path,
          errorCode: "disk_changed",
          error: `"${get().doc.project.name}" changed outside Sonobe${files.length ? ` (${files.slice(0, 3).join(", ")}${files.length > 3 ? ` +${files.length - 3}` : ""})` : ""} while you had unsaved changes, so it wasn't saved. Keep your version and save over it, or reload the version on disk.`,
        };
      }
      const name = host.displayName(path);
      const current = get();
      if (current.doc.project.name === "Untitled" && name && name !== "Untitled") {
        current.apply([{ op: "setProject", changes: { name } }], { label: `Name prototype "${name}"` });
      }
      const { doc, revision } = get();
      const key = positionKey();
      set({ status: "saving" });
      writeCount++;
      try {
        await host.writeProject(path, doc, { copyAssetsFrom: copyAssetsFrom && copyAssetsFrom !== path ? copyAssetsFrom : null });
        savedKey = key;
        savedDoc = doc;
        savedFiles = null;
        forcedDirty = false;
        diskDirty = false;
        const moved = get().projectPath !== path;
        set({ projectPath: path, lastSavedRevision: revision, dirty: isDirty(get().doc), externalChange: null, diskProblem: null });
        if (moved || !unwatch) watch(path);
        return { ok: true, path };
      } catch (err) {
        return { ok: false, path, error: errorMessage(err), errorCode: errorCode(err) };
      } finally {
        becomeIdle();
      }
    };

    return {
      doc: initialDoc,
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
      gesture: null,
      externalChange: null,
      diskProblem: null,

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
          seenIds: amending ? seenIdsExcept(ids, amending) : ids,
        });
        if (input.dryRun) return result;
        if (result.doc === s.doc || result.applied.length === 0) {
          if (input.gesture === "end") get().endGesture(input.coalesceKey);
          return result;
        }
        ids.observe(result.doc, result.affected.components);
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
        pruneReloads();
        commit(result.doc, { kind: "apply", revision: history.revision, author, label: input.label, txnId: entry.txnId, affected: result.affected, opCount: result.applied.length, timestamp: now() });
        return result;
      },

      endGesture(coalesceKey) {
        if (group?.gesture && (coalesceKey === undefined || group.key === coalesceKey)) group.open = false;
        syncGesture();
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

      amend(txnId, ops, input) {
        const before = get().doc;
        const undone = get().undoTo(txnId, normalizeAuthor(input.author));
        if (!undone.ok) return { ok: false, doc: before, results: [], errors: undone.errors, idMap: {}, inverse: [], applied: [], affected: { ...EMPTY_AFFECTED } };
        amending = before;
        let result: ApplyOpsResult;
        try {
          result = get().apply(ops, input);
        } finally {
          amending = null;
        }
        if (!result.ok || result.applied.length === 0) for (let i = 0; i < undone.entries.length; i++) get().redo(normalizeAuthor(input.author));
        return result;
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
          // Changes queued for the project this replaces don't matter anymore.
          if (target !== get().projectPath) skippedExternal.clear();
          replaceDocument(doc, { projectPath: target, saved: true, label: `Opened ${host.displayName(target)}` });
          watch(target);
          return { ok: true, path: target };
        } catch (err) {
          return { ok: false, path: target, error: errorMessage(err), errorCode: errorCode(err) };
        } finally {
          becomeIdle();
        }
      },

      async save(saveOptions = {}) {
        const path = get().projectPath;
        if (!path) return get().saveAs();
        return writeTo(path, null, saveOptions);
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
        if (!host || !path || disposed) return;
        if (get().status !== "idle") {
          // A save or open is in flight: look again once it's done, so the change isn't dropped and later overwritten.
          for (const p of paths) skippedExternal.add(p);
          return;
        }
        const writes = writeCount;
        let next: SonobeDocument;
        try {
          next = await host.readProject(path);
        } catch (err) {
          // The folder went away or can't be read right now: wait for the next change.
          if (get().projectPath !== path || !isFormatProblem(err)) return;
          // A file that doesn't parse (a merge conflict, a typo, a half-written file). Say so, and mark the
          // document as having something to save; a later good read clears it.
          diskDirty = true;
          set({ diskProblem: { path, paths: [...paths], code: errorCode(err), message: errorMessage(err), detectedAt: now() }, dirty: true });
          return;
        }
        if (get().projectPath !== path) return;
        if (writeCount !== writes || get().status !== "idle") {
          // Our own save started while reading: read again once it's done.
          for (const p of paths) skippedExternal.add(p);
          if (get().status === "idle") becomeIdle();
          return;
        }
        if (get().diskProblem) {
          diskDirty = false;
          set({ diskProblem: null, dirty: isDirty(get().doc) });
        }
        if (sameDocumentContent(next, get().doc)) return;
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

      historyEntries: (limit) => history.entries(limit).map(historyListEntry),
      redoEntries: (limit) => history.redoEntries(limit).map(historyListEntry),

      subscribeRevision(cb) {
        return store.subscribe((state, previous) => {
          if (state.revision !== previous.revision) cb(state, previous);
        });
      },

      isRetiredId: (component, id) => ids.isRetired(get().doc, component, id),
      retiredIds: () => retiredIds(ids, get().doc),

      dispose() {
        disposed = true;
        unwatch?.();
        unwatch = null;
      },
    };
  });
  return store;
}
