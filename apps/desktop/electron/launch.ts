/**
 * What a new editor window starts on, when the app has something for it: a prototype double-clicked in
 * Finder or named on the command line, or what was open before a restart for an update. The editor asks
 * once, before its first render (`sonobeHost.launch()`), so the first frame is that document and never
 * the demo it would otherwise start on (ARCHITECTURE §9.1 Launch).
 *
 * Electron-free: main.ts gives it the paths, the restart's steps and how to look at a path.
 */

import type { LaunchInfo } from "./host-api.d.ts";
import type { ReopenStep } from "./update-restart.ts";

export interface LaunchPlan {
  /** What the window's editor is told. */
  info: LaunchInfo;
  /**
   * What opens through the usual queue, in the order asked: the prototypes named after the one the window starts on, and
   * any path that didn't answer in the time it was given.
   */
  restPaths: string[];
  /** A restart's steps after the first. */
  restSteps: ReopenStep[];
}

export interface LaunchPlanInput {
  /** Paths the app was asked to open, in order. They win over `steps`. */
  paths: readonly string[];
  /** What a restart wrote down (update-restart.ts reopenPlan). */
  steps: readonly ReopenStep[];
  /** The project folder a path selects, or null (project-io.ts resolveProjectSelection). */
  resolve(path: string): Promise<string | null>;
  /** Whether anything is at a path that selects no project. */
  exists(path: string): boolean;
  /** The draft a folder is, when it's one of the app's drafts of unsaved work. */
  draftAt(dir: string): Promise<string | null>;
  /** How long looking at one path may take. Default LAUNCH_LOOK_MS. */
  lookTimeoutMs?: number;
}

/**
 * The time `planLaunch` gives each path to answer: a share that hangs, or a disk that is waking up, doesn't. It is under
 * the 1.5 s the editor's first render waits for the plan (LAUNCH_WAIT_MS), so with one such path the editor still renders
 * with the answer.
 */
export const LAUNCH_LOOK_MS = 1000;

/** What `looking` resolves, or undefined when it takes longer than `ms`. */
function within<T>(looking: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    void looking.then((found) => {
      clearTimeout(timer);
      resolve(found);
    });
  });
}

/**
 * The window starts on the first path that is a prototype (a draft's folder comes back as the draft), and
 * every path that isn't one is a problem the editor tells the person about. With no paths it starts on a
 * restart's first step. With neither, `open` is null and the editor starts as it does on a plain launch.
 *
 * A path that doesn't answer in its time is neither: it goes to `restPaths` and opens the usual way when it does
 * answer, so the window, and whatever is opened in it meanwhile, doesn't wait on it.
 */
export async function planLaunch(input: LaunchPlanInput): Promise<LaunchPlan> {
  let first: string | undefined;
  const restPaths: string[] = [];
  const problems: LaunchInfo["problems"] = [];
  for (const candidate of input.paths) {
    const dir = await within(input.resolve(candidate).catch(() => null), input.lookTimeoutMs ?? LAUNCH_LOOK_MS);
    // Only a path that answered is looked at again: `exists` on one that hasn't would wait on the same share.
    if (dir === null) problems.push({ path: candidate, reason: input.exists(candidate) ? "notProject" : "missing" });
    else if (dir === undefined || first !== undefined) restPaths.push(dir ?? candidate);
    else first = dir;
  }
  if (first !== undefined) {
    const draft = await input.draftAt(first).catch(() => null);
    return { info: { reopening: false, open: draft ? { kind: "draft", id: draft, project: null } : { kind: "project", path: first }, problems }, restPaths, restSteps: [] };
  }
  const [step, ...restSteps] = input.paths.length ? [] : input.steps;
  if (!step) return { info: { reopening: false, open: null, problems }, restPaths, restSteps: [] };
  return { info: { reopening: true, open: step.kind === "draft" ? { kind: "draft", id: step.id, project: step.project } : { kind: "project", path: step.path }, problems }, restPaths, restSteps };
}

/** Whether what a window's editor reports (`document.info`) is what it was started on: the draft, the project under a draft that didn't come back, or the project. */
export function showsLaunch(open: NonNullable<LaunchInfo["open"]>, info: { projectPath?: unknown; draft?: unknown } | null | undefined): boolean {
  if (!info) return false;
  if (open.kind === "project") return info.projectPath === open.path;
  const draft = info.draft as { id?: unknown } | null | undefined;
  return draft?.id === open.id || (open.project !== null && info.projectPath === open.project);
}
