/**
 * createComponent: move selected layers and/or patches into a new component, publish
 * the ports that cross the boundary, and leave an instance wired equivalently
 * (a componentInstance layer for layer components, a "component" patch otherwise).
 */

import { layerAddress, parseAddress, type ParsedAddress } from "../address.ts";
import { deviceScreenSize, FORMAT_VERSION } from "../document.ts";
import { isValidId, uniqueId } from "../ids.ts";
import { allLayerIds, COMPONENT_INSTANCE_LAYER_TYPE, COMPONENT_PATCH_TYPE, componentItemIds, findPort, resolveLayerProps } from "../registry.ts";
import type { Component, ComponentKind, Id, InputValue, InterfacePort, LayerNode, Op, PatchNode, ValueType } from "../types.ts";
import { resolveSource, resolveTarget } from "../validate.ts";
import { isLayerInput, isLinkInput, roundNumber } from "../values.ts";
import { newComponentId } from "./components.ts";
import { defineRef, fail, getTargetComponent, newItemId, requireLayer, requirePatch, resolveId, type OpContext, type OpOf, type OpOutcome } from "./context.ts";
import { listInputs, readInput, restoreLayerOps, restorePatchOps, targetAddress, writeInput, type InputTarget } from "./references.ts";
import { insertLayerNode, removeLayerNode } from "./tree.ts";

interface LiteralFrame {
  position: [number, number];
  size: [number, number];
  anchor: [number, number];
}

/** Position/size/anchor when all are literal (or defaults); undefined when any is linked. */
function literalFrame(ctx: OpContext, component: Component, layer: LayerNode): LiteralFrame | undefined {
  const props = resolveLayerProps(ctx.doc, component.id, layer, ctx.registry);
  if (!props) return undefined;
  const vec = (key: string): [number, number] | undefined => {
    const v = key in layer.props ? layer.props[key] : findPort(props, key)?.default;
    return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number") ? [v[0] as number, v[1] as number] : undefined;
  };
  const position = vec("position");
  const size = vec("size");
  const anchor = vec("anchor");
  return position && size && anchor ? { position, size, anchor } : undefined;
}

export function createComponent(ctx: OpContext, op: OpOf<"createComponent">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  if (typeof op.name !== "string" || !op.name.trim()) fail("invalid_value", "The new component needs a name.");
  if (op.layerIds !== undefined && !Array.isArray(op.layerIds)) fail("invalid_op", '"layerIds" must be a list of layer ids.');
  if (op.patchIds !== undefined && !Array.isArray(op.patchIds)) fail("invalid_op", '"patchIds" must be a list of patch ids.');
  const layerIds = [...new Set((op.layerIds ?? []).map((id) => resolveId(ctx, id)))];
  const patchIds = [...new Set((op.patchIds ?? []).map((id) => resolveId(ctx, id)))];
  if (!layerIds.length && !patchIds.length) fail("nothing_selected", "Pick at least one layer or patch to turn into a component.", { hint: 'Pass "layerIds" and/or "patchIds".' });

  const locations = layerIds.map((id) => requireLayer(component, id));
  for (const id of patchIds) requirePatch(component, id);
  const selected = new Set(layerIds);
  const top = locations.filter((l) => !l.path.slice(0, -1).some((a) => selected.has(a))).sort((a, b) => a.index - b.index);
  if (new Set(top.map((l) => l.parent?.id ?? null)).size > 1) {
    fail("different_parents", `The layers ${top.map((l) => `"${l.layer.id}"`).join(", ")} sit in different groups, so one instance can't replace them.`, {
      hint: "Move them into the same group first, or make one component per group.",
    });
  }
  const parentId = top[0]?.parent?.id ?? null;
  const kind: ComponentKind = top.length ? "layerComponent" : "patchComponent";
  const movedLayers = new Set(top.flatMap((l) => allLayerIds([l.layer])));
  const movedPatches = new Set(patchIds);
  const isInside = (t: InputTarget) => (t.kind === "patch" ? movedPatches.has(t.id) : t.kind === "layer" ? movedLayers.has(t.id) : false);
  const isMovedSource = (a: ParsedAddress | undefined) => !!a && ((a.kind === "patch" && movedPatches.has(a.id)) || (a.kind === "layer" && movedLayers.has(a.id)));

  // Case-insensitive: "navBar" and "navbar" would be one components/*.json file on macOS and Windows.
  const newId = newComponentId(ctx, op.name);
  defineRef(ctx, op.ref, newId);
  const instanceId = newItemId(ctx, component, { name: op.name, fallback: "component", taken: componentItemIds(component) });
  const lenient = { registry: ctx.registry, lenient: true };
  const entries = listInputs(component);

  for (const e of entries) {
    if (isInside(e.target) || !isLayerInput(e.value) || !movedLayers.has(e.value.layer) || e.target.kind === "componentOutput") continue;
    if (e.target.kind === "patch") {
      fail("layer_ref_crosses_boundary", `Patch "${e.target.id}" points at layer "${e.value.layer}", which would move into the new component.`, {
        address: targetAddress(e.target),
        hint: `Include "${e.target.id}" in patchIds so it moves along with the layer.`,
        suggestions: [{ description: `Move "${e.target.id}" into the component too`, ops: [{ op: "createComponent", component: component.id, name: op.name, layerIds, patchIds: [...patchIds, e.target.id] }] }],
      });
    }
    fail("layer_ref_crosses_boundary", `Layer "${e.target.id}" points at layer "${e.value.layer}", which would move into the new component.`, {
      address: targetAddress(e.target),
      hint: "Include both layers in the component, or neither.",
    });
  }

  const usedIn = new Set<string>(kind === "layerComponent" ? (ctx.registry.layers.get(COMPONENT_INSTANCE_LAYER_TYPE)?.props.map((p) => p.key) ?? []) : []);
  const usedOut = new Set<string>();
  const freshKey = (base: string, used: Set<string>) => {
    const key = uniqueId(isValidId(base) ? base : "value", used);
    used.add(key);
    return key;
  };

  // Values flowing in from outside become published inputs.
  const published = new Map<string, { port: InterfacePort; value: InputValue }>();
  const inner = new Map<string, InputValue>();
  for (const e of entries) {
    if (!isInside(e.target)) continue;
    const outside = (isLinkInput(e.value) && !isMovedSource(parseAddress(e.value.link))) || (isLayerInput(e.value) && !movedLayers.has(e.value.layer));
    if (!outside) continue;
    const address = targetAddress(e.target);
    const sourceKey = isLinkInput(e.value) ? e.value.link : `layer:${(e.value as { layer: Id }).layer}`;
    let entry = published.get(sourceKey);
    if (!entry) {
      const target = resolveTarget(ctx.doc, component, address, lenient);
      const targetPort = target.ok ? target.value.port : undefined;
      let type: ValueType = isLayerInput(e.value) ? "layer" : (targetPort?.type ?? "any");
      if (type === "any" && isLinkInput(e.value)) {
        const src = resolveSource(ctx.doc, component, e.value.link, lenient);
        if (src.ok && src.value.port) type = src.value.port.type;
      }
      const key = freshKey(e.target.key, usedIn);
      entry = { port: { key, name: targetPort?.name ?? key, type }, value: e.value };
      published.set(sourceKey, entry);
    }
    inner.set(address, { link: `$in.${entry.port.key}` });
  }

  // Values read from outside become published outputs.
  const outputs = new Map<string, InterfacePort>();
  const outer: { target: InputTarget; value: InputValue }[] = [];
  for (const e of entries) {
    if (isInside(e.target) || !isLinkInput(e.value)) continue;
    const src = parseAddress(e.value.link);
    if (!src || !isMovedSource(src)) continue;
    let port = outputs.get(e.value.link);
    if (!port) {
      const s = resolveSource(ctx.doc, component, e.value.link, lenient);
      const sp = s.ok ? s.value.port : undefined;
      const key = freshKey(src.key, usedOut);
      port = { key, name: sp?.name ?? key, type: sp?.type ?? "any", link: e.value.link };
      outputs.set(e.value.link, port);
    }
    outer.push({ target: e.target, value: { link: kind === "layerComponent" ? `@${instanceId}.${port.key}` : `${instanceId}.${port.key}` } });
  }

  // Frame: when every selected layer has a literal frame, the component hugs their bounds.
  let origin: [number, number] | undefined;
  let size: [number, number] | undefined;
  const frames = new Map<Id, LiteralFrame>();
  if (kind === "layerComponent") {
    for (const l of top) {
      const f = literalFrame(ctx, component, l.layer);
      if (f) frames.set(l.layer.id, f);
    }
    if (frames.size === top.length) {
      const rects = [...frames.values()].map((f) => [f.position[0] - f.anchor[0] * f.size[0], f.position[1] - f.anchor[1] * f.size[1], f.size[0], f.size[1]] as const);
      const minX = Math.min(...rects.map((r) => r[0]));
      const minY = Math.min(...rects.map((r) => r[1]));
      const maxX = Math.max(...rects.map((r) => r[0] + r[2]));
      const maxY = Math.max(...rects.map((r) => r[1] + r[3]));
      origin = [roundNumber(minX), roundNumber(minY)];
      size = [roundNumber(Math.max(1, maxX - minX)), roundNumber(Math.max(1, maxY - minY))];
    } else {
      size = component.size ? [component.size[0], component.size[1]] : deviceScreenSize(ctx.doc.project.device);
    }
  }

  const rewriteLayer = (layer: LayerNode, isTop: boolean): LayerNode => {
    const props = { ...layer.props };
    for (const key of Object.keys(props)) {
      const v = inner.get(layerAddress(layer.id, key));
      if (v) props[key] = v;
    }
    const frame = frames.get(layer.id);
    if (isTop && origin && frame && (origin[0] !== 0 || origin[1] !== 0)) {
      props.position = [roundNumber(frame.position[0] - origin[0]), roundNumber(frame.position[1] - origin[1])];
    }
    const out: LayerNode = { ...layer, props };
    if (layer.children?.length) out.children = layer.children.map((c) => rewriteLayer(c, false));
    return out;
  };

  const patches: Record<Id, PatchNode> = {};
  for (const id of patchIds) {
    const node = component.patches[id]!;
    const inputs = { ...node.inputs };
    for (const key of Object.keys(inputs)) {
      const v = inner.get(`${id}.${key}`);
      if (v) inputs[key] = v;
    }
    patches[id] = { ...node, inputs };
  }

  const created: Component = {
    formatVersion: FORMAT_VERSION,
    id: newId,
    name: op.name,
    kind,
    interface: {
      inputs: Object.fromEntries([...published.values()].map((e) => [e.port.key, e.port])),
      outputs: Object.fromEntries([...outputs.values()].map((p) => [p.key, p])),
    },
    layers: top.map((l) => rewriteLayer(l.layer, true)),
    patches,
    comments: [],
  };
  if (size) created.size = size;

  let next: Component = component;
  for (const o of outer) next = writeInput(next, o.target, o.value);
  for (const l of top) next = { ...next, layers: removeLayerNode(next.layers, l.layer.id) };
  if (movedPatches.size) {
    const remaining = { ...next.patches };
    for (const id of movedPatches) delete remaining[id];
    next = { ...next, patches: remaining };
  }
  const instanceInputs: Record<string, InputValue> = Object.fromEntries([...published.values()].map((e) => [e.port.key, e.value]));
  if (kind === "layerComponent") {
    const props: Record<string, InputValue> = { ...instanceInputs };
    if (origin) props.position = [origin[0], origin[1]];
    if (size) props.size = [size[0], size[1]];
    const instance: LayerNode = { id: instanceId, type: COMPONENT_INSTANCE_LAYER_TYPE, name: op.name, component: newId, props };
    next = { ...next, layers: insertLayerNode(next.layers, parentId, top[0]!.index, instance) };
    ctx.affected.layers.add(instanceId);
  } else {
    const nodes = patchIds.map((id) => component.patches[id]!);
    const instance: PatchNode = {
      type: COMPONENT_PATCH_TYPE,
      name: op.name,
      component: newId,
      inputs: instanceInputs,
      ui: { x: Math.min(...nodes.map((n) => n.ui.x)), y: Math.min(...nodes.map((n) => n.ui.y)) },
    };
    next = { ...next, patches: { ...next.patches, [instanceId]: instance } };
    ctx.affected.patches.add(instanceId);
  }
  ctx.doc = { ...ctx.doc, components: { ...ctx.doc.components, [component.id]: next, [newId]: created } };
  ctx.affected.components.add(component.id);
  ctx.affected.components.add(newId);
  for (const id of movedLayers) ctx.affected.layers.add(id);
  for (const id of movedPatches) ctx.affected.patches.add(id);
  for (const o of outer) {
    if (o.target.kind === "patch") ctx.affected.patches.add(o.target.id);
    if (o.target.kind === "layer") ctx.affected.layers.add(o.target.id);
  }

  const adds: Op[] = [];
  const afters: Op[] = [];
  for (const l of top) {
    const r = restoreLayerOps(component.id, parentId, l.index, l.layer);
    adds.push(...r.add);
    afters.push(...r.after);
  }
  for (const id of patchIds) {
    const r = restorePatchOps(component.id, id, component.patches[id]!);
    adds.push(...r.add);
    afters.push(...r.after);
  }
  const restoreOuter: Op[] = outer.map((o) => ({ op: "setInput", component: component.id, target: targetAddress(o.target), value: readInput(component, o.target) ?? null }));
  const removeInstance: Op = kind === "layerComponent" ? { op: "removeLayer", component: component.id, id: instanceId } : { op: "removePatch", component: component.id, id: instanceId };
  return {
    ids: [newId, instanceId],
    applied: { op: "createComponent", component: component.id, name: op.name, layerIds, patchIds },
    inverse: [removeInstance, { op: "removeComponent", id: newId }, ...adds, ...afters, ...restoreOuter],
  };
}
