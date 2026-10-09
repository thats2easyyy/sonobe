/**
 * Restarting without losing work, for Restart to Update and for Move to Applications. Every window
 * closes through its unsaved-changes prompt, what was open is written down, and only then does the app
 * quit; the next launch opens it all again. Cancelling any prompt calls the restart off. The prompt is
 * the one every close and quit goes through, so what a plain quit does once it's answered is here too.
 *
 * Electron-free: app-window.ts gives the prompt its dialogs and the editor's RPC, and main.ts gives the
 * sequence its windows and the updater, so the decisions that could lose work are unit tested here.
 */

import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { DRAFT_ID } from "./drafts.ts";
import { atomicWriteFileSync } from "./fs-utils.ts";

// --- The unsaved-changes prompt ------------------------------------------------------------------

/** Why a window is closing: the person closed it or quit, or the app restarts for an update or to move. */
export type CloseReason = "close" | "restart" | "move";

export type CloseOutcome =
  | { closed: true; /** The folder Save wrote the document to. */ savedTo?: string; /** The draft Keep Draft left for the next launch. */ draft?: string }
  | { closed: false };

/** What the editor's `drafts.flush` said: the draft on disk, and whether edits are still missing from it. */
export interface FlushReply {
  draft: string | null;
  pending: boolean;
}

export interface ClosePromptQuestion {
  message: string;
  detail: string;
  /** The first is the default and the last cancels. */
  buttons: string[];
}

export interface ClosePromptDeps {
  reason: CloseReason;
  /** The document's name, as the window's title has it. */
  name: string;
  /** The editor can save (it registered `document.save`). */
  canSave: boolean;
  /** Writes the window's unsaved edits to its draft now. Null when the editor can't, or didn't answer in time. */
  flush(): Promise<FlushReply | null>;
  /** Shows the question on the window and resolves with the button the person chose. */
  ask(question: ClosePromptQuestion): Promise<string>;
  /** `document.save`: the folder it saved to (null when the editor didn't say), or false when the person cancelled. Rejects when saving failed. */
  save(): Promise<string | null | false>;
  /** The window's draft isn't needed anymore: delete it. */
  discard(): Promise<void>;
  showError(message: string, detail: string): Promise<void>;
}

const KEEP_DRAFT = "Keep Draft";
const LOSE = "Your changes will be lost if you don't save them.";

/**
 * The unsaved-changes prompt, from the question to what became of the window. Closing or quitting asks
 * Save, Don't Save or Cancel, and writes the draft meanwhile in case nobody answers. A restart can do
 * better than Don't Save: when the draft holds every edit, the middle button is Keep Draft, which closes
 * the window and leaves the draft for the next launch to open again. Without such a draft (a copy that's
 * only marked unsaved has none, and a write can fail) the choice stays Save or Don't Save, and says so.
 *
 * The person can't edit while the question is up, but Claude and the Assistant can. So Keep Draft writes
 * the draft once more before the window closes, and when that draft isn't whole the question comes
 * back without Keep Draft.
 */
export async function resolveClosePrompt(deps: ClosePromptDeps): Promise<CloseOutcome> {
  const restarting = deps.reason !== "close";
  let flushing = deps.flush().catch(() => null);
  // A restart waits for the draft, since the buttons depend on it. A close asks at once.
  let kept = restarting ? await flushing : null;
  for (;;) {
    const draft = kept && !kept.pending ? kept.draft : null;
    const discardLabel = draft ? KEEP_DRAFT : "Don't Save";
    const detail = draft
      ? `Sonobe keeps your changes as a draft and opens it again ${deps.reason === "move" ? "once it has moved" : "after the update"}.`
      : restarting && (!kept || kept.pending)
        ? `Sonobe couldn't keep a draft of your changes. ${LOSE}`
        : LOSE;
    const buttons = deps.canSave ? ["Save", discardLabel, "Cancel"] : [discardLabel, "Cancel"];
    const choice = await deps.ask({ message: `Do you want to save the changes you made to “${deps.name}”?`, detail, buttons });
    if (choice !== "Save" && choice !== discardLabel) return { closed: false };
    if (choice === KEEP_DRAFT) {
      flushing = deps.flush().catch(() => null);
      const now = await flushing;
      if (now && !now.pending && now.draft === draft) return { closed: true, draft: draft! };
      // The draft lacks an edit made since the question, or isn't the one that was offered: ask again, without it.
      kept = null;
      continue;
    }
    let savedTo: string | null = null;
    if (choice === "Save") {
      try {
        const saved = await deps.save();
        if (saved === false) return { closed: false };
        savedTo = saved;
      } catch (err) {
        await deps.showError("Sonobe couldn't save your prototype.", err instanceof Error ? err.message : String(err));
        return { closed: false };
      }
    }
    // Saved, or the person chose not to keep the changes: the draft goes with the window (after the flush lands).
    await flushing;
    await deps.discard();
    return { closed: true, ...(savedTo ? { savedTo } : {}) };
  }
}

/**
 * A quit that the unsaved-changes prompt held up. Quitting closes every window, a window with unsaved
 * changes stops the quit to ask, and nothing carries on by itself once the person has answered: the
 * window closes and the app stays, with an update that was to go in "the next time you quit" still
 * waiting. This remembers that a quit is under way. When a prompt ends with its window closed, the quit
 * is asked for again (it stops at the next window with something to ask); when the person cancels, it's off.
 */
export function createQuitResume(quit: () => void): { /** The app was asked to quit (`before-quit`). */ began(): void; /** A window's unsaved-changes prompt ended. */ answered(closed: boolean): void } {
  let quitting = false;
  return {
    began() {
      quitting = true;
    },
    answered(closed) {
      if (!closed) quitting = false;
      else if (quitting) quit();
    },
  };
}

// --- What was open -------------------------------------------------------------------------------

/** An editor window, as the restart sees it. */
export interface RestartWindow {
  /** The project folder its document is saved in, or null (`document.info`). */
  project(): Promise<string | null>;
  focus(): void;
  /** Closes it through the prompt when it has unsaved changes. */
  requestClose(reason: CloseReason): Promise<CloseOutcome>;
}

/** What one window had open: its project, and the draft that holds its unsaved changes. */
export interface ReopenWindow {
  project: string | null;
  draft: string | null;
}

/**
 * Closes the windows one at a time, front first, each through its own prompt, and stops at the first
 * one the person keeps open. Resolves with what each window had open, as it is after any Save.
 */
export async function closeWindowsForRestart(windows: readonly RestartWindow[], reason: Exclude<CloseReason, "close">): Promise<{ closed: true; windows: ReopenWindow[] } | { closed: false }> {
  const open: ReopenWindow[] = [];
  for (const window of windows) {
    const project = await window.project().catch(() => null);
    window.focus();
    const outcome = await window.requestClose(reason);
    if (!outcome.closed) return { closed: false };
    open.push({ project: outcome.savedTo ?? project, draft: outcome.draft ?? null });
  }
  return { closed: true, windows: open };
}

/** <userData>/reopen-after-update.json: what to open again at the next launch, once. */
export interface ReopenRecord {
  version: 1;
  windows: ReopenWindow[];
}

/** Written synchronously: the app quits right after. */
export function writeReopenRecord(file: string, record: ReopenRecord): void {
  atomicWriteFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

/** Reads the record and deletes it, so it's used once whatever happens next. Null without one worth using. */
export function takeReopenRecord(file: string): ReopenRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    // No record (every ordinary launch), or one that can't be read: either way there's nothing to reopen.
    if ((err as { code?: unknown }).code !== "ENOENT") rmSync(file, { force: true });
    return null;
  }
  rmSync(file, { force: true });
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (o.version !== 1 || !Array.isArray(o.windows)) return null;
  const windows = o.windows.slice(0, 16).flatMap((entry): ReopenWindow[] => {
    const w = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const project = typeof w.project === "string" && path.isAbsolute(w.project) ? w.project : null;
    const draft = typeof w.draft === "string" && DRAFT_ID.test(w.draft) ? w.draft : null;
    return project || draft ? [{ project, draft }] : [];
  });
  return windows.length ? { version: 1, windows } : null;
}

export type ReopenStep = { kind: "draft"; id: string; /** Opened instead when the draft can't be. */ project: string | null } | { kind: "project"; path: string };

/**
 * What to open for a record: each window's draft while it's still there for the taking (restoring it
 * opens its project underneath), else its project when the folder still exists.
 */
export function reopenPlan(record: ReopenRecord, state: { /** Drafts no window claims. */ drafts: readonly string[]; exists(dir: string): boolean }): ReopenStep[] {
  return record.windows.flatMap((window): ReopenStep[] => {
    const project = window.project && state.exists(window.project) ? window.project : null;
    if (window.draft && state.drafts.includes(window.draft)) return [{ kind: "draft", id: window.draft, project }];
    return project ? [{ kind: "project", path: project }] : [];
  });
}

// --- Claude sessions -----------------------------------------------------------------------------

/**
 * What to ask before a restart while Claude sessions are connected, or null when none is. `sessions`
 * are their labels ("Claude Code"). The relay finds the app again by itself; on Windows the installer
 * stops it, so the session has to be reconnected. A session that carries on keeps the tool list it read
 * from the old version: the relay doesn't tell Claude to read it again.
 */
export function restartConfirmation(sessions: readonly string[], version: string | null, platform: string): ClosePromptQuestion | null {
  if (!sessions.length) return null;
  const counts = new Map<string, number>();
  for (const label of sessions) counts.set(label, (counts.get(label) ?? 0) + 1);
  const names = [...counts].map(([label, count]) => (count > 1 ? `${count} ${label} sessions` : label));
  const listed = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
  const one = sessions.length === 1;
  const after =
    platform === "win32"
      ? `Reconnect ${one ? "it" : "them"} once Sonobe is back.`
      : `The session${one ? " carries" : "s carry"} on once Sonobe is back. If the update changes Sonobe's tools, start a new session to see them.`;
  return {
    message: version ? `Restart Sonobe to update to ${version}?` : "Restart Sonobe?",
    detail: `${listed} ${one ? "is" : "are"} connected. A tool call that's running now will stop. ${after}`,
    buttons: ["Restart", "Cancel"],
  };
}

/**
 * What Move to Applications does when a Sonobe is already in the Applications folder: ask before
 * replacing one that isn't running, and never replace one that is.
 */
export function moveConflict(conflict: "exists" | "existsAndRunning"): { replace: "ask"; question: ClosePromptQuestion } | { replace: false; message: string; detail: string } {
  if (conflict === "existsAndRunning") {
    return { replace: false, message: "Another Sonobe is running from your Applications folder.", detail: "Quit that one, then choose Move to Applications again." };
  }
  return {
    replace: "ask",
    question: { message: "Replace the Sonobe that's in your Applications folder?", detail: "This copy takes its place. Your prototypes and settings stay as they are.", buttons: ["Replace", "Cancel"] },
  };
}

// --- The sequence --------------------------------------------------------------------------------

export interface RestartSteps {
  reason: Exclude<CloseReason, "close">;
  /** Asked first, when there's something to ask (connected Claude sessions). False calls it off. */
  confirm(): Promise<boolean>;
  /** The editor windows, front first. */
  windows(): readonly RestartWindow[];
  /** True before the first window closes, false when the restart is called off or failed. */
  setRestarting(restarting: boolean): void;
  /** Writes the reopen record. */
  record(windows: ReopenWindow[]): void;
  /** Closes the helper windows and resolves once no window is left, or false when one stays. The updater only quits an app without windows. */
  noWindowsLeft(): Promise<boolean>;
  /** Quits and installs (or moves). Rejects when that failed; when it works the app is gone before it settles. */
  install(): Promise<void>;
  /** The app is still here with every window closed: open one and bring the work back. */
  recover(windows: ReopenWindow[]): Promise<void>;
  /** How long after install() an app that's still running counts as a failed restart. */
  giveUpMs?: number;
}

/**
 * Runs a restart. It only comes back when the app didn't restart: "cancelled" (the person said no, or
 * kept a window open), or "failed" with the reason, after the work is back on screen.
 */
export async function restartKeepingWork(steps: RestartSteps): Promise<{ result: "cancelled" } | { result: "failed"; error: Error }> {
  if (!(await steps.confirm())) return { result: "cancelled" };
  steps.setRestarting(true);
  let closed: Awaited<ReturnType<typeof closeWindowsForRestart>>;
  try {
    closed = await closeWindowsForRestart(steps.windows(), steps.reason);
  } catch (err) {
    steps.setRestarting(false);
    throw err;
  }
  if (!closed.closed) {
    steps.setRestarting(false);
    return { result: "cancelled" };
  }
  let error: Error;
  try {
    steps.record(closed.windows);
    if (!(await steps.noWindowsLeft())) throw new Error("A Sonobe window stayed open, so the restart was called off.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const giveUpMs = steps.giveUpMs ?? 30_000;
    const stillHere = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Sonobe is still running ${Math.round(giveUpMs / 1000)} s after it was asked to restart.`)), giveUpMs);
    });
    try {
      await Promise.race([steps.install(), stillHere]);
    } finally {
      clearTimeout(timer);
    }
    // install() came back without an error and the app is still here (a move the person turned down).
    error = new Error("Sonobe didn't restart.");
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }
  steps.setRestarting(false);
  await steps.recover(closed.windows);
  return { result: "failed", error };
}
