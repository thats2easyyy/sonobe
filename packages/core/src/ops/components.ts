/** addComponent, removeComponent, updateComponent, updateInterface. */

import { layerAddress, parseAddress, patchAddress } from "../address.ts";
import { DEFAULT_LAYER_COMPONENT_SIZE, deviceScreenSize, findComponentInstances, FORMAT_VERSION } from "../document.ts";
import { fileNameCollision, getOwn, isFileNameTaken, isValidId, slugify, uniqueId } from "../ids.ts";
import { allLayers, COMPONENT_INSTANCE_LAYER_TYPE, COMPONENT_PATCH_TYPE, getPatchSpec, interfacePortToPort } from "../registry.ts";
import { parseComponentFile } from "../schema.ts";
import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { Component, Id, InputValue, InterfacePort, InterfacePortInput, LayerNode, Op, PatchNode } from "../types.ts";
import { checkInputValue, checkLink, checkLiteral, resolveTarget, type PortTarget } from "../validate.ts";
import { isLinkInput, isValueType, VALUE_TYPES } from "../values.ts";
import { CLEAR, defineRef, fail, getTargetComponent, isClear, noteRenamed, OpFailure, resolveAddress, resolveId, unwrap, withComponent, type OpContext, type OpOf, type OpOutcome } from "./context.ts";
import { validateInstance } from "./layers.ts";
import { validatePatchComponent } from "./patches.ts";
import { linkSourceId, removeInputs, restoreInputOps, targetAddress, type InputEntry } from "./references.ts";

const KINDS = ["prototype", "layerComponent", "patchComponent"];

function requireComponentById(ctx: OpContext, raw: unknown): Component {
  const id = resolveId(ctx, raw);
  const c = getOwn(ctx.doc.components, id);
  if (!c) fail("not_found", `There's no component "${id}".${didYouMeanText(didYouMean(id, Object.keys(ctx.doc.components)))}`);
  return c;
}

/** Run `check`, naming the new component in any failure. */
function inNewComponent<T>(id: Id, check: () => T): T {
  try {
    return check();
  } catch (err) {
    if (err instanceof OpFailure) throw new OpFailure({ ...err.error, message: `In the new component "${id}": ${err.error.message}` });
    throw err;
  }
}

/**
 * The checks addLayer, addPatch and updateInterface run, applied to a whole component's content:
 * known layer and patch types, existing ports, valid values and links, and instances of existing
 * components of the right kind that don't end up containing themselves. Links between items of the
 * new component resolve in any order. Returns the component with values normalized.
 */
function checkNewComponent(ctx: OpContext, component: Component): Component {
  const doc = withComponent(ctx.doc, component);
  const inner: OpContext = { ...ctx, doc };
  const checkValue = (address: string, value: InputValue): InputValue => {
    if (value === null) return null;
    const target = unwrap(resolveTarget(doc, component, address, ctx.validate));
    return unwrap(checkInputValue(doc, component, target, value, ctx.validate));
  };
  const checkLayer = (layer: LayerNode): LayerNode => {
    const spec = ctx.registry.layers.get(layer.type);
    if (!spec) {
      const types = [...ctx.registry.layers.values()];
      fail("unknown_layer_type", `Layer "${layer.id}" has an unknown type "${layer.type}".${didYouMeanText(didYouMean(layer.type, types.map((t) => ({ value: t.type, aliases: [t.name] }))))}`, {
        hint: `Layer types: ${types.map((t) => t.type).join(", ")}.`,
      });
    }
    if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE || layer.component !== undefined) validateInstance(inner, component, layer);
    const out: LayerNode = { ...layer, props: {} };
    for (const [key, value] of Object.entries(layer.props)) out.props[key] = checkValue(layerAddress(layer.id, key), value);
    if (layer.children?.length) {
      if (!spec.canHaveChildren) fail("cannot_have_children", `"${layer.id}" is a ${spec.name} layer, which can't hold other layers.`, { hint: "Put the layers in a Group instead." });
      out.children = layer.children.map(checkLayer);
    }
    return out;
  };
  return inNewComponent(component.id, () => {
    const layers = component.layers.map(checkLayer);
    const patches: Record<Id, PatchNode> = {};
    for (const [id, node] of Object.entries(component.patches)) {
      if (!getPatchSpec(ctx.registry, node.type)) {
        const specs = [...ctx.registry.patches.values()];
        fail("unknown_patch_type", `Patch "${id}" has an unknown type "${node.type}".${didYouMeanText(didYouMean(node.type, specs.map((s) => ({ value: s.type, aliases: [s.name, ...(s.aliases ?? [])] }))))}`, {
          hint: "list_patch_types shows every patch type with a one-line summary.",
        });
      }
      if (node.type === COMPONENT_PATCH_TYPE || node.component !== undefined) validatePatchComponent(inner, component, id, node);
      const inputs: Record<string, InputValue> = {};
      for (const [key, value] of Object.entries(node.inputs)) inputs[key] = checkValue(patchAddress(id, key), value);
      patches[id] = { ...node, inputs };
    }
    const inputs: Record<string, InterfacePort> = {};
    for (const [key, port] of Object.entries(component.interface.inputs)) {
      if (port.default === undefined) inputs[key] = port;
      else if (isLinkInput(port.default)) fail("invalid_value", `The default for "${key}" must be a value, not a connection.`);
      else inputs[key] = { ...port, default: unwrap(checkLiteral(doc, component, port.default, interfacePortToPort(port, "input"), `$in.${key}`, ctx.validate)) };
    }
    const outputs: Record<string, InterfacePort> = {};
    for (const [key, port] of Object.entries(component.interface.outputs)) {
      if (port.link === undefined) {
        outputs[key] = port;
        continue;
      }
      const target: PortTarget = { kind: "componentOutput", address: `$out.${key}`, key, port: interfacePortToPort(port, "output"), bindable: true };
      outputs[key] = { ...port, link: unwrap(checkLink(doc, component, port.link, target, ctx.validate)).link };
    }
    return { ...component, interface: { inputs, outputs }, layers, patches };
  });
}

/** A component id derived from a name: free ignoring case, and not retired this session. */
export function newComponentId(ctx: OpContext, name: string): Id {
  const componentIds = Object.keys(ctx.doc.components);
  const base = slugify(name, "component");
  const id = uniqueId(base, (x) => isFileNameTaken(componentIds, x) || ctx.retiredComponent(x));
  if (id !== base) noteRenamed(ctx, id, base, ctx.retiredComponent(base), false);
  return id;
}

export function addComponent(ctx: OpContext, op: OpOf<"addComponent">): OpOutcome {
  const c = op.component;
  if (!c || typeof c !== "object") fail("invalid_op", 'addComponent needs a component, like { "name": "Primary Button", "kind": "layerComponent" }.');
  if (typeof c.name !== "string" || !c.name.trim()) fail("invalid_value", "A component needs a name.");
  if (!KINDS.includes(c.kind)) fail("invalid_value", `A component's kind must be ${KINDS.join(", ")}, but got ${JSON.stringify(c.kind)}.${didYouMeanText(didYouMean(String(c.kind), KINDS))}`);
  if (c.kind === "patchComponent" && Array.isArray(c.layers) && c.layers.length > 0 && !ctx.lenient) {
    fail("wrong_component_kind", `"${c.name}" is a patch component, which holds only patches, so its layers would never be drawn.`, { hint: 'Use kind "layerComponent" for components with layers, or leave "layers" out.' });
  }
  if (c.formatVersion !== undefined && c.formatVersion !== FORMAT_VERSION && !ctx.lenient) {
    fail("invalid_op", `formatVersion can't be set with addComponent; it's managed by Sonobe (this version writes format ${FORMAT_VERSION}).`, { hint: 'Leave "formatVersion" out.' });
  }
  const componentIds = Object.keys(ctx.doc.components);
  let id: Id;
  if (c.id !== undefined) {
    if (!isValidId(c.id)) fail("invalid_id", `"${String(c.id)}" isn't a valid component id.`, { hint: `Try "${slugify(String(c.id), "component")}".` });
    if (Object.hasOwn(ctx.doc.components, c.id)) fail("id_taken", `There's already a component "${c.id}".`, { hint: 'Leave "id" out to get a free one. To replace it, remove it earlier in the same batch.' });
    const clash = ctx.lenient ? undefined : fileNameCollision(componentIds, c.id);
    if (clash !== undefined) {
      fail("id_taken", `"${c.id}" would share a file with the component "${clash}": on macOS and Windows, components/${c.id}.json and components/${clash}.json are the same file.`, {
        hint: 'Pick an id that differs by more than capitalization, or leave "id" out to get a free one.',
      });
    }
    if (ctx.retiredComponent(c.id)) {
      fail("id_retired", `"${c.id}" belonged to a component removed earlier in this session, so it isn't given to a new one.`, {
        hint: 'To rebuild a component under its old id, remove it and add the new one in the same batch (if the removal is already applied, undo it first). Or leave "id" out.',
      });
    }
    id = c.id;
  } else {
    id = newComponentId(ctx, c.name);
  }
  defineRef(ctx, op.ref, id);
  const full: Component = {
    // In-memory components are always at the current format (loads migrate), so this is never the caller's.
    formatVersion: FORMAT_VERSION,
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
  // Lenient applies (undo, redo) restore components exactly, diagnostics and all.
  const component = ctx.lenient ? parsed.value : checkNewComponent(ctx, parsed.value);
  ctx.doc = withComponent(ctx.doc, component);
  ctx.affected.components.add(id);
  return { ids: [id], applied: { op: "addComponent", component }, inverse: [{ op: "removeComponent", id }] };
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

/** The fields a published port takes. */
const PORT_FIELDS = ["key", "name", "type", "default", "category", "enumOptions", "loopBehavior", "link"];

/** The properties every layer component instance has on its own (position, opacity...), which win over published inputs with the same key. */
const instanceLayerProps = (ctx: OpContext) => ctx.registry.layers.get(COMPONENT_INSTANCE_LAYER_TYPE)?.props ?? [];

function validatePort(ctx: OpContext, component: Component, key: string, port: unknown, direction: "input" | "output", existing: InterfacePort | undefined): InterfacePort {
  if (!isValidId(key)) fail("invalid_id", `"${key}" isn't a valid port key.`, { hint: `Try "${slugify(key, "value")}".` });
  // An instance layer's own properties win over published inputs with the same key (input_shadowed_by_prop).
  const shadowing = direction === "input" && !existing && !ctx.lenient && component.kind === "layerComponent" ? ctx.registry.layers.get(COMPONENT_INSTANCE_LAYER_TYPE)?.props.find((q) => q.key === key) : undefined;
  if (shadowing) {
    fail("id_taken", `"${key}" can't be a published input of ${component.name}: every layer already has a ${shadowing.name} property with that key, so instances would set their own ${shadowing.name} and nothing would reach the input.`, {
      hint: `Pick another key, like "${key}Value".`,
    });
  }
  if (!port || typeof port !== "object" || Array.isArray(port)) fail("invalid_value", `The published ${direction} "${key}" must be an object like { "name": "Label", "type": "text" }.`);
  const p = port as Partial<InterfacePortInput>;
  for (const field of Object.keys(p)) {
    if (!PORT_FIELDS.includes(field)) fail("unknown_field", `The published ${direction} "${key}" has no field "${field}".${didYouMeanText(didYouMean(field, PORT_FIELDS))}`, { hint: `A port takes: ${PORT_FIELDS.join(", ")}.` });
  }
  if (p.key !== undefined && p.key !== key) {
    const renamed = isValidId(p.key) ? p.key : undefined;
    const side = direction === "input" ? "inputs" : "outputs";
    fail("invalid_value", `The published ${direction} "${key}" says its key is ${JSON.stringify(p.key)}. A port's key is the key it's listed under, and keys can't be renamed.`, {
      hint: renamed ? `To rename it, unpublish "${key}" (null) and publish "${renamed}"; cables to "${key}" are disconnected. Or leave "key" out.` : 'Leave "key" out: it defaults to the key the port is listed under.',
      ...(renamed ? { suggestions: [{ description: `Publish it as "${renamed}" and unpublish "${key}"`, ops: [{ op: "updateInterface", component: component.id, [side]: { [key]: null, [renamed]: { ...p, key: renamed } } } as Op] }] } : {}),
    });
  }
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
  if (direction === "input") {
    if (p.link !== undefined && p.link !== null) fail("invalid_value", `Published inputs can't have a link ("${key}").`, { hint: "Inside the component, read the input with { \"link\": \"$in." + key + "\" }." });
    return out;
  }
  // An output declared again without "link" keeps its cable; "link": null disconnects it.
  const kept = p.link === undefined ? existing?.link : undefined;
  const link = p.link ?? kept;
  if (link !== undefined) {
    const target: PortTarget = { kind: "componentOutput", address: `$out.${key}`, key, port: interfacePortToPort(out, "output"), bindable: true };
    const check = checkLink(ctx.doc, component, kept ?? resolveAddress(ctx, link), target, ctx.validate);
    if (!check.ok && kept !== undefined) {
      fail(check.error.code, `The published output "${key}" keeps its connection from ${kept}, which no longer fits: ${check.error.message}`, { hint: 'Pass "link": null to disconnect it, or give a new "link".' });
    }
    out.link = unwrap(check).link;
  }
  return out;
}

/** An output port with its link spelled out (null when it has none), since an output given without "link" keeps its cable. */
const explicitLink = (port: InterfacePort): InterfacePortInput => (port.link === undefined ? { ...port, link: null } : port);

/** The ports one side of updateInterface sets: as given, or with replace, also null for each current key it leaves out. */
function interfaceSide(given: unknown, current: Readonly<Record<string, InterfacePort>>, side: "inputs" | "outputs", replace: boolean): [string, unknown][] {
  if (!given || typeof given !== "object" || Array.isArray(given)) fail("invalid_op", `"${side}" must map port keys to ports (or null to remove).`, { hint: `Like { "${side}": { "label": { "name": "Label", "type": "text" }, "old": null } }.` });
  const entries = Object.entries(given);
  if (!replace) return entries;
  return [...Object.keys(current).filter((key) => !Object.hasOwn(given, key)).map((key): [string, unknown] => [key, null]), ...entries];
}

export function updateInterface(ctx: OpContext, op: OpOf<"updateInterface">): OpOutcome {
  let component = getTargetComponent(ctx, op.component);
  if (op.replace !== undefined && typeof op.replace !== "boolean") {
    fail("invalid_value", `"replace" must be true or false, but got ${JSON.stringify(op.replace)}.`, { hint: "replace: true makes each side you give (inputs, outputs) the whole set of ports; its keys you leave out are unpublished." });
  }
  const replace = op.replace === true;
  const before = component.interface;
  const inputs = { ...before.inputs };
  const outputs = { ...before.outputs };
  // `applied` and `inverse` are explicit (a null per unpublished key, no replace flag, every output's
  // link spelled out), so redo and undo don't depend on the document they land on.
  const inverse: OpOf<"updateInterface"> = { op: "updateInterface", component: component.id };
  const applied: OpOf<"updateInterface"> = { op: "updateInterface", component: component.id };
  const removedInputs: string[] = [];
  const removedOutputs: string[] = [];

  if (op.inputs !== undefined) {
    const given = interfaceSide(op.inputs, before.inputs, "inputs", replace);
    inverse.inputs = {};
    applied.inputs = {};
    for (const [key, port] of given) {
      inverse.inputs[key] = getOwn(inputs, key) ?? null;
      if (port === null) {
        if (getOwn(inputs, key)) removedInputs.push(key);
        delete inputs[key];
        applied.inputs[key] = null;
      } else {
        inputs[key] = applied.inputs[key] = validatePort(ctx, component, key, port, "input", getOwn(before.inputs, key));
      }
    }
    component = { ...component, interface: { inputs, outputs } };
  }
  if (op.outputs !== undefined) {
    const given = interfaceSide(op.outputs, before.outputs, "outputs", replace);
    inverse.outputs = {};
    applied.outputs = {};
    for (const [key, port] of given) {
      const current = getOwn(outputs, key);
      inverse.outputs[key] = current ? explicitLink(current) : null;
      if (port === null) {
        if (getOwn(outputs, key)) removedOutputs.push(key);
        delete outputs[key];
        applied.outputs[key] = null;
      } else {
        outputs[key] = validatePort(ctx, component, key, port, "output", getOwn(before.outputs, key));
        applied.outputs[key] = explicitLink(outputs[key]);
      }
    }
    component = { ...component, interface: { inputs, outputs } };
  }

  let doc = withComponent(ctx.doc, component);
  const restores: Op[] = [];
  const cleared: Op[] = [];
  const cascade = (componentId: Id, predicate: (e: InputEntry) => boolean, record = false) => {
    const { component: next, removed } = removeInputs(doc.components[componentId]!, predicate);
    if (!removed.length) return;
    doc = withComponent(doc, next);
    ctx.affected.components.add(componentId);
    restores.push(...restoreInputOps(componentId, removed));
    if (record) for (const e of removed) cleared.push({ op: "setInput", component: componentId, target: targetAddress(e.target), value: null });
  };
  // A layer instance's own properties (position, opacity...) share its prop namespace but aren't ports.
  const ownProps = new Set(instanceLayerProps(ctx).map((p) => p.key));
  const isPortKey = (inst: { kind: "layer" | "patch" }, key: string) => inst.kind !== "layer" || !ownProps.has(key);
  /** Cables and values stored on instances of this component (and its inner reads of `$in`) that name one of these keys. */
  const touches = (inputKeys: ReadonlySet<string>, outputKeys: ReadonlySet<string>) => {
    const inside = (e: InputEntry) => {
      if (!isLinkInput(e.value)) return false;
      const a = parseAddress(e.value.link);
      return a?.kind === "componentInput" && inputKeys.has(a.key);
    };
    const onInstance = (inst: { kind: "layer" | "patch"; id: Id }) => (e: InputEntry) => {
      if (e.target.kind === inst.kind && e.target.id === inst.id && inputKeys.has(e.target.key) && isPortKey(inst, e.target.key)) return true;
      if (linkSourceId(e.value) !== inst.id) return false;
      const a = parseAddress((e.value as { link: string }).link);
      if (!a || (a.kind !== "patch" && a.kind !== "layer") || !isPortKey(inst, a.key)) return false;
      // An output's value, or an input's read off a layer instance ("@chip_1.label") unless an output has that key.
      return outputKeys.has(a.key) || (inst.kind === "layer" && inputKeys.has(a.key) && !getOwn(outputs, a.key));
    };
    return { inside, onInstance };
  };
  if (removedInputs.length || removedOutputs.length) {
    const { inside, onInstance } = touches(new Set(removedInputs), new Set(removedOutputs));
    cascade(component.id, inside);
    for (const inst of findComponentInstances(doc, component.id)) cascade(inst.componentId, onInstance(inst));
  }
  // A port declared again, or newly, can change what fits: cables and instance values that fit before
  // and don't now (a new type, fewer options) are dropped like an unpublished port's, and the inverse
  // restores them. Lenient replays (undo, redo) skip this; `applied` lists the drops for redo.
  if (!ctx.lenient) {
    const declared = (side: Record<string, InterfacePortInput | null> | undefined) => new Set(Object.entries(side ?? {}).filter(([, port]) => port !== null).map(([key]) => key));
    const inputKeys = declared(applied.inputs);
    const outputKeys = declared(applied.outputs);
    if (inputKeys.size || outputKeys.size) {
      const { inside, onInstance } = touches(inputKeys, outputKeys);
      const fits = (d: typeof doc, hostId: Id, e: InputEntry) => {
        const host = d.components[hostId];
        const target = host && resolveTarget(d, host, targetAddress(e.target), ctx.validate);
        return !!target && target.ok && checkInputValue(d, host, target.value, e.value, ctx.validate).ok;
      };
      const broke = (hostId: Id, predicate: (e: InputEntry) => boolean) => (e: InputEntry) => predicate(e) && !fits(doc, hostId, e) && fits(ctx.doc, hostId, e);
      cascade(component.id, broke(component.id, inside), true);
      for (const inst of findComponentInstances(doc, component.id)) cascade(inst.componentId, broke(inst.componentId, onInstance(inst)), true);
    }
  }
  ctx.doc = doc;
  ctx.affected.components.add(component.id);
  return { ids: [component.id], applied: cleared.length ? [applied, ...cleared] : applied, inverse: [inverse, ...restores] };
}
