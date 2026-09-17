/**
 * Layer menu actions that no panel owns: Insert Layer (centered in the prototype or the selected
 * group) and Use as Mask, which Sonobe implements as Clip Contents on the parent group.
 */

import { COMPONENT_INSTANCE_LAYER_TYPE, findLayer, getDevicePreset, type Component, type Id, type LayerNode, type LayerTypeSpec, type Op, type Registry, type SonobeDocument } from "@sonobe/core";

export const INSERTED_LAYER_REF = "inserted";

/** Layer types someone can insert from a list (component instances need a component, so they're left out). */
export function insertableLayerTypes(registry: Pick<Registry, "layers">): LayerTypeSpec[] {
  return [...registry.layers.values()].filter((spec) => spec.type !== COMPONENT_INSTANCE_LAYER_TYPE);
}

export function layerPickItems(registry: Pick<Registry, "layers">): { value: string; label: string; description: string }[] {
  return insertableLayerTypes(registry).map((spec) => ({ value: spec.type, label: spec.name, description: spec.summary }));
}

const isVec2 = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n));

/** The prototype's screen size in points (device preset, custom size, orientation). */
export function prototypeSize(doc: SonobeDocument): [number, number] {
  const device = doc.project.device;
  const size = isVec2(device.size) ? device.size : getDevicePreset(device.preset).size;
  return device.orientation === "landscape" ? [size[1], size[0]] : [size[0], size[1]];
}

/** Where a new layer goes: into the selected layer when it can hold children, else at the top level. */
export function insertParentFor(component: Component, selectedLayers: readonly Id[], registry: Pick<Registry, "layers">): Id | null {
  if (selectedLayers.length !== 1) return null;
  const layer = findLayer(component.layers, selectedLayers[0]!)?.layer;
  return layer && registry.layers.get(layer.type)?.canHaveChildren ? layer.id : null;
}

/** addLayer ops for a layer of `type`, centered in its parent (or the prototype screen). */
export function insertLayerOps(doc: SonobeDocument, componentId: Id, type: string, registry: Pick<Registry, "layers">, parent: Id | null = null): Op[] {
  const spec = registry.layers.get(type);
  const component = doc.components[componentId];
  const hasProp = (key: string) => !!spec?.props.some((p) => p.key === key);
  const sizeDefault = spec?.props.find((p) => p.key === "size")?.default;
  const size: [number, number] = isVec2(sizeDefault) ? sizeDefault : [120, 120];
  const parentLayer = parent && component ? findLayer(component.layers, parent)?.layer : undefined;
  const parentSize = parentLayer && isVec2(parentLayer.props.size) ? parentLayer.props.size : componentId === doc.project.root || !isVec2(component?.size) ? prototypeSize(doc) : component!.size!;
  const props: Record<string, [number, number]> = {};
  if (hasProp("position")) props.position = [Math.max(0, Math.round((parentSize[0] - size[0]) / 2)), Math.max(0, Math.round((parentSize[1] - size[1]) / 2))];
  return [{ op: "addLayer", component: componentId, parent, layer: { ref: INSERTED_LAYER_REF, type, ...(spec ? { name: spec.name } : {}), props } }];
}

export type ClipPlan =
  | { ok: true; ops: Op[]; groups: { id: Id; name: string }[]; clip: boolean }
  | { ok: false; message: string; hint: string };

/**
 * Use as Mask → Clip Contents on each selected layer's parent group. When every parent already
 * clips, it turns clipping off instead.
 */
export function clipParentPlan(component: Component, layerIds: readonly Id[], registry: Pick<Registry, "layers">): ClipPlan {
  const parents = new Map<Id, LayerNode>();
  for (const id of layerIds) {
    const parent = findLayer(component.layers, id)?.parent;
    if (parent && registry.layers.get(parent.type)?.props.some((p) => p.key === "clip")) parents.set(parent.id, parent);
  }
  if (parents.size === 0) {
    return { ok: false, message: "Put the layer inside a group first", hint: "A group clips its contents to its own bounds. Select the layers and group them, then choose Use as Mask." };
  }
  const groups = [...parents.values()];
  const clip = !groups.every((g) => g.props.clip === true);
  return { ok: true, clip, groups: groups.map((g) => ({ id: g.id, name: g.name })), ops: groups.map((g): Op => ({ op: "updateLayer", component: component.id, id: g.id, props: { clip } })) };
}
