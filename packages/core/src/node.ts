/**
 * Node file system adapter for project IO ("@sonobe/core/node"). Everything else in
 * @sonobe/core is browser-safe; only this module imports node:*.
 */

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MigrateOptions } from "./migrations.ts";
import { loadProject, saveProject, type FsAdapter, type SaveResult } from "./serialize.ts";
import type { SonobeDocument } from "./types.ts";

const isMissing = (err: unknown) => !!err && typeof err === "object" && (err as { code?: string }).code === "ENOENT";

let tempCounter = 0;

/** FsAdapter over node:fs/promises. Text writes are atomic (temp file + rename). */
export function createNodeFs(): FsAdapter {
  return {
    readText: (path) => readFile(path, "utf8"),
    async writeText(path, text) {
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.${tempCounter++}.tmp`;
      await writeFile(temp, text, "utf8");
      await rename(temp, path);
    },
    async readBinary(path) {
      return new Uint8Array(await readFile(path));
    },
    async writeBinary(path, data) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async list(dir) {
      try {
        return (await readdir(dir)).sort();
      } catch (err) {
        if (isMissing(err)) return [];
        throw err;
      }
    },
    async mkdirp(dir) {
      await mkdir(dir, { recursive: true });
    },
    async exists(path) {
      try {
        await stat(path);
        return true;
      } catch (err) {
        if (isMissing(err)) return false;
        throw err;
      }
    },
    async remove(path) {
      await rm(path, { recursive: true, force: true });
    },
  };
}

/** Load a project folder from disk. */
export function loadProjectFromDisk(dir: string, options: MigrateOptions = {}): Promise<SonobeDocument> {
  return loadProject(createNodeFs(), dir, options);
}

/** Save a document into a project folder on disk. */
export function saveProjectToDisk(dir: string, doc: SonobeDocument): Promise<SaveResult> {
  return saveProject(createNodeFs(), dir, doc);
}
