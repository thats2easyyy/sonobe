/**
 * Where the component you're editing runs in the live prototype. The engine addresses values inside
 * component instances by instance path ("press_card/spring.output", "@card_2/badge.scale"), so this
 * turns selection.componentPath into that path, picking which instance to watch when a component is
 * used more than once.
 */

import { COMPONENT_INSTANCE_LAYER_TYPE, COMPONENT_PATCH_TYPE, walkLayers, type Id, type SonobeDocument } from "@sonobe/core";

export interface ComponentInstance {
  /** Patch id (patch components) or layer id (layer components) in the parent component. */
  id: Id;
  name: string;
  kind: "patch" | "layer";
}

export interface LiveScopeStep {
  parent: Id;
  component: Id;
  /** Every instance of `component` in `parent`, in canvas order. */
  instances: ComponentInstance[];
  /** The instance being watched. */
  instance: Id;
}

export interface LiveScope {
  /** Engine instance path: "" for the root component, "press_card" or "card/badge" inside components, null when the component doesn't run. */
  prefix: string | null;
  steps: LiveScopeStep[];
}

/** Key for remembering which instance of `component` inside `parent` to watch. */
export const instanceChoiceKey = (parent: Id, component: Id): string => `${parent}>${component}`;

/** Instances of `componentId` placed directly in `parentId`: component patches first (top-left first), then layer instances (back to front). */
export function componentInstances(doc: SonobeDocument, parentId: Id, componentId: Id): ComponentInstance[] {
  const parent = doc.components[parentId];
  if (!parent) return [];
  const fallbackName = doc.components[componentId]?.name ?? componentId;
  const patches = Object.entries(parent.patches)
    .filter(([, node]) => node.type === COMPONENT_PATCH_TYPE && node.component === componentId)
    .sort(([, a], [, b]) => a.ui.y - b.ui.y || a.ui.x - b.ui.x)
    .map(([id, node]): ComponentInstance => ({ id, name: node.name || fallbackName, kind: "patch" }));
  const layers: ComponentInstance[] = [];
  walkLayers(parent.layers, (layer) => {
    if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE && layer.component === componentId) layers.push({ id: layer.id, name: layer.name || fallbackName, kind: "layer" });
  });
  return [...patches, ...layers];
}

/** Components that `componentId` places instances of. */
function childComponents(doc: SonobeDocument, componentId: Id): Id[] {
  const component = doc.components[componentId];
  if (!component) return [];
  const out = new Set<Id>();
  for (const node of Object.values(component.patches)) if (node.type === COMPONENT_PATCH_TYPE && node.component) out.add(node.component);
  walkLayers(component.layers, (layer) => {
    if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE && layer.component) out.add(layer.component);
  });
  return [...out];
}

/** Shortest component chain from the root to `target` (inclusive), or null when the prototype never uses it. */
function chainFromRoot(doc: SonobeDocument, target: Id): Id[] | null {
  const root = doc.project.root;
  const seen = new Set<Id>([root]);
  const queue: Id[][] = [[root]];
  while (queue.length) {
    const chain = queue.shift()!;
    const last = chain.at(-1)!;
    if (last === target) return chain;
    for (const child of childComponents(doc, last)) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push([...chain, child]);
    }
  }
  return null;
}

/** The instance path for a component path, using `choices` (instanceChoiceKey → instance id) where a component is used several times. */
export function resolveLiveScope(doc: SonobeDocument, componentPath: readonly Id[], choices: Readonly<Record<string, Id>> = {}): LiveScope {
  const root = doc.project.root;
  let path = componentPath.length ? [...componentPath] : [root];
  if (path[0] !== root) {
    const chain = chainFromRoot(doc, path[0]!);
    if (!chain) return { prefix: null, steps: [] };
    path = [...chain, ...path.slice(1)];
  }
  const steps: LiveScopeStep[] = [];
  for (let i = 1; i < path.length; i++) {
    const parent = path[i - 1]!;
    const component = path[i]!;
    const instances = componentInstances(doc, parent, component);
    if (instances.length === 0) return { prefix: null, steps };
    const chosen = choices[instanceChoiceKey(parent, component)];
    const instance = instances.find((x) => x.id === chosen) ?? instances[0]!;
    steps.push({ parent, component, instances, instance: instance.id });
  }
  return { prefix: steps.map((s) => s.instance).join("/"), steps };
}

/** A component-local address as the engine reads it inside `prefix` ("pop.output" → "card/pop.output", "@badge.scale" → "@card/badge.scale"). */
export function scopedAddress(prefix: string, address: string): string {
  if (!prefix) return address;
  return address.startsWith("@") ? `@${prefix}/${address.slice(1)}` : `${prefix}/${address}`;
}
