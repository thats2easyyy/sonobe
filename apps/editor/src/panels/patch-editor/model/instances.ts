/**
 * Where the component you're editing runs in the live prototype. The engine addresses values inside
 * component instances by instance path ("press_card/spring.output", "@card_2/badge.scale"), so this
 * turns selection.componentPath into that path, picking which instance to watch when a component is
 * used more than once.
 */

import { COMPONENT_INSTANCE_LAYER_TYPE, COMPONENT_PATCH_TYPE, walkLayers, type Id, type SonobeDocument } from "@sonobe/core";
import type { SceneFrame, SceneNode } from "@sonobe/engine";

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

/**
 * The address whose `copies` (runtime inspect) count the copies of the instance you're inside: a
 * layer instance's position ("@card.position", "@list/card.position" inside another instance), or
 * a component patch's first published port ("press.pressed"; a patch instance loops only through
 * its inputs, so one without ports never has copies). Null at the root.
 */
export function instanceCopiesAddress(scope: LiveScope, doc?: SonobeDocument): string | null {
  const last = scope.steps.at(-1);
  if (scope.prefix === null || !last) return null;
  const instance = last.instances.find((x) => x.id === last.instance);
  if (!instance) return null;
  const parent = scope.steps.slice(0, -1).map((s) => s.instance).join("/");
  const path = `${parent ? `${parent}/` : ""}${instance.id}`;
  if (instance.kind === "layer") return `@${path}.position`;
  const face = doc?.components[last.component]?.interface;
  const port = face ? (Object.keys(face.inputs)[0] ?? Object.keys(face.outputs)[0]) : undefined;
  return port ? `${path}.${port}` : null;
}

/**
 * The loop copy a scene key shows for the live scope `prefix` ("" at the root, "list_row" inside an
 * instance): inside a looped instance, the instance's copy ("list_row#2/title" → 2); otherwise the
 * copy of a looped layer in the scope's own component ("card#3" → 3). Undefined when the key isn't
 * in that scope or isn't a copy.
 */
export function copyInScope(key: string, prefix: string): number | undefined {
  const scope = prefix ? prefix.split("/") : [];
  const segments = key.split("/");
  if (segments.length <= scope.length) return undefined;
  for (let i = 0; i < scope.length; i++) if (segments[i]!.replace(/#\d+$/, "") !== scope[i]) return undefined;
  const copyOf = (segment: string | undefined) => {
    const m = /#(\d+)$/.exec(segment ?? "");
    return m ? Number(m[1]) : undefined;
  };
  return (scope.length ? copyOf(segments[scope.length - 1]) : undefined) ?? copyOf(segments[scope.length]);
}

/**
 * The scene key of layer `layerId` in the watched scope (`prefix` from watchedPrefix): the layer
 * itself, or, for a looped layer, its watched copy (copy 0 without one, wrapping past the last).
 * Undefined when the scene doesn't draw it there.
 */
export function layerSceneKey(scene: SceneFrame | null, prefix: string, layerId: Id, copy: number | null): string | undefined {
  if (!scene) return undefined;
  const base = prefix ? `${prefix}/${layerId}` : layerId;
  const copies = new Set<number>();
  let single = false;
  const stack: SceneNode[] = [...scene.roots];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.key === base) single = true;
    else if (node.key.startsWith(`${base}#`) && /^\d+$/.test(node.key.slice(base.length + 1))) copies.add(Number(node.key.slice(base.length + 1)));
    for (const child of node.children) stack.push(child);
  }
  if (single) return base;
  if (!copies.size) return undefined;
  const want = copy === null ? 0 : copy % copies.size;
  return `${base}#${copies.has(want) ? want : Math.min(...copies)}`;
}

/**
 * The instance path live values come from, with the watched copy: inside a looped instance
 * (`copies` of them), "card#3" picks that copy (wrapping past the last). Without a watched copy, or
 * when the instance isn't looped, it's the scope's own path (the engine then reads copy 0).
 */
export function watchedPrefix(scope: LiveScope, copies: number | undefined, copy: number | null): string | null {
  if (scope.prefix === null || copy === null || !copies || !scope.steps.length) return scope.prefix;
  return `${scope.prefix}#${copy % copies}`;
}

/** A component-local address as the engine reads it inside `prefix` ("pop.output" → "card/pop.output", "@badge.scale" → "@card/badge.scale"). */
export function scopedAddress(prefix: string, address: string): string {
  if (!prefix) return address;
  return address.startsWith("@") ? `@${prefix}/${address.slice(1)}` : `${prefix}/${address}`;
}
