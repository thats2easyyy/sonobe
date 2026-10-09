/**
 * A window the desktop app opened for something starts on it: a prototype double-clicked in Finder or
 * named on the command line, or the work a restart for an update closed. The app says what before the
 * first render (`sonobeHost.launch()`), and the app's session is created on an empty document and opens
 * it, so the first frame is that document and the Photo Zoom demo is never built. What can't be opened
 * is said in a notice that stays, over the demo a plain launch shows.
 *
 * Mirrors `LaunchInfo` in apps/desktop/electron/host-api.d.ts. Keep in sync. The browser editor has
 * nothing to ask and starts as it always has.
 */

import { createEmptyDocument } from "@sonobe/core";
import { getDesktopHostApi } from "../host/detect.ts";
import { projectDisplayName } from "../host/projectFiles.ts";
import type { DocumentChange, FileResult } from "../state/document.ts";
import type { EditorSession, RestoreDraftResult } from "../state/session.ts";
import { toast, type ToastOptions } from "../ui/Toast.tsx";
import { startAppSession, type AppSessionOptions } from "./session.ts";

export interface LaunchInfo {
  /** The window opens again what was open before a restart for an update. */
  reopening: boolean;
  /** What to start on: a project folder, or a draft with the project to open when the draft doesn't come back. Null: nothing. */
  open: { kind: "project"; path: string } | { kind: "draft"; id: string; project: string | null } | null;
  /** Paths the app was asked to open and couldn't: nothing is there, or what's there isn't a prototype. */
  problems: { path: string; reason: "missing" | "notProject" }[];
}

export interface LaunchHost {
  launch(): Promise<unknown>;
}

/** How long the first render waits for the launch document. After that the editor shows, empty, and the document arrives when it's read. */
export const LAUNCH_WAIT_MS = 1500;

/** What came of the launch, for the welcome screen and the Recovered offer (EditorApp.tsx). */
export interface LaunchOutcome {
  /** The launch document isn't in yet. */
  pending: boolean;
  reopening: boolean;
  /** The session shows what the window was opened for. */
  opened: boolean;
  /** The change that put the demo in when nothing opened: with it as the last change, the document is as untouched as a plain launch's. */
  pristine: DocumentChange | null;
}

const NO_LAUNCH: LaunchOutcome = { pending: false, reopening: false, opened: false, pristine: null };
let outcome = NO_LAUNCH;

export const launchOutcome = (): LaunchOutcome => outcome;

/** The host to ask, in a window the desktop app opened for something. Null everywhere else. */
export function getLaunchHost(): LaunchHost | null {
  if (typeof window === "undefined") return null;
  // e2e only (e2e/fakeLaunch.ts); never in a production build.
  const fake = import.meta.env?.DEV ? (window as unknown as { __sonobeFakeLaunch?: unknown }).__sonobeFakeLaunch : undefined;
  const api = (fake ?? getDesktopHostApi()) as { launching?: unknown; launch?: unknown } | undefined;
  if (!api || api.launching !== true || typeof api.launch !== "function") return null;
  return { launch: () => (api.launch as () => Promise<unknown>)() };
}

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** What the host answered, with anything malformed read as nothing to open. */
export function toLaunchInfo(value: unknown): LaunchInfo {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const o = (v.open && typeof v.open === "object" ? v.open : {}) as Record<string, unknown>;
  const [path, id] = [text(o.path), text(o.id)];
  const open: LaunchInfo["open"] = o.kind === "project" && path ? { kind: "project", path } : o.kind === "draft" && id ? { kind: "draft", id, project: text(o.project) } : null;
  const problems = (Array.isArray(v.problems) ? v.problems : []).flatMap((entry: unknown): LaunchInfo["problems"] => {
    const at = text((entry as { path?: unknown } | null)?.path);
    return at ? [{ path: at, reason: (entry as { reason?: unknown }).reason === "notProject" ? "notProject" : "missing" }] : [];
  });
  return { reopening: v.reopening === true, open, problems };
}

/** Shows a notice (the kit's toast). */
export type LaunchNotifier = (options: ToastOptions) => unknown;

const failed = (err: unknown): FileResult => ({ ok: false, error: err instanceof Error ? err.message : String(err) });

/** Puts what the window was opened for into its session. Never rejects. */
async function launchInto(session: EditorSession, host: LaunchHost, notify: LaunchNotifier): Promise<void> {
  const info = toLaunchInfo(await host.launch().catch(() => null));
  outcome = { ...outcome, reopening: info.reopening };
  // The person asked for something and didn't get it: the notice stays until it's dismissed.
  const say = (id: string, title: string, description: string) => void notify({ id: `launch-${id}`, title, description, tone: "danger", duration: "persistent" });
  const named = (path: string) => `“${session.host?.displayName(path) ?? projectDisplayName(path)}”`;
  info.problems.forEach((problem, i) =>
    problem.reason === "missing"
      ? say(`missing-${i}`, `${named(problem.path)} isn't there right now`, "It may have moved or been deleted, or be on a drive or share that isn't connected.")
      : say(`not-project-${i}`, `${named(problem.path)} isn't a Sonobe prototype`, "A prototype is a folder ending in .sonobe, or a folder that contains project.json."),
  );
  const openProject = async (path: string): Promise<boolean> => {
    const result = await session.openProject(path).catch(failed);
    if (!result.ok && !result.cancelled) say("project", `Couldn't open ${named(path)}`, result.error ?? "It may have moved or been deleted.");
    return result.ok;
  };
  const { open } = info;
  let opened = false;
  if (open?.kind === "draft") {
    const draft: RestoreDraftResult = await session.restoreDraft(open.id).catch(failed);
    opened = draft.ok;
    // What the Recovered section says of a draft that came back with something missing.
    if (draft.ok && draft.notes?.length) notify({ id: "launch-draft", title: `Recovered “${draft.draft?.name ?? "your draft"}”`, description: draft.notes.join(" "), tone: "warn", duration: "persistent" });
    if (!draft.ok) {
      say("draft", "Sonobe couldn't bring back that draft", draft.error ?? "Its files may be damaged.");
      if (open.project) opened = await openProject(open.project);
    }
  } else if (open) {
    opened = await openProject(open.path);
  }
  // Nothing opened: the demo, as on a plain launch. Not over an empty prototype the person has already started on.
  const untouched = !opened && session.document.getState().lastChange === null;
  if (untouched) await session.newProject({ template: "demo" });
  outcome = { pending: false, reopening: info.reopening, opened, pristine: untouched ? session.document.getState().lastChange : null };
}

/**
 * In a window the app opened for something: creates the app's session, started on it, and resolves once
 * it shows (or couldn't be opened and the demo does). Null everywhere else: there's nothing to wait for.
 * Call it before the first render, and render when it settles or after LAUNCH_WAIT_MS, whichever is first.
 */
export function startLaunch(host: LaunchHost | null = getLaunchHost(), options: AppSessionOptions = {}, notify: LaunchNotifier = toast): Promise<void> | null {
  outcome = { ...NO_LAUNCH, pending: host !== null };
  if (!host) return null;
  return startAppSession({ ...options, document: createEmptyDocument(), launch: (session) => launchInto(session, host, notify) }).launched;
}
