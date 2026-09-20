/** addLayer, updateLayer, moveLayer, removeLayer. */

import { layerAddress } from "../address.ts";
import { wouldCreateComponentCycle } from "../document.ts";
import { getOwn, slugify } from "../ids.ts";
import { allLayerIds, COMPONENT_INSTANCE_LAYER_TYPE, componentItemIds, findLayer, isDescendantLayer } from "../registry.ts";
import { layerTreeHeight, MAX_LAYER_DEPTH } from "../schema.ts";
import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { Component, Id, InputValue, LayerNode, NewLayer } from "../types.ts";
import { checkInputValue, resolveTarget } from "../validate.ts";
import { dropLayerNodePositions } from "./graphNodes.ts";
import {
  commitComponent,
  defineRef,
  fail,
  getTargetComponent,
  newItemId,
  requireLayer,
  resolveId,
  resolveIndex,
  resolveInputRefs,
  unwrap,
  withComponent,
  type OpContext,
  type OpOf,
  type OpOutcome,
} from "./context.ts";
import { referencesItems, removeInputs, restoreInputOps, restoreLayerOps } from "./references.ts";
import { insertLayerNode, mapLayer, removeLayerNode } from "./tree.ts";

function requireContainer(ctx: OpContext, layer: LayerNode): void {
  const spec = ctx.registry.layers.get(layer.type);
  if (spec && !spec.canHaveChildren && !ctx.lenient) {
    fail("cannot_have_children", `"${layer.id}" is a ${spec.name} layer, which can't hold other layers.`, { hint: "Put the layers in a Group instead." });
  }
}

const tooDeep = () =>
  fail("too_deep", `That would nest layers more than ${MAX_LAYER_DEPTH} levels deep, which Sonobe can't save or open.`, {
    hint: "Flatten some groups, or put these layers in a group closer to the top.",
  });

/** A componentInstance layer points at an existing layer component that doesn't contain `host`. */
export function validateInstance(ctx: OpContext, host: Component, node: LayerNode): void {
  if (node.type !== COMPONENT_INSTANCE_LAYER_TYPE) {
    if (ctx.lenient) return;
    fail("invalid_op", `Only componentInstance layers can point at a component ("${node.id}" is a ${node.type}).`, { hint: 'Leave out "component", or use type "componentInstance".' });
  }
  const layerComponents = Object.values(ctx.doc.components).filter((c) => c.kind === "layerComponent").map((c) => c.id);
  if (node.component === undefined) {
    if (ctx.lenient) return;
    fail("invalid_op", `The componentInstance layer "${node.id}" needs "component": the id of a layer component.`, {
      hint: layerComponents.length ? `Layer components: ${layerComponents.join(", ")}.` : "Create one first with addComponent or createComponent.",
    });
  }
  const target = getOwn(ctx.doc.components, node.component);
  if (!target) fail("not_found", `There's no component "${node.component}".${didYouMeanText(didYouMean(node.component, layerComponents))}`);
  if (target.kind !== "layerComponent" && !ctx.lenient) {
    fail("wrong_component_kind", `"${target.id}" is a ${target.kind}; layer instances render layer components.`, {
      hint: target.kind === "patchComponent" ? `Add it as a patch instead: addPatch with type "component" and component "${target.id}".` : "The root prototype can't be instantiated.",
    });
  }
  if (wouldCreateComponentCycle(ctx.doc, host.id, target.id)) {
    fail("component_cycle", `${host.id} can't contain an instance of "${target.id}", because "${target.id}" already contains ${host.id}.`, { hint: "Components can't contain themselves." });
  }
}

function defaultLayerName(ctx: OpContext, type: string, id: Id): string {
  const specName = ctx.registry.layers.get(type)?.name ?? type;
  const m = new RegExp(`^${slugify(specName)}_(\\d+)$`).exec(id);
  return m ? `${specName} ${m[1]}` : specName;
}

function toNewLayer(node: LayerNode): NewLayer {
  const out: NewLayer = { id: node.id, type: node.type, name: node.name, props: node.props };
  if (node.component !== undefined) out.component = node.component;
  if (node.children?.length) out.children = node.children.map(toNewLayer);
  return out;
}

export function addLayer(ctx: OpContext, op: OpOf<"addLayer">): OpOutcome {
  let component = getTargetComponent(ctx, op.component);
  if (component.kind === "patchComponent" && !ctx.lenient) {
    fail("wrong_component_kind", `"${component.name}" is a patch component, which holds only patches, so a layer there would never be drawn.`, {
      hint: "Add layers to a prototype or a layer component. To reuse layers, select them and choose Create Component.",
    });
  }
  const parentId = op.parent === undefined || op.parent === null ? null : resolveId(ctx, op.parent);
  let siblings: readonly LayerNode[] = component.layers;
  let parentDepth = 0;
  if (parentId !== null) {
    const loc = requireLayer(component, parentId);
    requireContainer(ctx, loc.layer);
    siblings = loc.layer.children ?? [];
    parentDepth = loc.path.length;
  }
  const index = resolveIndex(op.index, siblings.length);
  if (!op.layer || typeof op.layer !== "object") fail("invalid_op", "addLayer needs a layer, like { \"type\": \"rectangle\", \"name\": \"Card\" }.");
  if (!ctx.lenient && parentDepth + layerTreeHeight(op.layer) > MAX_LAYER_DEPTH) tooDeep();

  const taken = new Set(componentItemIds(component));
  const created: { node: LayerNode; props: Record<string, InputValue> | undefined }[] = [];
  const build = (nl: NewLayer): LayerNode => {
    if (!nl || typeof nl !== "object" || typeof nl.type !== "string") fail("invalid_op", 'Each new layer needs a "type", like "rectangle".');
    const spec = ctx.registry.layers.get(nl.type);
    if (!spec && !ctx.lenient) {
      const types = [...ctx.registry.layers.values()];
      fail("unknown_layer_type", `There's no layer type "${nl.type}".${didYouMeanText(didYouMean(nl.type, types.map((t) => ({ value: t.type, aliases: [t.name] }))))}`, {
        hint: `Layer types: ${types.map((t) => t.type).join(", ")}.`,
      });
    }
    if (nl.name !== undefined && (typeof nl.name !== "string" || !nl.name.trim())) fail("invalid_value", "Layer names can't be empty.");
    const id = newItemId(ctx, component, { explicit: nl.id, name: nl.name, fallback: nl.type, taken });
    taken.add(id);
    defineRef(ctx, nl.ref, id);
    const node: LayerNode = { id, type: nl.type, name: nl.name ?? defaultLayerName(ctx, nl.type, id), props: {} };
    if (nl.component !== undefined) node.component = resolveId(ctx, nl.component);
    if (nl.type === COMPONENT_INSTANCE_LAYER_TYPE || node.component !== undefined) validateInstance(ctx, component, node);
    if (nl.props !== undefined && (typeof nl.props !== "object" || nl.props === null || Array.isArray(nl.props))) fail("invalid_op", `"props" for "${id}" must be an object of property values.`);
    created.push({ node, props: nl.props });
    if (nl.children?.length) {
      if (spec && !spec.canHaveChildren && !ctx.lenient) fail("cannot_have_children", `"${id}" is a ${spec.name} layer, which can't hold other layers.`, { hint: "Use a Group as the parent." });
      node.children = nl.children.map(build);
    }
    return node;
  };
  const root = build(op.layer);

  component = { ...component, layers: insertLayerNode(component.layers, parentId, index, root) };
  const docWithSkeleton = withComponent(ctx.doc, component);
  for (const { node, props } of created) {
    for (const [key, raw] of Object.entries(props ?? {})) {
      const target = unwrap(resolveTarget(docWithSkeleton, component, layerAddress(node.id, key), ctx.validate));
      node.props[key] = raw === null ? null : unwrap(checkInputValue(docWithSkeleton, component, target, resolveInputRefs(ctx, raw), ctx.validate));
    }
  }
  commitComponent(ctx, component);
  const ids = allLayerIds([root]);
  for (const id of ids) ctx.affected.layers.add(id);
  return {
    ids,
    applied: { op: "addLayer", component: component.id, parent: parentId, index, layer: toNewLayer(root) },
    inverse: [{ op: "removeLayer", component: component.id, id: root.id }],
  };
}

export function updateLayer(ctx: OpContext, op: OpOf<"updateLayer">): OpOutcome {
  let component = getTargetComponent(ctx, op.component);
  const id = resolveId(ctx, op.id);
  const loc = requireLayer(component, id);
  const original = loc.layer;
  const layer: LayerNode = { ...original };
  const inverse: OpOf<"updateLayer"> = { op: "updateLayer", component: component.id, id };
  const applied: OpOf<"updateLayer"> = { op: "updateLayer", component: component.id, id };

  if (op.props !== undefined) {
    if (!op.props || typeof op.props !== "object" || Array.isArray(op.props)) fail("invalid_op", '"props" must be an object of property values (null resets one).');
    const props = { ...original.props };
    const invProps: Record<string, InputValue | null> = {};
    const appliedProps: Record<string, InputValue | null> = {};
    for (const [key, raw] of Object.entries(op.props)) {
      invProps[key] = original.props[key] === undefined ? null : original.props[key]!;
      if (raw === null) {
        delete props[key];
        appliedProps[key] = null;
        continue;
      }
      const target = unwrap(resolveTarget(ctx.doc, component, layerAddress(id, key), ctx.validate));
      const value = unwrap(checkInputValue(ctx.doc, component, target, resolveInputRefs(ctx, raw), ctx.validate));
      props[key] = value;
      appliedProps[key] = value;
    }
    layer.props = props;
    inverse.props = invProps;
    applied.props = appliedProps;
  }
  if (op.name !== undefined) {
    if (typeof op.name !== "string" || !op.name.trim()) fail("invalid_value", "Layer names can't be empty.");
    inverse.name = original.name;
    applied.name = op.name;
    layer.name = op.name;
  }
  for (const flag of ["locked", "collapsed"] as const) {
    const v = op[flag];
    if (v === undefined) continue;
    inverse[flag] = !!original[flag];
    applied[flag] = !!v;
    if (v) layer[flag] = true;
    else delete layer[flag];
  }
  component = { ...component, layers: mapLayer(component.layers, id, () => layer) };
  commitComponent(ctx, component);
  ctx.affected.layers.add(id);
  return { ids: [id], applied, inverse: [inverse] };
}

export function moveLayer(ctx: OpContext, op: OpOf<"moveLayer">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const id = resolveId(ctx, op.id);
  const loc = requireLayer(component, id);
  const oldParent = loc.parent?.id ?? null;
  const parentId = op.parent === undefined ? oldParent : op.parent === null ? null : resolveId(ctx, op.parent);
  if (parentId !== null) {
    if (parentId === id || isDescendantLayer(component.layers, id, parentId)) {
      fail("cycle", `Can't move "${id}" into ${parentId === id ? "itself" : `its own child "${parentId}"`}.`, { hint: "Pick a parent outside this layer." });
    }
    const parent = requireLayer(component, parentId);
    requireContainer(ctx, parent.layer);
    if (!ctx.lenient && parent.path.length + layerTreeHeight(loc.layer) > MAX_LAYER_DEPTH) tooDeep();
  }
  let layers = removeLayerNode(component.layers, id);
  const siblings = parentId === null ? layers : (findLayer(layers, parentId)!.layer.children ?? []);
  const index = resolveIndex(op.index, siblings.length);
  layers = insertLayerNode(layers, parentId, index, loc.layer);
  commitComponent(ctx, { ...component, layers });
  ctx.affected.layers.add(id);
  return {
    ids: [id],
    applied: { op: "moveLayer", component: component.id, id, parent: parentId, index },
    inverse: [{ op: "moveLayer", component: component.id, id, parent: oldParent, index: loc.index }],
  };
}

export function removeLayer(ctx: OpContext, op: OpOf<"removeLayer">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const id = resolveId(ctx, op.id);
  const loc = requireLayer(component, id);
  const subtree = new Set(allLayerIds([loc.layer]));
  const { component: unlinked, removed } = removeInputs({ ...component, layers: removeLayerNode(component.layers, id) }, (e) => referencesItems(e.value, subtree));
  // Saved graph positions go too, so a new layer that gets the same id starts from automatic placement.
  const { component: next, restore: positions } = dropLayerNodePositions(unlinked, subtree);
  commitComponent(ctx, next);
  for (const l of subtree) ctx.affected.layers.add(l);
  for (const e of removed) {
    if (e.target.kind === "patch") ctx.affected.patches.add(e.target.id);
    if (e.target.kind === "layer") ctx.affected.layers.add(e.target.id);
  }
  const restore = restoreLayerOps(component.id, loc.parent?.id ?? null, loc.index, loc.layer);
  return {
    ids: [...subtree],
    applied: { op: "removeLayer", component: component.id, id },
    inverse: [...restore.add, ...restore.after, ...restoreInputOps(component.id, removed), ...(positions ? [{ op: "setNodePositions" as const, component: component.id, positions }] : [])],
  };
}
