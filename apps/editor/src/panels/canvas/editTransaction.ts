/**
 * Coalesced edits: a gesture (drag, resize, rotate, reorder) applies ops live so every panel follows
 * along, and ends as one undo entry holding only the final ops. Each `update` must describe the whole
 * gesture relative to the pre-gesture document (absolute values), so the last ops alone reproduce it.
 */

import type { ApplyOpsResult, Author, Id, Op, SonobeDocument } from "@sonobe/core";
import type { DocumentStore } from "../../state/document.ts";

export interface EditTransactionOptions {
  label: string;
  defaultComponent?: Id;
  author?: Author;
  /** Coalesce key. Default: unique per transaction. */
  key?: string;
}

export interface EditTransaction {
  readonly label: string;
  /** The document holds changes from this transaction. */
  readonly changed: boolean;
  /** Apply the gesture's current state. Returns null once finished or for an empty batch. */
  update(ops: readonly Op[], label?: string): ApplyOpsResult | null;
  /**
   * Finish: replace the gesture's history with one entry holding the final ops, or with nothing
   * when the gesture ended where it started.
   */
  commit(): void;
  /** Undo everything this transaction applied. */
  cancel(): void;
}

let counter = 0;

const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function createEditTransaction(store: DocumentStore, options: EditTransactionOptions): EditTransaction {
  const key = options.key ?? `canvas-edit:${++counter}`;
  let label = options.label;
  let lastOps: readonly Op[] = [];
  let lastResult: ApplyOpsResult | null = null;
  let applied = 0;
  let startDoc: SonobeDocument | null = null;
  let finished = false;
  const txnIds: string[] = [];
  const touched = new Set<Id>();

  const applyOptions = () => ({
    label,
    ...(options.defaultComponent !== undefined ? { defaultComponent: options.defaultComponent } : {}),
    ...(options.author ? { author: options.author } : {}),
  });

  /** Our entries are the newest in history (nobody else committed in between). */
  const onTop = () => {
    const top = store.getState().historyEntries(txnIds.length).map((e) => e.txnId);
    return top.length === txnIds.length && top.every((id, i) => id === txnIds[txnIds.length - 1 - i]);
  };

  const undoAll = () => {
    const result = store.getState().undoTo(txnIds[0]!, options.author);
    if (result.ok) txnIds.length = 0;
    return result.ok;
  };

  return {
    get label() {
      return label;
    },
    get changed() {
      return txnIds.length > 0;
    },

    update(ops, nextLabel) {
      if (finished || ops.length === 0) return null;
      if (nextLabel) label = nextLabel;
      if (lastResult && sameJson(ops, lastOps)) return lastResult;
      const state = store.getState();
      const before = state.doc;
      const result = state.apply(ops, { ...applyOptions(), coalesceKey: key });
      const after = store.getState();
      if (result.ok && after.doc !== before) {
        startDoc ??= before;
        for (const id of result.affected.components) touched.add(id);
        lastOps = ops;
        lastResult = result;
        applied++;
        const txnId = after.lastChange?.txnId;
        if (txnId && !txnIds.includes(txnId)) txnIds.push(txnId);
      }
      return result;
    },

    commit() {
      if (finished) return;
      finished = true;
      if (txnIds.length === 0 || !onTop()) return;
      const doc = store.getState().doc;
      const unchanged = startDoc !== null && [...touched].every((id) => sameJson(startDoc!.components[id], doc.components[id]));
      if (unchanged) {
        undoAll();
        return;
      }
      if (applied <= 1) return;
      if (undoAll()) store.getState().apply(lastOps, applyOptions());
    },

    cancel() {
      if (finished) return;
      finished = true;
      if (txnIds.length > 0 && onTop()) undoAll();
    },
  };
}
