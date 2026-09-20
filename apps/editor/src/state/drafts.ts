/**
 * The draft keeper (ARCHITECTURE §3.5 Drafts). While the document has unsaved edits, it writes them to
 * the host's drafts a second after the last change (at most five seconds after the first), waiting
 * out an open gesture, so a crash, a quit or a killed process loses a few seconds at most. It covers
 * prototypes that were never saved and unsaved edits to saved projects. Once the document is clean
 * again (saved, or undone back to the saved state) or replaced (the person chose Don't Save), it
 * removes the draft. It only reads the document store, never changes it.
 */

import { allLayerIds, type SonobeDocument } from "@sonobe/core";
import { newDraftId } from "../host/projectFiles.ts";
import type { DraftCounts, HostDrafts } from "../host/types.ts";
import type { DocumentState, DocumentStore } from "./document.ts";

export interface DraftKeeperOptions {
  document: DocumentStore;
  drafts: HostDrafts;
  /** Quiet time after a change before writing. Default 1000 ms. */
  debounceMs?: number;
  /** Longest a change waits while edits keep coming. Default 5000 ms. */
  maxWaitMs?: number;
  now?: () => number;
  newId?: () => string;
  /** A write or remove failed (it's retried with the next change). Default: console.warn. */
  onError?: (err: unknown) => void;
}

export interface DraftKeeper {
  /** Write any unsaved edits now (quitting, a signal, the window hiding). Resolves once written. */
  flush(): Promise<void>;
  /** The next document replace restores draft `id`: keep writing that draft instead of starting one. */
  adopt(id: string, draft: { createdAt: number; projectPath: string | null }): void;
  /** The current document's draft, once it's on disk. */
  current(): { id: string; updatedAt: number } | null;
  dispose(): void;
}

/** Components, layers and patches in a document (shown with a recovered draft: "66 layers"). */
export function draftCounts(doc: SonobeDocument): DraftCounts {
  let layers = 0;
  let patches = 0;
  for (const component of Object.values(doc.components)) {
    layers += allLayerIds(component.layers).length;
    patches += Object.keys(component.patches).length;
  }
  return { components: Object.keys(doc.components).length, layers, patches };
}

interface Draft {
  id: string;
  createdAt: number;
  /** A write started, so the draft may exist on disk. */
  started: boolean;
  /** Revision and project path as last written (-1: never). */
  revision: number;
  projectPath: string | null;
  updatedAt: number;
}

export function createDraftKeeper(options: DraftKeeperOptions): DraftKeeper {
  const { document, drafts } = options;
  const debounceMs = options.debounceMs ?? 1000;
  const maxWaitMs = options.maxWaitMs ?? 5000;
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? (() => newDraftId(now()));
  const report = options.onError ?? ((err: unknown) => console.warn("[sonobe] couldn't keep a draft of your changes", err));

  /** The current document's draft. */
  let draft: Draft | null = null;
  /** The document was edited since it was opened: one that's only marked unsaved (an example copy) gets no draft. */
  let edited = false;
  let adopting: { id: string; createdAt: number; projectPath: string | null } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** When the oldest change not yet written arrived. */
  let pendingSince: number | null = null;
  let chain: Promise<void> = Promise.resolve();
  let disposed = false;

  /** Writes and removes run one at a time, in order, so a remove never races the write before it. */
  const enqueue = (job: () => Promise<void>): Promise<void> => (chain = chain.then(job).catch(report));

  const wanted = (s: DocumentState) => s.dirty && edited && !disposed;
  const upToDate = (s: DocumentState) => draft !== null && draft.revision === s.revision && draft.projectPath === s.projectPath;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const write = (duringGesture: boolean) =>
    enqueue(async () => {
      const s = document.getState();
      if (!wanted(s) || (s.gesture !== null && !duringGesture) || upToDate(s)) return;
      draft ??= { id: newId(), createdAt: now(), started: false, revision: -1, projectPath: null, updatedAt: 0 };
      const target = draft;
      target.started = true;
      pendingSince = null;
      await drafts.write(target.id, s.doc, { name: s.doc.project.name, projectPath: s.projectPath, revision: s.revision, createdAt: target.createdAt, counts: draftCounts(s.doc), seenIds: s.seenIds() });
      target.revision = s.revision;
      target.projectPath = s.projectPath;
      target.updatedAt = now();
      // More edits arrived while writing.
      if (draft === target) schedule();
    });

  function schedule(): void {
    const s = document.getState();
    if (!wanted(s)) {
      clearTimer();
      pendingSince = null;
      return;
    }
    if (upToDate(s)) return;
    // An open gesture (a drag, a scrub) is written once it ends.
    if (s.gesture !== null) {
      clearTimer();
      return;
    }
    pendingSince ??= now();
    const wait = Math.max(0, Math.min(debounceMs, pendingSince + maxWaitMs - now()));
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void write(false);
    }, wait);
  }

  /** The document's draft is done with: saved, discarded, or replaced. */
  const finish = () => {
    clearTimer();
    pendingSince = null;
    const old = draft;
    draft = null;
    if (old?.started) void enqueue(() => drafts.remove(old.id));
  };

  const unsubscribe = document.subscribe((s, previous) => {
    if (disposed) return;
    const change = s.lastChange;
    if (change && change !== previous.lastChange) {
      if (change.kind === "replace") {
        const restoring = adopting;
        adopting = null;
        if (draft && draft.id !== restoring?.id) finish();
        edited = restoring !== null;
        // A restored draft is on disk as the document is now; a new project path gets written.
        if (restoring) draft = { id: restoring.id, createdAt: restoring.createdAt, started: true, revision: s.revision, projectPath: restoring.projectPath, updatedAt: now() };
      } else if (change.kind !== "reload") {
        edited = true;
      }
    }
    if (!s.dirty) {
      if (draft) finish();
      return;
    }
    // Other store updates (status, banners) don't move the debounce.
    if (s.revision !== previous.revision || s.gesture !== previous.gesture || s.dirty !== previous.dirty || s.projectPath !== previous.projectPath) schedule();
  });

  return {
    flush() {
      clearTimer();
      return write(true);
    },
    adopt(id, restored) {
      adopting = { id, createdAt: restored.createdAt, projectPath: restored.projectPath };
    },
    current: () => (draft && draft.revision >= 0 && draft.updatedAt > 0 ? { id: draft.id, updatedAt: draft.updatedAt } : null),
    dispose() {
      disposed = true;
      clearTimer();
      unsubscribe();
    },
  };
}
