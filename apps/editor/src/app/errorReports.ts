/**
 * Where the editor's own errors go (ARCHITECTURE §9, Error containment). An error a boundary caught, one
 * nothing caught, one React recovered from, a window `error` and an unhandled promise rejection each
 * become one line in the HUD console with source "editor", so the console opens on the first of a
 * session as it does for a prototype's (`hudAutoOpen.ts`). The last few are kept for Copy details.
 * A prototype's errors don't come through here: the runtime host logs those itself.
 */

import type { RootOptions } from "react-dom/client";
import { ErrorBoundary, lastBoundaryError } from "../ui/ErrorBoundary.tsx";
import { environmentLine } from "./about.ts";
import { issueContext } from "./appActions.ts";
import type { EditorSession } from "../state/session.ts";
import { peekAppSession } from "./session.ts";

export interface EditorErrorReport {
  /** "TypeError: Cannot read properties of undefined (reading 'id')". */
  summary: string;
  /** The part of the editor that failed, when a boundary caught it: "The Inspector". */
  where: string | null;
  level: "error" | "warn";
  stack: string | null;
  componentStack: string | null;
  /** Epoch ms. */
  at: number;
}

export interface ReportOptions {
  /** The boundary that caught it, as a sentence starts. */
  where?: string;
  /** "warn" for an error React recovered from: it is logged, and doesn't open the console. Default "error". */
  level?: "error" | "warn";
  componentStack?: string;
  /** Also write it to the browser's console. The browser already prints the errors it raises on `window`, so only React's do. */
  print?: boolean;
}

const KEPT = 10;
const HINT = "If it keeps happening, save your work and restart Sonobe, or use Help → Report an Issue.";

/** Errors already reported, so one that reaches two handlers is logged once. */
let reported = new WeakSet<object>();
let recent: EditorErrorReport[] = [];

/** "TypeError: x is not a function" for an Error, the text of anything else. */
export function summarizeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function consoleLine(report: EditorErrorReport): string {
  if (report.level === "warn") return `The editor hit a problem while drawing and recovered by drawing again. (${report.summary})`;
  if (report.where) return `${report.where} hit a problem and stopped drawing. ${HINT} (${report.summary})`;
  return `Something in the editor failed. ${HINT} (${report.summary})`;
}

/** Log an editor error once: in the HUD console when the app has a session, and in the list Copy details reads. Returns false for one already reported. */
export function reportEditorError(error: unknown, options: ReportOptions = {}): boolean {
  if (typeof error === "object" && error !== null) {
    if (reported.has(error)) return false;
    reported.add(error);
  }
  const report: EditorErrorReport = {
    summary: summarizeError(error),
    where: options.where ?? null,
    level: options.level ?? "error",
    stack: error instanceof Error ? (error.stack ?? null) : null,
    componentStack: options.componentStack?.trim() || null,
    at: Date.now(),
  };
  recent = [...recent.slice(1 - KEPT), report];
  if (options.print) console.error(`[sonobe] ${report.where ?? "The editor"} hit a problem.`, error, report.componentStack ? `\n${report.componentStack}` : "");
  // Never create the session from here: an error before the editor started has no console to open.
  peekAppSession()?.console.getState().push(report.level, consoleLine(report), { source: "editor" });
  return true;
}

/** The editor errors reported most recently, oldest first. */
export function recentEditorErrors(): readonly EditorErrorReport[] {
  return recent;
}

/** Forget what was reported (tests). */
export function clearEditorErrors(): void {
  reported = new WeakSet();
  recent = [];
}

/** Chromium raises this when a ResizeObserver callback resizes what it observes; the layout settles a frame later. */
const BENIGN = /ResizeObserver loop/;

type ErrorTarget = Pick<Window, "addEventListener" | "removeEventListener">;

/**
 * Report errors that reach `window`: one thrown in an event handler, a timer or an animation frame, and
 * a promise that rejected with nobody waiting. Returns a function that stops.
 */
export function installErrorReporting(target: ErrorTarget = window): () => void {
  const onError = (event: ErrorEvent) => {
    if (BENIGN.test(event.message ?? "")) return;
    reportEditorError(event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    // A cancelled fetch or share sheet, not a failure.
    if (typeof reason === "object" && reason !== null && (reason as { name?: unknown }).name === "AbortError") return;
    reportEditorError(reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

/**
 * createRoot's error handlers. Boundaries don't report, so this is the one place a render error is
 * logged: with the name of the boundary that caught it, or, when none did, before the last resort
 * goes up in the container's place.
 */
export function rootErrorOptions(container: Element): RootOptions {
  return {
    onCaughtError(error, info) {
      const boundary = info.errorBoundary;
      reportEditorError(error, { ...(boundary instanceof ErrorBoundary ? { where: boundary.props.name } : {}), ...(info.componentStack ? { componentStack: info.componentStack } : {}), print: true });
    },
    onUncaughtError(error, info) {
      reportEditorError(error, { ...(info.componentStack ? { componentStack: info.componentStack } : {}), print: true });
      showLastResort(container, error);
    },
    onRecoverableError(error, info) {
      reportEditorError(error, { level: "warn", ...(info.componentStack ? { componentStack: info.componentStack } : {}), print: true });
    },
  };
}

const time = (at: number) => new Date(at).toTimeString().slice(0, 8);

/** The error with its stack. Chromium's stack starts with the summary; other browsers' doesn't. */
export function errorText(error: unknown): string {
  const summary = summarizeError(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return !stack ? summary : stack.startsWith(summary) ? stack : `${summary}\n${stack}`;
}

/** What Copy details puts on the clipboard: the error, where it was thrown, the editor errors before it, and the line Report an Issue ends with. */
export function errorDetails(error: unknown, componentStack: string | null = null): string {
  const summary = summarizeError(error);
  const earlier = recent.filter((report) => report.summary !== summary);
  return [
    errorText(error),
    ...(componentStack?.trim() ? ["", "Component stack", componentStack.trim()] : []),
    ...(earlier.length ? ["", "Earlier editor errors", ...earlier.map((report) => `${time(report.at)} ${report.where ? `${report.where}: ` : ""}${report.summary}`)] : []),
    "",
    environmentLine(issueContext(peekAppSession())),
  ].join("\n");
}

/** How long Reload waits for the draft before it reloads anyway. */
const FLUSH_LIMIT_MS = 1500;

export type DraftStatus =
  /** Nothing was unsaved, or the editor never got as far as a document. */
  | { state: "clean" }
  /** The unsaved edits are in the draft. */
  | { state: "kept"; name: string }
  /** Marked unsaved with no edits of the person's (an example copy): there is nothing to keep. */
  | { state: "nothing"; name: string }
  /** Unsaved edits with no draft: the host keeps none, or the write hasn't landed. */
  | { state: "lost"; name: string };

/** What the draft keeper holds of the session's unsaved work, as it is now. */
export function draftStatus(session: Pick<EditorSession, "document" | "drafts"> | null): DraftStatus {
  const state = session?.document.getState();
  if (!session || !state?.dirty) return { state: "clean" };
  const name = state.doc.project.name;
  const drafts = session.drafts;
  if (!drafts || drafts.pending()) return { state: "lost", name };
  return { state: drafts.current() ? "kept" : "nothing", name };
}

/** Write the session's draft now, waiting at most 1.5 s, and say what it holds. `flush()` resolves when a write fails too, so the answer comes from `pending()`. */
export async function keepDraft(session: Pick<EditorSession, "document" | "drafts"> | null = peekAppSession(), limitMs: number = FLUSH_LIMIT_MS): Promise<DraftStatus> {
  if (session?.drafts && session.document.getState().dirty) await Promise.race([session.drafts.flush(), new Promise((resolve) => setTimeout(resolve, limitMs))]);
  return draftStatus(session);
}

/**
 * With a draft on disk, or nothing of the person's to keep, the window stops counting as edited. The
 * document's Save went with the tree, so the desktop app's unsaved-changes prompt could offer only
 * Don't Save, which deletes the draft; this way closing or quitting leaves the draft for the next
 * launch. That holds for a draft that lacks the last changes too: it is all there is to keep. With no
 * draft at all the flag stays, and the prompt still warns.
 */
export function releaseEditedFlag(session: Pick<EditorSession, "host"> | null, status: DraftStatus): void {
  if (status.state !== "clean" && status.state !== "lost") session?.host?.setDocumentEdited(false);
}

/**
 * The last resort: the editor threw with no boundary left to catch it (the recovery screen itself
 * failed), and React draws nothing. Plain DOM, so nothing here can fail the same way, and the window
 * is never blank. It takes the container's place in the page instead of filling it: React isn't done
 * with a container it emptied, and clears it again with the next thing it commits there.
 */
export function showLastResort(container: Element, error: unknown, reload: () => void = () => window.location.reload()): void {
  const doc = container.ownerDocument;
  const el = (tag: string, className: string, text?: string) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const first = lastBoundaryError();
  const screen = el("div", "sb-recovery");
  screen.setAttribute("role", "alert");
  const body = el("div", "sb-recovery__body");
  const button = el("button", "sb-btn", "Reload Sonobe") as HTMLButtonElement;
  button.type = "button";
  button.dataset.variant = "primary";
  button.dataset.size = "md";
  button.addEventListener("click", () => {
    button.disabled = true;
    // Whatever the draft keeper can still write goes in first; the reload happens either way.
    void keepDraft().then(reload, reload);
  });
  const actions = el("div", "sb-recovery__actions");
  actions.append(button);
  body.append(
    el("h1", "sb-recovery__title", "Sonobe hit a problem"),
    el("p", "sb-recovery__text", "The editor stopped and couldn't show its recovery screen. Reload to start again: unsaved changes Sonobe kept as a draft are on the welcome screen, under Recovered."),
    // What broke first, then what broke the recovery screen.
    el("pre", "sb-recovery__details sb-selectable sb-scroll", [...(first !== null && first !== error ? [errorText(first), ""] : []), errorText(error)].join("\n")),
    actions,
  );
  screen.append(el("div", "sb-recovery__drag"), body);
  container.replaceWith(screen);

  // What the recovery screen does first, as far as plain code can: stop the prototype, write the draft, and let the
  // window close without the prompt that could only delete it. The session may be what broke, so none of it may throw.
  const session = peekAppSession();
  try {
    session?.runtime.pause();
  } catch {
    // The message is up either way.
  }
  void keepDraft(session)
    .then((status) => releaseEditedFlag(session, status))
    .catch(() => undefined);
}
