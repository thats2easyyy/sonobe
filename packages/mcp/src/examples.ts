/**
 * The verified examples as a patterns catalog for list_examples and get_example: what each one
 * teaches, its key patches, the scenarios that prove it works, and its recipe as apply_ops batches.
 *
 * The registry is examples/recipes (RECIPES, what examples/build.ts builds the project folders
 * from), so a new example shows up here once it's in the registry. Recipes come in as code; each
 * example's README.md and test.json, and the examples/README.md table, are read from the examples
 * folder: SONOBE_EXAMPLES_DIR, else examples/ beside a bundle (the build scripts copy them), else
 * the repository's. Without them an example still lists, from its recipe alone. Node only.
 *
 * A recipe that starts from a design import or tidies by frame (buildRecipe, asynchronous, and for a
 * design its capture and photos) is read from its project folder instead of rebuilt: run.test.ts keeps
 * that folder equal to the recipe's build. A bundle carries its JSON files and the design's capture,
 * which get_example hands to import_design (the photos download from their URLs), not the photos.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSETS_FILE,
  COMPONENTS_DIR,
  didYouMean,
  getOutline,
  KNOBS_FILE,
  parseDocumentFiles,
  PROJECT_FILE,
  readNodePositions,
  SCRIPTS_DIR,
  type Op,
  type Registry,
  type SonobeDocument,
} from "@sonobe/core";
import { buildRecipeDocument, type Recipe } from "../../../examples/lib/recipe.ts";
import { RECIPES } from "../../../examples/recipes/index.ts";

export interface ExampleScenario {
  name: string;
  /** What it checks, in the test's own words. */
  checks: string[];
}

export interface ExampleEntry {
  /** The folder name, e.g. "10-swipe-cards". */
  id: string;
  number: number;
  name: string;
  /** The recipe's one-sentence description (the Learn panel's). */
  description: string;
  /** What it teaches: the examples table's "You'll learn", else the description. */
  teaches: string;
  /** Key patches by display name, from the examples table ("Loop", "Swipe"); empty when it has no row. */
  keyPatchNames: string[];
  /** Tutorial slugs in docs/guides the example backs. */
  guides: string[];
  /** README.md, when the examples folder has it. */
  readme?: string;
  /** test.json's scenarios, when the examples folder has it. */
  scenarios?: ExampleScenario[];
  recipe: Recipe;
}

/** One example built for a registry: the document and its recipe as ready batches. */
export interface BuiltExample {
  doc: SonobeDocument;
  /** Patch types used anywhere, sorted. */
  patchTypes: string[];
  /** Key patches as patch type keys: the table's names resolved, else the most used types. */
  keyPatches: string[];
  /** The recipe as apply_ops batches for a blank document, in order. */
  batches: Op[][];
}

export interface ExampleCatalog {
  list(): ExampleEntry[];
  /** By id, number ("10"), id without its number ("swipe-cards") or name ("Swipe Cards"). */
  get(ref: string): ExampleEntry | undefined;
  /** Close ids for a ref that names none. */
  suggest(ref: string): string[];
  /** Build an example with a registry (cached). Throws when its recipe no longer applies. */
  build(entry: ExampleEntry, registry: Registry): BuiltExample;
  /** The design capture an example starts from (Recipe.design), parsed; undefined without one. */
  design(entry: ExampleEntry): unknown;
}

/** Most ops in one batch (apply_ops takes 500). */
const MAX_BATCH_OPS = 150;
/** Roughly the most JSON one batch carries, so a result stays readable. */
const MAX_BATCH_CHARS = 40_000;

/** The examples folder beside this module or its bundle, or the repository's (SONOBE_EXAMPLES_DIR wins). */
export function defaultExamplesDir(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.SONOBE_EXAMPLES_DIR) return env.SONOBE_EXAMPLES_DIR;
  for (const relative of ["./examples/", "../../../examples/"]) {
    const dir = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(path.join(dir, "README.md"))) return dir;
  }
  return undefined;
}

/** Whether the catalog reads a recipe's document from its project folder (see the module comment). */
export function readsProjectFolder(recipe: Recipe): boolean {
  return !!recipe.design || recipe.tidy === "frames";
}

/** A project folder's document files (project.json, knobs.json, components, scripts, assets.json), relative to it. */
function projectFiles(dir: string): string[] {
  const list = (sub: string, keep: (name: string) => boolean) =>
    existsSync(path.join(dir, sub)) ? readdirSync(path.join(dir, sub)).filter(keep).sort().map((name) => `${sub}/${name}`) : [];
  return [
    ...[PROJECT_FILE, KNOBS_FILE, ASSETS_FILE].filter((file) => existsSync(path.join(dir, file))),
    ...list(COMPONENTS_DIR, (name) => name.endsWith(".json")),
    ...list(SCRIPTS_DIR, () => true),
  ];
}

/**
 * The files the catalog reads from an examples folder, relative to it: the table, each example's
 * README.md and test.json, the document files of those it reads from their project folder, and the
 * design captures recipes start from.
 */
export function exampleTextFiles(from: string | undefined = defaultExamplesDir()): string[] {
  return [
    "README.md",
    ...RECIPES.flatMap((r) => [
      `${r.folder}/README.md`,
      `${r.folder}/test.json`,
      ...(from && readsProjectFolder(r) ? projectFiles(path.join(from, r.folder)).map((file) => `${r.folder}/${file}`) : []),
      ...(r.design ? [r.design.capture] : []),
    ]),
  ];
}

/**
 * Copy the files the catalog reads (exampleTextFiles) from an examples folder to `to`, for a bundle
 * that runs without the repository: the build scripts put them in examples/ beside it. Returns how
 * many files it copied.
 */
export function copyExampleTexts(to: string, from: string | undefined = defaultExamplesDir()): number {
  if (!from) return 0;
  rmSync(to, { recursive: true, force: true });
  let copied = 0;
  for (const rel of exampleTextFiles(from)) {
    const source = path.join(from, rel);
    if (!existsSync(source)) continue;
    mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
    copyFileSync(source, path.join(to, rel));
    copied++;
  }
  return copied;
}

const readText = (file: string | undefined): string | undefined => {
  if (!file || !existsSync(file)) return undefined;
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};

/** Rows of the examples table ("| 01 | [Tap to Grow](01-tap-to-grow/) | You'll learn | Key patches |"), by folder. */
export function parseExamplesTable(markdown: string): Map<string, { teaches: string; keyPatches: string[] }> {
  const rows = new Map<string, { teaches: string; keyPatches: string[] }>();
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 6) continue;
    const folder = /\]\(([^)/]+)\/?\)/.exec(cells[2] ?? "")?.[1];
    if (!folder) continue;
    rows.set(folder, {
      teaches: cells[3]!,
      keyPatches: cells[4]!.split(",").map((k) => k.replace(/\s*\(.*\)$/, "").trim()).filter(Boolean),
    });
  }
  return rows;
}

/** test.json's scenarios: names and what each checks. */
export function parseScenarios(json: string): ExampleScenario[] | undefined {
  try {
    const test = JSON.parse(json) as { scenarios?: { name?: unknown; expect?: { description?: unknown }[] }[] };
    if (!Array.isArray(test.scenarios)) return undefined;
    return test.scenarios.map((s) => ({
      name: typeof s.name === "string" ? s.name : "(unnamed)",
      checks: (Array.isArray(s.expect) ? s.expect : [])
        .map((e) => e?.description)
        .filter((d): d is string => typeof d === "string"),
    }));
  } catch {
    return undefined;
  }
}

/** A README's "## " sections by heading, and the paragraph under its title. Relative links keep only their text. */
export function readmeSections(markdown: string): { intro: string; sections: Map<string, string> } {
  const text = markdown.replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, "$1");
  const sections = new Map<string, string>();
  const parts = text.split(/^## /m);
  const head = parts.shift() ?? "";
  const intro = head.replace(/^# .*$/m, "").trim().split(/\n\s*\n/)[0]?.trim() ?? "";
  for (const part of parts) {
    const newline = part.indexOf("\n");
    const heading = (newline < 0 ? part : part.slice(0, newline)).trim();
    sections.set(heading, (newline < 0 ? "" : part.slice(newline + 1)).trim());
  }
  return { intro, sections };
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A recipe's example read from its project folder. Throws when the folder isn't there. */
function storedDocument(recipe: Recipe, dir: string | undefined): SonobeDocument {
  const folder = dir ? path.join(dir, recipe.folder) : undefined;
  if (!folder || !existsSync(path.join(folder, PROJECT_FILE)))
    throw new Error(`${recipe.name} is read from its project folder (examples/${recipe.folder}), which isn't here.`);
  return parseDocumentFiles(Object.fromEntries(projectFiles(folder).map((file) => [file, readFileSync(path.join(folder, file), "utf8")])));
}

/**
 * The ops a recipe's example applies, with the layout the example has: its patch positions, comment
 * frames and graph node positions (a recipe tidied by frame moves all three after its ops), then the
 * positions of what its ops didn't add, such as an imported design's patches.
 */
function positionedOps(recipe: Recipe, doc: SonobeDocument): Op[] {
  const root = doc.project.root;
  const setup: Op[] = [
    { op: "setProject", changes: { background: recipe.background } },
    { op: "updateComponent", id: root, notes: recipe.notes },
  ];
  const added = new Map<string, { patches: Set<string>; nodes: Set<string> }>();
  const seen = (component: string | undefined) => {
    const id = component ?? root;
    let entry = added.get(id);
    if (!entry) added.set(id, (entry = { patches: new Set(), nodes: new Set() }));
    return entry;
  };
  const ops = recipe.ops().map((op): Op => {
    if (op.op === "addPatch" && op.patch.id) {
      seen(op.component).patches.add(op.patch.id);
      const ui = doc.components[op.component ?? root]?.patches[op.patch.id]?.ui;
      return ui ? { ...op, patch: { ...op.patch, ui: { ...op.patch.ui, x: ui.x, y: ui.y } } } : op;
    }
    if (op.op === "addComment" && op.comment.id) {
      const rect = doc.components[op.component ?? root]?.comments.find((c) => c.id === op.comment.id)?.rect;
      return rect ? { ...op, comment: { ...op.comment, rect: [...rect] } } : op;
    }
    if (op.op === "setNodePositions") {
      const saved = readNodePositions(doc.components[op.component ?? root]);
      const nodes = seen(op.component).nodes;
      const positions = Object.fromEntries(
        Object.entries(op.positions).map(([id, p]): [string, [number, number] | null] => {
          nodes.add(id);
          const at = saved[id];
          return [id, p && at ? [at.x, at.y] : p];
        }),
      );
      return { ...op, positions };
    }
    return op;
  });
  const rest: Op[] = [];
  for (const id of Object.keys(doc.components).sort()) {
    const component = doc.components[id]!;
    const mine = added.get(id) ?? { patches: new Set<string>(), nodes: new Set<string>() };
    const where = id === root ? {} : { component: id };
    for (const [patchId, node] of Object.entries(component.patches))
      if (!mine.patches.has(patchId)) rest.push({ op: "updatePatch", ...where, id: patchId, ui: { x: node.ui.x, y: node.ui.y } });
    const unplaced = Object.entries(readNodePositions(component)).filter(([nodeId]) => !mine.nodes.has(nodeId));
    if (unplaced.length) rest.push({ op: "setNodePositions", ...where, positions: Object.fromEntries(unplaced.map(([nodeId, p]) => [nodeId, [p.x, p.y]])) });
  }
  return [...setup, ...ops, ...rest];
}

/**
 * Ops split into apply_ops batches at op boundaries. Recipes name items by id, and every op only
 * names items earlier ops made, so any boundary works; a recipe that uses "$ref"s stays one batch,
 * since refs only resolve inside a batch.
 */
export function batchOps(ops: readonly Op[]): Op[][] {
  if (JSON.stringify(ops).includes('"ref":')) return [[...ops]];
  const batches: Op[][] = [];
  let current: Op[] = [];
  let chars = 0;
  for (const op of ops) {
    const size = JSON.stringify(op).length;
    if (current.length && (current.length >= MAX_BATCH_OPS || chars + size > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(op);
    chars += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** The catalog over a list of recipes (default: the examples registry) and an examples folder. */
export function loadExamples(options: { dir?: string | undefined; recipes?: readonly Recipe[] } = {}): ExampleCatalog {
  const dir = "dir" in options ? options.dir : defaultExamplesDir();
  const at = (rel: string) => (dir ? path.join(dir, rel) : undefined);
  const table = parseExamplesTable(readText(at("README.md")) ?? "");
  const entries: ExampleEntry[] = (options.recipes ?? RECIPES).map((recipe) => {
    const row = table.get(recipe.folder);
    const readme = readText(at(path.join(recipe.folder, "README.md")));
    const test = readText(at(path.join(recipe.folder, "test.json")));
    const scenarios = test === undefined ? undefined : parseScenarios(test);
    return {
      id: recipe.folder,
      number: Number.parseInt(recipe.folder, 10) || 0,
      name: recipe.name,
      description: recipe.description,
      teaches: row?.teaches || recipe.description,
      keyPatchNames: row?.keyPatches ?? [],
      guides: [...recipe.guides],
      ...(readme !== undefined ? { readme } : {}),
      ...(scenarios ? { scenarios } : {}),
      recipe,
    };
  });
  const built = new WeakMap<Registry, Map<string, BuiltExample>>();
  const find = (ref: string): ExampleEntry | undefined => {
    const key = normalize(ref);
    if (!key) return undefined;
    const n = /^\d+$/.test(ref.trim()) ? Number(ref.trim()) : undefined;
    return (
      entries.find((e) => e.id === ref.trim()) ??
      entries.find((e) => n !== undefined && e.number === n) ??
      entries.find((e) => normalize(e.id) === key || normalize(e.id.replace(/^\d+-/, "")) === key || normalize(e.name) === key)
    );
  };
  return {
    list: () => entries,
    get: find,
    suggest: (ref) => didYouMean(ref, entries.map((e) => ({ value: e.id, aliases: [e.name, e.id.replace(/^\d+-/, "")] }))),
    build(entry, registry) {
      let byId = built.get(registry);
      if (!byId) built.set(registry, (byId = new Map()));
      const cached = byId.get(entry.id);
      if (cached) return cached;
      const doc = readsProjectFolder(entry.recipe) ? storedDocument(entry.recipe, dir) : buildRecipeDocument(entry.recipe, registry);
      const counts = new Map<string, number>();
      for (const c of Object.values(doc.components))
        for (const node of Object.values(c.patches)) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
      const byName = new Map([...registry.patches.values()].map((s) => [normalize(s.name), s.type]));
      const named = entry.keyPatchNames.map((name) => byName.get(normalize(name))).filter((t): t is string => !!t && counts.has(t));
      const keyPatches = named.length
        ? [...new Set(named)]
        : [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([type]) => type);
      const result: BuiltExample = {
        doc,
        patchTypes: [...counts.keys()].sort(),
        keyPatches,
        batches: batchOps(positionedOps(entry.recipe, doc)),
      };
      byId.set(entry.id, result);
      return result;
    },
    design(entry) {
      const text = entry.recipe.design ? readText(at(entry.recipe.design.capture)) : undefined;
      return text === undefined ? undefined : (JSON.parse(text) as unknown);
    },
  };
}

let cached: ExampleCatalog | undefined;

/** The default catalog, loaded on first use. */
export function defaultExamples(): ExampleCatalog {
  cached ??= loadExamples();
  return cached;
}

/** The outline of an example's document (normal detail: structure, links and values), every component. */
export function exampleOutline(example: BuiltExample, registry: Registry): string {
  return getOutline(example.doc, undefined, { detail: "normal", registry });
}
