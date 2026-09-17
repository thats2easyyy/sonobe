/**
 * Component instance addressing between the editor and the engine. The editor tracks the component
 * being edited as a component path ([root, card, badge]); the engine reads values inside instances by
 * instance path ("card_instance/badge_1/pop.output"). These helpers map one onto the other.
 */

import { COMPONENT_INSTANCE_LAYER_TYPE, COMPONENT_PATCH_TYPE, findLayer, walkLayers, type Id, type SonobeDocument } from "@sonobe/core";

/** Instance ids of component `childId` placed inside component `parentId`: layer instances (back → front), then component patches (by id). */
export function instanceIdsIn(doc: SonobeDocument, parentId: Id, childId: Id): Id[] {
  const parent = doc.components[parentId];
  if (!parent) return [];
  const out: Id[] = [];
  walkLayers(parent.layers, (layer) => {
    if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE && layer.component === childId) out.push(layer.id);
  });
  for (const id of Object.keys(parent.patches).sort()) {
    const node = parent.patches[id]!;
    if (node.type === COMPONENT_PATCH_TYPE && node.component === childId) out.push(id);
  }
  return out;
}

/** The shortest chain of instance ids from component `from` down to an instance of component `to`. */
function instanceChain(doc: SonobeDocument, from: Id, to: Id): Id[] | null {
  if (from === to) return [];
  const queue: { component: Id; chain: Id[] }[] = [{ component: from, chain: [] }];
  const seen = new Set<Id>([from]);
  while (queue.length) {
    const { component, chain } = queue.shift()!;
    const c = doc.components[component];
    if (!c) continue;
    const children: { id: Id; component: Id }[] = [];
    walkLayers(c.layers, (layer) => {
      if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE && layer.component) children.push({ id: layer.id, component: layer.component });
    });
    for (const id of Object.keys(c.patches).sort()) {
      const node = c.patches[id]!;
      if (node.type === COMPONENT_PATCH_TYPE && node.component) children.push({ id, component: node.component });
    }
    for (const child of children) {
      if (child.component === to) return [...chain, child.id];
      if (seen.has(child.component)) continue;
      seen.add(child.component);
      queue.push({ component: child.component, chain: [...chain, child.id] });
    }
  }
  return null;
}

/**
 * The engine instance path for editing a component path: "" for the root, "card/badge" inside nested
 * instances (the first instance at each level), or null when the component isn't instantiated from
 * the root.
 */
export function instancePathFor(doc: SonobeDocument, componentPath: readonly Id[]): string | null {
  const root = doc.project.root;
  const target = componentPath.at(-1) ?? root;
  if (target === root) return "";
  if (!doc.components[target]) return null;
  const segments: Id[] = [];
  let current = root;
  for (const next of componentPath.slice(componentPath[0] === root ? 1 : 0)) {
    if (next === current) continue;
    const direct = instanceIdsIn(doc, current, next);
    if (direct.length) {
      segments.push(direct[0]!);
    } else {
      const chain = instanceChain(doc, current, next);
      if (!chain) {
        const fromRoot = instanceChain(doc, root, target);
        return fromRoot ? fromRoot.join("/") : null;
      }
      segments.push(...chain);
    }
    current = next;
  }
  return segments.join("/");
}

/** The component an engine instance path ("main/card#2/badge") runs; undefined when it doesn't resolve. */
export function componentIdForInstancePath(doc: SonobeDocument, path: string | undefined): Id | undefined {
  const root = doc.project.root;
  if (!path) return root;
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === root && !doc.components[root]?.patches[root] && !findLayer(doc.components[root]?.layers ?? [], root)) segments.shift();
  let current: Id = root;
  for (const segment of segments) {
    const id = segment.replace(/#\d+$/, "");
    const component = doc.components[current];
    if (!component) return undefined;
    const layer = findLayer(component.layers, id)?.layer;
    const next = layer?.type === COMPONENT_INSTANCE_LAYER_TYPE ? layer.component : component.patches[id]?.type === COMPONENT_PATCH_TYPE ? component.patches[id]!.component : undefined;
    if (!next || !doc.components[next]) return undefined;
    current = next;
  }
  return current;
}

/** "pop.output" → "card/pop.output"; "@card.scale" → "@card/badge.scale". Unchanged for the root. */
export function qualifyAddress(address: string, instancePath: string | null | undefined): string {
  if (!instancePath) return address;
  return address.startsWith("@") ? `@${instancePath}/${address.slice(1)}` : `${instancePath}/${address}`;
}
