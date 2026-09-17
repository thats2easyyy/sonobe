/**
 * HeadlessHost: SonobeHost over project folders on disk, with no app running. Documents open
 * through @sonobe/core/node, edits go through core applyOps + History with author attribution,
 * simulations run on the engine runtime, presence is recorded but shown nowhere, and screenshots
 * explain that they need the app. Node only.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { ProjectFormatError, slugify, uniqueId, type Id } from "@sonobe/core";
import { loadProjectFromDisk, saveProjectToDisk } from "@sonobe/core/node";
import type { EngineRegistry } from "@sonobe/engine";
import { createPatchRegistry } from "@sonobe/patches";
import { HostError, type DocumentSummary, type SonobeHost, type WorkIntent } from "./host.ts";
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
  /** Dispose simulations. Unsaved changes stay unsaved. */
  close(): Promise<void>;
}

interface Entry {
  docId: Id;
  path: string;
  session: DocumentSession;
}

const PROJECT_HINT =
  "A project is a folder with project.json and components/. Create one with create_document (or `sonobe new <dir>`), then open it.";

export function createHeadlessHost(options: HeadlessHostOptions = {}): HeadlessHost {
  const registry = options.registry ?? createPatchRegistry();
  const autosave = options.autosave ?? false;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<Id, Entry>();
  const working = new Map<Id, Map<string, WorkIntent>>();
  let active: Id | undefined;

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

  const addEntry = (
    dir: string,
    doc: Parameters<typeof createDocumentSession>[0],
    saved: boolean,
  ): Entry => {
    const base = slugify(doc.project.name || path.basename(dir, ".sonobe"), "document");
    const docId = uniqueId(base, (id) => entries.has(id));
    const session = createDocumentSession(doc, { docId, registry, now });
    if (saved) session.markSaved();
    const entry: Entry = { docId, path: dir, session };
    entries.set(docId, entry);
    return entry;
  };

  const save = async (entry: Entry) => {
    const r = await saveProjectToDisk(entry.path, entry.session.doc);
    entry.session.markSaved();
    return r;
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
    capabilities: { screenshots: false, selection: false, presence: false, autosave },
    registry,

    async listDocuments() {
      return [...entries.values()].map(summary);
    },

    async openDocument(ref) {
      const byId = entries.get(ref);
      if (byId) {
        active = byId.docId;
        return summary(byId);
      }
      const dir = path.resolve(ref);
      const byPath = [...entries.values()].find((e) => e.path === dir);
      if (byPath) {
        active = byPath.docId;
        return summary(byPath);
      }
      let doc;
      try {
        doc = await loadProjectFromDisk(dir);
      } catch (err) {
        if (err instanceof ProjectFormatError) {
          const missing = !existsSync(path.join(dir, "project.json"));
          throw new HostError(missing ? "not_a_project" : "invalid_project", err.message, {
            hint: missing
              ? PROJECT_HINT
              : "Fix the files it names (or run `sonobe validate <dir>` for the full list), then open it again.",
          });
        }
        throw new HostError(
          "open_failed",
          `Couldn't open ${dir}: ${err instanceof Error ? err.message : String(err)}`,
          { hint: PROJECT_HINT },
        );
      }
      const entry = addEntry(dir, doc, true);
      active = entry.docId;
      return summary(entry);
    },

    async createDocument(request) {
      if (!request.path)
        throw new HostError(
          "path_required",
          "Headless mode needs a folder path for the new project.",
          { hint: 'Pass path, e.g. "./Checkout Flow.sonobe".' },
        );
      const dir = path.resolve(request.path);
      if (existsSync(path.join(dir, "project.json"))) {
        throw new HostError("already_exists", `${dir} already holds a Sonobe project.`, {
          hint: "Open it with open_document instead, or pick another folder.",
          suggestions: [],
        });
      }
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
      await saveProjectToDisk(dir, doc);
      const entry = addEntry(dir, doc, true);
      if (request.open !== false) active = entry.docId;
      return summary(entry);
    },

    async getDocument(docId) {
      const entry = resolve(docId);
      return {
        docId: entry.docId,
        path: entry.path,
        doc: entry.session.doc,
        revision: entry.session.revision,
        dirty: entry.session.dirty,
      };
    },

    async saveDocument(docId) {
      const entry = resolve(docId);
      const r = await save(entry);
      return {
        docId: entry.docId,
        path: entry.path,
        revision: entry.session.revision,
        written: r.written,
        removed: r.removed,
      };
    },

    async apply(ops, applyOptions) {
      const entry = resolve(applyOptions.docId);
      const result = entry.session.apply(ops, applyOptions);
      if (result.ok && !result.dryRun && result.txnId !== undefined && autosave) {
        await save(entry);
        result.saved = true;
      }
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

    async screenshot() {
      throw new HostError(
        "screenshots_unavailable",
        "Screenshots need the Sonobe app; this MCP server is running headless.",
        {
          hint: "Open the project in the Sonobe app for screenshots. Meanwhile, check structure with get_outline and behavior with sim_get_values or sim_trace.",
        },
      );
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
        const result = entry.session.undo(undoOptions);
        if (autosave) {
          await save(entry);
          result.saved = true;
        }
        return result;
      },
    },

    async close() {
      sim.dispose();
    },
  };
  return host;
}
