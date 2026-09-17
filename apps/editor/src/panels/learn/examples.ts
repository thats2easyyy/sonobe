/**
 * Example projects bundled at build time from examples/<name>/ (project.json, components, scripts,
 * and the asset registry, via import.meta.glob ?raw). "Try it" buttons appear only when examples
 * exist; opening one replaces the document with an unsaved copy.
 */

import { parseDocumentFiles, type SonobeDocument } from "@sonobe/core";
import type { DocumentStore } from "../../state/document.ts";
import type { SelectionStore } from "../../state/selection.ts";

const EXAMPLE_FILES = import.meta.glob(
  ["../../../../../examples/*/project.json", "../../../../../examples/*/components/*.json", "../../../../../examples/*/scripts/*.js", "../../../../../examples/*/assets/assets.json"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

export interface ExampleProject {
  /** Folder name without ".sonobe". */
  id: string;
  folder: string;
  name: string;
  description: string;
  /** Patch types used anywhere in the example, sorted. */
  patchTypes: string[];
  /** Guide slugs listed in project.json meta.guides. */
  guides: string[];
  /** Document files keyed by project-relative path. */
  files: Record<string, string>;
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Group globbed files (".../examples/<folder>/<path>") into example projects. Folders without project.json are skipped. */
export function groupExampleFiles(files: Record<string, string>): ExampleProject[] {
  const byFolder = new Map<string, Record<string, string>>();
  for (const [path, text] of Object.entries(files)) {
    const match = /(?:^|\/)examples\/([^/]+)\/(.+)$/.exec(path);
    if (!match) continue;
    const folder = match[1]!;
    const entry = byFolder.get(folder) ?? {};
    entry[match[2]!] = text;
    byFolder.set(folder, entry);
  }
  const out: ExampleProject[] = [];
  for (const [folder, projectFiles] of byFolder) {
    const project = parseJson(projectFiles["project.json"]);
    if (project === undefined) continue;
    const manifest = record(project);
    const meta = record(manifest.meta);
    const types = new Set<string>();
    let rootNotes = "";
    for (const [path, text] of Object.entries(projectFiles)) {
      if (!/^components\/[^/]+\.json$/.test(path)) continue;
      const component = record(parseJson(text));
      for (const node of Object.values(record(component.patches))) {
        const type = record(node).type;
        if (typeof type === "string") types.add(type);
      }
      if (component.id === manifest.root && typeof component.notes === "string") rootNotes = component.notes;
    }
    out.push({
      id: folder.replace(/\.sonobe$/i, ""),
      folder,
      name: typeof manifest.name === "string" && manifest.name ? manifest.name : folder.replace(/\.sonobe$/i, ""),
      description: typeof meta.description === "string" ? meta.description : rootNotes,
      patchTypes: [...types].sort(),
      guides: Array.isArray(meta.guides) ? meta.guides.filter((g): g is string => typeof g === "string") : [],
      files: projectFiles,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function examplesUsingPatch(examples: readonly ExampleProject[], type: string): ExampleProject[] {
  return examples.filter((e) => e.patchTypes.includes(type));
}

/** Examples a guide lists in meta.guides or mentions as examples/<id>. */
export function examplesForGuide(examples: readonly ExampleProject[], guide: { slug: string; markdown: string }): ExampleProject[] {
  return examples.filter((e) => e.guides.includes(guide.slug) || guide.markdown.includes(`examples/${e.folder}`) || guide.markdown.includes(`examples/${e.id}`));
}

export function loadExampleDocument(example: ExampleProject): SonobeDocument {
  return parseDocumentFiles(example.files);
}

export interface OpenExampleTarget {
  document: DocumentStore;
  selection: SelectionStore;
  confirmDiscardChanges(action: "open" | "new" | "reload"): Promise<boolean>;
}

export interface OpenExampleResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
}

/** Open an example as a new, unsaved document (asking about unsaved changes first). */
export async function openExample(session: OpenExampleTarget, example: ExampleProject): Promise<OpenExampleResult> {
  let doc: SonobeDocument;
  try {
    doc = loadExampleDocument(example);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!(await session.confirmDiscardChanges("new"))) return { ok: false, cancelled: true };
  session.document.getState().replaceDocument(doc, { projectPath: null, saved: false, label: `Opened example “${example.name}”` });
  session.selection.getState().setComponentPath([doc.project.root]);
  return { ok: true };
}

let examples: ExampleProject[] | undefined;

/** The bundled examples (empty when the repo has none). */
export function getExamples(): ExampleProject[] {
  examples ??= groupExampleFiles(EXAMPLE_FILES);
  return examples;
}
