/**
 * Variables (Variable Broadcaster and Variable Receiver): how a receiver resolves to a broadcaster,
 * the way the engine compiles it (nearest level first, lowest id on ties), which variables a receiver
 * can choose from, and which receivers follow a broadcaster when it's renamed, rescoped, or retyped.
 */

import { VARIABLE_BROADCASTER_TYPE, VARIABLE_RECEIVER_TYPE } from "./graph.ts";
import { getOwn } from "./ids.ts";
import { allLayers, COMPONENT_INSTANCE_LAYER_TYPE, COMPONENT_PATCH_TYPE, resolveNodePorts } from "./registry.ts";
import type { Id, PatchNode, Registry, SonobeDocument, ValueType } from "./types.ts";

export type VariableScope = "local" | "global";

/** A variable as a broadcaster or receiver declares it. */
export interface VariableKey {
  /** Trimmed; "" when unnamed. */
  name: string;
  scope: VariableScope;
  type: ValueType;
}

export interface VariableInfo extends VariableKey {
  componentId: Id;
  /** The broadcaster's patch id. */
  id: Id;
  muted: boolean;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Same name, scope, and type: the receiver and broadcaster match. */
export const sameVariable = (a: VariableKey, b: VariableKey): boolean => a.name === b.name && a.scope === b.scope && a.type === b.type;

/** A variable patch's trimmed name and scope. */
export function variableSettings(node: Pick<PatchNode, "settings">): { name: string; scope: VariableScope } {
  const name = node.settings?.name;
  return { name: typeof name === "string" ? name.trim() : "", scope: node.settings?.scope === "global" ? "global" : "local" };
}

/** A variable patch's value type: a broadcaster's Value input or a receiver's Output ("number" when unset). */
export function variableType(doc: SonobeDocument, node: PatchNode, registry: Registry): ValueType {
  const ports = resolveNodePorts(doc, node, registry);
  const port = node.type === VARIABLE_BROADCASTER_TYPE ? ports?.inputs.find((p) => p.key === "value") : ports?.outputs[0];
  return port?.type ?? ((node.typeParam as ValueType | undefined) ?? "number");
}

/** A variable patch's name, scope, and type. */
export function variableKey(doc: SonobeDocument, node: PatchNode, registry: Registry): VariableKey {
  return { ...variableSettings(node), type: variableType(doc, node, registry) };
}

/** Broadcasters in one component, by id. */
export function componentBroadcasters(doc: SonobeDocument, registry: Registry, componentId: Id): VariableInfo[] {
  const c = getOwn(doc.components, componentId);
  if (!c) return [];
  return Object.keys(c.patches)
    .sort(byId)
    .filter((id) => c.patches[id]!.type === VARIABLE_BROADCASTER_TYPE)
    .map((id) => {
      const node = c.patches[id]!;
      return { componentId, id, muted: node.muted === true, ...variableKey(doc, node, registry) };
    });
}

/**
 * The broadcaster a receiver resolves to, for a receiver in the last component of `componentPath`
 * (root first, as the editor walks into components). Local variables come from that component;
 * global ones from it and then each enclosing component, nearest first. `mismatch`: a broadcaster
 * with the receiver's name and scope exists, but with another type.
 */
export function resolveReceiver(doc: SonobeDocument, registry: Registry, componentPath: readonly Id[], receiverId: Id): { broadcaster: VariableInfo | null; mismatch: boolean } {
  const componentId = componentPath.at(-1);
  const node = componentId === undefined ? undefined : getOwn(doc.components, componentId)?.patches[receiverId];
  if (!node || node.type !== VARIABLE_RECEIVER_TYPE) return { broadcaster: null, mismatch: false };
  const want = variableKey(doc, node, registry);
  if (!want.name) return { broadcaster: null, mismatch: false };
  const levels = want.scope === "local" ? [componentId!] : [...componentPath].reverse();
  let mismatch = false;
  for (const level of levels) {
    const candidates = componentBroadcasters(doc, registry, level).filter((b) => b.name === want.name && b.scope === want.scope);
    const match = candidates.find((b) => b.type === want.type);
    if (match) return { broadcaster: match, mismatch: false };
    if (candidates.length) mismatch = true;
  }
  return { broadcaster: null, mismatch };
}

/**
 * The variables a receiver in the last component of `componentPath` can choose: that component's
 * local and global broadcasters, then the global broadcasters of each enclosing component, nearest
 * first. Unnamed broadcasters, and variables a nearer one with the same name, scope, and type
 * shadows, are left out.
 */
export function reachableVariables(doc: SonobeDocument, registry: Registry, componentPath: readonly Id[]): VariableInfo[] {
  const out: VariableInfo[] = [];
  [...componentPath].reverse().forEach((level, depth) => {
    for (const b of componentBroadcasters(doc, registry, level)) {
      if (!b.name || (depth > 0 && b.scope !== "global")) continue;
      if (!out.some((o) => sameVariable(o, b))) out.push(b);
    }
  });
  return out;
}

/** Components placed directly inside a component (patch components and component layers), sorted. */
function childComponents(doc: SonobeDocument, componentId: Id): Id[] {
  const c = getOwn(doc.components, componentId);
  if (!c) return [];
  const ids = new Set<Id>();
  for (const node of Object.values(c.patches)) if (node.type === COMPONENT_PATCH_TYPE && node.component) ids.add(node.component);
  for (const layer of allLayers(c.layers)) if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE && layer.component) ids.add(layer.component);
  return [...ids].sort(byId);
}

/**
 * The receivers that resolve to a broadcaster now: receivers with its name, scope, and type in its
 * component and, for a global variable, in the components placed inside it, down to where another
 * global broadcaster with the same name and type takes over. Empty for an unnamed broadcaster, and
 * for one that another broadcaster with the same name, scope, and type shadows (a lower id wins).
 */
export function followingReceivers(doc: SonobeDocument, registry: Registry, componentId: Id, broadcasterId: Id): { componentId: Id; id: Id }[] {
  const c = getOwn(doc.components, componentId);
  const node = c ? getOwn(c.patches, broadcasterId) : undefined;
  if (!node || node.type !== VARIABLE_BROADCASTER_TYPE) return [];
  const key = variableKey(doc, node, registry);
  if (!key.name) return [];
  if (componentBroadcasters(doc, registry, componentId).find((b) => sameVariable(b, key))?.id !== broadcasterId) return [];
  const out: { componentId: Id; id: Id }[] = [];
  const collect = (level: Id) => {
    const patches = doc.components[level]!.patches;
    for (const id of Object.keys(patches).sort(byId)) {
      const receiver = patches[id]!;
      if (receiver.type === VARIABLE_RECEIVER_TYPE && sameVariable(variableKey(doc, receiver, registry), key)) out.push({ componentId: level, id });
    }
  };
  collect(componentId);
  if (key.scope !== "global") return out;
  const seen = new Set<Id>([componentId]);
  const queue = childComponents(doc, componentId);
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next) || !getOwn(doc.components, next)) continue;
    seen.add(next);
    if (componentBroadcasters(doc, registry, next).some((b) => sameVariable(b, key))) continue;
    collect(next);
    queue.push(...childComponents(doc, next));
  }
  return out;
}
