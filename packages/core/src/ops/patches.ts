/** addPatch, updatePatch, replacePatch, removePatch. */

import { parseAddress, patchAddress } from "../address.ts";
import { wouldCreateComponentCycle } from "../document.ts";
import { VARIABLE_BROADCASTER_TYPE } from "../graph.ts";
import { estimatePatchSize } from "../graph/placement.ts";
import { getOwn } from "../ids.ts";
import { COMPONENT_PATCH_TYPE, componentItemIds, findPort, getInputCountRange, getPatchSpec, resolveNodePorts, resolveNodeVariants } from "../registry.ts";
import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { Component, InputValue, Op, PatchNode, PatchSpec, ValueType } from "../types.ts";
import { followingReceivers, sameVariable, variableKey, type VariableKey } from "../variables.ts";
import { checkInputValue, resolveSource, resolveTarget } from "../validate.ts";
import { canConnect } from "../values.ts";
import {
  appliedOps,
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
import { linkSourceId, listInputs, referencesItems, removeInputs, restoreInputOps, restorePatchOps, targetAddress, writeInput, type InputEntry } from "./references.ts";

/** A typeParam checked against the node's allowed variants (the spec's, or those its dynamicPorts declare). */
function validateTypeParam(spec: PatchSpec, typeParam: unknown, variants: readonly ValueType[] | undefined): string {
  const allowed: string[] = [...(variants ?? [])];
  if (!allowed.length) fail("invalid_value", `The ${spec.name} patch has no type options, so "typeParam" doesn't apply.`, { hint: "Leave typeParam out." });
  if (typeof typeParam !== "string" || !allowed.includes(typeParam)) {
    fail("invalid_value", `The ${spec.name} patch can't be set to type "${String(typeParam)}".${didYouMeanText(didYouMean(String(typeParam), allowed))}`, { hint: `Its types: ${allowed.join(", ")}.` });
  }
  return typeParam;
}

/** An inputCount within the spec's variadic range or inputCountRange. */
function validateInputCount(spec: PatchSpec, inputCount: unknown): number {
  const range = getInputCountRange(spec);
  if (!range) fail("invalid_value", `The ${spec.name} patch has a fixed set of inputs, so "inputCount" doesn't apply.`, { hint: "Leave inputCount out." });
  if (typeof inputCount !== "number" || !Number.isInteger(inputCount) || inputCount < range.min || inputCount > range.max) {
    const what = spec.variadic ? `${spec.variadic.name.toLowerCase()} inputs` : "sets of inputs";
    fail("invalid_value", `The ${spec.name} patch takes between ${range.min} and ${range.max} ${what}, but inputCount is ${JSON.stringify(inputCount)}.`);
  }
  return inputCount;
}

/** A "component" patch points at an existing patch component that doesn't contain `host`. */
export function validatePatchComponent(ctx: OpContext, host: Component, id: string, node: PatchNode): void {
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
  const target = getOwn(ctx.doc.components, node.component);
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

function failUnknownType(ctx: OpContext, type: string): never {
  const specs = [...ctx.registry.patches.values()];
  return fail("unknown_patch_type", `There's no patch type "${type}".${didYouMeanText(didYouMean(type, specs.map((s) => ({ value: s.type, aliases: [s.name, ...(s.aliases ?? [])] }))))}`, {
    hint: "list_patch_types shows every patch type with a one-line summary.",
  });
}

/** A patch added without a position goes one column right of the rightmost patch, as wide as the editor draws it. */
function autoUi(ctx: OpContext, component: Component): { x: number; y: number } {
  const nodes = Object.values(component.patches);
  if (!nodes.length) return { x: 40, y: 40 };
  const right = nodes.reduce((a, b) => (b.ui.x > a.ui.x ? b : a));
  const width = estimatePatchSize(ctx.doc, ctx.registry, right, { component: component.id }).width;
  return { x: right.ui.x + width + 72, y: right.ui.y };
}

const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function addPatch(ctx: OpContext, op: OpOf<"addPatch">): OpOutcome {
  let component = getTargetComponent(ctx, op.component);
  const np = op.patch;
  if (!np || typeof np !== "object" || typeof np.type !== "string") fail("invalid_op", 'addPatch needs a patch, like { "type": "popAnimation" }.');
  const spec = getPatchSpec(ctx.registry, np.type);
  if (!spec && !ctx.lenient) failUnknownType(ctx, np.type);
  if (np.name !== undefined && typeof np.name !== "string") fail("invalid_value", "Patch names must be text.");
  const id = newItemId(ctx, component, { explicit: np.id, name: np.name, fallback: np.type, taken: componentItemIds(component) });
  defineRef(ctx, np.ref, id);

  let ui: { x: number; y: number };
  if (np.ui !== undefined) {
    if (!np.ui || !isFiniteNumber(np.ui.x) || !isFiniteNumber(np.ui.y)) fail("invalid_value", '"ui" must be { "x": number, "y": number }.');
    ui = { x: np.ui.x, y: np.ui.y };
  } else ui = autoUi(ctx, component);
  const node: PatchNode = { type: np.type, inputs: {}, ui };
  if (np.name) node.name = np.name;
  if (np.component !== undefined) node.component = resolveId(ctx, np.component);
  if (np.type === COMPONENT_PATCH_TYPE || node.component !== undefined) validatePatchComponent(ctx, component, id, node);
  if (np.settings !== undefined) {
    if (!np.settings || typeof np.settings !== "object" || Array.isArray(np.settings)) fail("invalid_value", '"settings" must be an object.');
    if (Object.keys(np.settings).length) node.settings = { ...np.settings };
  }
  if (spec && !ctx.lenient) {
    // Settings can change a node's variants (a script declaring its types), so check typeParam after them.
    const variants = resolveNodeVariants(ctx.doc, node, ctx.registry);
    if (np.typeParam !== undefined) node.typeParam = validateTypeParam(spec, np.typeParam, variants);
    else if (variants?.length) node.typeParam = variants[0];
    const range = getInputCountRange(spec);
    if (np.inputCount !== undefined) node.inputCount = validateInputCount(spec, np.inputCount);
    else if (range) node.inputCount = range.defaultCount;
  } else {
    if (np.typeParam !== undefined) node.typeParam = np.typeParam;
    if (np.inputCount !== undefined) node.inputCount = np.inputCount;
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

/**
 * After a typeParam/inputCount change: drop stored inputs and outgoing links that no longer fit —
 * ports that disappeared (expanded variadic keys, or ports the node had before the change) and
 * values or links whose types no longer match.
 */
function pruneAfterPortChange(ctx: OpContext, component: Component, id: string, original: PatchNode): { component: Component; removed: InputEntry[] } {
  const node = component.patches[id]!;
  const doc = withComponent(ctx.doc, component);
  const ports = resolveNodePorts(doc, node, ctx.registry);
  if (!ports) return { component, removed: [] };
  const before = resolveNodePorts(ctx.doc, original, ctx.registry);
  const hadInput = new Set(before?.inputs.map((p) => p.key) ?? []);
  const hadOutput = new Set(before?.outputs.map((p) => p.key) ?? []);
  const v = ports.spec.variadic;
  const variadicKey = v ? new RegExp(`^${v.key}(\\d+)$`) : undefined;
  const variadicOutputs = v?.direction === "outputs";
  return removeInputs(component, (entry) => {
    if (entry.target.kind === "patch" && entry.target.id === id) {
      const port = findPort(ports.inputs, entry.target.key);
      if (!port) return hadInput.has(entry.target.key) || (!variadicOutputs && !!variadicKey?.test(entry.target.key));
      const target = resolveTarget(doc, component, targetAddress(entry.target), ctx.validate);
      if (!target.ok) return false;
      const check = checkInputValue(doc, component, target.value, entry.value, ctx.validate);
      return !check.ok && (check.error.code === "invalid_value" || check.error.code === "type_mismatch");
    }
    if (linkSourceId(entry.value) !== id) return false;
    const link = (entry.value as { link: string }).link;
    const source = parseAddress(link);
    if (!source || source.kind !== "patch") return false;
    if (!findPort(ports.outputs, source.key)) return hadOutput.has(source.key) || (variadicOutputs && !!variadicKey?.test(source.key));
    const src = resolveSource(doc, component, link, ctx.validate);
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
  // Receivers follow a broadcaster whose name, scope, or type changes (catalog: Variable Broadcaster, Authoring).
  // Undo and redo replay explicit ops (lenient), so nothing cascades there.
  const following =
    !ctx.lenient && original.type === VARIABLE_BROADCASTER_TYPE && (op.settings?.name !== undefined || op.settings?.scope !== undefined || op.typeParam !== undefined)
      ? { before: variableKey(ctx.doc, original, ctx.registry), receivers: followingReceivers(ctx.doc, ctx.registry, component.id, id) }
      : null;

  if (op.name !== undefined) {
    if (op.name !== null && typeof op.name !== "string") fail("invalid_value", "Patch names must be text.");
    inverse.name = original.name ?? "";
    applied.name = op.name ?? "";
    if (isClear(op.name)) delete node.name;
    else node.name = op.name;
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
  if (op.typeParam !== undefined) {
    inverse.typeParam = original.typeParam ?? CLEAR;
    if (isClear(op.typeParam)) {
      delete node.typeParam;
      applied.typeParam = CLEAR;
    } else {
      // Checked against the node with this op's settings, which may declare its variants.
      node.typeParam = spec && !ctx.lenient ? validateTypeParam(spec, op.typeParam, resolveNodeVariants(ctx.doc, node, ctx.registry)) : op.typeParam;
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
  if (portsChanged && !ctx.lenient) ({ component, removed } = pruneAfterPortChange(ctx, component, id, original));
  commitComponent(ctx, component);
  ctx.affected.patches.add(id);
  for (const e of removed) {
    if (e.target.kind === "patch") ctx.affected.patches.add(e.target.id);
    if (e.target.kind === "layer") ctx.affected.layers.add(e.target.id);
  }
  // Lenient replays (redo) don't prune, so the drops are listed after the op.
  const clears: Op[] = removed.map((e) => ({ op: "setInput", component: component.id, target: targetAddress(e.target), value: null }));
  const outcome: OpOutcome = { ids: [id], applied: clears.length ? [applied, ...clears] : applied, inverse: [inverse, ...restoreInputOps(component.id, removed)] };
  return following?.receivers.length ? followBroadcaster(ctx, outcome, node, following.before, following.receivers) : outcome;
}

/** Update the receivers that read a broadcaster's variable to its new name, scope, and type, in the same batch. */
function followBroadcaster(ctx: OpContext, outcome: OpOutcome, node: PatchNode, before: VariableKey, receivers: readonly { componentId: string; id: string }[]): OpOutcome {
  const after = variableKey(ctx.doc, node, ctx.registry);
  // An emptied name reaches nobody; receivers keep theirs, so naming it back reconnects them.
  if (!after.name || sameVariable(after, before)) return outcome;
  const applied: Op[] = [...appliedOps(outcome)];
  const inverse: Op[] = [];
  for (const r of receivers) {
    const change: OpOf<"updatePatch"> = { op: "updatePatch", component: r.componentId, id: r.id };
    const settings: NonNullable<PatchNode["settings"]> = {};
    if (after.name !== before.name) settings.name = after.name;
    if (after.scope !== before.scope) settings.scope = after.scope === "global" ? "global" : (null as unknown as string);
    if (Object.keys(settings).length) change.settings = settings;
    if (after.type !== before.type) change.typeParam = node.typeParam ?? CLEAR;
    const result = updatePatch(ctx, change);
    applied.push(...appliedOps(result));
    inverse.unshift(...result.inverse);
  }
  return { ids: outcome.ids, applied, inverse: [...inverse, ...outcome.inverse] };
}

/** The fields replacePatch's "patch" takes, and hints for the ones people guess. */
const REPLACE_FIELDS = ["type", "typeParam", "inputCount", "settings", "component", "name"];
const REPLACE_HINTS: Record<string, string> = {
  id: 'replacePatch keeps the patch\'s id: name the patch beside "patch", like { "op": "replacePatch", "id": "spring", "patch": { "type": "classicAnimation" } }.',
  ref: "replacePatch keeps the patch's id, so there's no new item to give a ref.",
  inputs: "Values and cables that fit carry over by themselves. Set new ones with setInput in the same batch, or carry one to a renamed port with inputMap.",
  ui: "replacePatch keeps the patch's position. Move it with updatePatch.",
};

/** An inputMap or outputMap: old key → new key, each naming a port of its side. */
function checkPortMap(field: "inputMap" | "outputMap", raw: unknown, oldKeys: readonly string[] | null, newKeys: readonly string[] | null, newName: string): Record<string, string> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("invalid_value", `"${field}" must map old port keys to new ones, like { "number": "progress" }.`);
  const side = field === "inputMap" ? "input" : "output";
  for (const [from, to] of Object.entries(raw)) {
    if (typeof to !== "string") fail("invalid_value", `${field} must send "${from}" to a port key, but got ${JSON.stringify(to)}.`);
    if (oldKeys && !oldKeys.includes(from)) fail("unknown_port", `${field} names "${from}", but the patch has no ${side} "${from}".${didYouMeanText(didYouMean(from, oldKeys))}`, { hint: `Its ${side}s: ${oldKeys.join(", ") || "none"}.` });
    if (newKeys && !newKeys.includes(to)) fail("unknown_port", `${field} sends "${from}" to "${to}", but ${newName} has no ${side} "${to}".${didYouMeanText(didYouMean(to, newKeys))}`, { hint: `${newName} ${side}s: ${newKeys.join(", ") || "none"}.` });
  }
  return raw as Record<string, string>;
}

/**
 * Change a patch's type in place (the editor's Replace With). The node keeps its id, position, custom
 * name and bypass. Its values, the cables into it and the cables reading its outputs carry over when
 * the new type has a port with the same key (or the one inputMap / outputMap names) that they still
 * fit; the rest are dropped and reported. The inverse removes the patch and restores the old one with
 * every cable. `applied` clears the drops first, so a lenient redo lands on the same document.
 */
export function replacePatch(ctx: OpContext, op: OpOf<"replacePatch">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const id = resolveId(ctx, op.id);
  const original = requirePatch(component, id);
  const np = op.patch as Partial<OpOf<"replacePatch">["patch"]> | undefined;
  if (!np || typeof np !== "object" || Array.isArray(np) || typeof np.type !== "string") {
    fail("invalid_op", 'replacePatch needs the new type in "patch", like { "op": "replacePatch", "id": "spring", "patch": { "type": "classicAnimation" } }.');
  }
  if (!ctx.lenient) {
    for (const key of Object.keys(np)) {
      if (!REPLACE_FIELDS.includes(key)) fail("unknown_field", `replacePatch's "patch" has no field "${key}".${didYouMeanText(didYouMean(key, REPLACE_FIELDS))}`, { hint: REPLACE_HINTS[key] ?? `"patch" takes: ${REPLACE_FIELDS.join(", ")}.` });
    }
  }
  const spec = getPatchSpec(ctx.registry, np.type);
  if (!spec && !ctx.lenient) failUnknownType(ctx, np.type);
  const oldSpec = getPatchSpec(ctx.registry, original.type);
  const sameType = np.type === original.type;

  const node: PatchNode = { type: np.type, inputs: {}, ui: { ...original.ui } };
  if (original.muted) node.muted = true;
  if (np.name !== undefined) {
    if (typeof np.name !== "string") fail("invalid_value", "Patch names must be text.");
    if (np.name) node.name = np.name;
  } else if (original.name !== undefined && (sameType || original.name !== oldSpec?.name)) {
    // A name that only repeated the old type's name ("Pop Animation") would now mislabel the patch.
    node.name = original.name;
  }
  if (np.component !== undefined) node.component = resolveId(ctx, np.component);
  else if (sameType && original.component !== undefined) node.component = original.component;
  if (np.type === COMPONENT_PATCH_TYPE || node.component !== undefined) validatePatchComponent(ctx, component, id, node);
  const settings = np.settings !== undefined ? np.settings : sameType ? original.settings : undefined;
  if (settings !== undefined && settings !== null) {
    if (typeof settings !== "object" || Array.isArray(settings)) fail("invalid_value", '"settings" must be an object.');
    if (Object.keys(settings).length) node.settings = { ...settings };
  }
  if (spec && !ctx.lenient) {
    const variants = resolveNodeVariants(ctx.doc, node, ctx.registry);
    if (np.typeParam !== undefined) node.typeParam = validateTypeParam(spec, np.typeParam, variants);
    else if (variants?.length) node.typeParam = original.typeParam !== undefined && (variants as readonly string[]).includes(original.typeParam) ? original.typeParam : variants[0];
    const range = getInputCountRange(spec);
    if (np.inputCount !== undefined) node.inputCount = validateInputCount(spec, np.inputCount);
    else if (range) node.inputCount = Math.min(range.max, Math.max(range.min, original.inputCount ?? range.defaultCount));
    if (sameType && node.typeParam === original.typeParam && node.inputCount === original.inputCount && node.component === original.component && JSON.stringify(node.settings) === JSON.stringify(original.settings)) {
      fail("invalid_op", `"${id}" is already a ${spec.name}${original.typeParam ? ` (${original.typeParam})` : ""}, so there's nothing to replace.`, { hint: "To rename it or bypass it, use updatePatch." });
    }
  } else {
    if (np.typeParam !== undefined) node.typeParam = np.typeParam;
    if (np.inputCount !== undefined) node.inputCount = np.inputCount;
  }

  let next: Component = { ...component, patches: { ...component.patches, [id]: node } };
  const doc = withComponent(ctx.doc, next);
  const oldPorts = resolveNodePorts(ctx.doc, original, ctx.registry);
  const newPorts = resolveNodePorts(doc, node, ctx.registry);
  const newName = spec?.name ?? np.type;
  const strict = !ctx.lenient;
  const oldInputKeys = [...new Set([...(oldPorts?.inputs.map((p) => p.key) ?? []), ...Object.keys(original.inputs)])];
  const inputMap = checkPortMap("inputMap", op.inputMap, strict ? oldInputKeys : null, strict ? (newPorts?.inputs.map((p) => p.key) ?? []) : null, newName);
  const outputMap = checkPortMap("outputMap", op.outputMap, strict ? (oldPorts?.outputs.map((p) => p.key) ?? []) : null, strict ? (newPorts?.outputs.map((p) => p.key) ?? []) : null, newName);

  const dropped: InputEntry[] = [];
  /** `value` as `address` on the new node stores it, or undefined when that port is missing or doesn't take it. */
  const fit = (address: string, value: InputValue, hasPort: boolean): InputValue | undefined => {
    if (!hasPort) return undefined;
    if (!strict) return value;
    const target = resolveTarget(doc, next, address, ctx.validate);
    if (!target.ok) return undefined;
    const check = checkInputValue(doc, next, target.value, value, ctx.validate);
    return check.ok ? check.value : undefined;
  };
  // Mapped inputs first, so a value moved onto a port wins over one that already had its key.
  const inputs = Object.entries(original.inputs).sort(([a], [b]) => Number(Object.hasOwn(inputMap, b)) - Number(Object.hasOwn(inputMap, a)));
  for (const [key, value] of inputs) {
    const dest = inputMap[key] ?? key;
    const kept = Object.hasOwn(node.inputs, dest) ? undefined : fit(patchAddress(id, dest), value, !!findPort(newPorts?.inputs, dest));
    if (kept === undefined) dropped.push({ target: { kind: "patch", id, key }, value });
    else node.inputs[dest] = kept;
  }
  const outgoing = listInputs(component).filter((e) => !(e.target.kind === "patch" && e.target.id === id) && linkSourceId(e.value) === id);
  for (const e of outgoing) {
    const a = parseAddress((e.value as { link: string }).link);
    if (a?.kind !== "patch") continue;
    const dest = outputMap[a.key] ?? a.key;
    const kept = fit(targetAddress(e.target), { link: patchAddress(id, dest) }, !!findPort(newPorts?.outputs, dest));
    if (kept === undefined) dropped.push(e);
    next = writeInput(next, e.target, kept);
  }
  commitComponent(ctx, next);
  ctx.affected.patches.add(id);
  for (const e of outgoing) {
    if (e.target.kind === "patch") ctx.affected.patches.add(e.target.id);
    if (e.target.kind === "layer") ctx.affected.layers.add(e.target.id);
  }

  const applied: OpOf<"replacePatch"> = { op: "replacePatch", component: component.id, id, patch: { type: node.type, name: node.name ?? "", settings: node.settings ?? {} } };
  if (node.typeParam !== undefined) applied.patch.typeParam = node.typeParam;
  if (node.inputCount !== undefined) applied.patch.inputCount = node.inputCount;
  if (node.component !== undefined) applied.patch.component = node.component;
  if (Object.keys(inputMap).length) applied.inputMap = { ...inputMap };
  if (Object.keys(outputMap).length) applied.outputMap = { ...outputMap };
  const clears: Op[] = dropped.map((e) => ({ op: "setInput", component: component.id, target: targetAddress(e.target), value: null }));
  const restore = restorePatchOps(component.id, id, original);
  return {
    ids: [id],
    applied: [...clears, applied],
    inverse: [{ op: "removePatch", component: component.id, id }, ...restore.add, ...restore.after, ...restoreInputOps(component.id, outgoing)],
    dropped: dropped.map((e) => ({ to: targetAddress(e.target), value: e.value })),
  };
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
