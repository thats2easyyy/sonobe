/**
 * Drafts of unsaved work (ARCHITECTURE §3.5 Drafts): one project folder per draft,
 * <userData>/Drafts/<id>.sonobe, written by the editor's draft keeper over IPC. Each write goes file
 * by file with atomic renames, and draft.json, written last, lists every file with its sha256, so a
 * draft whose write was cut off (a SIGKILL, a power cut) reads as torn instead of being trusted.
 *
 * A window claims the drafts it writes or opens. list() shows only drafts no window claims: what a
 * crash, a quit or a signal left behind. Claims end when a window closes, reloads or its renderer
 * dies. Everything here but registerDraftIpc is Electron-free.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { atomicWriteFile } from "./fs-utils.ts";
import type { DraftInfo, DraftManifestInput, DraftReply } from "./host-api.d.ts";
import { IPC } from "./ipc.ts";
import { isBinaryProjectPath, readProject, writeProject, type WriteProjectInput } from "./project-io.ts";

export const DRAFT_MANIFEST = "draft.json";
export const DRAFT_ID = /^[A-Za-z0-9-]{8,64}$/;
/** Drafts nobody opened for this long are deleted at launch. */
export const DRAFT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** draft.json: what the editor recorded, plus the files as this store wrote them. */
interface Manifest extends DraftManifestInput {
  formatVersion: 1;
  id: string;
  updatedAt: number;
  appVersion: string;
  /** Every file in the draft (POSIX path) → sha256 of its bytes. */
  files: Record<string, string>;
}

export class DraftError extends Error {
  readonly code: "unknown_draft" | "draft_in_use" | "invalid_draft";

  constructor(code: DraftError["code"], message: string) {
    super(message);
    this.name = "DraftError";
    this.code = code;
  }
}

export interface DraftStoreOptions {
  /** Usually <userData>/Drafts. */
  dir: string;
  /** Recorded in draft.json. */
  version: string;
  now?: () => number;
}

export interface DraftStore {
  readonly dir: string;
  /** The folder draft `id` lives in. */
  folder(id: string): string;
  /** Write changed files, then draft.json, and claim the draft for `owner` (a webContents id). */
  write(owner: number, id: string, changes: WriteProjectInput, meta: unknown): Promise<void>;
  /** Delete a draft that `owner` claims or nobody does. */
  remove(owner: number, id: string): Promise<void>;
  /** Drafts no window claims, newest first. */
  list(): Promise<DraftInfo[]>;
  /** Claim a draft for `owner` and read every file in it. */
  read(owner: number, id: string): Promise<{ info: DraftInfo; manifest: Record<string, unknown>; files: Record<string, string>; binaries: Record<string, Uint8Array> }>;
  /** A window closed, reloaded or crashed: its drafts become recoverable. With `id`, only that draft (one the editor couldn't open). */
  release(owner: number, id?: string): void;
  /** Delete the drafts a window claims (it's closing after Save or Don't Save). */
  discard(owner: number): Promise<void>;
  /** At launch: delete drafts with nothing in them and drafts untouched for 90 days. Returns how many went. */
  prune(): Promise<number>;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The editor's part of draft.json, with the right types (anything else is dropped). */
function metaFrom(value: unknown): DraftManifestInput {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const counts = (v.counts && typeof v.counts === "object" ? v.counts : {}) as Record<string, unknown>;
  const base = v.base && typeof v.base === "object" && !Array.isArray(v.base) ? Object.fromEntries(Object.entries(v.base).filter((e): e is [string, string] => typeof e[1] === "string")) : undefined;
  return {
    name: typeof v.name === "string" ? v.name.slice(0, 200) : "Untitled",
    projectPath: typeof v.projectPath === "string" && path.isAbsolute(v.projectPath) ? v.projectPath : null,
    revision: num(v.revision),
    createdAt: num(v.createdAt),
    counts: { components: num(counts.components), layers: num(counts.layers), patches: num(counts.patches) },
    seenIds: (v.seenIds && typeof v.seenIds === "object" ? v.seenIds : { items: {}, components: [], knobs: [], presets: [] }) as DraftManifestInput["seenIds"],
    ...(base ? { base } : {}),
  };
}

/** Document files a draft can hold outside its manifest (a write cut off after adding one): components, scripts, root JSON. */
async function documentPaths(folder: string): Promise<string[]> {
  const out: string[] = [];
  const names = async (dir: string) => (await readdir(path.join(folder, dir), { withFileTypes: true }).catch(() => [])).filter((e) => e.isFile()).map((e) => e.name);
  for (const name of await names(".")) if (name.endsWith(".json") && name !== DRAFT_MANIFEST) out.push(name);
  for (const name of await names("components")) if (name.endsWith(".json")) out.push(`components/${name}`);
  for (const name of await names("scripts")) out.push(`scripts/${name}`);
  if ((await stat(path.join(folder, "assets", "assets.json")).catch(() => null))?.isFile()) out.push("assets/assets.json");
  return out;
}

export function createDraftStore(options: DraftStoreOptions): DraftStore {
  const { dir, version } = options;
  const now = options.now ?? (() => Date.now());
  /** Draft id → the webContents that has it. */
  const claims = new Map<string, number>();
  /** draft.json as last written or read, per draft. */
  const manifests = new Map<string, Manifest>();
  /** One operation per draft at a time. */
  const queues = new Map<string, Promise<unknown>>();

  const folder = (id: string) => path.join(dir, `${id}.sonobe`);
  const checkId = (id: unknown): string => {
    if (typeof id !== "string" || !DRAFT_ID.test(id)) throw new DraftError("invalid_draft", `"${String(id)}" isn't a draft id.`);
    return id;
  };
  const serial = <T>(id: string, job: () => Promise<T>): Promise<T> => {
    const run = (queues.get(id) ?? Promise.resolve()).then(job, job);
    const settled = run.catch(() => undefined);
    queues.set(id, settled);
    void settled.then(() => {
      if (queues.get(id) === settled) queues.delete(id);
    });
    return run;
  };
  const claim = (owner: number, id: string) => {
    const holder = claims.get(id);
    if (holder !== undefined && holder !== owner) throw new DraftError("draft_in_use", "Another Sonobe window has this draft open.");
    claims.set(id, owner);
  };

  const readManifest = async (id: string): Promise<Manifest | null> => {
    try {
      const value = JSON.parse(await readFile(path.join(folder(id), DRAFT_MANIFEST), "utf8")) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const m = value as Record<string, unknown>;
      const files = m.files && typeof m.files === "object" && !Array.isArray(m.files) ? Object.fromEntries(Object.entries(m.files).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
      return { ...metaFrom(m), formatVersion: 1, id, updatedAt: num(m.updatedAt), appVersion: typeof m.appVersion === "string" ? m.appVersion : "", files };
    } catch {
      return null;
    }
  };

  /** Whether the files on disk are the ones draft.json lists. Text files are hashed; assets are content-addressed, so they only need to exist. */
  const intact = async (id: string, manifest: Manifest, contents?: { files: Record<string, string>; binaries: Record<string, Uint8Array> }): Promise<boolean> => {
    const root = folder(id);
    for (const [rel, digest] of Object.entries(manifest.files)) {
      if (contents) {
        const data = contents.files[rel] ?? contents.binaries[rel];
        if (data === undefined || sha256(data) !== digest) return false;
      } else if (isBinaryProjectPath(rel)) {
        if (!(await stat(path.join(root, ...rel.split("/"))).catch(() => null))?.isFile()) return false;
      } else {
        const text = await readFile(path.join(root, ...rel.split("/"))).catch(() => null);
        if (!text || sha256(text) !== digest) return false;
      }
    }
    return (await documentPaths(root)).every((rel) => rel in manifest.files);
  };

  const infoOf = (id: string, manifest: Manifest | null, torn: boolean, fallback: { name: string; updatedAt: number }): DraftInfo => ({
    id,
    name: manifest?.name ?? fallback.name,
    projectPath: manifest?.projectPath ?? null,
    createdAt: manifest?.createdAt ?? fallback.updatedAt,
    updatedAt: manifest?.updatedAt || fallback.updatedAt,
    revision: manifest?.revision ?? 0,
    counts: manifest?.counts ?? { components: 0, layers: 0, patches: 0 },
    ...(torn ? { torn: true } : {}),
  });

  /** Describe a draft folder; null when it holds no project (a first write cut off before project.json). */
  const inspect = async (id: string): Promise<DraftInfo | null> => {
    const root = folder(id);
    const manifest = await readManifest(id);
    const projectFile = await readFile(path.join(root, "project.json"), "utf8").catch(() => null);
    if (projectFile === null && !manifest) return null;
    if (manifest) return infoOf(id, manifest, !(await intact(id, manifest)), { name: manifest.name, updatedAt: manifest.updatedAt });
    // project.json but no draft.json: the first write was cut off before its manifest.
    let name = "Untitled";
    try {
      const parsed = JSON.parse(projectFile ?? "{}") as { name?: unknown };
      if (typeof parsed.name === "string" && parsed.name) name = parsed.name;
    } catch {
      // Keep "Untitled".
    }
    const mtime = (await stat(path.join(root, "project.json")).catch(() => null))?.mtimeMs ?? now();
    return infoOf(id, null, true, { name, updatedAt: Math.round(mtime) });
  };

  const draftIds = async (): Promise<string[]> =>
    (await readdir(dir, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory() && e.name.endsWith(".sonobe"))
      .map((e) => e.name.slice(0, -".sonobe".length))
      .filter((id) => DRAFT_ID.test(id));

  const store: DraftStore = {
    dir,
    folder: (id) => folder(checkId(id)),

    async write(owner, rawId, changes, meta) {
      const id = checkId(rawId);
      return serial(id, async () => {
        claim(owner, id);
        const input = changes ?? {};
        for (const rel of [...Object.keys(input.files ?? {}), ...Object.keys(input.binaries ?? {}), ...(input.deleted ?? [])]) {
          if (rel === DRAFT_MANIFEST) throw new DraftError("invalid_draft", `${DRAFT_MANIFEST} is written by the app, not the editor.`);
        }
        const previous = manifests.get(id) ?? (await readManifest(id));
        await writeProject(folder(id), input);
        const files = { ...previous?.files };
        for (const rel of input.deleted ?? []) delete files[rel];
        for (const [rel, text] of Object.entries(input.files ?? {})) files[rel] = sha256(text);
        for (const [rel, bytes] of Object.entries(input.binaries ?? {})) files[rel] = sha256(toBytes(bytes));
        const manifest: Manifest = { formatVersion: 1, id, ...metaFrom(meta), updatedAt: now(), appVersion: version, files };
        await atomicWriteFile(path.join(folder(id), DRAFT_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
        manifests.set(id, manifest);
      });
    },

    async remove(owner, rawId) {
      const id = checkId(rawId);
      return serial(id, async () => {
        const holder = claims.get(id);
        if (holder !== undefined && holder !== owner) throw new DraftError("draft_in_use", "Another Sonobe window has this draft open.");
        await rm(folder(id), { recursive: true, force: true });
        claims.delete(id);
        manifests.delete(id);
      });
    },

    async list() {
      const out: DraftInfo[] = [];
      for (const id of await draftIds()) {
        if (claims.has(id)) continue;
        const info = await inspect(id).catch(() => null);
        if (info) out.push(info);
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async read(owner, rawId) {
      const id = checkId(rawId);
      return serial(id, async () => {
        claim(owner, id);
        try {
          const contents = await readProject(folder(id)).catch(() => null);
          if (!contents || contents.files["project.json"] === undefined) throw new DraftError("unknown_draft", `There's no draft "${id}".`);
          const manifest = await readManifest(id);
          const { [DRAFT_MANIFEST]: _manifestText, ...files } = contents.files;
          // Without a manifest the first write was cut off; inspect names it from project.json.
          const info = manifest ? infoOf(id, manifest, !(await intact(id, manifest, contents)), manifest) : (await inspect(id))!;
          if (manifest) manifests.set(id, manifest);
          return { info, manifest: (manifest ?? {}) as unknown as Record<string, unknown>, files, binaries: contents.binaries };
        } catch (err) {
          claims.delete(id);
          throw err;
        }
      });
    },

    release(owner, only) {
      for (const [id, holder] of claims) {
        if (holder !== owner || (only !== undefined && id !== only)) continue;
        claims.delete(id);
        manifests.delete(id);
      }
    },

    async discard(owner) {
      const owned = [...claims].filter(([, holder]) => holder === owner).map(([id]) => id);
      await Promise.all(owned.map((id) => store.remove(owner, id).catch(() => undefined)));
    },

    async prune() {
      let removed = 0;
      for (const id of await draftIds()) {
        if (claims.has(id)) continue;
        const info = await inspect(id).catch(() => null);
        if (info && now() - info.updatedAt < DRAFT_RETENTION_MS) continue;
        await rm(folder(id), { recursive: true, force: true }).catch(() => undefined);
        removed++;
      }
      return removed;
    },
  };
  return store;
}

/** A DraftError (or any error) as the reply the preload hands the editor: the context bridge drops Error properties. */
function failure(err: unknown): DraftReply {
  const code = err instanceof DraftError ? err.code : (err as { code?: unknown })?.code === "invalid_path" ? "invalid_draft" : "draft_failed";
  return { ok: false, code, message: err instanceof Error ? err.message : String(err) };
}

/** The sonobe:drafts:* IPC handlers, for trusted editor windows only. */
export function registerDraftIpc(ipcMain: Pick<IpcMain, "handle">, store: DraftStore, options: { requireWindow(event: IpcMainInvokeEvent): { webContents: { id: number } }; reveal(folder: string): void }): void {
  const owner = (event: IpcMainInvokeEvent) => options.requireWindow(event).webContents.id;
  ipcMain.handle(IPC.draftsWrite, async (event, id: unknown, changes: unknown, meta: unknown): Promise<DraftReply> => {
    const w = owner(event);
    try {
      await store.write(w, id as string, (changes && typeof changes === "object" ? changes : {}) as WriteProjectInput, meta);
      return { ok: true };
    } catch (err) {
      return failure(err);
    }
  });
  ipcMain.handle(IPC.draftsRemove, async (event, id: unknown): Promise<DraftReply> => {
    const w = owner(event);
    try {
      await store.remove(w, id as string);
      return { ok: true };
    } catch (err) {
      return failure(err);
    }
  });
  ipcMain.handle(IPC.draftsList, async (event): Promise<DraftInfo[]> => {
    owner(event);
    return store.list();
  });
  ipcMain.handle(IPC.draftsRead, async (event, id: unknown) => {
    const w = owner(event);
    try {
      return { ok: true, ...(await store.read(w, id as string)) };
    } catch (err) {
      return failure(err);
    }
  });
  ipcMain.handle(IPC.draftsRelease, (event, id: unknown) => {
    const w = owner(event);
    if (typeof id === "string" && DRAFT_ID.test(id)) store.release(w, id);
  });
  ipcMain.handle(IPC.draftsReveal, (event, id: unknown) => {
    owner(event);
    if (typeof id === "string" && DRAFT_ID.test(id)) options.reveal(store.folder(id));
  });
}

export interface QuitOnSignalOptions {
  /** Write every window's draft. */
  flush(): Promise<unknown>;
  /** Quit without the unsaved-changes prompt. */
  exit(): void;
  log?(level: "info" | "warn", message: string): void;
  /** Longest wait for the flush. Default 1500 ms. */
  timeoutMs?: number;
  signals?: readonly NodeJS.Signals[];
}

/**
 * Quit on SIGTERM, SIGINT or SIGHUP (a closed terminal, an ended background task, `kill`) without the
 * unsaved-changes prompt nobody would answer: write each window's draft, waiting at most
 * `timeoutMs`, then exit. A second signal exits at once. Replaces Electron's own handling of them.
 */
export function installQuitOnSignal(options: QuitOnSignalOptions): () => void {
  const timeoutMs = options.timeoutMs ?? 1500;
  const signals = options.signals ?? ["SIGTERM", "SIGINT", "SIGHUP"];
  let quitting = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (quitting) {
      options.log?.("warn", `${signal} again: quitting now`);
      options.exit();
      return;
    }
    quitting = true;
    options.log?.("info", `${signal}: keeping drafts of unsaved work, then quitting`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    void Promise.race([options.flush().catch((err: unknown) => options.log?.("warn", `Couldn't write drafts: ${err instanceof Error ? err.message : String(err)}`)), timeout]).finally(() => {
      clearTimeout(timer);
      options.exit();
    });
  };
  for (const signal of signals) process.on(signal, onSignal);
  return () => {
    for (const signal of signals) process.off(signal, onSignal);
  };
}
