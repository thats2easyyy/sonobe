/**
 * Node's compile cache for the main process: V8's compiled code for main.cjs (and updater.cjs when it loads), kept on disk
 * so a launch doesn't parse 10 MB of source again. electron/boot.ts turns it on before the main bundle loads, and main.ts
 * writes it and removes other versions' folders once the first window is on screen.
 *
 * Where it lives: `<userData>/compile-cache/app-<version>` for a packaged app and `<userData>/compile-cache/checkout` for a
 * checkout, so the two never share a folder though they share a data folder, and nothing is ever written inside the app.
 * The bundled CLI has one of its own, set by its launcher, under `~/.sonobe`: it runs outside the app, where the data
 * folder isn't known.
 * Node names an entry after the module's path and checks the source's hash, so an entry of another build is never read;
 * the folder per version is what lets an update's old entries be removed.
 *
 * No Electron import: the rules are unit tested.
 */

import { readdir, rm } from "node:fs/promises";
import path from "node:path";

/** What node:module's enableCompileCache() answers, as far as this reads it. */
export interface CompileCacheResult {
  /** node:module's constants.compileCacheStatus: 0 failed, 1 enabled, 2 already enabled (NODE_COMPILE_CACHE), 3 disabled (NODE_DISABLE_COMPILE_CACHE). */
  status: number;
  message?: string;
}

const FAILED = 0;

/** The folder's name under `compile-cache`: a packaged app's version, or `checkout`. */
export function compileCacheKey(build: { version: string; packaged: boolean }): string {
  return build.packaged ? `app-${build.version}` : "checkout";
}

/**
 * The bundled CLI's folder under `<SONOBE_HOME or ~/.sonobe>/compile-cache`, which its launcher points Node at
 * (scripts/cli-launchers.ts). Named after the app's version, so the app knows which one to keep.
 */
export function cliCompileCacheKey(version: string): string {
  return `cli-${version}`;
}

export function compileCacheDir(userData: string, key: string): string {
  return path.join(userData, "compile-cache", key);
}

/**
 * False where the app's own path is new on every launch: under App Translocation (macOS runs an app from a random path until
 * it's moved out of Downloads) and in an AppImage (mounted at a new path each time). Entries are named after the module's
 * path, so every launch there would miss and leave another 1.3 MB behind.
 */
export function usesCompileCache(where: { exePath: string; appImage: string | undefined }): boolean {
  return !where.exePath.includes("/AppTranslocation/") && !where.appImage;
}

export interface CompileCacheStart {
  /** node:module's enableCompileCache. */
  enable(dir: string): CompileCacheResult;
  /** The data folder main.ts is about to use. */
  userData: string;
  version: string;
  packaged: boolean;
  exePath: string;
  appImage: string | undefined;
  /** Why this build must not run here (env.ts launchEnvProblem), or null: a build that is about to stop writes nothing. */
  launchProblem: string | null;
  warn(message: string): void;
}

/**
 * Turns the cache on, or doesn't. Returns the folder it asked for, or null when it didn't ask. Launch never fails over the
 * cache: a folder that can't be made is one warning, and the app compiles its code as it would without one. A cache Node
 * already has (NODE_COMPILE_CACHE in the environment) or was told not to have (NODE_DISABLE_COMPILE_CACHE=1) stays as it is.
 */
export function startCompileCache(o: CompileCacheStart): string | null {
  if (o.launchProblem || !usesCompileCache(o)) return null;
  const dir = compileCacheDir(o.userData, compileCacheKey(o));
  const failed = (why: string) => o.warn(`Sonobe couldn't keep its compile cache in ${dir} (${why}), so this launch compiles its code again and starts a little slower. Check that the folder can be written.`);
  try {
    const result = o.enable(dir);
    if (result.status === FAILED) failed(result.message ?? "no reason given");
  } catch (err) {
    failed(err instanceof Error ? err.message : String(err));
  }
  return dir;
}

/** The folders among `names` that start with `prefix` and aren't `keep`: other versions' caches of the same kind. */
export function staleCompileCaches(names: readonly string[], keep: string, prefix: string): string[] {
  return names.filter((name) => name.startsWith(prefix) && name !== keep);
}

/** Removes other versions' caches under `root`. A folder that isn't there, or won't go, is left for the next launch. */
export async function pruneCompileCaches(root: string, keep: string, prefix: string): Promise<string[]> {
  const names = await readdir(root).catch(() => [] as string[]);
  const stale = staleCompileCaches(names, keep, prefix);
  await Promise.all(stale.map((name) => rm(path.join(root, name), { recursive: true, force: true }).catch(() => undefined)));
  return stale;
}
