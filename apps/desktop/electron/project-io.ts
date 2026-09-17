/** Reading and writing *.sonobe project folders from the main process (ARCHITECTURE.md §3.1). */

import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { TEMP_MARKER, atomicWriteFile } from "./fs-utils.ts";

export interface ReadProjectResult {
  files: Record<string, string>;
  binaries: Record<string, Uint8Array>;
}

export interface WriteProjectInput {
  files?: Record<string, string>;
  binaries?: Record<string, ArrayBuffer | ArrayBufferView>;
  deleted?: string[];
}

export class ProjectPathError extends Error {
  readonly code = "invalid_path";

  constructor(message: string) {
    super(message);
    this.name = "ProjectPathError";
  }
}

/** Extensions read as UTF-8 text (outside assets/). */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([".json", ".js", ".mjs", ".ts", ".md", ".txt", ".glsl", ".frag", ".vert", ".csv"]);

const IGNORED_SEGMENTS = new Set([".git", "node_modules", ".svn", ".hg"]);
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "Icon\r"]);

/** Paths the app never reads, writes, or reports: VCS folders, OS litter, and atomic-write temp files. */
export function isIgnoredProjectPath(rel: string): boolean {
  const segments = rel.split("/");
  const name = segments.at(-1) ?? "";
  return segments.some((s) => IGNORED_SEGMENTS.has(s)) || IGNORED_NAMES.has(name) || name.includes(TEMP_MARKER);
}

/** Validate a POSIX path relative to the project root. Returns it unchanged or throws. */
export function validateRelativePath(rel: unknown): string {
  if (typeof rel !== "string" || rel.length === 0) throw new ProjectPathError("Project paths must be non-empty strings");
  if (rel.length > 1024) throw new ProjectPathError(`Project path is too long: ${rel.slice(0, 60)}…`);
  if (rel.includes("\0")) throw new ProjectPathError("Project paths can't contain NUL characters");
  if (rel.includes("\\")) throw new ProjectPathError(`Use forward slashes in project paths: ${rel}`);
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) throw new ProjectPathError(`Project paths must be relative: ${rel}`);
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === "." || segment === "..") throw new ProjectPathError(`Invalid segment in project path: ${rel}`);
  }
  if (isIgnoredProjectPath(rel)) throw new ProjectPathError(`That path is reserved: ${rel}`);
  return rel;
}

function resolveInside(dir: string, rel: string): string {
  const target = path.resolve(dir, ...rel.split("/"));
  const back = path.relative(dir, target);
  if (back.startsWith("..") || path.isAbsolute(back)) throw new ProjectPathError(`Path escapes the project folder: ${rel}`);
  return target;
}

/** Binary under assets/ (except the registry) or any non-text extension. */
export function isBinaryProjectPath(rel: string): boolean {
  if (rel.startsWith("assets/") && rel !== "assets/assets.json") return true;
  return !TEXT_EXTENSIONS.has(path.posix.extname(rel).toLowerCase());
}

export function hashBytes(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Remembers what this process last wrote to each project path so the watcher can tell our own
 * writes from external edits by content, not by timing.
 */
export class OwnWriteRegistry {
  private readonly entries = new Map<string, string | null>();

  private key(dir: string, rel: string): string {
    return `${path.resolve(dir)}\n${rel}`;
  }

  /** Record content we're about to write (null = we're deleting it). */
  record(dir: string, rel: string, bytes: Uint8Array | string | null): void {
    this.entries.set(this.key(dir, rel), bytes === null ? null : hashBytes(bytes));
  }

  has(dir: string, rel: string): boolean {
    return this.entries.has(this.key(dir, rel));
  }

  /** True when the current disk content (null = missing) is exactly what we wrote. */
  matches(dir: string, rel: string, bytes: Uint8Array | null): boolean {
    const k = this.key(dir, rel);
    if (!this.entries.has(k)) return false;
    const expected = this.entries.get(k);
    return bytes === null ? expected === null : expected === hashBytes(bytes);
  }

  forget(dir: string, rel: string): void {
    this.entries.delete(this.key(dir, rel));
  }

  forgetProject(dir: string): void {
    const prefix = `${path.resolve(dir)}\n`;
    for (const k of this.entries.keys()) if (k.startsWith(prefix)) this.entries.delete(k);
  }
}

export interface ReadProjectOptions {
  /** Default 20,000 files. */
  maxFiles?: number;
  /** Default 2 GiB total. */
  maxBytes?: number;
}

/** Read every project file (symlinks are skipped, never followed). Keys are sorted. */
export async function readProject(dir: string, opts: ReadProjectOptions = {}): Promise<ReadProjectResult> {
  const maxFiles = opts.maxFiles ?? 20_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 ** 3;
  const root = path.resolve(dir);
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw Object.assign(new Error(`Project folder not found: ${root}`), { code: "not_found" });

  const found: string[] = [];
  const walk = async (absDir: string, relDir: string) => {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (isIgnoredProjectPath(rel)) continue;
      if (entry.isDirectory()) await walk(path.join(absDir, entry.name), rel);
      else if (entry.isFile()) {
        found.push(rel);
        if (found.length > maxFiles) throw Object.assign(new Error(`Project has more than ${maxFiles} files`), { code: "too_large" });
      }
    }
  };
  await walk(root, "");
  found.sort();

  const result: ReadProjectResult = { files: {}, binaries: {} };
  let total = 0;
  for (const rel of found) {
    const bytes = await readFile(path.join(root, ...rel.split("/")));
    total += bytes.byteLength;
    if (total > maxBytes) throw Object.assign(new Error(`Project is larger than ${Math.round(maxBytes / 1024 ** 2)} MB`), { code: "too_large" });
    if (isBinaryProjectPath(rel)) result.binaries[rel] = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    else result.files[rel] = bytes.toString("utf8");
  }
  return result;
}

function toBytes(value: unknown, rel: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new ProjectPathError(`Binary content for ${rel} must be an ArrayBuffer or typed array`);
}

export interface WriteProjectOptions {
  ownWrites?: OwnWriteRegistry;
}

export interface WriteProjectResult {
  written: string[];
  deleted: string[];
}

/** Validate every path first, then write files atomically and remove deleted ones. */
export async function writeProject(dir: string, input: WriteProjectInput, opts: WriteProjectOptions = {}): Promise<WriteProjectResult> {
  const root = path.resolve(dir);
  const writes = new Map<string, Uint8Array | string>();
  for (const [rel, text] of Object.entries(input.files ?? {})) {
    if (typeof text !== "string") throw new ProjectPathError(`Text content for ${rel} must be a string`);
    writes.set(validateRelativePath(rel), text);
  }
  for (const [rel, bin] of Object.entries(input.binaries ?? {})) {
    validateRelativePath(rel);
    if (writes.has(rel)) throw new ProjectPathError(`${rel} appears in both files and binaries`);
    writes.set(rel, toBytes(bin, rel));
  }
  const deleted = (input.deleted ?? []).map(validateRelativePath);
  for (const rel of deleted) if (writes.has(rel)) throw new ProjectPathError(`${rel} is both written and deleted`);
  for (const rel of [...writes.keys(), ...deleted]) resolveInside(root, rel);

  const existing = await lstat(root).catch(() => null);
  if (existing && !existing.isDirectory()) throw new ProjectPathError(`Not a folder: ${root}`);
  await mkdir(root, { recursive: true });

  for (const [rel, content] of writes) {
    opts.ownWrites?.record(root, rel, content);
    await atomicWriteFile(resolveInside(root, rel), content);
  }
  for (const rel of deleted) {
    opts.ownWrites?.record(root, rel, null);
    const target = resolveInside(root, rel);
    await rm(target, { force: true });
    await pruneEmptyParents(root, path.dirname(target));
  }
  return { written: [...writes.keys()].sort(), deleted: [...deleted].sort() };
}

async function pruneEmptyParents(root: string, from: string): Promise<void> {
  let current = from;
  while (current !== root && current.startsWith(root + path.sep)) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/** A folder containing project.json. */
export async function isProjectDir(dir: string): Promise<boolean> {
  const info = await stat(path.join(dir, "project.json")).catch(() => null);
  return !!info?.isFile();
}

/**
 * Capability check for renderer file access. A compromised renderer shouldn't be able to read or
 * write arbitrary folders: allowed are folders the user picked (dialogs, Finder, command line,
 * recents) and existing *.sonobe project folders.
 */
export class ProjectAccess {
  private readonly approved = new Set<string>();

  approve(dir: string): void {
    this.approved.add(path.resolve(dir));
  }

  isApproved(dir: string): boolean {
    return this.approved.has(path.resolve(dir));
  }

  async canAccess(dir: unknown): Promise<boolean> {
    if (typeof dir !== "string" || !path.isAbsolute(dir)) return false;
    if (this.isApproved(dir)) return true;
    return path.basename(path.resolve(dir)).toLowerCase().endsWith(".sonobe") && (await isProjectDir(dir));
  }
}

/** Resolve a user-picked path to its project folder (a project.json inside it selects the folder). */
export async function resolveProjectSelection(selected: string): Promise<string | null> {
  const resolved = path.resolve(selected);
  const info = await stat(resolved).catch(() => null);
  if (!info) return null;
  if (info.isFile()) return path.basename(resolved) === "project.json" ? path.dirname(resolved) : null;
  if (!info.isDirectory()) return null;
  if (resolved.toLowerCase().endsWith(".sonobe") || (await isProjectDir(resolved))) return resolved;
  return null;
}
