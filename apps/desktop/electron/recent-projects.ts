import { stat } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, readJsonFile } from "./fs-utils.ts";

export interface RecentProjectsOptions {
  /** Default 12. */
  max?: number;
  /** Existence check; defaults to "is a directory". */
  exists?(dir: string): Promise<boolean>;
  /** How long one folder's check may take before the folder counts as missing for now. Default 1.5 s. */
  checkTimeoutMs?: number;
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

function normalize(dir: string): string {
  const resolved = path.resolve(dir);
  return resolved.length > 1 ? resolved.replace(/[\\/]+$/, "") : resolved;
}

/**
 * With this many checks past their time and still unanswered (a share that hangs), no new check starts. Each one holds one of
 * the file system's four threads until it answers. Folders are checked two at a time, so at most three checks ever wait, and
 * reading and saving projects always have a thread.
 */
const MAX_UNANSWERED = 2;

/**
 * Most-recent-first list of project folders, persisted as JSON in userData.
 *
 * A folder that isn't there right now stays in the saved list: a project on a drive that's unplugged or a share that isn't
 * mounted comes back with it. `available()` looks which folders are there, and `snapshot()` leaves out the ones the last look
 * didn't find. Only `add`, `remove` and `clear` write the file.
 */
export class RecentProjects {
  readonly file: string;
  private readonly max: number;
  private readonly exists: (dir: string) => Promise<boolean>;
  private readonly checkTimeoutMs: number;
  private items: string[] | null = null;
  private writes: Promise<void> = Promise.resolve();
  /** Folders the last look didn't find. */
  private readonly missing = new Set<string>();
  /** Checks that haven't answered yet, by folder. A folder is never asked about twice at once. */
  private readonly asked = new Map<string, Promise<boolean>>();
  /** The asked folders whose check ran out of time and still hasn't answered. */
  private readonly unanswered = new Set<string>();
  private looking: Promise<string[]> | null = null;

  constructor(file: string, opts: RecentProjectsOptions = {}) {
    this.file = file;
    this.max = opts.max ?? 12;
    this.exists = opts.exists ?? isDirectory;
    this.checkTimeoutMs = opts.checkTimeoutMs ?? 1500;
  }

  private async load(): Promise<string[]> {
    if (this.items) return this.items;
    const data = await readJsonFile(this.file);
    const list = data && typeof data === "object" && Array.isArray((data as { projects?: unknown }).projects) ? (data as { projects: unknown[] }).projects : [];
    // Two reads can overlap. The second mustn't replace a list that add() has changed since the first.
    this.items ??= [...new Set(list.filter((p): p is string => typeof p === "string" && path.isAbsolute(p)).map(normalize))].slice(0, this.max);
    return this.items;
  }

  private persist(): Promise<void> {
    const snapshot = [...(this.items ?? [])];
    this.writes = this.writes.then(() => atomicWriteFile(this.file, `${JSON.stringify({ version: 1, projects: snapshot }, null, 2)}\n`)).catch(() => undefined);
    return this.writes;
  }

  /** The loaded list without the folders the last look didn't find, without touching the disk (for building menus). */
  snapshot(): string[] {
    return (this.items ?? []).filter((p) => !this.missing.has(p));
  }

  /** Whether the last look left a folder of the list out. One the list has dropped since (pushed off the end, removed) doesn't count. */
  hasMissing(): boolean {
    return (this.items ?? []).some((p) => this.missing.has(p));
  }

  /** The saved list, missing folders included. Reads the file once and checks nothing. */
  async list(): Promise<string[]> {
    return [...(await this.load())];
  }

  /**
   * Whether `dir` is there, or null when it wasn't asked because earlier checks still hang (MAX_UNANSWERED). A check gets
   * `checkTimeoutMs`; past that the folder counts as missing, and it isn't asked about again until that check has answered.
   */
  private check(dir: string): Promise<boolean | null> {
    let answer = this.asked.get(dir);
    if (!answer) {
      if (this.unanswered.size >= MAX_UNANSWERED) return Promise.resolve(null);
      answer = this.exists(dir)
        .catch(() => false)
        .finally(() => {
          this.asked.delete(dir);
          this.unanswered.delete(dir);
        });
      this.asked.set(dir, answer);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.asked.has(dir)) this.unanswered.add(dir);
        resolve(false);
      }, this.checkTimeoutMs);
      void answer.then((there) => {
        clearTimeout(timer);
        resolve(there);
      });
    });
  }

  /**
   * Looks which saved folders are there now, two at a time, and returns those. Nothing is saved. Calls made while a look is
   * running share it.
   */
  available(): Promise<string[]> {
    return (this.looking ??= (async () => {
      const queue = [...(await this.load())];
      const look = async () => {
        for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
          const there = await this.check(dir);
          if (there === true) this.missing.delete(dir);
          else if (there === false) this.missing.add(dir);
        }
      };
      await Promise.all([look(), look()]);
      return this.snapshot();
    })().finally(() => {
      this.looking = null;
    }));
  }

  async add(dir: string): Promise<string[]> {
    const normalized = normalize(dir);
    const items = await this.load();
    this.items = [normalized, ...items.filter((p) => p !== normalized)].slice(0, this.max);
    // It was just opened or saved, so it's there.
    this.missing.delete(normalized);
    await this.persist();
    return this.snapshot();
  }

  async remove(dir: string): Promise<string[]> {
    const normalized = normalize(dir);
    this.items = (await this.load()).filter((p) => p !== normalized);
    this.missing.delete(normalized);
    await this.persist();
    return this.snapshot();
  }

  async clear(): Promise<void> {
    this.items = [];
    this.missing.clear();
    await this.persist();
  }
}
