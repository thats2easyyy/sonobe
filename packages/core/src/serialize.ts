/**
 * Canonical serialization (ARCHITECTURE §3.1): schema key order, maps sorted by key,
 * short leaf objects on one line, float noise trimmed from numbers (0.30000000000000004 → 0.3,
 * while 1/30 keeps every digit), -0 → 0, LF, 2-space indent, trailing newline. Plus project folder
 * IO through an FsAdapter.
 */

import { KNOBS_FORMAT_VERSION, projectFormatVersion } from "./document.ts";
import { fileNameKey, UNSAFE_IDS } from "./ids.ts";
import { migrateFile, ProjectFormatError, type MigrateOptions } from "./migrations.ts";
import { formatIssues, parseAssetsFile, parseComponentFile, parseKnobsFile, parseProjectFile, type FormatIssue } from "./schema.ts";
import type { AssetRecord, Component, Id, KnobSet, ProjectManifest, SonobeDocument } from "./types.ts";
import { roundNumber } from "./values.ts";

// ---------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------

type Shape =
  | { kind: "object"; order: readonly string[]; fields: Record<string, Shape> }
  | { kind: "map"; value: Shape }
  | { kind: "array"; item: Shape }
  | { kind: "input" }
  /** User data: key order preserved. */
  | { kind: "data" }
  /** Extension data: keys sorted recursively. */
  | { kind: "sorted" };

const DATA: Shape = { kind: "data" };
const SORTED: Shape = { kind: "sorted" };
const INPUT: Shape = { kind: "input" };
const INPUT_MAP: Shape = { kind: "map", value: INPUT };

const obj = (order: readonly string[], fields: Record<string, Shape> = {}): Shape & { kind: "object" } => ({ kind: "object", order, fields });

const GRADIENT = obj(["kind", "stops", "start", "end", "ratio"]);
const INPUT_WRAPPER_ORDER = ["link", "layer", "asset", "loop", "json", "gradient"];

const LAYER = obj(["id", "type", "name", "component", "locked", "collapsed", "props", "children"], { props: INPUT_MAP });
LAYER.fields.children = { kind: "array", item: LAYER };

const PATCH = obj(["type", "name", "component", "typeParam", "inputCount", "muted", "inputs", "settings", "ui"], {
  inputs: INPUT_MAP,
  settings: SORTED,
  ui: obj(["x", "y", "collapsed", "color"]),
});

const INTERFACE_PORT = obj(["key", "name", "type", "default", "category", "enumOptions", "loopBehavior", "link"], { default: INPUT });

const COMPONENT = obj(["formatVersion", "id", "name", "kind", "notes", "size", "interface", "layers", "patches", "comments", "meta"], {
  interface: obj(["inputs", "outputs"], { inputs: { kind: "map", value: INTERFACE_PORT }, outputs: { kind: "map", value: INTERFACE_PORT } }),
  layers: { kind: "array", item: LAYER },
  patches: { kind: "map", value: PATCH },
  comments: { kind: "array", item: obj(["id", "text", "rect", "color"]) },
  meta: SORTED,
});

const PROJECT = obj(["formatVersion", "minReaderVersion", "name", "generator", "root", "device", "fps", "background", "meta"], {
  device: obj(["preset", "size", "orientation"]),
  meta: SORTED,
});

const ASSET = obj(["id", "kind", "name", "file", "mime", "width", "height", "duration", "sha256", "font"], {
  font: obj(["family", "weight", "style", "unicodeRange"]),
});
const ASSETS: Shape = { kind: "map", value: ASSET };

const KNOB = obj(["id", "name", "group", "type", "values", "min", "max", "step", "unit", "options", "description"], {
  values: { kind: "map", value: DATA },
  options: { kind: "array", item: obj(["key", "name", "description"]) },
});
const KNOBS = obj(["formatVersion", "active", "presets", "knobs"], {
  presets: { kind: "array", item: obj(["id", "name", "locked"]) },
  knobs: { kind: "array", item: KNOB },
});

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Float noise: how far below the 6-decimal form a number may sit and still be written as it. */
const FLOAT_NOISE = 1e-9;

/**
 * A number as files store it. One within float noise of its 6-decimal form is written in that form,
 * so arithmetic leftovers stay readable (0.1 + 0.2 → 0.3, 6.1e-15 → 0); any other number is written
 * exactly, so a value like 1/30 reads back as the same number. Idempotent, and -0 becomes 0.
 */
export function canonicalNumber(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const rounded = roundNumber(n);
  return Math.abs(rounded - n) <= FLOAT_NOISE * Math.max(1, Math.abs(n)) ? rounded : n;
}

function normalizeScalar(v: unknown): unknown {
  if (typeof v === "number") return Number.isFinite(v) ? canonicalNumber(v) : null;
  return v;
}

function canonicalize(value: unknown, shape: Shape): unknown {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const item = shape.kind === "array" ? shape.item : shape.kind === "sorted" ? SORTED : DATA;
    return value.map((v) => canonicalize(v, item));
  }
  if (!isPlainObject(value)) return normalizeScalar(value);
  const out: Record<string, unknown> = {};
  const put = (key: string, s: Shape) => {
    const v = canonicalize(value[key], s);
    if (v === undefined) return;
    // `out["__proto__"] = v` would set the prototype and drop the key (json literal data can hold one).
    if (key === "__proto__") Object.defineProperty(out, key, { value: v, enumerable: true, writable: true, configurable: true });
    else out[key] = v;
  };
  switch (shape.kind) {
    case "object": {
      for (const key of shape.order) if (key in value) put(key, shape.fields[key] ?? DATA);
      for (const key of Object.keys(value).filter((k) => !shape.order.includes(k)).sort(byKey)) put(key, SORTED);
      return out;
    }
    case "map":
      for (const key of Object.keys(value).sort(byKey)) put(key, shape.value);
      return out;
    case "input": {
      for (const key of INPUT_WRAPPER_ORDER) if (key in value) put(key, key === "gradient" ? GRADIENT : DATA);
      for (const key of Object.keys(value).filter((k) => !INPUT_WRAPPER_ORDER.includes(k)).sort(byKey)) put(key, DATA);
      return out;
    }
    case "sorted":
      for (const key of Object.keys(value).sort(byKey)) put(key, SORTED);
      return out;
    case "array":
    case "data":
      for (const key of Object.keys(value)) put(key, DATA);
      return out;
  }
}

const INLINE_LIMIT = 100;

const isEmptyContainer = (v: unknown) => (Array.isArray(v) ? v.length === 0 : isPlainObject(v) && Object.keys(v).length === 0);
const isScalarLike = (v: unknown) => v === null || typeof v !== "object" || isEmptyContainer(v);
const children = (v: object): unknown[] => (Array.isArray(v) ? v : Object.values(v));
const isFlat = (v: unknown) => !!v && typeof v === "object" && children(v).every(isScalarLike);

function canInline(v: object): boolean {
  if (isFlat(v)) return true;
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    return keys.length === 1 && isFlat(v[keys[0]!]);
  }
  return Array.isArray(v) && v.every((item) => Array.isArray(item) && isFlat(item));
}

function scalar(v: unknown): string {
  if (typeof v === "number") return String(v);
  return JSON.stringify(v) ?? "null";
}

function inline(v: unknown): string {
  if (isScalarLike(v)) return Array.isArray(v) ? "[]" : isPlainObject(v) ? "{}" : scalar(v);
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  return `{ ${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }`;
}

function write(v: unknown, indent: string): string {
  if (isScalarLike(v)) return inline(v);
  const container = v as object;
  if (canInline(container)) {
    const text = inline(container);
    if (text.length < INLINE_LIMIT) return text;
  }
  const next = indent + "  ";
  if (Array.isArray(container)) return `[\n${container.map((x) => next + write(x, next)).join(",\n")}\n${indent}]`;
  const entries = Object.entries(container as Record<string, unknown>).map(([k, x]) => `${next}${JSON.stringify(k)}: ${write(x, next)}`);
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

function serializeWith(value: unknown, shape: Shape): string {
  return write(canonicalize(value, shape), "") + "\n";
}

/** Canonical JSON for arbitrary data (keys sorted recursively). */
export function stringifyCanonical(value: unknown): string {
  return serializeWith(value, SORTED);
}

export function serializeComponent(component: Component): string {
  return serializeWith(component, COMPONENT);
}

export function serializeProjectManifest(project: ProjectManifest): string {
  return serializeWith(project, PROJECT);
}

export function serializeAssets(assets: Record<Id, AssetRecord>): string {
  return serializeWith(assets, ASSETS);
}

/** knobs.json: presets, then knobs in panel order. A tune changes one line (the knob's values). */
export function serializeKnobs(set: KnobSet): string {
  return serializeWith({ formatVersion: KNOBS_FORMAT_VERSION, ...set }, KNOBS);
}

// ---------------------------------------------------------------------------
// Document files
// ---------------------------------------------------------------------------

export const PROJECT_FILE = "project.json";
export const COMPONENTS_DIR = "components";
export const SCRIPTS_DIR = "scripts";
export const ASSETS_DIR = "assets";
export const ASSETS_FILE = "assets/assets.json";
/** Written only when the document has knobs. */
export const KNOBS_FILE = "knobs.json";

const SCRIPT_FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** True for a script file name that can live in scripts/ ("js_1.js"). */
export function isValidScriptFile(file: string): boolean {
  return SCRIPT_FILE.test(file) && !file.includes("..") && !UNSAFE_IDS.includes(file);
}

/**
 * Every file of a project folder, keyed by path relative to the folder. project.json says format 2
 * when the document has knobs and format 1 otherwise, whatever the in-memory manifest says.
 */
export function serializeDocument(doc: SonobeDocument): Record<string, string> {
  const files: Record<string, string> = { [PROJECT_FILE]: serializeProjectManifest({ ...doc.project, formatVersion: projectFormatVersion(doc) }) };
  for (const id of Object.keys(doc.components).sort(byKey)) files[`${COMPONENTS_DIR}/${id}.json`] = serializeComponent(doc.components[id]!);
  for (const file of Object.keys(doc.scripts).sort(byKey)) files[`${SCRIPTS_DIR}/${file}`] = doc.scripts[file]!;
  files[ASSETS_FILE] = serializeAssets(doc.assets);
  if (doc.knobs) files[KNOBS_FILE] = serializeKnobs(doc.knobs);
  return files;
}

/** Groups of paths that differ only by case, so they'd be one file on macOS and Windows (sorted). */
export function fileNameCollisions(paths: Iterable<string>): string[][] {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const key = fileNameKey(path);
    const group = groups.get(key);
    if (group) group.push(path);
    else groups.set(key, [path]);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort(byKey));
}

/**
 * Throw before anything is written when two document files differ only by case ("components/Card.json"
 * and "components/card.json"). On case-insensitive file systems one would overwrite the other,
 * losing a component or script and leaving a project that doesn't open.
 */
export function assertNoFileNameCollisions(paths: Iterable<string>): void {
  const collisions = fileNameCollisions(paths);
  if (!collisions.length) return;
  const issues: FormatIssue[] = collisions.map((group) => ({
    file: group[0]!,
    path: "",
    message: `${group.join(" and ")} would overwrite each other on macOS and Windows, where file names ignore case`,
  }));
  const [first] = collisions;
  throw new ProjectFormatError(
    "invalidFormat",
    `Sonobe didn't save, because ${first!.join(" and ")} would overwrite each other on macOS and Windows, where file names ignore case. Recreate one of them under an id that differs by more than capitalization (for example with createComponent), then save again.`,
    { file: first![0]!, issues },
  );
}

function parseJsonText(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ProjectFormatError("corrupt", `${file} isn't valid JSON: ${err instanceof Error ? err.message : String(err)}`, { file, cause: err });
  }
}

/** Parse (migrate + validate) a component file's text. Throws ProjectFormatError. */
export function parseComponent(text: string, file = "component", options: MigrateOptions = {}): Component {
  return withStackGuard(file, () => {
    const json = migrateFile("component", parseJsonText(text, file), { ...options, file });
    const r = parseComponentFile(json, file);
    if (!r.ok) throw new ProjectFormatError("invalidFormat", `${file} has problems:\n${r.message}`, { file, issues: r.issues });
    return r.value;
  });
}

/** Parse (migrate + validate) project.json text. Throws ProjectFormatError. */
export function parseProjectManifest(text: string, file = PROJECT_FILE, options: MigrateOptions = {}): ProjectManifest {
  return withStackGuard(file, () => {
    const json = migrateFile("project", parseJsonText(text, file), { ...options, file });
    const r = parseProjectFile(json, file);
    if (!r.ok) throw new ProjectFormatError("invalidFormat", `${file} has problems:\n${r.message}`, { file, issues: r.issues });
    return r.value;
  });
}

/** Deeply nested data the depth check doesn't cover (json literals, meta) can still overflow the parser's stack. */
function withStackGuard<T>(file: string, parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    if (err instanceof RangeError) {
      throw new ProjectFormatError("corrupt", `${file} is nested too deeply to read. Flatten the deepest groups or data in it, then open it again.`, { file, cause: err });
    }
    throw err;
  }
}

/** Build a document from project files (as produced by serializeDocument). Throws ProjectFormatError. */
export function parseDocumentFiles(files: Record<string, string>, options: MigrateOptions = {}): SonobeDocument {
  const projectText = files[PROJECT_FILE];
  if (projectText === undefined) throw new ProjectFormatError("invalidFormat", "This folder isn't a Sonobe project: project.json is missing.", { file: PROJECT_FILE });
  const project = parseProjectManifest(projectText, PROJECT_FILE, options);

  const components: Record<Id, Component> = {};
  const issues: FormatIssue[] = [];
  const componentFiles = Object.keys(files)
    .filter((p) => p.startsWith(`${COMPONENTS_DIR}/`) && p.endsWith(".json") && !p.slice(COMPONENTS_DIR.length + 1).includes("/"))
    .sort(byKey);
  for (const path of componentFiles) {
    try {
      const component = parseComponent(files[path]!, path, options);
      const expected = path.slice(COMPONENTS_DIR.length + 1, -".json".length);
      if (component.id === expected) components[component.id] = component;
      else if (fileNameKey(component.id) === fileNameKey(expected)) {
        issues.push({
          file: path,
          path: "id",
          message: `is "${component.id}" but the file is named ${expected}.json. The names differ only by capitalization, which macOS and Windows treat as one file, so two components whose ids differ only by case likely overwrote each other. Rename the file to ${component.id}.json; if a component is missing, recreate it under a different id`,
        });
      } else issues.push({ file: path, path: "id", message: `is "${component.id}" but the file is named ${expected}.json; rename one so they match` });
    } catch (err) {
      if (err instanceof ProjectFormatError && err.code === "invalidFormat") issues.push(...(err.issues.length ? err.issues : [{ file: path, path: "", message: err.message }]));
      else throw err;
    }
  }
  if (issues.length) throw new ProjectFormatError("invalidFormat", `The project has problems:\n${formatIssues(issues)}`, { issues });
  if (!components[project.root]) {
    throw new ProjectFormatError("invalidFormat", `project.json says the root component is "${project.root}", but components/${project.root}.json is missing.`, { file: PROJECT_FILE });
  }

  const scripts: Record<string, string> = {};
  for (const path of Object.keys(files).sort(byKey)) {
    if (!path.startsWith(`${SCRIPTS_DIR}/`)) continue;
    const name = path.slice(SCRIPTS_DIR.length + 1);
    if (isValidScriptFile(name)) scripts[name] = files[path]!;
  }

  let assets: Record<Id, AssetRecord> = {};
  const assetsText = files[ASSETS_FILE];
  if (assetsText !== undefined) {
    const r = parseAssetsFile(parseJsonText(assetsText, ASSETS_FILE), ASSETS_FILE);
    if (!r.ok) throw new ProjectFormatError("invalidFormat", `${ASSETS_FILE} has problems:\n${r.message}`, { file: ASSETS_FILE, issues: r.issues });
    assets = r.value;
  }
  const doc: SonobeDocument = { project, components, scripts, assets };
  const knobsText = files[KNOBS_FILE];
  if (knobsText !== undefined) doc.knobs = parseKnobs(knobsText, KNOBS_FILE, options);
  // What the files say decides the format they're written in again; the manifest in memory follows it.
  project.formatVersion = projectFormatVersion(doc);
  return doc;
}

/** Parse (migrate + validate) knobs.json text. Throws ProjectFormatError. */
export function parseKnobs(text: string, file = KNOBS_FILE, options: MigrateOptions = {}): KnobSet {
  return withStackGuard(file, () => {
    const json = migrateFile("knobs", parseJsonText(text, file), { ...options, file });
    const r = parseKnobsFile(json, file);
    if (!r.ok) throw new ProjectFormatError("invalidFormat", `${file} has problems:\n${r.message}`, { file, issues: r.issues });
    return r.value;
  });
}

// ---------------------------------------------------------------------------
// Project IO
// ---------------------------------------------------------------------------

/** Minimal async file system used for project IO (Node, Electron IPC, in-memory tests). */
export interface FsAdapter {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  readBinary?(path: string): Promise<Uint8Array>;
  writeBinary?(path: string, data: Uint8Array): Promise<void>;
  /** Entry names (not paths) in a directory; empty when it doesn't exist. */
  list(dir: string): Promise<string[]>;
  mkdirp(dir: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** True for a regular file; false for folders and missing paths. Adapters without it are probed with exists and list. */
  isFile?(path: string): Promise<boolean>;
  /** Remove a file. Folders are never removed. */
  remove(path: string): Promise<void>;
}

/** Join path segments with "/". */
export function joinPath(...parts: string[]): string {
  const filtered = parts.filter((p) => p !== "");
  if (!filtered.length) return "";
  const joined = filtered.join("/").replace(/\/{2,}/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

const errorCodeOf = (err: unknown) => (!!err && typeof err === "object" ? (err as { code?: unknown }).code : undefined);

async function isRegularFile(fs: FsAdapter, path: string): Promise<boolean> {
  if (fs.isFile) return fs.isFile(path);
  if (!(await fs.exists(path))) return false;
  try {
    return (await fs.list(path)).length === 0;
  } catch {
    return true;
  }
}

/**
 * Document files present in a project folder, as relative paths: project.json, knobs.json,
 * components/*.json, scripts/<valid script names> and assets/assets.json. Only regular files count,
 * so folders (like a scripts/lib/ someone keeps helpers in) are never read, rewritten or deleted.
 */
export async function listDocumentFiles(fs: FsAdapter, dir: string): Promise<string[]> {
  const out: string[] = [];
  if (await isRegularFile(fs, joinPath(dir, PROJECT_FILE))) out.push(PROJECT_FILE);
  if (await isRegularFile(fs, joinPath(dir, KNOBS_FILE))) out.push(KNOBS_FILE);
  for (const name of await fs.list(joinPath(dir, COMPONENTS_DIR))) {
    if (name.endsWith(".json") && (await isRegularFile(fs, joinPath(dir, COMPONENTS_DIR, name)))) out.push(`${COMPONENTS_DIR}/${name}`);
  }
  for (const name of await fs.list(joinPath(dir, SCRIPTS_DIR))) {
    if (isValidScriptFile(name) && (await isRegularFile(fs, joinPath(dir, SCRIPTS_DIR, name)))) out.push(`${SCRIPTS_DIR}/${name}`);
  }
  if (await isRegularFile(fs, joinPath(dir, ASSETS_FILE))) out.push(ASSETS_FILE);
  return out;
}

/**
 * The text of every document file in a folder (see listDocumentFiles), keyed by relative path.
 * Files that disappear while reading are skipped; other read failures become ProjectFormatErrors.
 */
export async function readProjectFiles(fs: FsAdapter, dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const rel of await listDocumentFiles(fs, dir)) {
    try {
      files[rel] = await fs.readText(joinPath(dir, rel));
    } catch (err) {
      const code = errorCodeOf(err);
      if (code === "ENOENT" || code === "EISDIR" || code === "ERR_FS_EISDIR") continue;
      throw new ProjectFormatError("corrupt", `Couldn't read ${rel}: ${err instanceof Error ? err.message : String(err)}`, { file: rel, cause: err });
    }
  }
  return files;
}

export interface LoadedProject {
  doc: SonobeDocument;
  /** The document files exactly as read (readProjectFiles). */
  files: Record<string, string>;
}

/** Load a project folder along with the files it was read from. Throws ProjectFormatError. */
export async function loadProjectFiles(fs: FsAdapter, dir: string, options: MigrateOptions = {}): Promise<LoadedProject> {
  const files = await readProjectFiles(fs, dir);
  if (files[PROJECT_FILE] === undefined) throw new ProjectFormatError("invalidFormat", `${dir} isn't a Sonobe project: project.json is missing.`, { file: PROJECT_FILE });
  return { doc: parseDocumentFiles(files, options), files };
}

/** Load a project folder. Throws ProjectFormatError for missing, too-new, corrupt or invalid files. */
export async function loadProject(fs: FsAdapter, dir: string, options: MigrateOptions = {}): Promise<SonobeDocument> {
  return (await loadProjectFiles(fs, dir, options)).doc;
}

export interface SaveOptions {
  /**
   * Stale files this save may delete: typically the document files a session loaded or last wrote.
   * Component or script files it never knew about (added by someone else) stay on disk. Default:
   * any component or valid script file the document no longer has.
   */
  removable?: ReadonlySet<string>;
}

export interface SaveResult {
  /** Paths (relative to the project folder) whose contents changed or were created. */
  written: string[];
  /** Stale component and script files that were deleted. */
  removed: string[];
  unchanged: string[];
  /** Every document file as saved (serializeDocument of the document). */
  files: Record<string, string>;
}

/**
 * Component, script and knobs files in a folder that `files` (a serialized document) doesn't have and
 * a save would delete (knobs.json goes once the last knob does). Never project.json or assets.json, never folders or files with other names,
 * never a path that differs from a saved file only by case (on macOS and Windows that's the same
 * file), and, when `removable` is given, only paths in it.
 */
export async function staleProjectFiles(fs: FsAdapter, dir: string, files: Record<string, string>, removable?: ReadonlySet<string>): Promise<string[]> {
  const saved = new Set(Object.keys(files).map(fileNameKey));
  const out: string[] = [];
  for (const rel of await listDocumentFiles(fs, dir)) {
    if (rel === PROJECT_FILE || rel === ASSETS_FILE || rel in files || saved.has(fileNameKey(rel))) continue;
    if (removable && !removable.has(rel)) continue;
    out.push(rel);
  }
  return out;
}

/**
 * Save a document into a project folder. Writes only files whose content changed and removes
 * stale component and script files (see staleProjectFiles and SaveOptions.removable). Throws
 * ProjectFormatError before writing anything when two files would differ only by case.
 */
export async function saveProject(fs: FsAdapter, dir: string, doc: SonobeDocument, options: SaveOptions = {}): Promise<SaveResult> {
  const files = serializeDocument(doc);
  assertNoFileNameCollisions(Object.keys(files));
  const result: SaveResult = { written: [], removed: [], unchanged: [], files };
  await fs.mkdirp(dir);
  await fs.mkdirp(joinPath(dir, COMPONENTS_DIR));
  await fs.mkdirp(joinPath(dir, ASSETS_DIR));
  if (Object.keys(doc.scripts).length) await fs.mkdirp(joinPath(dir, SCRIPTS_DIR));
  for (const [rel, text] of Object.entries(files)) {
    const path = joinPath(dir, rel);
    if ((await isRegularFile(fs, path)) && (await fs.readText(path)) === text) {
      result.unchanged.push(rel);
      continue;
    }
    await fs.writeText(path, text);
    result.written.push(rel);
  }
  for (const rel of await staleProjectFiles(fs, dir, files, options.removable)) {
    await fs.remove(joinPath(dir, rel));
    result.removed.push(rel);
  }
  return result;
}

/** An in-memory FsAdapter (tests, previews, the web player). Paths are "/"-joined. */
export function createMemoryFs(initial: Record<string, string | Uint8Array> = {}): FsAdapter & { files: Map<string, string | Uint8Array> } {
  const files = new Map<string, string | Uint8Array>(Object.entries(initial).map(([p, v]) => [joinPath(p), v]));
  const dirs = new Set<string>();
  const parentDirs = (path: string) => {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/") || "/");
  };
  for (const p of files.keys()) parentDirs(p);
  const notFound = (path: string) => Object.assign(new Error(`ENOENT: no such file ${path}`), { code: "ENOENT" });
  return {
    files,
    async readText(path) {
      const v = files.get(joinPath(path));
      if (v === undefined) throw notFound(path);
      return typeof v === "string" ? v : new TextDecoder().decode(v);
    },
    async writeText(path, text) {
      const p = joinPath(path);
      files.set(p, text);
      parentDirs(p);
    },
    async readBinary(path) {
      const v = files.get(joinPath(path));
      if (v === undefined) throw notFound(path);
      return typeof v === "string" ? new TextEncoder().encode(v) : v;
    },
    async writeBinary(path, data) {
      const p = joinPath(path);
      files.set(p, data);
      parentDirs(p);
    },
    async list(dir) {
      const prefix = joinPath(dir) + "/";
      const names = new Set<string>();
      for (const p of [...files.keys(), ...dirs]) {
        if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split("/")[0]!);
      }
      return [...names].filter(Boolean).sort(byKey);
    },
    async mkdirp(dir) {
      const p = joinPath(dir);
      dirs.add(p);
      parentDirs(p);
    },
    async exists(path) {
      const p = joinPath(path);
      return files.has(p) || dirs.has(p);
    },
    async isFile(path) {
      return files.has(joinPath(path));
    },
    async remove(path) {
      files.delete(joinPath(path));
    },
  };
}
