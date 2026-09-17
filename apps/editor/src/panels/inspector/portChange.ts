/**
 * Changing a patch's Type or input count can leave cables that no longer fit: core drops them when
 * the ports change. Before the inspector applies such a change it plans it here: which cables would
 * be lost (and why), how many stored values reset, and ready ops that insert a converter patch for
 * every lost cable that has one, so the change and its fixes land as one undo step.
 */

import {
  allLayers,
  applyOps,
  converterSuggestions,
  findLayer,
  getPatchSpec,
  isLinkInput,
  parseAddress,
  resolveLayerProps,
  resolveNodePorts,
  type Component,
  type Id,
  type Op,
  type Registry,
  type SonobeDocument,
  type SonobeError,
  type Suggestion,
  type ValueType,
} from "@sonobe/core";
import { freeInsertPosition, portTypeAt } from "../patch-editor/api.ts";

/** A cable as stored: the output it reads and the input it drives. */
export interface CableRef {
  from: string;
  to: string;
}

export interface LostCable extends CableRef {
  /** "Zoom Spring · Progress" */
  fromLabel: string;
  /** "Photo · Scale" */
  toLabel: string;
  /** The output's type after the change (before it, when the port is gone). */
  fromType: ValueType | undefined;
  /** The input's type after the change (before it, when the port is gone). */
  toType: ValueType | undefined;
  /** One end's port no longer exists (fewer inputs, or a variant without it). */
  removedPort: boolean;
  /** A converter patch that makes the cable fit again. */
  converter?: { patchType: string; patchName: string; description: string };
}

export type PortChangePlan =
  | {
      ok: true;
      lost: LostCable[];
      /** Stored input values on the changed patches that reset because they no longer fit. */
      resetValues: number;
      /** addPatch + connect ops (after the change ops) for every lost cable with a converter. */
      converterOps: Op[];
      converterCount: number;
    }
  | { ok: false; error: SonobeError | undefined };

/** Every cable touching `ids`: into their inputs, or out of their outputs. */
export function cablesTouching(component: Component, ids: ReadonlySet<Id>): CableRef[] {
  const out: CableRef[] = [];
  const readsFrom = (link: string) => {
    const source = parseAddress(link);
    return source?.kind === "patch" && ids.has(source.id);
  };
  for (const [id, node] of Object.entries(component.patches)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (isLinkInput(value) && (ids.has(id) || readsFrom(value.link))) out.push({ from: value.link, to: `${id}.${key}` });
    }
  }
  for (const layer of allLayers(component.layers)) {
    for (const [key, value] of Object.entries(layer.props)) {
      if (isLinkInput(value) && readsFrom(value.link)) out.push({ from: value.link, to: `@${layer.id}.${key}` });
    }
  }
  for (const [key, port] of Object.entries(component.interface.outputs)) {
    const link = (port as { link?: unknown }).link;
    if (typeof link === "string" && readsFrom(link)) out.push({ from: link, to: `$out.${key}` });
  }
  return out;
}

/** A port in plain language: "Zoom Spring · Progress", "Photo · Scale", "Pressed (component input)". */
export function endpointLabel(doc: SonobeDocument, componentId: Id, registry: Registry, address: string): string {
  const component = doc.components[componentId];
  const parsed = parseAddress(address);
  if (!component || !parsed) return address;
  if (parsed.kind === "patch") {
    const node = component.patches[parsed.id];
    if (!node) return address;
    const ports = resolveNodePorts(doc, node, registry);
    const port = ports?.inputs.find((p) => p.key === parsed.key) ?? ports?.outputs.find((p) => p.key === parsed.key);
    return `${node.name || getPatchSpec(registry, node.type)?.name || parsed.id} · ${port?.name ?? parsed.key}`;
  }
  if (parsed.kind === "layer") {
    const layer = findLayer(component.layers, parsed.id)?.layer;
    if (!layer) return address;
    const prop = resolveLayerProps(doc, componentId, layer, registry)?.find((p) => p.key === parsed.key);
    const output = registry.layers.get(layer.type)?.outputs?.find((p) => p.key === parsed.key);
    return `${layer.name} · ${prop?.name ?? output?.name ?? parsed.key}`;
  }
  if (parsed.kind === "componentInput") return `${component.interface.inputs[parsed.key]?.name ?? parsed.key} (component input)`;
  return `${component.interface.outputs[parsed.key]?.name ?? parsed.key} (component output)`;
}

const changedPatchIds = (ops: readonly Op[]): Set<Id> => new Set(ops.flatMap((op) => (op.op === "updatePatch" && typeof op.id === "string" ? [op.id] : [])));

const converterOf = (doc: SonobeDocument, componentId: Id, registry: Registry, from: string, to: string, fromType: ValueType, toType: ValueType): Suggestion | undefined =>
  converterSuggestions(doc, registry, componentId, { address: from, type: fromType }, { address: to, type: toType }).find((s) => s.ops?.some((op) => op.op === "addPatch"));

/**
 * What applying `ops` (updatePatch typeParam / inputCount changes) would disconnect, with converter
 * ops for the cables that have a converter. `ok: false` when the ops don't apply at all.
 */
export function planPortChange(doc: SonobeDocument, componentId: Id, registry: Registry, ops: readonly Op[]): PortChangePlan {
  const before = doc.components[componentId];
  const result = applyOps(doc, ops, { registry, defaultComponent: componentId });
  if (!result.ok || !before) return { ok: false, error: result.errors[0] };
  const next = result.doc;
  const after = next.components[componentId];
  if (!after) return { ok: false, error: result.errors[0] };
  const ids = changedPatchIds(ops);
  const kept = new Set(cablesTouching(after, ids).map((c) => `${c.from}→${c.to}`));
  const lost: LostCable[] = [];
  const suggestions: (Suggestion | undefined)[] = [];
  for (const cable of cablesTouching(before, ids)) {
    if (kept.has(`${cable.from}→${cable.to}`)) continue;
    const fromAfter = portTypeAt(next, componentId, registry, cable.from, "out");
    const toAfter = portTypeAt(next, componentId, registry, cable.to, "in");
    const removedPort = fromAfter === undefined || toAfter === undefined;
    const entry: LostCable = {
      ...cable,
      fromLabel: endpointLabel(doc, componentId, registry, cable.from),
      toLabel: endpointLabel(doc, componentId, registry, cable.to),
      fromType: fromAfter ?? portTypeAt(doc, componentId, registry, cable.from, "out"),
      toType: toAfter ?? portTypeAt(doc, componentId, registry, cable.to, "in"),
      removedPort,
    };
    const suggestion = !removedPort ? converterOf(next, componentId, registry, cable.from, cable.to, fromAfter, toAfter) : undefined;
    const added = suggestion?.ops?.find((op) => op.op === "addPatch");
    if (suggestion && added?.op === "addPatch") {
      const spec = getPatchSpec(registry, added.patch.type);
      entry.converter = { patchType: added.patch.type, patchName: spec?.name ?? added.patch.type, description: suggestion.description };
    }
    lost.push(entry);
    suggestions.push(suggestion);
  }
  let resetValues = 0;
  for (const id of ids) {
    const was = before.patches[id];
    const now = after.patches[id];
    if (!was || !now) continue;
    for (const [key, value] of Object.entries(was.inputs)) if (!isLinkInput(value) && !(key in now.inputs)) resetValues++;
  }
  const converterOps = placeConverters(next, componentId, registry, before, lost, suggestions);
  return { ok: true, lost, resetValues, converterOps, converterCount: lost.filter((l) => l.converter).length };
}

/** Converter suggestions as one batch: unique refs, placed in free space between the cable's ends. */
function placeConverters(doc: SonobeDocument, componentId: Id, registry: Registry, component: Component, lost: readonly LostCable[], suggestions: readonly (Suggestion | undefined)[]): Op[] {
  const ops: Op[] = [];
  const taken: { x: number; y: number }[] = [];
  const uiOf = (address: string) => {
    const parsed = parseAddress(address);
    return parsed?.kind === "patch" ? component.patches[parsed.id]?.ui : undefined;
  };
  lost.forEach((cable, i) => {
    const suggestion = suggestions[i];
    if (!suggestion?.ops || !cable.converter) return;
    const ref = `converter_${i + 1}`;
    let original: string | undefined;
    const rename = (address: string) => (original !== undefined && address.startsWith(`$${original}.`) ? `$${ref}.${address.slice(original.length + 2)}` : address);
    const a = uiOf(cable.from);
    const b = uiOf(cable.to);
    const near = a && b ? { x: Math.round((a.x + b.x) / 2), y: Math.round(Math.max(a.y, b.y) + 80) } : a ? { x: a.x + 240, y: a.y } : b ? { x: b.x - 240, y: b.y } : undefined;
    for (const op of suggestion.ops) {
      if (op.op === "addPatch") {
        original = op.patch.ref;
        const at = freeInsertPosition(doc, componentId, registry, op.patch.type, near, { bias: "any", ...(op.patch.typeParam ? { typeParam: op.patch.typeParam } : {}) });
        const stacked = taken.filter((t) => t.x === at.x && t.y === at.y).length;
        taken.push(at);
        ops.push({ ...op, component: componentId, patch: { ...op.patch, ref, ui: { x: at.x, y: at.y + stacked * 90 } } });
      } else if (op.op === "connect") {
        ops.push({ ...op, component: componentId, from: rename(op.from), to: rename(op.to) });
      } else {
        ops.push(op);
      }
    }
  });
  return ops;
}
