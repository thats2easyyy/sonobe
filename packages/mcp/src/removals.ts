/**
 * What a batch removes, counted from the documents before and after it (so cascades count): a
 * removeLayer counts its whole subtree, a removeComponent counts the component plus every layer,
 * patch and comment inside it, and setScript with no source counts the script file. Write tools
 * report it as `removed`, and agents use a dry run's summary to decide when to ask the person first.
 * They also report the ports a batch unpublished and the cables it cut (`unpublished`, `disconnected`).
 */

import { allLayerIds, isLinkInput, listInputs, targetAddress, type Component, type Id, type InputEntry, type Op, type SonobeDocument } from "@sonobe/core";

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

/**
 * True for batches that can cut cables as a side effect: destructive ops, and updateInterface ops
 * that unpublish ports (a null port, or replace: true).
 */
export function hasCascadingOps(ops: readonly Op[] | readonly unknown[]): boolean {
  return ops.some((op) => {
    if (isDestructiveOp(op)) return true;
    const o = op as { op?: unknown; replace?: unknown; inputs?: unknown; outputs?: unknown };
    if (!o || typeof o !== "object" || o.op !== "updateInterface") return false;
    if (o.replace === true) return true;
    const hasNull = (side: unknown) => !!side && typeof side === "object" && Object.values(side).some((v) => v === null);
    return hasNull(o.inputs) || hasNull(o.outputs);
  });
}

export interface UnpublishedPorts {
  component: Id;
  inputs: string[];
  outputs: string[];
}

/** Published ports of components in both documents that `after` no longer has. */
export function unpublishedPorts(before: SonobeDocument, after: SonobeDocument): UnpublishedPorts[] {
  const out: UnpublishedPorts[] = [];
  for (const [id, component] of Object.entries(before.components)) {
    const next = after.components[id];
    if (!next || next.interface === component.interface) continue;
    const inputs = Object.keys(component.interface.inputs).filter((key) => !Object.hasOwn(next.interface.inputs, key));
    const outputs = Object.keys(component.interface.outputs).filter((key) => !Object.hasOwn(next.interface.outputs, key));
    if (inputs.length || outputs.length) out.push({ component: id, inputs, outputs });
  }
  return out;
}

export interface CutCable {
  component: Id;
  from: string;
  to: string;
}

/** True when the input a stored value belongs to still exists in `component` (whose layer ids are `layers`). */
function hasTarget(component: Component, layers: ReadonlySet<Id>, target: InputEntry["target"]): boolean {
  if (target.kind === "patch") return Object.hasOwn(component.patches, target.id);
  if (target.kind === "layer") return layers.has(target.id);
  return Object.hasOwn(component.interface.outputs, target.key);
}

/** Cables in `before` whose input still exists in `after` but no longer holds them (cut by a cascade, or replaced). */
export function disconnectedLinks(before: SonobeDocument, after: SonobeDocument): CutCable[] {
  const out: CutCable[] = [];
  for (const [id, component] of Object.entries(before.components)) {
    const next = after.components[id];
    if (!next || next === component) continue;
    const layers = new Set(allLayerIds(next.layers));
    const links = new Map<string, string>();
    for (const entry of listInputs(next)) if (isLinkInput(entry.value)) links.set(targetAddress(entry.target), entry.value.link);
    for (const entry of listInputs(component)) {
      if (!isLinkInput(entry.value) || !hasTarget(next, layers, entry.target)) continue;
      const to = targetAddress(entry.target);
      if (links.get(to) !== entry.value.link) out.push({ component: id, from: entry.value.link, to });
    }
  }
  return out;
}
