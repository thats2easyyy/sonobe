import { stat } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, readJsonFile } from "./fs-utils.ts";

export interface RecentProjectsOptions {
  /** Default 12. */
  max?: number;
  /** Existence check; defaults to "is a directory". */
  exists?(dir: string): Promise<boolean>;
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

/** Most-recent-first list of project folders, persisted as JSON in userData. */
export class RecentProjects {
  readonly file: string;
  private readonly max: number;
  private readonly exists: (dir: string) => Promise<boolean>;
  private items: string[] | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(file: string, opts: RecentProjectsOptions = {}) {
    this.file = file;
    this.max = opts.max ?? 12;
    this.exists = opts.exists ?? isDirectory;
  }

  private async load(): Promise<string[]> {
    if (this.items) return this.items;
    const data = await readJsonFile(this.file);
    const list = data && typeof data === "object" && Array.isArray((data as { projects?: unknown }).projects) ? (data as { projects: unknown[] }).projects : [];
    this.items = [...new Set(list.filter((p): p is string => typeof p === "string" && path.isAbsolute(p)).map(normalize))].slice(0, this.max);
    return this.items;
  }

  private persist(): Promise<void> {
    const snapshot = [...(this.items ?? [])];
    this.writes = this.writes.then(() => atomicWriteFile(this.file, `${JSON.stringify({ version: 1, projects: snapshot }, null, 2)}\n`)).catch(() => undefined);
    return this.writes;
  }

  /** Last loaded list without touching the disk (for building menus). */
  snapshot(): string[] {
    return [...(this.items ?? [])];
  }

  /** Current list, dropping folders that no longer exist. */
  async list(): Promise<string[]> {
    const items = await this.load();
    const checks = await Promise.all(items.map((p) => this.exists(p)));
    const kept = items.filter((_, i) => checks[i]);
    if (kept.length !== items.length) {
      this.items = kept;
      await this.persist();
    }
    return [...kept];
  }

  async add(dir: string): Promise<string[]> {
    const normalized = normalize(dir);
    const items = await this.load();
    this.items = [normalized, ...items.filter((p) => p !== normalized)].slice(0, this.max);
    await this.persist();
    return this.snapshot();
  }

  async remove(dir: string): Promise<string[]> {
    const normalized = normalize(dir);
    this.items = (await this.load()).filter((p) => p !== normalized);
    await this.persist();
    return this.snapshot();
  }

  async clear(): Promise<void> {
    this.items = [];
    await this.persist();
  }
}
