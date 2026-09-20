/**
 * HeadlessHost: SonobeHost over project folders on disk, with no app running. Documents open
 * through @sonobe/core/node, edits go through core applyOps + History with author attribution,
 * simulations run on the engine runtime, presence is recorded but shown nowhere, and screenshots
 * draw the prototype screen itself (SceneFrame → SVG → PNG, see screenshot.ts). Node only.
 *
 * Other writers may share the folder (the Sonobe app, git, a person, another session), so every
 * document remembers the files as it last read or wrote them. A save first reads the folder again
 * and refuses with "disk_changed" when anything differs, and it only deletes stale files this
 * session loaded or wrote itself.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectFormatError, readProjectFiles, retiredIds, saveProject, slugify, uniqueId, type Id, type SaveResult, type SonobeDocument } from "@sonobe/core";
import { createNodeFs, loadProjectFilesFromDisk } from "@sonobe/core/node";
import type { EngineRegistry } from "@sonobe/engine";
import { CaptureCancelledError, CaptureTimeoutError } from "@sonobe/import";
import { capturePage, CaptureFailedError, CaptureUnavailableError } from "@sonobe/import/node";
import { createPatchRegistry } from "@sonobe/patches";
import {
  HostError,
  isHostError,
  type DocumentChange,
  type DocumentSummary,
  type SaveOutcome,
  type SaveProblem,
  type SonobeHost,
  type WorkIntent,
} from "./host.ts";
import { ToolCancelledError } from "./progress.ts";
import { resolveProjectTarget } from "./projectTarget.ts";
import { loadSceneAssets, renderSceneScreenshot } from "./screenshot.ts";
import { createDocumentSession, type DocumentSession } from "./session.ts";
import { createSimulationManager, type SimulationManager } from "./sim.ts";
import { createTemplateDocument, TEMPLATES } from "./templates.ts";

export interface HeadlessHostOptions {
  /** Patch registry (default: @sonobe/patches with fallbacks for unimplemented types). */
  registry?: EngineRegistry;
  /** Save after every successful write or undo (default false). */
  autosave?: boolean;
  maxSimSessions?: number;
  now?: () => number;
}

export interface HeadlessHost extends SonobeHost {
  /** Simulations, including scene(simId) for rendering a session's frame. */
  readonly sim: SimulationManager;
  onDocumentChange(listener: (change: DocumentChange) => void): () => void;
  /** Dispose simulations. Unsaved changes stay unsaved. */
  close(): Promise<void>;
}

interface Entry {
  docId: Id;
  path: string;
  session: DocumentSession;
  /** Document files on disk as this session last read or wrote them (a save compares the folder against them). */
  disk: Record<string, string>;
  /** Files this session loaded or wrote: the only stale files a save may delete. */
  owned: Set<string>;
}

const PROJECT_HINT =
  "A project is a folder with project.json and components/. Create one with create_document (or `sonobe new <dir>`), then open it.";

const DISK_CHANGED_HINT =
  "Someone else (the Sonobe app, git, a person or another session) changed the project. Ask the person which version to keep: open_document with reload: true loads what's on disk and drops this session's unsaved changes; save_document with force: true writes this session's version over those changes.";

/** Paths whose content differs between two file listings (added, removed or changed), sorted. */
function changedPaths(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): string[] {
  const out = new Set<string>();
  for (const p of Object.keys(before)) if (!Object.hasOwn(after, p) || before[p] !== after[p]) out.add(p);
  for (const p of Object.keys(after)) if (!Object.hasOwn(before, p)) out.add(p);
  return [...out].sort();
}

const listPaths = (paths: readonly string[], max = 6) =>
  paths.slice(0, max).join(", ") + (paths.length > max ? ` and ${paths.length - max} more` : "");

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createHeadlessHost(options: HeadlessHostOptions = {}): HeadlessHost {
  const registry = options.registry ?? createPatchRegistry();
  const autosave = options.autosave ?? false;
  const now = options.now ?? (() => Date.now());
  const fs = createNodeFs();
  const entries = new Map<Id, Entry>();
  const working = new Map<Id, Map<string, WorkIntent>>();
  const listeners = new Set<(change: DocumentChange) => void>();
  let active: Id | undefined;

  const emit = (change: DocumentChange) => {
    for (const listener of [...listeners]) {
      try {
        listener(change);
      } catch {
        // A listener failing (a closed transport) never breaks an edit.
      }
    }
  };

  const summary = (entry: Entry): DocumentSummary => ({
    docId: entry.docId,
    name: entry.session.doc.project.name,
    path: entry.path,
    revision: entry.session.revision,
    dirty: entry.session.dirty,
    active: entry.docId === active,
  });

  const resolve = (docId: Id | undefined): Entry => {
    if (docId !== undefined) {
      const entry = entries.get(docId);
      if (entry) return entry;
      const open = [...entries.keys()];
      throw new HostError("unknown_document", `There's no open document "${docId}".`, {
        hint: open.length
          ? `Open documents: ${open.join(", ")}. Or open a project folder with open_document.`
          : PROJECT_HINT,
      });
    }
    const entry = active !== undefined ? entries.get(active) : undefined;
    if (!entry)
      throw new HostError("no_document", "No document is open yet.", {
        hint: `Call open_document with a project folder path, or create_document. ${PROJECT_HINT}`,
      });
    return entry;
  };

  const addEntry = (dir: string, doc: SonobeDocument, disk: Record<string, string>, owned: Iterable<string>): Entry => {
    const base = slugify(doc.project.name || path.basename(dir, ".sonobe"), "document");
    const docId = uniqueId(base, (id) => entries.has(id));
    const session = createDocumentSession(doc, { docId, registry, now });
    session.markSaved();
    const entry: Entry = { docId, path: dir, session, disk: { ...disk }, owned: new Set(owned) };
    entries.set(docId, entry);
    return entry;
  };

  /** Load a project folder with the files it was read from, as teaching HostErrors. */
  const loadFromDisk = async (dir: string) => {
    try {
      return await loadProjectFilesFromDisk(dir);
    } catch (err) {
      if (err instanceof ProjectFormatError) {
        const missing = !existsSync(path.join(dir, "project.json"));
        throw new HostError(missing ? "not_a_project" : "invalid_project", err.message, {
          hint: missing
            ? PROJECT_HINT
            : "Fix the files it names (or run `sonobe validate <dir>` for the full list), then open it again.",
        });
      }
      throw new HostError("open_failed", `Couldn't open ${dir}: ${errorText(err)}`, { hint: PROJECT_HINT });
    }
  };

  /** Write the document, refusing when the folder changed since this session last read or wrote it. */
  const save = async (entry: Entry, force = false): Promise<SaveResult & { overwritten: string[] }> => {
    try {
      const current = await readProjectFiles(fs, entry.path);
      const overwritten = changedPaths(entry.disk, current);
      if (overwritten.length && !force) {
        throw new HostError(
          "disk_changed",
          `${entry.path} changed on disk since this session last read or saved it (${listPaths(overwritten)}), so nothing was saved.`,
          { hint: DISK_CHANGED_HINT, data: { paths: overwritten } },
        );
      }
      const r = await saveProject(fs, entry.path, entry.session.doc, { removable: entry.owned });
      entry.session.markSaved();
      const disk = { ...current };
      for (const rel of r.removed) delete disk[rel];
      Object.assign(disk, r.files);
      entry.disk = disk;
      entry.owned = new Set(Object.keys(r.files));
      return { ...r, overwritten };
    } catch (err) {
      if (isHostError(err)) throw err;
      if (err instanceof ProjectFormatError) {
        throw new HostError("invalid_document", err.message, {
          hint: "Nothing was written. Fix what it names with ops, then save again.",
        });
      }
      throw new HostError("save_failed", `Couldn't save ${entry.path}: ${errorText(err)}`, {
        hint: "Check that the folder still exists and can be written to, then try again.",
      });
    }
  };

  /** Save As: write the document into a new folder (with its asset files) and keep working there. */
  const saveAs = async (entry: Entry, input: string): Promise<SaveOutcome> => {
    const dir = await resolveProjectTarget(input, { cwd: process.cwd() });
    try {
      const r = await saveProject(fs, dir, entry.session.doc, { removable: new Set() });
      const copied: string[] = [];
      for (const record of Object.values(entry.session.doc.assets)) {
        if (path.basename(record.file) !== record.file) continue;
        const from = path.join(entry.path, "assets", record.file);
        const to = path.join(dir, "assets", record.file);
        if (!existsSync(from) || existsSync(to)) continue;
        await copyFile(from, to);
        copied.push(`assets/${record.file}`);
      }
      entry.session.markSaved();
      entry.path = dir;
      entry.disk = await readProjectFiles(fs, dir);
      entry.owned = new Set(Object.keys(r.files));
      return { docId: entry.docId, path: dir, revision: entry.session.revision, written: [...r.written, ...copied], removed: [] };
    } catch (err) {
      if (err instanceof ProjectFormatError) {
        throw new HostError("invalid_document", err.message, { hint: "Nothing was written. Fix what it names with ops, then save again." });
      }
      throw new HostError("save_failed", `Couldn't save to ${dir}: ${errorText(err)}`, {
        hint: "Check that the folder can be written to, then try again.",
      });
    }
  };

  /** Autosave after a write or undo: the change stays applied either way, so problems are reported, not thrown. */
  const autosaveProblem = async (entry: Entry): Promise<SaveProblem | undefined> => {
    try {
      await save(entry);
      return undefined;
    } catch (err) {
      if (isHostError(err)) return { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) };
      return { code: "save_failed", message: errorText(err) };
    }
  };

  const reload = async (entry: Entry) => {
    const { doc, files } = await loadFromDisk(entry.path);
    entry.session.replace(doc);
    entry.disk = { ...files };
    entry.owned = new Set(Object.keys(files));
    emit({ kind: "revision", docId: entry.docId, revision: entry.session.revision });
  };

  const sim: SimulationManager = createSimulationManager({
    registry,
    ...(options.maxSimSessions !== undefined ? { maxSessions: options.maxSimSessions } : {}),
    getDocument: (docId) => {
      const entry = resolve(docId);
      return { docId: entry.docId, doc: entry.session.doc, revision: entry.session.revision };
    },
  });

  const host: HeadlessHost = {
    kind: "headless",
    capabilities: { screenshots: true, selection: false, presence: false, autosave },
    registry,

    async listDocuments() {
      return [...entries.values()].map(summary);
    },

    async openDocument(ref, openOptions = {}) {
      if (ref.startsWith("draft:"))
        throw new HostError("unknown_draft", `There's no draft "${ref.slice(6)}" here: the Sonobe app keeps drafts, and headless mode works on project folders.`, {
          hint: "Open a project folder with open_document, or open the draft in the Sonobe app.",
        });
      const dir = path.resolve(ref);
      const existing = entries.get(ref) ?? [...entries.values()].find((e) => e.path === dir);
      if (existing) {
        active = existing.docId;
        if (openOptions.reload) await reload(existing);
        return summary(existing);
      }
      const { doc, files } = await loadFromDisk(dir);
      const entry = addEntry(dir, doc, files, Object.keys(files));
      active = entry.docId;
      emit({ kind: "opened", docId: entry.docId });
      return summary(entry);
    },

    async createDocument(request) {
      if (!request.path)
        throw new HostError(
          "path_required",
          "Headless mode needs a folder path for the new project.",
          { hint: 'Pass path, e.g. "./Checkout Flow.sonobe".' },
        );
      // A new or empty folder, not inside another project (projectTarget.ts).
      const dir = await resolveProjectTarget(request.path, { cwd: process.cwd() });
      if (request.template !== undefined && !TEMPLATES.some((t) => t.id === request.template)) {
        throw new HostError("unknown_template", `There's no template "${request.template}".`, {
          hint: `Templates: ${TEMPLATES.map((t) => `${t.id} (${t.description})`).join("; ")}.`,
        });
      }
      const name = request.name ?? path.basename(dir).replace(/\.sonobe$/i, "");
      const doc = createTemplateDocument({
        name,
        registry,
        ...(request.template ? { template: request.template } : {}),
        ...(request.device ? { device: request.device } : {}),
      });
      // A new project never deletes anything already in the folder.
      const r = await saveProject(fs, dir, doc, { removable: new Set() });
      const entry = addEntry(dir, doc, await readProjectFiles(fs, dir), Object.keys(r.files));
      if (request.open !== false) active = entry.docId;
      emit({ kind: "opened", docId: entry.docId });
      return summary(entry);
    },

    async getDocument(docId) {
      const entry = resolve(docId);
      const retired = retiredIds(entry.session.seenIds, entry.session.doc);
      return {
        docId: entry.docId,
        path: entry.path,
        doc: entry.session.doc,
        revision: entry.session.revision,
        dirty: entry.session.dirty,
        ...(Object.keys(retired).length ? { retired } : {}),
      };
    },

    async saveDocument(docId, saveOptions = {}) {
      const entry = resolve(docId);
      if (saveOptions.path !== undefined) return saveAs(entry, saveOptions.path);
      const r = await save(entry, saveOptions.force === true);
      return {
        docId: entry.docId,
        path: entry.path,
        revision: entry.session.revision,
        written: r.written,
        removed: r.removed,
        ...(r.overwritten.length ? { overwritten: r.overwritten } : {}),
      };
    },

    async apply(ops, applyOptions) {
      const entry = resolve(applyOptions.docId);
      if (applyOptions.signal?.aborted) throw new ToolCancelledError();
      const before = entry.session.revision;
      const result = entry.session.apply(ops, applyOptions);
      if (result.ok && !result.dryRun && result.txnId !== undefined && autosave) {
        const problem = await autosaveProblem(entry);
        result.saved = !problem;
        if (problem) result.saveError = problem;
      }
      if (entry.session.revision !== before)
        emit({ kind: "revision", docId: entry.docId, revision: entry.session.revision });
      return result;
    },

    async diagnostics(docId) {
      const entry = resolve(docId);
      return {
        docId: entry.docId,
        revision: entry.session.revision,
        diagnostics: entry.session.diagnostics(),
      };
    },

    async getSelection(docId) {
      const entry = resolve(docId);
      return {
        docId: entry.docId,
        component: entry.session.doc.project.root,
        layers: [],
        patches: [],
        comments: [],
        note: "Headless mode has no editor, so nothing is selected. Ask the person which layers or patches they mean.",
      };
    },

    async captureDesign(request, control = {}) {
      try {
        const result = await capturePage(request, {
          ...(control.signal ? { signal: control.signal } : {}),
          onProgress: (p) => control.progress?.({ message: p.message, ...(p.done !== undefined ? { progress: p.done } : {}), ...(p.total !== undefined ? { total: p.total } : {}) }),
        });
        return {
          capture: result.capture,
          images: result.images,
          ...(result.screenshot ? { screenshot: { data: result.screenshot.data, mimeType: "image/png" as const, width: result.screenshot.width, height: result.screenshot.height } } : {}),
          ...(result.notes ? { notes: result.notes } : {}),
        };
      } catch (err) {
        if (err instanceof CaptureTimeoutError || err instanceof CaptureCancelledError) throw new HostError(err.code, err.message, { hint: err.hint });
        if (err instanceof CaptureUnavailableError)
          throw new HostError("design_capture_unavailable", err.message, {
            hint: "Install Playwright's Chromium where Sonobe runs (npm install playwright && npx playwright install chromium), or open the project in the Sonobe app, which renders pages itself. You can also pass a ready-made capture.",
          });
        if (err instanceof CaptureFailedError)
          throw new HostError("capture_failed", err.message, {
            hint: request.url ? "Check that the dev server is running and the address opens in a browser." : "Check the HTML and the selector.",
          });
        throw err;
      }
    },

    async putAssetFiles(files, fileOptions) {
      const entry = resolve(fileOptions.docId);
      const dir = path.join(entry.path, "assets");
      await mkdir(dir, { recursive: true });
      for (const f of files) {
        if (fileOptions.signal?.aborted) throw new ToolCancelledError();
        if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(f.file)) throw new HostError("invalid_asset_file", `"${f.file}" isn't a valid asset file name.`);
        const target = path.join(dir, f.file);
        // Content-addressed: a file that exists already holds these bytes.
        if (!existsSync(target)) await writeFile(target, f.bytes);
      }
    },

    async screenshot(target, shotOptions) {
      if (target.kind === "canvas" || target.kind === "graph") {
        throw new HostError(
          "target_unavailable",
          `Headless mode has no ${target.kind === "graph" ? "patch graph" : "editor canvas"} to capture; its screenshots draw the prototype screen.`,
          { hint: 'Use target "viewer" for the whole screen, or "@layerId" for one layer.' },
        );
      }
      let docId = shotOptions.docId;
      let scene;
      let settled = true;
      if (shotOptions.simId !== undefined) {
        scene = sim.sceneAt(shotOptions.simId, shotOptions.atMs ?? 0);
        docId = sim.list().find((s) => s.simId === shotOptions.simId)?.docId ?? docId;
      } else {
        const preview = sim.previewScene(
          resolve(docId).docId,
          shotOptions.atMs !== undefined ? { atMs: shotOptions.atMs } : {},
        );
        scene = preview.scene;
        settled = preview.settled || shotOptions.atMs !== undefined;
      }
      const entry = resolve(docId);
      const shot = await renderSceneScreenshot({
        scene,
        target,
        assets: await loadSceneAssets(scene, entry.session.doc, entry.path),
        ...(shotOptions.scale !== undefined ? { scale: shotOptions.scale } : {}),
        ...(shotOptions.maxWidth !== undefined ? { maxWidth: shotOptions.maxWidth } : {}),
        ...(shotOptions.simId !== undefined ? { simId: shotOptions.simId } : {}),
        ...(shotOptions.isolate ? { isolate: true } : {}),
      });
      if (!settled)
        shot.notes = [
          ...(shot.notes ?? []),
          "The prototype was still animating 5 s after it started, so this shows that moment. Pass atMs to pick a moment.",
        ];
      return shot;
    },

    async reveal() {
      return { revealed: false, reason: "Headless mode has no editor window to reveal items in." };
    },

    async setWorking(work, workOptions) {
      const entry = resolve(workOptions.docId);
      const map = working.get(entry.docId) ?? new Map<string, WorkIntent>();
      working.set(entry.docId, map);
      if (work === null) map.delete(workOptions.author.name);
      else
        map.set(workOptions.author.name, {
          ids: [...work.ids],
          intent: work.intent,
          author: workOptions.author,
          since: now(),
        });
    },

    async presence(docId) {
      const entry = resolve(docId);
      return [...(working.get(entry.docId)?.values() ?? [])];
    },

    sim,

    history: {
      async list(listOptions) {
        const entry = resolve(listOptions.docId);
        return entry.session.listHistory({
          ...(listOptions.limit !== undefined ? { limit: listOptions.limit } : {}),
          ...(listOptions.author !== undefined ? { author: listOptions.author } : {}),
        });
      },
      async undo(undoOptions) {
        const entry = resolve(undoOptions.docId);
        if (undoOptions.signal?.aborted) throw new ToolCancelledError();
        const before = entry.session.revision;
        const result = entry.session.undo(undoOptions);
        if (autosave) {
          const problem = await autosaveProblem(entry);
          result.saved = !problem;
          if (problem) result.saveError = problem;
        }
        if (entry.session.revision !== before)
          emit({ kind: "revision", docId: entry.docId, revision: entry.session.revision });
        return result;
      },
    },

    onDocumentChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async close() {
      listeners.clear();
      sim.dispose();
    },
  };
  return host;
}
