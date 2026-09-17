/**
 * Stored input values (patch inputs, layer props, published output links): listing,
 * reading, writing, cascading removal, and builders for ops that restore removed items
 * exactly (used by inverse ops).
 */

import { parseAddress } from "../address.ts";
import { getOwn } from "../ids.ts";
import { walkLayers } from "../registry.ts";
import type { Component, Id, InputValue, LayerNode, NewLayer, NewPatch, Op, PatchNode } from "../types.ts";
import { isLayerInput, isLinkInput } from "../values.ts";
import type { OpOf } from "./context.ts";
import { mapLayer } from "./tree.ts";

export type InputTarget = { kind: "patch"; id: Id; key: string } | { kind: "layer"; id: Id; key: string } | { kind: "componentOutput"; key: string };

export interface InputEntry {
  target: InputTarget;
  value: InputValue;
}

export function targetAddress(target: InputTarget): string {
  switch (target.kind) {
    case "patch":
      return `${target.id}.${target.key}`;
    case "layer":
      return `@${target.id}.${target.key}`;
    case "componentOutput":
      return `$out.${target.key}`;
  }
}

/** Every stored input value in a component. */
export function listInputs(component: Component): InputEntry[] {
  const out: InputEntry[] = [];
  for (const [id, node] of Object.entries(component.patches)) {
    for (const [key, value] of Object.entries(node.inputs)) out.push({ target: { kind: "patch", id, key }, value });
  }
  walkLayers(component.layers, (layer) => {
    for (const [key, value] of Object.entries(layer.props)) out.push({ target: { kind: "layer", id: layer.id, key }, value });
  });
  for (const [key, port] of Object.entries(component.interface.outputs)) {
    if (port.link !== undefined) out.push({ target: { kind: "componentOutput", key }, value: { link: port.link } });
  }
  return out;
}

export function readInput(component: Component, target: InputTarget): InputValue | undefined {
  switch (target.kind) {
    case "patch": {
      const node = getOwn(component.patches, target.id);
      return node ? getOwn(node.inputs, target.key) : undefined;
    }
    case "layer": {
      let found: InputValue | undefined;
      walkLayers(component.layers, (l) => {
        if (l.id !== target.id) return;
        found = getOwn(l.props, target.key);
        return "stop";
      });
      return found;
    }
    case "componentOutput": {
      const link = getOwn(component.interface.outputs, target.key)?.link;
      return link === undefined ? undefined : { link };
    }
  }
}

/** Write (or delete, with undefined) one stored input value. */
export function writeInput(component: Component, target: InputTarget, value: InputValue | undefined): Component {
  switch (target.kind) {
    case "patch": {
      const node = getOwn(component.patches, target.id);
      if (!node) return component;
      const inputs = { ...node.inputs };
      if (value === undefined) delete inputs[target.key];
      else inputs[target.key] = value;
      return { ...component, patches: { ...component.patches, [target.id]: { ...node, inputs } } };
    }
    case "layer": {
      const layers = mapLayer(component.layers, target.id, (layer) => {
        const props = { ...layer.props };
        if (value === undefined) delete props[target.key];
        else props[target.key] = value;
        return { ...layer, props };
      });
      return layers === component.layers ? component : { ...component, layers };
    }
    case "componentOutput": {
      const port = getOwn(component.interface.outputs, target.key);
      if (!port) return component;
      const next = { ...port };
      if (value === undefined || !isLinkInput(value)) delete next.link;
      else next.link = value.link;
      return { ...component, interface: { ...component.interface, outputs: { ...component.interface.outputs, [target.key]: next } } };
    }
  }
}

/** Remove every stored value matching `predicate`. */
export function removeInputs(component: Component, predicate: (entry: InputEntry) => boolean): { component: Component; removed: InputEntry[] } {
  const removed = listInputs(component).filter(predicate);
  let next = component;
  for (const entry of removed) next = writeInput(next, entry.target, undefined);
  return { component: next, removed };
}

/** setInput ops that put removed values back. */
export function restoreInputOps(componentId: Id, entries: readonly InputEntry[]): Op[] {
  return entries.map((e): Op => ({ op: "setInput", component: componentId, target: targetAddress(e.target), value: e.value }));
}

/** The patch or layer id a link reads from, if any. */
export function linkSourceId(value: InputValue): Id | undefined {
  if (!isLinkInput(value)) return undefined;
  const a = parseAddress(value.link);
  return a && (a.kind === "patch" || a.kind === "layer") ? a.id : undefined;
}

/** True when a value links from, or points at, one of `ids`. */
export function referencesItems(value: InputValue, ids: ReadonlySet<Id>): boolean {
  if (isLayerInput(value)) return ids.has(value.layer);
  const source = linkSourceId(value);
  return source !== undefined && ids.has(source);
}

/**
 * Ops that re-create a removed layer subtree exactly. `add` inserts the layers without
 * links or layer references (plus editor flags); `after` restores those links once every
 * restored item exists.
 */
export function restoreLayerOps(componentId: Id, parentId: Id | null, index: number, node: LayerNode): { add: Op[]; after: Op[] } {
  const after: Op[] = [];
  const flags: Op[] = [];
  const toNew = (layer: LayerNode): NewLayer => {
    const props: Record<string, InputValue> = {};
    for (const [key, value] of Object.entries(layer.props)) {
      if (isLinkInput(value) || isLayerInput(value)) after.push({ op: "setInput", component: componentId, target: `@${layer.id}.${key}`, value });
      else props[key] = value;
    }
    const out: NewLayer = { id: layer.id, type: layer.type, name: layer.name, props };
    if (layer.component !== undefined) out.component = layer.component;
    if (layer.children?.length) out.children = layer.children.map(toNew);
    if (layer.locked || layer.collapsed) {
      const flag: OpOf<"updateLayer"> = { op: "updateLayer", component: componentId, id: layer.id };
      if (layer.locked) flag.locked = true;
      if (layer.collapsed) flag.collapsed = true;
      flags.push(flag);
    }
    return out;
  };
  const layer = toNew(node);
  return { add: [{ op: "addLayer", component: componentId, parent: parentId, index, layer }, ...flags], after };
}

/** Ops that re-create a removed patch exactly (see restoreLayerOps). */
export function restorePatchOps(componentId: Id, id: Id, node: PatchNode): { add: Op[]; after: Op[] } {
  const inputs: Record<string, InputValue> = {};
  const after: Op[] = [];
  for (const [key, value] of Object.entries(node.inputs)) {
    if (isLinkInput(value) || isLayerInput(value)) after.push({ op: "setInput", component: componentId, target: `${id}.${key}`, value });
    else inputs[key] = value;
  }
  const patch: NewPatch = { id, type: node.type, inputs, ui: { x: node.ui.x, y: node.ui.y } };
  if (node.name !== undefined) patch.name = node.name;
  if (node.typeParam !== undefined) patch.typeParam = node.typeParam;
  if (node.inputCount !== undefined) patch.inputCount = node.inputCount;
  if (node.settings !== undefined) patch.settings = node.settings;
  if (node.component !== undefined) patch.component = node.component;
  const add: Op[] = [{ op: "addPatch", component: componentId, patch }];
  if (node.muted || node.ui.collapsed || node.ui.color !== undefined) {
    const flag: OpOf<"updatePatch"> = { op: "updatePatch", component: componentId, id };
    if (node.muted) flag.muted = true;
    if (node.ui.collapsed || node.ui.color !== undefined) {
      flag.ui = {};
      if (node.ui.collapsed) flag.ui.collapsed = true;
      if (node.ui.color !== undefined) flag.ui.color = node.ui.color;
    }
    add.push(flag);
  }
  return { add, after };
}
