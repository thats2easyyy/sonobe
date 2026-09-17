/**
 * Undo history (ARCHITECTURE §3.5): every committed batch is one group with a label,
 * an author, its ops and inverse, and a revision. History never touches documents;
 * undo()/redo() return the ops to apply.
 */

import type { Author, HistoryEntry, Op } from "./types.ts";

export interface HistoryOptions {
  /** Maximum groups kept; the oldest are dropped. Default 500. */
  limit?: number;
  /** Groups with the same coalesce key merge when pushed within this window. Default 1000 ms. */
  coalesceWindowMs?: number;
  now?: () => number;
}

export interface PushInput {
  label: string;
  author: Author;
  /** Ops as applied (use ApplyOpsResult.applied so redo reproduces generated ids). */
  ops: Op[];
  /** ApplyResult.inverse. */
  inverse: Op[];
  txnId?: string;
  timestamp?: number;
  /** Merge with the previous group when it has the same key and author and is recent (e.g. scrubbing a value). */
  coalesceKey?: string;
}

export interface HistoryStep {
  entry: HistoryEntry;
  /** Ops to apply: the inverse for undo, the original ops for redo. Apply with `lenient: true`. */
  ops: Op[];
}

export interface History {
  /** Increments on every push, undo and redo. */
  readonly revision: number;
  push(input: PushInput): HistoryEntry;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): HistoryStep | undefined;
  redo(): HistoryStep | undefined;
  /** Undo every group up to and including `txnId`; undefined when it isn't undoable. */
  undoTo(txnId: string): HistoryStep[] | undefined;
  peekUndo(): HistoryEntry | undefined;
  peekRedo(): HistoryEntry | undefined;
  /** Undoable groups, newest first. */
  entries(limit?: number): HistoryEntry[];
  /** Redoable groups, next redo first. */
  redoEntries(limit?: number): HistoryEntry[];
  /** Advance the revision without recording a group (e.g. an external reload). */
  bump(): number;
  clear(): void;
}

/** "Claude: added press animation (12 ops)" */
export function describeHistoryEntry(entry: Pick<HistoryEntry, "label" | "author" | "ops">): string {
  const count = entry.ops.length > 1 ? ` (${entry.ops.length} ops)` : "";
  return `${entry.author.name}: ${entry.label}${count}`;
}

export function createHistory(options: HistoryOptions = {}): History {
  const limit = Math.max(1, options.limit ?? 500);
  const window = options.coalesceWindowMs ?? 1000;
  const now = options.now ?? (() => Date.now());
  let undoStack: { entry: HistoryEntry; key?: string }[] = [];
  let redoStack: { entry: HistoryEntry; key?: string }[] = [];
  let revision = 0;
  let counter = 0;

  const sameAuthor = (a: Author, b: Author) => a.kind === b.kind && a.name === b.name;

  return {
    get revision() {
      return revision;
    },
    push(input) {
      const timestamp = input.timestamp ?? now();
      revision++;
      redoStack = [];
      const top = undoStack.at(-1);
      if (input.coalesceKey !== undefined && top && top.key === input.coalesceKey && sameAuthor(top.entry.author, input.author) && timestamp - top.entry.timestamp <= window) {
        const merged: HistoryEntry = {
          ...top.entry,
          label: input.label,
          ops: [...top.entry.ops, ...input.ops],
          inverse: [...input.inverse, ...top.entry.inverse],
          revision,
          timestamp,
        };
        undoStack[undoStack.length - 1] = { entry: merged, key: top.key };
        return merged;
      }
      const entry: HistoryEntry = {
        txnId: input.txnId ?? `txn_${++counter}`,
        label: input.label,
        author: { ...input.author },
        revision,
        ops: input.ops,
        inverse: input.inverse,
        timestamp,
      };
      undoStack.push(input.coalesceKey === undefined ? { entry } : { entry, key: input.coalesceKey });
      if (undoStack.length > limit) undoStack = undoStack.slice(undoStack.length - limit);
      return entry;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo() {
      const item = undoStack.pop();
      if (!item) return undefined;
      revision++;
      redoStack.push({ entry: item.entry });
      return { entry: item.entry, ops: item.entry.inverse };
    },
    redo() {
      const item = redoStack.pop();
      if (!item) return undefined;
      revision++;
      undoStack.push({ entry: item.entry });
      return { entry: item.entry, ops: item.entry.ops };
    },
    undoTo(txnId) {
      if (!undoStack.some((i) => i.entry.txnId === txnId)) return undefined;
      const steps: HistoryStep[] = [];
      for (;;) {
        const step = this.undo();
        if (!step) break;
        steps.push(step);
        if (step.entry.txnId === txnId) break;
      }
      return steps;
    },
    peekUndo: () => undoStack.at(-1)?.entry,
    peekRedo: () => redoStack.at(-1)?.entry,
    entries: (max) => undoStack.map((i) => i.entry).reverse().slice(0, max ?? undoStack.length),
    redoEntries: (max) => redoStack.map((i) => i.entry).reverse().slice(0, max ?? redoStack.length),
    bump: () => ++revision,
    clear() {
      undoStack = [];
      redoStack = [];
      revision++;
    },
  };
}
