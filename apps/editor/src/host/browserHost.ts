/**
 * Browser HostAdapter: projects live in the Origin Private File System, localStorage, or memory
 * (paths "browser:<name>"), or in real folders opened with the File System Access API
 * ("fsa:<n>/<folder>"). Writes broadcast to other tabs, which see them as external changes.
 */

import { parseDocumentFiles, ProjectFormatError } from "@sonobe/core";
import { getDefaultDialogs, type DialogService } from "../state/dialogs.ts";
import { assetBinaries, createAssetUrlCache, documentFiles, planProjectWrite, projectDisplayName, sanitizeProjectName, toArrayBuffer } from "./projectFiles.ts";
import type { HostAdapter } from "./types.ts";

export interface StoredProject {
  files: Record<string, string>;
  binaries?: Record<string, ArrayBuffer>;
}

export interface ProjectStorageWrite {
  files: Record<string, string>;
  deleted: readonly string[];
  binaries?: Record<string, ArrayBuffer | Uint8Array>;
}

/** A place to keep named projects. */
export interface ProjectStorage {
  readonly kind: "memory" | "localStorage" | "opfs" | "directory";
  /** Project names, sorted. */
  list(): Promise<string[]>;
  read(name: string): Promise<StoredProject | undefined>;
  write(name: string, changes: ProjectStorageWrite): Promise<void>;
  remove(name: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Storage backends
// ---------------------------------------------------------------------------

export function createMemoryProjectStorage(initial: Record<string, StoredProject> = {}): ProjectStorage {
  const projects = new Map<string, StoredProject>(Object.entries(initial).map(([k, v]) => [k, { files: { ...v.files }, binaries: { ...v.binaries } }]));
  return {
    kind: "memory",
    list: async () => [...projects.keys()].sort(),
    async read(name) {
      const p = projects.get(name);
      return p ? { files: { ...p.files }, binaries: { ...p.binaries } } : undefined;
    },
    async write(name, changes) {
      const p = projects.get(name) ?? { files: {}, binaries: {} };
      const files = { ...p.files, ...changes.files };
      const binaries: Record<string, ArrayBuffer> = { ...p.binaries };
      for (const [path, bytes] of Object.entries(changes.binaries ?? {})) binaries[path] = toArrayBuffer(bytes);
      for (const path of changes.deleted) {
        delete files[path];
        delete binaries[path];
      }
      projects.set(name, { files, binaries });
    },
    async remove(name) {
      projects.delete(name);
    },
  };
}

export interface LocalStorageProjectStorageOptions {
  storage?: Storage;
  /** Key prefix. Default "sonobe.project:". */
  prefix?: string;
}

/** Text files only (binaries are skipped): one JSON map per project. */
export function createLocalStorageProjectStorage(options: LocalStorageProjectStorageOptions = {}): ProjectStorage {
  const prefix = options.prefix ?? "sonobe.project:";
  const storage = () => options.storage ?? globalThis.localStorage;
  const readMap = (name: string): Record<string, string> | undefined => {
    const text = storage().getItem(prefix + name);
    if (text === null) return undefined;
    try {
      const value: unknown = JSON.parse(text);
      return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    kind: "localStorage",
    async list() {
      const out: string[] = [];
      const s = storage();
      for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        if (key?.startsWith(prefix)) out.push(key.slice(prefix.length));
      }
      return out.sort();
    },
    async read(name) {
      const files = readMap(name);
      return files ? { files } : undefined;
    },
    async write(name, changes) {
      const files = { ...readMap(name), ...changes.files };
      for (const path of changes.deleted) delete files[path];
      storage().setItem(prefix + name, JSON.stringify(files));
    },
    async remove(name) {
      storage().removeItem(prefix + name);
    },
  };
}

/** The subset of FileSystemFileHandle used here. */
export interface FileHandleLike {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{ write(data: string | ArrayBuffer | Uint8Array): Promise<void>; close(): Promise<void> }>;
}

/** The subset of FileSystemDirectoryHandle used here. */
export interface DirectoryHandleLike {
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, DirectoryHandleLike | FileHandleLike]>;
}

const IGNORED = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".git", "node_modules"]);
const TEXT_EXT = /\.(json|js|mjs|ts|md|txt|glsl|frag|vert|csv)$/i;

const isBinaryPath = (path: string) => (path.startsWith("assets/") && path !== "assets/assets.json") || !TEXT_EXT.test(path);

/** Read every file under a directory handle, keyed by POSIX path. */
export async function readDirectoryTree(dir: DirectoryHandleLike): Promise<StoredProject> {
  const files: Record<string, string> = {};
  const binaries: Record<string, ArrayBuffer> = {};
  const visit = async (handle: DirectoryHandleLike, prefix: string) => {
    for await (const [name, entry] of handle.entries()) {
      if (IGNORED.has(name) || name.includes(".sonobe-tmp")) continue;
      const path = prefix + name;
      if (entry.kind === "directory") await visit(entry, `${path}/`);
      else if (isBinaryPath(path)) binaries[path] = await (await entry.getFile()).arrayBuffer();
      else files[path] = await (await entry.getFile()).text();
    }
  };
  await visit(dir, "");
  return { files, binaries };
}

async function writeTreeFile(root: DirectoryHandleLike, path: string, data: string | ArrayBuffer | Uint8Array): Promise<void> {
  const parts = path.split("/");
  let dir = root;
  for (const segment of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(segment, { create: true });
  const file = await dir.getFileHandle(parts.at(-1)!, { create: true });
  const writable = await file.createWritable();
  await writable.write(data);
  await writable.close();
}

async function removeTreeFile(root: DirectoryHandleLike, path: string): Promise<void> {
  const parts = path.split("/");
  let dir = root;
  try {
    for (const segment of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(segment);
    await dir.removeEntry(parts.at(-1)!);
  } catch {
    // Already gone.
  }
}

/** Write changes into one project folder. */
export async function writeDirectoryTree(dir: DirectoryHandleLike, changes: ProjectStorageWrite): Promise<void> {
  for (const [path, text] of Object.entries(changes.files)) await writeTreeFile(dir, path, text);
  for (const [path, bytes] of Object.entries(changes.binaries ?? {})) await writeTreeFile(dir, path, bytes);
  for (const path of changes.deleted) await removeTreeFile(dir, path);
}

/** Projects as subfolders of a directory (OPFS root or a user-picked folder). */
export function createDirectoryProjectStorage(root: DirectoryHandleLike, kind: "opfs" | "directory" = "opfs"): ProjectStorage {
  return {
    kind,
    async list() {
      const out: string[] = [];
      for await (const [name, entry] of root.entries()) if (entry.kind === "directory") out.push(name);
      return out.sort();
    },
    async read(name) {
      let dir: DirectoryHandleLike;
      try {
        dir = await root.getDirectoryHandle(name);
      } catch {
        return undefined;
      }
      return readDirectoryTree(dir);
    },
    async write(name, changes) {
      await writeDirectoryTree(await root.getDirectoryHandle(name, { create: true }), changes);
    },
    async remove(name) {
      try {
        await root.removeEntry(name, { recursive: true });
      } catch {
        // Already gone.
      }
    },
  };
}

function localStorageWorks(): boolean {
  try {
    const s = globalThis.localStorage;
    const key = "sonobe.probe";
    s.setItem(key, "1");
    s.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** OPFS when available, else localStorage, else memory. */
export async function createDefaultProjectStorage(): Promise<ProjectStorage> {
  const nav = globalThis.navigator as (Navigator & { storage?: { getDirectory?: () => Promise<unknown> } }) | undefined;
  if (typeof nav?.storage?.getDirectory === "function") {
    try {
      const root = (await nav.storage.getDirectory()) as DirectoryHandleLike;
      return createDirectoryProjectStorage(await root.getDirectoryHandle("sonobe-projects", { create: true }), "opfs");
    } catch {
      // OPFS blocked (private mode, file://): fall through.
    }
  }
  return localStorageWorks() ? createLocalStorageProjectStorage() : createMemoryProjectStorage();
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export interface BrowserDialogs {
  /** Choose one of the stored projects; resolve its name or null. */
  pickProject(names: string[]): Promise<string | null>;
  /** Ask for a project name; resolve it or null. */
  promptName(defaultName: string): Promise<string | null>;
}

type PickerWindow = {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<unknown>;
  prompt?: (message?: string, defaultValue?: string) => string | null;
  addEventListener?: (type: string, listener: (e: Event) => void) => void;
  removeEventListener?: (type: string, listener: (e: Event) => void) => void;
  document?: { title: string };
};

/** BrowserDialogs shown through a dialog service (in-app dialogs instead of window.prompt). */
export function browserDialogsFrom(service: DialogService): BrowserDialogs {
  return {
    pickProject: (names) =>
      service.pick({
        title: "Open a prototype",
        message: "Prototypes saved in this browser.",
        items: names.map((name) => ({ value: name, label: name })),
        confirmLabel: "Open",
        emptyMessage: "No saved prototypes yet.",
      }),
    promptName: (defaultName) =>
      service.prompt({
        title: "Save prototype",
        message: "Prototypes you save here stay in this browser. Give it a name you’ll recognize.",
        label: "Prototype name",
        defaultValue: defaultName,
        confirmLabel: "Save",
        validate: (value) => (value.trim() ? null : "Enter a name."),
      }),
  };
}

export interface BrowserHostOptions {
  storage?: ProjectStorage | Promise<ProjectStorage>;
  /** Default: in-app dialogs through `dialogService`. */
  dialogs?: Partial<BrowserDialogs>;
  /** Where default dialogs are shown. Default: getDefaultDialogs(). */
  dialogService?: DialogService;
  /** Use showDirectoryPicker when the browser has it. Default true. */
  fileSystemAccess?: boolean;
  /** Window used for dialogs, title, and beforeunload. Default globalThis.window. */
  window?: PickerWindow;
  /** BroadcastChannel name for cross-tab change notifications. Null disables. */
  channelName?: string | null;
  /** localStorage key for the recent list. Null disables. */
  recentKey?: string | null;
}

export interface BrowserHost extends HostAdapter {
  readonly storage: Promise<ProjectStorage>;
  /** Stored project names. */
  listProjects(): Promise<string[]>;
  /** Register a directory handle (e.g. from drag and drop) and return its project path. */
  addDirectory(handle: DirectoryHandleLike): string;
}

export const BROWSER_PREFIX = "browser:";
export const FSA_PREFIX = "fsa:";

const isAbort = (err: unknown) => !!err && typeof err === "object" && (err as { name?: string }).name === "AbortError";

export function createBrowserHost(options: BrowserHostOptions = {}): BrowserHost {
  const win: PickerWindow | undefined = options.window ?? (typeof window === "undefined" ? undefined : (window as unknown as PickerWindow));
  const storage = Promise.resolve(options.storage ?? createDefaultProjectStorage());
  const useFsa = options.fileSystemAccess !== false && typeof win?.showDirectoryPicker === "function";
  const directories = new Map<string, DirectoryHandleLike>();
  const known = new Map<string, Record<string, string>>();
  const assets = createAssetUrlCache();
  const origin = `tab_${Math.random().toString(36).slice(2)}`;
  const recentKey = options.recentKey === undefined ? "sonobe.recentProjects" : options.recentKey;
  let directoryCounter = 0;
  let unloadListener: ((e: Event) => void) | null = null;

  const channelName = options.channelName === undefined ? "sonobe.projects" : options.channelName;
  const channel = channelName && typeof BroadcastChannel === "function" ? new BroadcastChannel(channelName) : null;
  const watchers = new Map<string, Set<(paths: string[]) => void>>();
  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { path?: unknown; paths?: unknown; origin?: unknown } | null;
      if (!data || typeof data.path !== "string" || data.origin === origin) return;
      const paths = Array.isArray(data.paths) ? data.paths.filter((p): p is string => typeof p === "string") : ["."];
      for (const cb of watchers.get(data.path) ?? []) cb(paths);
    };
  }

  let fallbackDialogs: BrowserDialogs | null = null;
  const inApp = () => (fallbackDialogs ??= browserDialogsFrom(options.dialogService ?? getDefaultDialogs()));
  const dialogs: BrowserDialogs = {
    pickProject: options.dialogs?.pickProject ?? ((names) => inApp().pickProject(names)),
    promptName: options.dialogs?.promptName ?? ((defaultName) => inApp().promptName(defaultName)),
  };

  const nameOf = (path: string) => path.slice(BROWSER_PREFIX.length);

  const readRecent = (): string[] => {
    if (!recentKey) return [];
    try {
      const value: unknown = JSON.parse(globalThis.localStorage?.getItem(recentKey) ?? "[]");
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  };
  const touchRecent = (path: string) => {
    if (!recentKey) return;
    try {
      globalThis.localStorage?.setItem(recentKey, JSON.stringify([path, ...readRecent().filter((p) => p !== path)].slice(0, 12)));
    } catch {
      // Storage blocked: recents stay empty.
    }
  };

  const addDirectory = (handle: DirectoryHandleLike) => {
    for (const [path, existing] of directories) if (existing === handle) return path;
    const path = `${FSA_PREFIX}${++directoryCounter}/${handle.name}`;
    directories.set(path, handle);
    return path;
  };

  const readStored = async (path: string): Promise<StoredProject | undefined> => {
    if (path.startsWith(FSA_PREFIX)) {
      const dir = directories.get(path);
      return dir ? readDirectoryTree(dir) : undefined;
    }
    if (path.startsWith(BROWSER_PREFIX)) return (await storage).read(nameOf(path));
    return undefined;
  };

  const writeStored = async (path: string, changes: ProjectStorageWrite) => {
    if (path.startsWith(FSA_PREFIX)) {
      const dir = directories.get(path);
      if (!dir) throw new Error(`The folder for ${projectDisplayName(path)} isn't open anymore. Use Save As to pick it again.`);
      await writeDirectoryTree(dir, changes);
      return;
    }
    if (!path.startsWith(BROWSER_PREFIX)) throw new Error(`"${path}" isn't a browser project path.`);
    await (await storage).write(nameOf(path), changes);
  };

  const host: BrowserHost = {
    kind: "browser",
    platform: "web",
    capabilities: { nativeMenus: false, nativeDialogs: useFsa, watch: channel !== null, reveal: false, persistent: !(options.storage && "kind" in options.storage && options.storage.kind === "memory") },
    rpc: null,
    storage,

    listProjects: async () => (await storage).list(),
    addDirectory,

    async openProjectDialog() {
      if (useFsa) {
        try {
          return addDirectory((await win!.showDirectoryPicker!({ id: "sonobe-project", mode: "readwrite" })) as DirectoryHandleLike);
        } catch (err) {
          if (isAbort(err)) return null;
          throw err;
        }
      }
      const names = await (await storage).list();
      if (names.length === 0) return null;
      const name = await dialogs.pickProject(names);
      return name ? `${BROWSER_PREFIX}${name}` : null;
    },

    async saveProjectDialog(defaultName) {
      if (useFsa) {
        try {
          const parent = (await win!.showDirectoryPicker!({ id: "sonobe-save", mode: "readwrite" })) as DirectoryHandleLike;
          const dir = await parent.getDirectoryHandle(`${sanitizeProjectName(defaultName)}.sonobe`, { create: true });
          return addDirectory(dir);
        } catch (err) {
          if (isAbort(err)) return null;
          throw err;
        }
      }
      const answer = await dialogs.promptName(defaultName);
      return answer === null || !answer.trim() ? null : `${BROWSER_PREFIX}${sanitizeProjectName(answer)}`;
    },

    async readProject(path) {
      const stored = await readStored(path);
      if (!stored) throw new ProjectFormatError("invalidFormat", `There's no project called "${projectDisplayName(path)}" here.`, { file: "project.json" });
      // What's stored, even when it doesn't parse, so the next save rewrites invalid files.
      known.set(path, documentFiles(stored.files));
      assets.setBinaries(path, assetBinaries(stored.binaries));
      const doc = parseDocumentFiles(stored.files);
      touchRecent(path);
      return doc;
    },

    async writeProject(path, doc, writeOptions = {}) {
      const previous = known.get(path) ?? (await readStored(path).catch(() => undefined))?.files;
      const plan = planProjectWrite(doc, previous ? documentFiles(previous) : undefined);
      const from = writeOptions.copyAssetsFrom && writeOptions.copyAssetsFrom !== path ? writeOptions.copyAssetsFrom : null;
      const binaries = assets.pending(path, doc, from);
      if (from && !assets.hasProject(from) && Object.keys(doc.assets).length > 0) {
        const source = assetBinaries((await readStored(from))?.binaries);
        for (const record of Object.values(doc.assets)) {
          const rel = `assets/${record.file}`;
          if (!binaries[rel] && source[rel]) binaries[rel] = source[rel];
        }
      }
      const hasBinaries = Object.keys(binaries).length > 0;
      await writeStored(path, { files: plan.files, deleted: plan.deleted, ...(hasBinaries ? { binaries } : {}) });
      known.set(path, plan.all);
      if (hasBinaries) assets.markWritten(path, binaries);
      touchRecent(path);
      const changed = [...Object.keys(plan.files), ...plan.deleted];
      if (channel && changed.length) channel.postMessage({ path, paths: changed.sort(), origin });
      return { written: [...Object.keys(plan.files), ...Object.keys(binaries)], deleted: plan.deleted, unchanged: plan.unchanged };
    },

    putAssetBytes: (path, file, bytes) => assets.put(path, file, toArrayBuffer(bytes)),
    peekAssetBytes: (path, file) => assets.get(path, file),

    async readAssetBytes(path, file) {
      const held = assets.get(path, file);
      if (held || path === null) return held;
      const bytes = (await readStored(path).catch(() => undefined))?.binaries?.[`assets/${file}`];
      if (bytes) assets.markWritten(path, { [`assets/${file}`]: bytes });
      return bytes;
    },

    watchProject(path, cb) {
      let set = watchers.get(path);
      if (!set) watchers.set(path, (set = new Set()));
      const listener = (paths: string[]) => cb(paths);
      set.add(listener);
      return () => {
        watchers.get(path)?.delete(listener);
      };
    },

    revealInFinder() {
      // Browsers can't reveal files.
    },

    async recentProjects() {
      const names = new Set(await (await storage).list());
      return readRecent().filter((p) => (p.startsWith(BROWSER_PREFIX) ? names.has(nameOf(p)) : directories.has(p)));
    },

    resolveAssetUrl: (path, file) => assets.resolve(path, file),
    onCommand: () => () => undefined,
    onOpenProject: () => () => undefined,

    setDocumentEdited(edited) {
      if (!win?.addEventListener || !win.removeEventListener) return;
      if (edited && !unloadListener) {
        unloadListener = (e: Event) => {
          e.preventDefault();
          (e as unknown as { returnValue: unknown }).returnValue = "";
        };
        win.addEventListener("beforeunload", unloadListener);
      } else if (!edited && unloadListener) {
        win.removeEventListener("beforeunload", unloadListener);
        unloadListener = null;
      }
    },

    setTitle(title) {
      if (win?.document) win.document.title = title;
    },

    displayName: projectDisplayName,

    dispose() {
      host.setDocumentEdited(false);
      channel?.close();
      watchers.clear();
      assets.dispose();
      known.clear();
    },
  };
  return host;
}
