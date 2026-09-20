/**
 * Recipe definitions and the deterministic document builder behind examples/build.ts. A recipe is
 * a list of core ops; building applies them to an empty document through applyOps (the same op
 * engine the editor and MCP use), then lays the patch graph out: in columns by dataflow, spaced for
 * the nodes' estimated sizes (lib/tidy.ts), or frame by frame as tidy_graph does. A recipe can start
 * from a stored design import (`design`), which buildRecipe plans with planImport before the
 * recipe's own ops.
 */

import { applyOps, createEmptyDocument, DEFAULT_DEVICE, type Op, type Registry, type SonobeDocument } from "@sonobe/core";
import { componentNodeBoxes } from "@sonobe/core/graph";
import type { EngineRegistry } from "@sonobe/engine";
import type { ImportFile, ImportPlan } from "@sonobe/import";
import { tidyOps } from "./tidy.ts";

/** A design a recipe imports first, the way import_design would. Paths are relative to examples/. */
export interface RecipeDesign {
  /** The DesignCapture JSON capturePage wrote ("16-noddit-deck/design/capture.json"). */
  capture: string;
  /** The photo list naming each http(s) image's file and credit (lib/design.ts). */
  photos: string;
}

export interface Recipe {
  /** Folder under examples/, e.g. "01-tap-to-grow". */
  folder: string;
  /** Project name, shown in the Learn panel. */
  name: string;
  /** One sentence for the Learn panel (project meta.description). */
  description: string;
  /** Guide slugs from docs/guides that this example backs (project meta.guides). */
  guides: string[];
  /** Viewer background behind every layer ("#RRGGBBAA"). */
  background: string;
  /** Root component notes: what to try and how it works, in a few sentences. */
  notes: string;
  /** A design imported before ops() runs; its layer and asset ids are the ones ops() names. */
  design?: RecipeDesign;
  /**
   * How the patch graphs are laid out after building: "columns" (default) by dataflow depth, the way
   * the first examples were built; "frames" tidies inside each comment frame of every component, as
   * tidy_graph does.
   */
  tidy?: "columns" | "frames";
  ops(): Op[];
}

export class RecipeBuildError extends Error {
  readonly folder: string;
  constructor(folder: string, message: string) {
    super(`${folder}: ${message}`);
    this.name = "RecipeBuildError";
    this.folder = folder;
  }
}

function apply(recipe: Recipe, doc: SonobeDocument, ops: Op[], registry: Registry, stage: string): SonobeDocument {
  const r = applyOps(doc, ops, { registry });
  if (r.ok) return r.doc;
  const lines = r.errors.map((e) => {
    const op = e.opIndex !== undefined ? ops[e.opIndex] : undefined;
    const where = op ? ` (op ${e.opIndex}: ${JSON.stringify(op).slice(0, 160)})` : "";
    return `${e.message}${e.hint ? ` ${e.hint}` : ""}${where}`;
  });
  throw new RecipeBuildError(recipe.folder, `${stage} failed:\n  ${lines.join("\n  ")}`);
}

function start(recipe: Recipe): { doc: SonobeDocument; setup: Op[] } {
  const doc = createEmptyDocument({ name: recipe.name, device: DEFAULT_DEVICE });
  const setup: Op[] = [
    {
      op: "setProject",
      changes: { background: recipe.background, meta: { description: recipe.description, guides: [...recipe.guides], recipe: recipe.folder } },
    },
    { op: "updateComponent", id: doc.project.root, notes: recipe.notes },
  ];
  return { doc, setup };
}

/** Clear space the columns layout keeps after a column's widest node and a row's tallest. */
const TIDY_CLEARANCE: [number, number] = [40, 16];

function tidyColumns(recipe: Recipe, doc: SonobeDocument, registry: Registry): SonobeDocument {
  const root = doc.components[doc.project.root]!;
  const sizes = componentNodeBoxes(doc, registry, root.id);
  return apply(recipe, doc, tidyOps(root, { spacing: [260, 150], sizes, clearance: TIDY_CLEARANCE }), registry, "Tidying the graph");
}

/**
 * Build a recipe that needs neither a design import nor frame tidying into a document. Throws
 * RecipeBuildError with core's messages when an op fails.
 */
export function buildRecipeDocument(recipe: Recipe, registry: Registry): SonobeDocument {
  if (recipe.design || recipe.tidy === "frames") throw new RecipeBuildError(recipe.folder, `${recipe.design ? "imports a design" : "tidies its graph by frame"}, which takes a moment. Build it with await buildRecipe(recipe, registry).`);
  const { doc, setup } = start(recipe);
  return tidyColumns(recipe, apply(recipe, doc, [...setup, ...recipe.ops()], registry, "Building"), registry);
}

export interface BuiltRecipe {
  doc: SonobeDocument;
  /** Bytes of the document's asset files (assets/<file>), from the design import. */
  files: ImportFile[];
}

/**
 * Import a recipe's design into a document, as buildRecipe does before the recipe's ops, which name
 * the layers and assets it makes. A recipe without a design leaves the document as it is. Node only.
 */
export async function importRecipeDesign(recipe: Recipe, doc: SonobeDocument, registry: Registry): Promise<BuiltRecipe> {
  if (!recipe.design) return { doc, files: [] };
  const [{ loadDesign }, { planImport }] = await Promise.all([import("./design.ts"), import("@sonobe/import")]);
  let plan: ImportPlan;
  try {
    const { capture, images } = await loadDesign(recipe.design);
    plan = await planImport(capture, doc, images);
  } catch (err) {
    throw new RecipeBuildError(recipe.folder, `Importing the design failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { doc: apply(recipe, doc, plan.ops, registry, "Importing the design"), files: plan.files };
}

/** Build any recipe: import its design, apply its ops, then lay its graphs out. Node only. */
export async function buildRecipe(recipe: Recipe, registry: EngineRegistry): Promise<BuiltRecipe> {
  if (!recipe.design && recipe.tidy !== "frames") return { doc: buildRecipeDocument(recipe, registry), files: [] };
  const { doc: empty, setup } = start(recipe);
  const { doc: imported, files } = await importRecipeDesign(recipe, apply(recipe, empty, setup, registry, "Setting up"), registry);
  let doc = apply(recipe, imported, recipe.ops(), registry, "Building");
  if (recipe.tidy !== "frames") return { doc: tidyColumns(recipe, doc, registry), files };
  const { tidyFramesOps } = await import("./tidyFrames.ts");
  for (const id of Object.keys(doc.components).sort()) doc = apply(recipe, doc, await tidyFramesOps(doc, registry, id), registry, `Tidying ${id}`);
  return { doc, files };
}
