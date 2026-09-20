/**
 * Where a new project folder may go: the rules create_document and save_document({ path }) follow
 * on both hosts, and that the app's Save panel reuses. They only ever pick a new or empty folder, so
 * a path an agent chose can't overwrite, merge into or nest inside something that already exists.
 * Node only.
 *
 * 1. "~" expands to the home folder. The app needs an absolute path; headless resolves against its
 *    working folder.
 * 2. ".sonobe" is appended when the name doesn't end with it.
 * 3. With `roots` (the app): the folder must be inside one of them, outside `refused` folders, and
 *    not in a hidden folder under home.
 * 4. No folder above it may be a project (a *.sonobe folder, or one with a Sonobe project.json).
 * 5. It must not exist yet, or be an empty folder.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { HostError } from "./host.ts";

export interface ProjectTargetOptions {
  /** Resolve relative paths against this folder (headless). Without it they fail with absolute_path_required. */
  cwd?: string;
  /** For "~" and hidden-folder checks. Default os.homedir(). */
  home?: string;
  /** When given, the folder must be inside one of these (the app: home, mounted volumes, the temp folder). */
  roots?: readonly string[];
  /** Folders a project may never go in, with a reason ("Sonobe keeps its drafts there"). */
  refused?: readonly { dir: string; why: string }[];
  /** An existing project may be the target (the person confirmed replacing it in the Save panel). */
  allowExistingProject?: boolean;
}

/** Why a folder can't hold a new project. */
export interface ProjectTargetProblem {
  code: "absolute_path_required" | "path_not_allowed" | "inside_project" | "already_exists" | "folder_not_empty";
  message: string;
  hint: string;
  /** Where it could go instead: next to the project it was inside. */
  suggestion?: string;
}

export const PROJECT_EXTENSION = ".sonobe";

/** Files an OS leaves in folders; a folder holding only these counts as empty. */
const LITTER = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "Icon\r"]);

const hasExtension = (p: string) => path.basename(p).toLowerCase().endsWith(PROJECT_EXTENSION);

/** Inside (or equal to) `dir`. */
function isInside(target: string, dir: string, allowEqual = false): boolean {
  const rel = path.relative(dir, target);
  if (rel === "") return allowEqual;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** A folder with a Sonobe project.json (a manifest with formatVersion and root). */
async function holdsProject(dir: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, "project.json"), "utf8")) as unknown;
    return !!manifest && typeof manifest === "object" && "formatVersion" in manifest && "root" in manifest;
  } catch {
    return false;
  }
}

/** "~/…" or "~" with the home folder. */
export function expandHome(p: string, home = homedir()): string {
  return p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(home, p.slice(1)) : p;
}

/** The absolute folder `input` names, ending in .sonobe, or the reason it can't be resolved. */
function resolveInput(input: string, options: ProjectTargetOptions): string | ProjectTargetProblem {
  const expanded = expandHome(input.trim(), options.home);
  if (!path.isAbsolute(expanded) && options.cwd === undefined) {
    return {
      code: "absolute_path_required",
      message: `"${input}" is a relative path, and the Sonobe app has no working folder to resolve it against.`,
      hint: 'Pass an absolute folder path such as "~/Documents/Checkout Flow.sonobe".',
    };
  }
  const resolved = path.resolve(options.cwd ?? "/", expanded);
  return hasExtension(resolved) ? resolved : `${resolved}${PROJECT_EXTENSION}`;
}

/**
 * Check a folder for a new project. Returns the problem, or null when `dir` (absolute, ending in
 * .sonobe) can be created or is empty.
 */
export async function checkProjectTarget(dir: string, options: ProjectTargetOptions = {}): Promise<ProjectTargetProblem | null> {
  const home = options.home ?? homedir();
  const name = path.basename(dir);
  if (options.roots) {
    if (!options.roots.some((root) => isInside(dir, root))) {
      return {
        code: "path_not_allowed",
        message: `Sonobe only creates projects inside your home folder, the temporary folder or a mounted drive, and ${dir} isn't in one.`,
        hint: `Pick a folder such as "~/Documents/${name}".`,
      };
    }
    const refused = options.refused?.find((r) => isInside(dir, r.dir, true));
    if (refused) {
      return { code: "path_not_allowed", message: `A project can't go in ${refused.dir}: ${refused.why}.`, hint: `Pick a folder such as "~/Documents/${name}".` };
    }
    if (isInside(dir, home)) {
      const hidden = path.relative(home, path.dirname(dir)).split(path.sep).find((segment) => segment.startsWith("."));
      if (hidden) {
        return {
          code: "path_not_allowed",
          message: `${dir} is inside the hidden folder "${hidden}", where people wouldn't find it.`,
          hint: `Pick a visible folder such as "~/Documents/${name}".`,
        };
      }
    }
  }

  // Nothing above it may be a project: a project inside a project is a folder nobody can open.
  for (let parent = path.dirname(dir); parent !== path.dirname(parent); parent = path.dirname(parent)) {
    if (hasExtension(parent) || (await holdsProject(parent))) {
      const beside = path.join(path.dirname(parent), name);
      return {
        code: "inside_project",
        message: `${dir} would be inside the project ${parent}.`,
        hint: `Save it next to that project instead, for example "${beside}".`,
        suggestion: beside,
      };
    }
  }

  const info = await stat(dir).catch(() => null);
  if (!info) return null;
  if (!info.isDirectory()) {
    return { code: "already_exists", message: `${dir} is a file, not a folder.`, hint: "Pick another name." };
  }
  if (await holdsProject(dir)) {
    if (options.allowExistingProject) return null;
    return { code: "already_exists", message: `${dir} already holds a Sonobe project.`, hint: "Open it with open_document instead, or pick another folder." };
  }
  const entries = (await readdir(dir).catch(() => [] as string[])).filter((entry) => !LITTER.has(entry));
  if (entries.length) {
    return {
      code: "folder_not_empty",
      message: `${dir} already has ${entries.length === 1 ? `a file in it (${entries[0]})` : `${entries.length} files in it`}, so Sonobe won't put a project there.`,
      hint: "Pick a new folder name. Sonobe only creates projects in new or empty folders.",
    };
  }
  return null;
}

/**
 * Resolve and check a folder for a new project (the rules at the top of this file). Returns the
 * absolute folder, ending in .sonobe; throws a HostError explaining the rule it breaks.
 */
export async function resolveProjectTarget(input: string, options: ProjectTargetOptions = {}): Promise<string> {
  const resolved = resolveInput(input, options);
  const problem = typeof resolved === "string" ? await checkProjectTarget(resolved, options) : resolved;
  if (problem) throw new HostError(problem.code, problem.message, { hint: problem.hint, ...(problem.suggestion ? { data: { suggestion: problem.suggestion } } : {}) });
  return resolved as string;
}

/** A project name that says nothing ("Untitled", "Untitled 2", ""): not worth a folder name. */
export function isPlaceholderName(name: string): boolean {
  return /^(untitled( \d+)?)?$/i.test(name.trim());
}
