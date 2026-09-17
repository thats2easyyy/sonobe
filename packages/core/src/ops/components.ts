/** addComponent, removeComponent, updateComponent, updateInterface. */

import { parseAddress } from "../address.ts";
import { DEFAULT_LAYER_COMPONENT_SIZE, deviceScreenSize, findComponentInstances, FORMAT_VERSION, listComponentIds } from "../document.ts";
import { isValidId, slugify, uniqueId } from "../ids.ts";
import { allLayers, COMPONENT_INSTANCE_LAYER_TYPE, COMPONENT_PATCH_TYPE, interfacePortToPort } from "../registry.ts";
import { parseComponentFile } from "../schema.ts";
import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { Component, Id, InterfacePort, Op } from "../types.ts";
import { checkLink, checkLiteral, type PortTarget } from "../validate.ts";
import { isLinkInput, isValueType, VALUE_TYPES } from "../values.ts";
import { CLEAR, defineRef, fail, getTargetComponent, isClear, resolveAddress, resolveId, unwrap, withComponent, type OpContext, type OpOf, type OpOutcome } from "./context.ts";
import { linkSourceId, removeInputs, restoreInputOps, type InputEntry } from "./references.ts";

const KINDS = ["prototype", "layerComponent", "patchComponent"];

function requireComponentById(ctx: OpContext, raw: unknown): Component {
  const id = resolveId(ctx, raw);
  const c = ctx.doc.components[id];
  if (!c) fail("not_found", `There's no component "${id}".${didYouMeanText(didYouMean(id, Object.keys(ctx.doc.components)))}`);
  return c;
}

export function addComponent(ctx: OpContext, op: OpOf<"addComponent">): OpOutcome {
  const c = op.component;
  if (!c || typeof c !== "object") fail("invalid_op", 'addComponent needs a component, like { "name": "Primary Button", "kind": "layerComponent" }.');
  if (typeof c.name !== "string" || !c.name.trim()) fail("invalid_value", "A component needs a name.");
  if (!KINDS.includes(c.kind)) fail("invalid_value", `A component's kind must be ${KINDS.join(", ")}, but got ${JSON.stringify(c.kind)}.${didYouMeanText(didYouMean(String(c.kind), KINDS))}`);
  let id: Id;
  if (c.id !== undefined) {
    if (!isValidId(c.id)) fail("invalid_id", `"${String(c.id)}" isn't a valid component id.`, { hint: `Try "${slugify(String(c.id), "component")}".` });
    if (ctx.doc.components[c.id]) fail("id_taken", `There's already a component "${c.id}".`, { hint: 'Leave "id" out to get a free one.' });
    id = c.id;
  } else {
    id = uniqueId(slugify(c.name, "component"), (x) => x in ctx.doc.components || ctx.reserved.has(x));
  }
  defineRef(ctx, op.ref, id);
  const full: Component = {
    formatVersion: c.formatVersion ?? FORMAT_VERSION,
    id,
    name: c.name,
    kind: c.kind,
    interface: c.interface ?? { inputs: {}, outputs: {} },
    layers: c.layers ?? [],
    patches: c.patches ?? {},
    comments: c.comments ?? [],
  };
  if (c.notes) full.notes = c.notes;
  if (c.size !== undefined) full.size = c.size;
  else if (c.kind === "prototype") full.size = deviceScreenSize(ctx.doc.project.device);
  else if (c.kind === "layerComponent") full.size = [...DEFAULT_LAYER_COMPONENT_SIZE];
  if (c.meta !== undefined) full.meta = c.meta;
  const parsed = parseComponentFile(full, `component "${id}"`);
  if (!parsed.ok) fail("invalid_value", `The component "${id}" has problems:\n${parsed.message}`, { hint: "Fix the fields listed above, or leave layers/patches out and add them with ops." });
  const seen = new Set<Id>();
  const dupes = new Set<Id>();
  for (const itemId of [...allLayers(parsed.value.layers).map((l) => l.id), ...Object.keys(parsed.value.patches), ...parsed.value.comments.map((x) => x.id)]) {
    if (seen.has(itemId)) dupes.add(itemId);
    seen.add(itemId);
  }
  if (dupes.size) fail("id_taken", `The component "${id}" uses these ids more than once: ${[...dupes].join(", ")}.`, { hint: "Ids are unique across layers, patches and comments." });
  ctx.doc = withComponent(ctx.doc, parsed.value);
  ctx.affected.components.add(id);
  return { ids: [id], applied: { op: "addComponent", component: parsed.value }, inverse: [{ op: "removeComponent", id }] };
}

export function removeComponent(ctx: OpContext, op: OpOf<"removeComponent">): OpOutcome {
  const component = requireComponentById(ctx, op.id);
  if (component.id === ctx.doc.project.root) fail("invalid_op", `"${component.id}" is the root prototype, so it can't be removed.`, { hint: "Make another prototype the root with setProject first." });
  const instances = findComponentInstances(ctx.doc, component.id).filter((i) => i.componentId !== component.id);
  if (instances.length) {
    const removeOps: Op[] = instances.map((i) => (i.kind === "layer" ? { op: "removeLayer", component: i.componentId, id: i.id } : { op: "removePatch", component: i.componentId, id: i.id }));
    fail("component_in_use", `"${component.id}" is still used by ${instances.map((i) => `${i.componentId}/${i.id}`).join(", ")}.`, {
      hint: "Remove its instances first.",
      suggestions: [{ description: "Remove the instances, then the component", ops: [...removeOps, { op: "removeComponent", id: component.id }] }],
    });
  }
  const components = { ...ctx.doc.components };
  delete components[component.id];
  ctx.doc = { ...ctx.doc, components };
  ctx.affected.components.add(component.id);
  return { ids: [component.id], applied: { op: "removeComponent", id: component.id }, inverse: [{ op: "addComponent", component }] };
}

/** Plain JSON data a component file can store: null, booleans, finite numbers, text, arrays and plain objects. */
function isJsonData(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonData(item, depth + 1));
  if (typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.values(value).every((item) => isJsonData(item, depth + 1));
}

export function updateComponent(ctx: OpContext, op: OpOf<"updateComponent">): OpOutcome {
  const component = requireComponentById(ctx, op.id);
  const next: Component = { ...component };
  const inverse: OpOf<"updateComponent"> = { op: "updateComponent", id: component.id };
  const applied: OpOf<"updateComponent"> = { op: "updateComponent", id: component.id };
  if (op.name !== undefined) {
    if (typeof op.name !== "string" || !op.name.trim()) fail("invalid_value", "Component names can't be empty.");
    inverse.name = component.name;
    next.name = applied.name = op.name;
  }
  if (op.notes !== undefined) {
    inverse.notes = component.notes ?? "";
    applied.notes = op.notes ?? "";
    if (isClear(op.notes)) delete next.notes;
    else if (typeof op.notes !== "string") fail("invalid_value", "Notes must be text.");
    else next.notes = op.notes;
  }
  if (op.size !== undefined) {
    inverse.size = component.size ?? CLEAR;
    if (op.size === null) {
      delete next.size;
      applied.size = CLEAR;
    } else {
      const s = op.size;
      if (!Array.isArray(s) || s.length !== 2 || !s.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) fail("invalid_value", '"size" must be [width, height] with positive numbers.');
      next.size = applied.size = [s[0], s[1]];
    }
  }
  if (op.meta !== undefined) {
    // Merge key by key: a null value removes the key; other values replace the key whole.
    // The inverse restores every touched key (or removes meta again when there was none).
    const before = component.meta;
    if (op.meta === null) {
      inverse.meta = before === undefined ? CLEAR : { ...before };
      applied.meta = CLEAR;
      delete next.meta;
    } else {
      if (typeof op.meta !== "object" || Array.isArray(op.meta)) {
        fail("invalid_value", '"meta" must be an object like { "patchEditor": { … } }, or null to remove all metadata.', { hint: "Keys set to null are removed; other keys are replaced whole." });
      }
      const merged: Record<string, unknown> = { ...(before ?? {}) };
      const restore: Record<string, unknown> = {};
      const changes: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(op.meta)) {
        if (value === undefined) continue;
        if (!isJsonData(value)) fail("invalid_value", `meta.${key} must be plain JSON data: text, finite numbers, true/false, null, lists and objects.`);
        restore[key] = before !== undefined && Object.hasOwn(before, key) ? before[key] : null;
        changes[key] = value;
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      inverse.meta = before === undefined ? CLEAR : restore;
      applied.meta = changes;
      if (before === undefined && !Object.keys(merged).length) delete next.meta;
      else next.meta = merged;
    }
  }
  ctx.doc = withComponent(ctx.doc, next);
  ctx.affected.components.add(component.id);
  return { ids: [component.id], applied, inverse: [inverse] };
}

function validatePort(ctx: OpContext, component: Component, key: string, port: unknown, direction: "input" | "output"): InterfacePort {
  if (!isValidId(key)) fail("invalid_id", `"${key}" isn't a valid port key.`, { hint: `Try "${slugify(key, "value")}".` });
  if (!port || typeof port !== "object" || Array.isArray(port)) fail("invalid_value", `The published ${direction} "${key}" must be an object like { "name": "Label", "type": "text" }.`);
  const p = port as Partial<InterfacePort>;
  if (!isValueType(p.type)) fail("invalid_value", `The published ${direction} "${key}" has an unknown type ${JSON.stringify(p.type)}.${didYouMeanText(didYouMean(String(p.type), VALUE_TYPES))}`);
  if (p.name !== undefined && typeof p.name !== "string") fail("invalid_value", `The published ${direction} "${key}" needs a text name.`);
  const out: InterfacePort = { key, name: p.name ?? key, type: p.type };
  if (p.category !== undefined) out.category = String(p.category);
  if (p.enumOptions !== undefined) {
    if (!Array.isArray(p.enumOptions) || !p.enumOptions.every((o) => typeof o === "string")) fail("invalid_value", `enumOptions for "${key}" must be a list of option keys.`);
    out.enumOptions = [...p.enumOptions];
  }
  if (p.loopBehavior !== undefined) {
    if (p.loopBehavior !== "loop" && p.loopBehavior !== "pass") fail("invalid_value", `loopBehavior for "${key}" must be "loop" or "pass".`);
    out.loopBehavior = p.loopBehavior;
  }
  if (p.default !== undefined) {
    if (isLinkInput(p.default)) fail("invalid_value", `The default for "${key}" must be a value, not a connection.`);
    out.default = unwrap(checkLiteral(ctx.doc, component, p.default, interfacePortToPort(out, direction), `${direction === "input" ? "$in" : "$out"}.${key}`, ctx.validate));
  }
  if (p.link !== undefined) {
    if (direction === "input") fail("invalid_value", `Published inputs can't have a link ("${key}").`, { hint: "Inside the component, read the input with { \"link\": \"$in." + key + "\" }." });
    const target: PortTarget = { kind: "componentOutput", address: `$out.${key}`, key, port: interfacePortToPort(out, "output"), bindable: true };
    out.link = unwrap(checkLink(ctx.doc, component, resolveAddress(ctx, p.link), target, ctx.validate)).link;
  }
  return out;
}

export function updateInterface(ctx: OpContext, op: OpOf<"updateInterface">): OpOutcome {
  let component = getTargetComponent(ctx, op.component);
  const inputs = { ...component.interface.inputs };
  const outputs = { ...component.interface.outputs };
  const inverse: OpOf<"updateInterface"> = { op: "updateInterface", component: component.id };
  const applied: OpOf<"updateInterface"> = { op: "updateInterface", component: component.id };
  const removedInputs: string[] = [];
  const removedOutputs: string[] = [];

  if (op.inputs !== undefined) {
    if (!op.inputs || typeof op.inputs !== "object") fail("invalid_op", '"inputs" must map port keys to ports (or null to remove).');
    inverse.inputs = {};
    applied.inputs = {};
    for (const [key, port] of Object.entries(op.inputs)) {
      inverse.inputs[key] = inputs[key] ?? null;
      if (port === null) {
        if (inputs[key]) removedInputs.push(key);
        delete inputs[key];
        applied.inputs[key] = null;
      } else {
        inputs[key] = applied.inputs[key] = validatePort(ctx, component, key, port, "input");
      }
    }
    component = { ...component, interface: { inputs, outputs } };
  }
  if (op.outputs !== undefined) {
    if (!op.outputs || typeof op.outputs !== "object") fail("invalid_op", '"outputs" must map port keys to ports (or null to remove).');
    inverse.outputs = {};
    applied.outputs = {};
    for (const [key, port] of Object.entries(op.outputs)) {
      inverse.outputs[key] = outputs[key] ?? null;
      if (port === null) {
        if (outputs[key]) removedOutputs.push(key);
        delete outputs[key];
        applied.outputs[key] = null;
      } else {
        outputs[key] = applied.outputs[key] = validatePort(ctx, component, key, port, "output");
      }
    }
    component = { ...component, interface: { inputs, outputs } };
  }

  let doc = withComponent(ctx.doc, component);
  const restores: Op[] = [];
  const cascade = (componentId: Id, predicate: (e: InputEntry) => boolean) => {
    const { component: next, removed } = removeInputs(doc.components[componentId]!, predicate);
    if (!removed.length) return;
    doc = withComponent(doc, next);
    ctx.affected.components.add(componentId);
    restores.push(...restoreInputOps(componentId, removed));
  };
  if (removedInputs.length) {
    const keys = new Set(removedInputs);
    cascade(component.id, (e) => {
      if (!isLinkInput(e.value)) return false;
      const a = parseAddress(e.value.link);
      return a?.kind === "componentInput" && keys.has(a.key);
    });
    for (const inst of findComponentInstances(doc, component.id)) {
      cascade(inst.componentId, (e) => e.target.kind === inst.kind && e.target.id === inst.id && keys.has(e.target.key));
    }
  }
  if (removedOutputs.length) {
    const keys = new Set(removedOutputs);
    for (const hostId of listComponentIds(doc)) {
      const host = doc.components[hostId]!;
      const instanceIds = new Set<Id>([
        ...allLayers(host.layers).filter((l) => l.type === COMPONENT_INSTANCE_LAYER_TYPE && l.component === component.id).map((l) => l.id),
        ...Object.entries(host.patches).filter(([, p]) => p.type === COMPONENT_PATCH_TYPE && p.component === component.id).map(([id]) => id),
      ]);
      if (!instanceIds.size) continue;
      cascade(hostId, (e) => {
        const source = linkSourceId(e.value);
        if (source === undefined || !instanceIds.has(source)) return false;
        const a = parseAddress((e.value as { link: string }).link);
        return !!a && keys.has(a.key);
      });
    }
  }
  ctx.doc = doc;
  ctx.affected.components.add(component.id);
  return { ids: [component.id], applied, inverse: [inverse, ...restores] };
}
