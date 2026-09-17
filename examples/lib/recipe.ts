/**
 * Recipe definitions and the deterministic document builder behind examples/build.ts. A recipe is
 * a list of core ops; building applies them to an empty document through applyOps (the same op
 * engine the editor and MCP use), then lays the patch graph out with tidy_graph's algorithm.
 */

import { applyOps, createEmptyDocument, DEFAULT_DEVICE, type Op, type Registry, type SonobeDocument } from "@sonobe/core";
import { tidyOps } from "@sonobe/mcp";

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

/** Build a recipe into a document. Throws RecipeBuildError with core's messages when an op fails. */
export function buildRecipeDocument(recipe: Recipe, registry: Registry): SonobeDocument {
  const empty = createEmptyDocument({ name: recipe.name, device: DEFAULT_DEVICE });
  const setup: Op[] = [
    {
      op: "setProject",
      changes: { background: recipe.background, meta: { description: recipe.description, guides: [...recipe.guides], recipe: recipe.folder } },
    },
    { op: "updateComponent", id: empty.project.root, notes: recipe.notes },
  ];
  const built = apply(recipe, empty, [...setup, ...recipe.ops()], registry, "Building");
  const root = built.components[built.project.root]!;
  return apply(recipe, built, tidyOps(root, { spacing: [260, 150] }), registry, "Tidying the graph");
}
