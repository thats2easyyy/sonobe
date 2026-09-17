/** addPatch, updatePatch, removePatch. */

import { patchAddress } from "../address.ts";
import { wouldCreateComponentCycle } from "../document.ts";
import { COMPONENT_PATCH_TYPE, componentItemIds, findPort, getPatchSpec, resolveNodePorts } from "../registry.ts";
import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { Component, PatchNode, PatchSpec } from "../types.ts";
import { checkInputValue, resolveSource, resolveTarget } from "../validate.ts";
import { canConnect } from "../values.ts";
import {
  CLEAR,
  commitComponent,
  defineRef,
  fail,
  getTargetComponent,
  isClear,
  newItemId,
  requirePatch,
  resolveId,
  resolveInputRefs,
  unwrap,
  withComponent,
  type OpContext,
  type OpOf,
  type OpOutcome,
} from "./context.ts";
import { linkSourceId, referencesItems, removeInputs, restoreInputOps, restorePatchOps, targetAddress, type InputEntry } from "./references.ts";

function validateTypeParam(spec: PatchSpec, typeParam: unknown): string {
  const variants = spec.variants ?? [];
  if (!variants.length) fail("invalid_value", `The ${spec.name} patch has no type options, so "typeParam" doesn't apply.`, { hint: "Leave typeParam out." });
  if (typeof typeParam !== "string" || !(variants as string[]).includes(typeParam)) {
    fail("invalid_value", `The ${spec.name} patch can't be set to type "${String(typeParam)}".${didYouMeanText(didYouMean(String(typeParam), variants))}`, { hint: `Its types: ${variants.join(", ")}.` });
  }
  return typeParam;
}

function validateInputCount(spec: PatchSpec, inputCount: unknown): number {
  const v = spec.variadic;
  if (!v) fail("invalid_value", `The ${spec.name} patch has a fixed set of inputs, so "inputCount" doesn't apply.`, { hint: "Leave inputCount out." });
  if (typeof inputCount !== "number" || !Number.isInteger(inputCount) || inputCount < v.min || inputCount > v.max) {
    fail("invalid_value", `The ${spec.name} patch takes between ${v.min} and ${v.max} ${v.name.toLowerCase()} inputs, but inputCount is ${JSON.stringify(inputCount)}.`);
  }
  return inputCount;
}

function validatePatchComponent(ctx: OpContext, host: Component, id: string, node: PatchNode): void {
  if (node.type !== COMPONENT_PATCH_TYPE) {
    if (ctx.lenient) return;
    fail("invalid_op", `Only patches of type "component" can point at a component ("${id}" is a ${node.type}).`, { hint: 'Leave out "component", or use type "component".' });
  }
  const patchComponents = Object.values(ctx.doc.components).filter((c) => c.kind === "patchComponent").map((c) => c.id);
  if (node.component === undefined) {
    if (ctx.lenient) return;
    fail("invalid_op", `The component patch "${id}" needs "component": the id of a patch component.`, {
      hint: patchComponents.length ? `Patch components: ${patchComponents.join(", ")}.` : "Create one first with addComponent or createComponent.",
    });
  }
  const target = ctx.doc.components[node.component];
  if (!target) fail("not_found", `There's no component "${node.component}".${didYouMeanText(didYouMean(node.component, patchComponents))}`);
  if (target.kind !== "patchComponent" && !ctx.lenient) {
    fail("wrong_component_kind", `"${target.id}" is a ${target.kind}; component patches run patch components.`, {
      hint: target.kind === "layerComponent" ? `Add it as a layer instead: addLayer with type "componentInstance" and component "${target.id}".` : "The root prototype can't be instantiated.",
    });
  }
  if (wouldCreateComponentCycle(ctx.doc, host.id, target.id)) {
    fail("component_cycle", `${host.id} can't contain an instance of "${target.id}", because "${target.id}" already contains ${host.id}.`, { hint: "Components can't contain themselves." });
  }
}

function autoUi(component: Component): { x: number; y: number } {
  const nodes = Object.values(component.patches);
  if (!nodes.length) return { x: 40, y: 40 };
  const right = nodes.reduce((a, b) => (b.ui.x > a.ui.x ? b : a));
  return { x: right.ui.x + 200, y: right.ui.y };
}

const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function addPatch(ctx: OpContext, op: OpOf<"addPatch">): OpOutcome {
  let component = getTargetComponent(ctx, op.component);
  const np = op.patch;
  if (!np || typeof np !== "object" || typeof np.type !== "string") fail("invalid_op", 'addPatch needs a patch, like { "type": "popAnimation" }.');
  const spec = getPatchSpec(ctx.registry, np.type);
  if (!spec && !ctx.lenient) {
    const specs = [...ctx.registry.patches.values()];
    fail("unknown_patch_type", `There's no patch type "${np.type}".${didYouMeanText(didYouMean(np.type, specs.map((s) => ({ value: s.type, aliases: [s.name, ...(s.aliases ?? [])] }))))}`, {
      hint: "list_patch_types shows every patch type with a one-line summary.",
    });
  }
  if (np.name !== undefined && typeof np.name !== "string") fail("invalid_value", "Patch names must be text.");
  const id = newItemId(ctx, component, { explicit: np.id, name: np.name, fallback: np.type, taken: componentItemIds(component) });
  defineRef(ctx, np.ref, id);

  let ui = autoUi(component);
  if (np.ui !== undefined) {
    if (!np.ui || !isFiniteNumber(np.ui.x) || !isFiniteNumber(np.ui.y)) fail("invalid_value", '"ui" must be { "x": number, "y": number }.');
    ui = { x: np.ui.x, y: np.ui.y };
  }
  const node: PatchNode = { type: np.type, inputs: {}, ui };
  if (np.name) node.name = np.name;
  if (np.component !== undefined) node.component = resolveId(ctx, np.component);
  if (np.type === COMPONENT_PATCH_TYPE || node.component !== undefined) validatePatchComponent(ctx, component, id, node);
  if (spec && !ctx.lenient) {
    if (np.typeParam !== undefined) node.typeParam = validateTypeParam(spec, np.typeParam);
    else if (spec.variants?.length) node.typeParam = spec.variants[0];
    if (np.inputCount !== undefined) node.inputCount = validateInputCount(spec, np.inputCount);
    else if (spec.variadic) node.inputCount = spec.variadic.defaultCount;
  } else {
    if (np.typeParam !== undefined) node.typeParam = np.typeParam;
    if (np.inputCount !== undefined) node.inputCount = np.inputCount;
  }
  if (np.settings !== undefined) {
    if (!np.settings || typeof np.settings !== "object" || Array.isArray(np.settings)) fail("invalid_value", '"settings" must be an object.');
    if (Object.keys(np.settings).length) node.settings = { ...np.settings };
  }
  if (np.inputs !== undefined && (!np.inputs || typeof np.inputs !== "object" || Array.isArray(np.inputs))) fail("invalid_op", '"inputs" must be an object of input values.');

  component = { ...component, patches: { ...component.patches, [id]: node } };
  const doc = withComponent(ctx.doc, component);
  for (const [key, raw] of Object.entries(np.inputs ?? {})) {
    const target = unwrap(resolveTarget(doc, component, patchAddress(id, key), ctx.validate));
    node.inputs[key] = raw === null ? null : unwrap(checkInputValue(doc, component, target, resolveInputRefs(ctx, raw), ctx.validate));
  }
  commitComponent(ctx, component);
  ctx.affected.patches.add(id);

  const applied: OpOf<"addPatch"> = { op: "addPatch", component: component.id, patch: { id, type: node.type, inputs: node.inputs, ui: { x: ui.x, y: ui.y } } };
  if (node.name !== undefined) applied.patch.name = node.name;
  if (node.typeParam !== undefined) applied.patch.typeParam = node.typeParam;
  if (node.inputCount !== undefined) applied.patch.inputCount = node.inputCount;
  if (node.settings !== undefined) applied.patch.settings = node.settings;
  if (node.component !== undefined) applied.patch.component = node.component;
  return { ids: [id], applied, inverse: [{ op: "removePatch", component: component.id, id }] };
}

/** After a typeParam/inputCount change: drop inputs and outgoing links that no longer fit. */
function pruneAfterPortChange(ctx: OpContext, component: Component, id: string): { component: Component; removed: InputEntry[] } {
  const node = component.patches[id]!;
  const doc = withComponent(ctx.doc, component);
  const ports = resolveNodePorts(doc, node, ctx.registry);
  if (!ports) return { component, removed: [] };
  const variadicKey = ports.spec.variadic ? new RegExp(`^${ports.spec.variadic.key}(\\d+)$`) : undefined;
  return removeInputs(component, (entry) => {
    if (entry.target.kind === "patch" && entry.target.id === id) {
      const port = findPort(ports.inputs, entry.target.key);
      if (!port) return !!variadicKey?.test(entry.target.key);
      const target = resolveTarget(doc, component, targetAddress(entry.target), ctx.validate);
      if (!target.ok) return false;
      const check = checkInputValue(doc, component, target.value, entry.value, ctx.validate);
      return !check.ok && (check.error.code === "invalid_value" || check.error.code === "type_mismatch");
    }
    if (linkSourceId(entry.value) !== id) return false;
    const src = resolveSource(doc, component, (entry.value as { link: string }).link, ctx.validate);
    const target = resolveTarget(doc, component, targetAddress(entry.target), ctx.validate);
    if (!src.ok || !target.ok || !src.value.port || !target.value.port) return false;
    return !canConnect(src.value.port.type, target.value.port.type).ok;
  });
}

export function updatePatch(ctx: OpContext, op: OpOf<"updatePatch">): OpOutcome {
  let component = getTargetComponent(ctx, op.component);
  const id = resolveId(ctx, op.id);
  const original = requirePatch(component, id);
  const spec = getPatchSpec(ctx.registry, original.type);
  const node: PatchNode = { ...original, ui: { ...original.ui } };
  const inverse: OpOf<"updatePatch"> = { op: "updatePatch", component: component.id, id };
  const applied: OpOf<"updatePatch"> = { op: "updatePatch", component: component.id, id };
  let portsChanged = false;

  if (op.name !== undefined) {
    if (op.name !== null && typeof op.name !== "string") fail("invalid_value", "Patch names must be text.");
    inverse.name = original.name ?? "";
    applied.name = op.name ?? "";
    if (isClear(op.name)) delete node.name;
    else node.name = op.name;
  }
  if (op.typeParam !== undefined) {
    inverse.typeParam = original.typeParam ?? CLEAR;
    if (isClear(op.typeParam)) {
      delete node.typeParam;
      applied.typeParam = CLEAR;
    } else {
      node.typeParam = spec && !ctx.lenient ? validateTypeParam(spec, op.typeParam) : op.typeParam;
      applied.typeParam = node.typeParam;
    }
    portsChanged ||= node.typeParam !== original.typeParam;
  }
  if (op.inputCount !== undefined) {
    inverse.inputCount = original.inputCount ?? CLEAR;
    if (op.inputCount === null) {
      delete node.inputCount;
      applied.inputCount = CLEAR;
    } else {
      node.inputCount = spec && !ctx.lenient ? validateInputCount(spec, op.inputCount) : op.inputCount;
      applied.inputCount = node.inputCount;
    }
    portsChanged ||= node.inputCount !== original.inputCount;
  }
  if (op.muted !== undefined) {
    inverse.muted = !!original.muted;
    applied.muted = !!op.muted;
    if (op.muted) node.muted = true;
    else delete node.muted;
  }
  if (op.settings !== undefined && op.settings !== null) {
    if (typeof op.settings !== "object" || Array.isArray(op.settings)) fail("invalid_value", '"settings" must be an object (a null value removes a setting).');
    const settings = { ...(original.settings ?? {}) };
    const inv: NonNullable<PatchNode["settings"]> = {};
    for (const [key, value] of Object.entries(op.settings)) {
      inv[key] = key in settings ? settings[key]! : null;
      if (value === null) delete settings[key];
      else settings[key] = value;
    }
    if (Object.keys(settings).length) node.settings = settings;
    else delete node.settings;
    inverse.settings = inv;
    applied.settings = op.settings;
  }
  if (op.ui !== undefined) {
    if (!op.ui || typeof op.ui !== "object") fail("invalid_value", '"ui" must be an object like { "x": 120, "y": 40 }.');
    const invUi: NonNullable<OpOf<"updatePatch">["ui"]> = {};
    for (const axis of ["x", "y"] as const) {
      const v = op.ui[axis];
      if (v === undefined) continue;
      if (!isFiniteNumber(v)) fail("invalid_value", `ui.${axis} must be a number.`);
      invUi[axis] = original.ui[axis];
      node.ui[axis] = v;
    }
    if (op.ui.collapsed !== undefined) {
      invUi.collapsed = !!original.ui.collapsed;
      if (op.ui.collapsed) node.ui.collapsed = true;
      else delete node.ui.collapsed;
    }
    if (op.ui.color !== undefined) {
      invUi.color = original.ui.color ?? "";
      if (isClear(op.ui.color)) delete node.ui.color;
      else if (typeof op.ui.color !== "string") fail("invalid_value", "ui.color must be text.");
      else node.ui.color = op.ui.color;
    }
    inverse.ui = invUi;
    applied.ui = op.ui;
  }

  component = { ...component, patches: { ...component.patches, [id]: node } };
  let removed: InputEntry[] = [];
  if (portsChanged && !ctx.lenient) ({ component, removed } = pruneAfterPortChange(ctx, component, id));
  commitComponent(ctx, component);
  ctx.affected.patches.add(id);
  for (const e of removed) {
    if (e.target.kind === "patch") ctx.affected.patches.add(e.target.id);
    if (e.target.kind === "layer") ctx.affected.layers.add(e.target.id);
  }
  return { ids: [id], applied, inverse: [inverse, ...restoreInputOps(component.id, removed)] };
}

export function removePatch(ctx: OpContext, op: OpOf<"removePatch">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const id = resolveId(ctx, op.id);
  const node = requirePatch(component, id);
  const patches = { ...component.patches };
  delete patches[id];
  const { component: next, removed } = removeInputs({ ...component, patches }, (e) => referencesItems(e.value, new Set([id])));
  commitComponent(ctx, next);
  ctx.affected.patches.add(id);
  for (const e of removed) {
    if (e.target.kind === "patch") ctx.affected.patches.add(e.target.id);
    if (e.target.kind === "layer") ctx.affected.layers.add(e.target.id);
  }
  const restore = restorePatchOps(component.id, id, node);
  return {
    ids: [id],
    applied: { op: "removePatch", component: component.id, id },
    inverse: [...restore.add, ...restore.after, ...restoreInputOps(component.id, removed)],
  };
}
