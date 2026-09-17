/**
 * AI Activity feed derivation: what agents are working on right now, plus every agent-authored
 * history group (still undoable, undone, or from before the history was cleared) and agent notes
 * (finished work, agent undo and redo), newest first.
 */

import type { Author, Id } from "@sonobe/core";
import type { HistoryListEntry } from "../../state/document.ts";
import type { AgentChange, WorkingItem } from "../../state/presence.ts";

/** applied: in the undo stack. undone: in the redo stack. past: no longer in history (e.g. a new document). */
export type ActivityStatus = "applied" | "undone" | "past";

export interface WorkingActivity {
  kind: "working";
  key: string;
  workId: string;
  author: Author;
  intent: string;
  ids: Id[];
  component?: Id;
  startedAt: number;
}

export interface ChangeActivity {
  kind: "change";
  key: string;
  txnId: string;
  author: Author;
  label: string;
  opCount: number;
  timestamp: number;
  status: ActivityStatus;
  /** Items touched (when presence recorded them). */
  ids: Id[];
  components: Id[];
  /** Undoable groups newer than this one; "Undo this" also undoes them. */
  newer: number;
  canUndo: boolean;
  /** True for the next group redo would restore. */
  canRedo: boolean;
}

export interface NoteActivity {
  kind: "note";
  key: string;
  verb: "finish" | "undo" | "redo";
  author: Author;
  label: string;
  timestamp: number;
  ids: Id[];
  components: Id[];
}

export type ActivityItem = WorkingActivity | ChangeActivity | NoteActivity;

export interface ActivityInput {
  /** Undoable groups, newest first (DocumentState.historyEntries). */
  history: readonly HistoryListEntry[];
  /** Redoable groups, next redo first (DocumentState.redoEntries). */
  redo: readonly HistoryListEntry[];
  /** Agent changes, newest first (PresenceState.recent). */
  recent: readonly AgentChange[];
  working: readonly WorkingItem[];
}

const isAgent = (author: Author) => author.kind === "agent";

export function deriveActivityFeed(input: ActivityInput): ActivityItem[] {
  const touched = new Map<string, AgentChange>();
  for (const change of input.recent) {
    if (change.kind === "apply" && change.txnId && !touched.has(change.txnId)) touched.set(change.txnId, change);
  }

  const working: WorkingActivity[] = [...input.working]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((w) => ({ kind: "working", key: `work:${w.workId}`, workId: w.workId, author: w.author, intent: w.intent, ids: [...w.ids], ...(w.component !== undefined ? { component: w.component } : {}), startedAt: w.startedAt }));

  const timeline: (ChangeActivity | NoteActivity)[] = [];
  const inHistory = new Set<string>();
  const change = (entry: HistoryListEntry, status: ActivityStatus, newer: number, canRedo: boolean): ChangeActivity => {
    const recorded = touched.get(entry.txnId);
    return {
      kind: "change",
      key: `txn:${entry.txnId}`,
      txnId: entry.txnId,
      author: entry.author,
      label: entry.label,
      opCount: entry.opCount,
      timestamp: entry.timestamp,
      status,
      ids: recorded ? [...recorded.ids] : [],
      components: recorded ? [...recorded.components] : [],
      newer,
      canUndo: status === "applied",
      canRedo,
    };
  };

  input.history.forEach((entry, index) => {
    inHistory.add(entry.txnId);
    if (isAgent(entry.author)) timeline.push(change(entry, "applied", index, false));
  });
  input.redo.forEach((entry, index) => {
    inHistory.add(entry.txnId);
    if (isAgent(entry.author)) timeline.push(change(entry, "undone", 0, index === 0));
  });

  const past = new Set<string>();
  for (const recorded of input.recent) {
    if (!isAgent(recorded.author)) continue;
    if (recorded.kind === "apply") {
      if (!recorded.txnId || inHistory.has(recorded.txnId) || past.has(recorded.txnId)) continue;
      past.add(recorded.txnId);
      timeline.push({
        kind: "change",
        key: `past:${recorded.id}`,
        txnId: recorded.txnId,
        author: recorded.author,
        label: recorded.label,
        opCount: recorded.opCount,
        timestamp: recorded.timestamp,
        status: "past",
        ids: [...recorded.ids],
        components: [...recorded.components],
        newer: 0,
        canUndo: false,
        canRedo: false,
      });
    } else if (recorded.kind === "finish" || recorded.kind === "undo" || recorded.kind === "redo") {
      timeline.push({ kind: "note", key: `note:${recorded.id}`, verb: recorded.kind, author: recorded.author, label: recorded.label, timestamp: recorded.timestamp, ids: [...recorded.ids], components: [...recorded.components] });
    }
  }

  const ordered = timeline.map((item, index) => ({ item, index })).sort((a, b) => b.item.timestamp - a.item.timestamp || a.index - b.index);
  return [...working, ...ordered.map(({ item }) => item)];
}

/** Label for the undo action: "Undo this", or "Undo this + 2 newer" when newer groups go with it. */
export function undoActionLabel(item: Pick<ChangeActivity, "newer">): string {
  return item.newer === 0 ? "Undo this" : `Undo this + ${item.newer} newer`;
}

/** "just now", "42s ago", "5m ago", "14:03", or "Sep 3" for older days. */
export function formatRelativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const date = new Date(timestamp);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
