import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Suffix marker for temp files written by atomic writes (ignored by project watchers). */
export const TEMP_MARKER = ".sonobe-tmp-";

function tempPathFor(file: string): string {
  return path.join(path.dirname(file), `.${path.basename(file)}${TEMP_MARKER}${randomBytes(6).toString("hex")}`);
}

export interface AtomicWriteOptions {
  /** File mode applied to the new file (e.g. 0o600). */
  mode?: number;
  /** Mode for any directories created along the way. */
  dirMode?: number;
}

/** Write a file by writing a sibling temp file and renaming it over the target. */
export async function atomicWriteFile(file: string, data: string | Uint8Array, opts: AtomicWriteOptions = {}): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, ...(opts.dirMode !== undefined ? { mode: opts.dirMode } : {}) });
  const tmp = tempPathFor(file);
  try {
    await writeFile(tmp, data, opts.mode !== undefined ? { mode: opts.mode } : {});
    if (opts.mode !== undefined) await chmod(tmp, opts.mode);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Synchronous variant for quit paths where the event loop may not get another turn. */
export function atomicWriteFileSync(file: string, data: string | Uint8Array, opts: AtomicWriteOptions = {}): void {
  mkdirSync(path.dirname(file), { recursive: true, ...(opts.dirMode !== undefined ? { mode: opts.dirMode } : {}) });
  const tmp = tempPathFor(file);
  try {
    writeFileSync(tmp, data, opts.mode !== undefined ? { mode: opts.mode } : {});
    if (opts.mode !== undefined) chmodSync(tmp, opts.mode);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Read and parse a JSON file; returns undefined when missing or malformed. */
export async function readJsonFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}
