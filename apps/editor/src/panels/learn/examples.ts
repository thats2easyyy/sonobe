/**
 * Example projects bundled at build time from examples/<name>/ (project.json, knobs.json, components,
 * scripts and the asset registry via import.meta.glob ?raw, and asset files such as photos on demand).
 * "Try it" buttons appear only when examples exist; opening one replaces the document with an unsaved
 * copy whose asset files the host holds, so they show right away and are written on the first save.
 */

import { parseDocumentFiles, type SonobeDocument } from "@sonobe/core";
import type { HostAdapter } from "../../host/types.ts";
import type { AssetService } from "../../state/assets.ts";
import type { DocumentStore } from "../../state/document.ts";
import type { SelectionStore } from "../../state/selection.ts";

const EXAMPLE_FILES = import.meta.glob(
  [
    "../../../../../examples/*/project.json",
    "../../../../../examples/*/knobs.json",
    "../../../../../examples/*/components/*.json",
    "../../../../../examples/*/scripts/*.js",
    "../../../../../examples/*/assets/assets.json",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/**
 * Asset files (examples/<name>/assets/<sha256>.<ext>), each loaded as a data: URL when an example
 * opens. Data URLs rather than file URLs, because fetch() can't read the file:// URLs the desktop app
 * loads the editor from.
 */
const EXAMPLE_ASSET_FILES = import.meta.glob(["../../../../../examples/*/assets/*", "!../../../../../examples/*/assets/assets.json"], { query: "?inline", import: "default" }) as Record<string, () => Promise<string>>;

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
  /** Loads each bundled asset file as a URL fetch() can read, by file name under assets/. */
  assets: Record<string, () => Promise<string>>;
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

/** Group globbed paths (".../examples/<folder>/<path>") by folder. */
function byExampleFolder<T>(files: Record<string, T>): Map<string, Record<string, T>> {
  const byFolder = new Map<string, Record<string, T>>();
  for (const [path, text] of Object.entries(files)) {
    const match = /(?:^|\/)examples\/([^/]+)\/(.+)$/.exec(path);
    if (!match) continue;
    const folder = match[1]!;
    const entry = byFolder.get(folder) ?? {};
    entry[match[2]!] = text;
    byFolder.set(folder, entry);
  }
  return byFolder;
}

/**
 * Group globbed files (".../examples/<folder>/<path>") into example projects, with loaders for their
 * asset files (".../examples/<folder>/assets/<file>"). Folders without project.json are skipped.
 */
export function groupExampleFiles(files: Record<string, string>, assets: Record<string, () => Promise<string>> = {}): ExampleProject[] {
  const byFolder = byExampleFolder(files);
  const assetsByFolder = byExampleFolder(assets);
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
      assets: Object.fromEntries(Object.entries(assetsByFolder.get(folder) ?? {}).map(([rel, load]) => [rel.replace(/^assets\//, ""), load])),
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
  /** Holds the example's asset files for the unsaved copy (the session's host). */
  host?: Pick<HostAdapter, "putAssetBytes"> | null;
  /** Holds them when the host can't (the session's asset service). */
  assets?: Pick<AssetService, "storeBytes">;
}

export interface OpenExampleResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
}

/** The bytes of the example's asset files that the document uses, by file name. */
async function fetchExampleAssets(example: ExampleProject, doc: SonobeDocument): Promise<Map<string, ArrayBuffer>> {
  const files = [...new Set(Object.values(doc.assets).map((a) => a.file))].filter((file) => example.assets[file]);
  const loaded = await Promise.all(
    files.map(async (file) => {
      const response = await fetch(await example.assets[file]!());
      if (!response.ok) throw new Error(`Its file assets/${file} didn't load (${response.status}).`);
      return [file, await response.arrayBuffer()] as const;
    }),
  );
  return new Map(loaded);
}

/** Open an example as a new, unsaved document (asking about unsaved changes first), with its asset files. */
export async function openExample(session: OpenExampleTarget, example: ExampleProject): Promise<OpenExampleResult> {
  let doc: SonobeDocument;
  try {
    doc = loadExampleDocument(example);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!(await session.confirmDiscardChanges("new"))) return { ok: false, cancelled: true };
  let assets: Map<string, ArrayBuffer>;
  try {
    assets = await fetchExampleAssets(example, doc);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // The unsaved copy's files go in first, so its images show on the first frame.
  const host = session.host;
  if (host?.putAssetBytes) for (const [file, bytes] of assets) host.putAssetBytes(null, file, bytes);
  session.document.getState().replaceDocument(doc, { projectPath: null, saved: false, label: `Opened example “${example.name}”` });
  if (!host?.putAssetBytes) for (const [file, bytes] of assets) session.assets?.storeBytes(file, bytes);
  session.selection.getState().setComponentPath([doc.project.root]);
  return { ok: true };
}

let examples: ExampleProject[] | undefined;

/** The bundled examples (empty when the repo has none). */
export function getExamples(): ExampleProject[] {
  examples ??= groupExampleFiles(EXAMPLE_FILES, EXAMPLE_ASSET_FILES);
  return examples;
}
