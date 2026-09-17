/**
 * What a batch removes, counted from the documents before and after it (so cascades count): a
 * removeLayer counts its whole subtree, a removeComponent counts the component plus every layer,
 * patch and comment inside it, and setScript with no source counts the script file. Write tools
 * report it as `removed`, and agents use a dry run's summary to decide when to ask the person first.
 */

import { allLayerIds, type Op, type SonobeDocument } from "@sonobe/core";

export interface RemovalSummary {
  layers: number;
  patches: number;
  comments: number;
  components: number;
  assets: number;
  scripts: number;
  /** Every removed item: the sum of the counts above. */
  total: number;
}

const REMOVE_OPS = new Set(["removeLayer", "removePatch", "removeComment", "removeComponent", "removeAsset"]);

/** True for ops that can delete content: remove* ops and setScript without a source. */
export function isDestructiveOp(op: unknown): boolean {
  if (!op || typeof op !== "object") return false;
  const kind = (op as { op?: unknown }).op;
  if (typeof kind !== "string") return false;
  if (REMOVE_OPS.has(kind)) return true;
  if (kind === "setScript") {
    const source = (op as { source?: unknown }).source;
    return source === null || source === undefined;
  }
  return false;
}

export function hasDestructiveOps(ops: readonly Op[] | readonly unknown[]): boolean {
  return ops.some(isDestructiveOp);
}

/** Items present in `before` and gone from `after`. */
export function removedItems(before: SonobeDocument, after: SonobeDocument): RemovalSummary {
  const out: RemovalSummary = { layers: 0, patches: 0, comments: 0, components: 0, assets: 0, scripts: 0, total: 0 };
  for (const [id, component] of Object.entries(before.components)) {
    const next = after.components[id];
    if (!next) {
      out.components++;
      out.layers += allLayerIds(component.layers).length;
      out.patches += Object.keys(component.patches).length;
      out.comments += component.comments.length;
      continue;
    }
    if (next === component) continue;
    const kept = new Set(allLayerIds(next.layers));
    for (const layerId of allLayerIds(component.layers)) if (!kept.has(layerId)) out.layers++;
    for (const patchId of Object.keys(component.patches)) if (!next.patches[patchId]) out.patches++;
    const keptComments = new Set(next.comments.map((c) => c.id));
    for (const comment of component.comments) if (!keptComments.has(comment.id)) out.comments++;
  }
  for (const id of Object.keys(before.assets ?? {})) if (!after.assets?.[id]) out.assets++;
  for (const file of Object.keys(before.scripts ?? {})) if (after.scripts?.[file] === undefined) out.scripts++;
  out.total = out.layers + out.patches + out.comments + out.components + out.assets + out.scripts;
  return out;
}

const WORDS: readonly [keyof Omit<RemovalSummary, "total">, string, string][] = [
  ["layers", "layer", "layers"],
  ["patches", "patch", "patches"],
  ["comments", "comment", "comments"],
  ["components", "component", "components"],
  ["assets", "asset", "assets"],
  ["scripts", "script file", "script files"],
];

/** "41 layers, 20 patches" (empty when nothing is removed). */
export function describeRemovals(summary: RemovalSummary): string {
  return WORDS.filter(([key]) => summary[key] > 0)
    .map(([key, one, many]) => `${summary[key]} ${summary[key] === 1 ? one : many}`)
    .join(", ");
}
