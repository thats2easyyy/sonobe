/**
 * Op builders for patch editor edits: insert, duplicate with inputs, replace with another type
 * (the core replacePatch op), splice into a cable, align, move, comment around a selection, and history labels.
 */

import {
  canConnect,
  getPatchSpec,
  patchDisplayName,
  isLinkInput,
  listInputs,
  parseAddress,
  resolveInputCount,
  resolveNodePorts,
  resolveTypeParam,
  targetAddress,
  typeLabel,
  type Component,
  type Id,
  type InputValue,
  type NewPatch,
  type Op,
  type OpOf,
  type PatchNode,
  type PatchSpec,
  type Registry,
  type ResolvedPort,
  type SonobeDocument,
  type ValueType,
} from "@sonobe/core";
import { COMMENT_PADDING, boundsOf, type Rect } from "./geometry.ts";
import { portTypeAt } from "./connect.ts";

/** A patch's display name: its custom name, a variable's name, else its type's name. */
export function patchTitle(node: (Pick<PatchNode, "name" | "type"> & { settings?: PatchNode["settings"] }) | undefined, spec?: PatchSpec): string {
  if (!node) return "patch";
  return patchDisplayName(node, spec);
}

/** "Zoom Spring" for one patch, "3 patches" for several. */
export function patchesLabel(component: Component, ids: readonly Id[], registry: Registry): string {
  if (ids.length === 1) {
    const node = component.patches[ids[0]!];
    return patchTitle(node, node ? getPatchSpec(registry, node.type) : undefined);
  }
  return `${ids.length} patches`;
}

/** The name for a port address in labels ("Zoom Spring · Number"). */
export function portLabel(doc: SonobeDocument, componentId: Id, registry: Registry, address: string): string {
  const component = doc.components[componentId];
  const a = parseAddress(address);
  if (!component || !a) return address;
  if (a.kind === "patch") {
    const node = component.patches[a.id];
    const spec = node ? getPatchSpec(registry, node.type) : undefined;
    const ports = node ? resolveNodePorts(doc, node, registry) : undefined;
    const port = ports?.inputs.find((p) => p.key === a.key) ?? ports?.outputs.find((p) => p.key === a.key);
    return `${patchTitle(node, spec)} · ${port?.name ?? a.key}`;
  }
  if (a.kind === "layer") {
    const layer = findLayerName(component, a.id);
    const prop = registry.layers.get(findLayerType(component, a.id) ?? "")?.props.find((p) => p.key === a.key);
    return `${layer ?? a.id} · ${prop?.name ?? a.key}`;
  }
  return a.kind === "componentInput" ? `Input ${a.key}` : `Output ${a.key}`;
}

function findLayerName(component: Component, id: Id): string | undefined {
  let name: string | undefined;
  const visit = (layers: Component["layers"]) => {
    for (const l of layers) {
      if (l.id === id) name = l.name;
      else if (l.children) visit(l.children);
      if (name) return;
    }
  };
  visit(component.layers);
  return name;
}

function findLayerType(component: Component, id: Id): string | undefined {
  let type: string | undefined;
  const visit = (layers: Component["layers"]) => {
    for (const l of layers) {
      if (l.id === id) type = l.type;
      else if (l.children) visit(l.children);
      if (type) return;
    }
  };
  visit(component.layers);
  return type;
}

export interface InsertOptions {
  typeParam?: ValueType;
  inputCount?: number;
  /** Component patches: the patch component to run. */
  component?: Id;
  name?: string;
  settings?: PatchNode["settings"];
  /** Batch ref for the new patch. Default "inserted". */
  ref?: string;
}

/** Add a patch at a position (top-left, rounded). */
export function insertPatchOps(componentId: Id, type: string, position: { x: number; y: number }, options: InsertOptions = {}): Op[] {
  const patch: NewPatch = { ref: options.ref ?? "inserted", type, ui: { x: Math.round(position.x), y: Math.round(position.y) } };
  if (options.typeParam) patch.typeParam = options.typeParam;
  if (options.inputCount !== undefined) patch.inputCount = options.inputCount;
  if (options.component !== undefined) patch.component = options.component;
  if (options.name) patch.name = options.name;
  if (options.settings && Object.keys(options.settings).length) patch.settings = options.settings;
  return [{ op: "addPatch", component: componentId, patch }];
}

export interface DuplicatePlan {
  ops: Op[];
  /** Original patch id → batch ref of its copy. */
  refs: Map<Id, string>;
}

/**
 * Copy patches with their input values. Connections from outside the copied set are kept (the copies
 * are driven by the same outputs); links between copied patches point at the copies.
 */
export function duplicatePatchOps(component: Component, ids: readonly Id[], positions: ReadonlyMap<Id, { x: number; y: number }>): DuplicatePlan {
  const set = ids.filter((id) => component.patches[id]);
  const refs = new Map(set.map((id) => [id, `dup_${id}`]));
  const ops: Op[] = [];
  const later: Op[] = [];
  for (const id of set) {
    const node = component.patches[id]!;
    const ref = refs.get(id)!;
    const pos = positions.get(id) ?? { x: node.ui.x + 24, y: node.ui.y + 24 };
    const inputs: Record<string, InputValue> = {};
    for (const [key, value] of Object.entries(node.inputs)) {
      if (!isLinkInput(value)) {
        inputs[key] = value;
        continue;
      }
      const a = parseAddress(value.link);
      const link = a?.kind === "patch" && refs.has(a.id) ? `$${refs.get(a.id)}.${a.key}` : value.link;
      later.push({ op: "setInput", component: component.id, target: `$${ref}.${key}`, value: { link } });
    }
    const patch: NewPatch = { ref, type: node.type, inputs, ui: { x: Math.round(pos.x), y: Math.round(pos.y) } };
    if (node.name !== undefined) patch.name = node.name;
    if (node.typeParam !== undefined) patch.typeParam = node.typeParam;
    if (node.inputCount !== undefined) patch.inputCount = node.inputCount;
    if (node.settings !== undefined) patch.settings = node.settings;
    if (node.component !== undefined) patch.component = node.component;
    ops.push({ op: "addPatch", component: component.id, patch });
    if (node.muted || node.ui.collapsed) {
      later.push({ op: "updatePatch", component: component.id, id: `$${ref}`, ...(node.muted ? { muted: true } : {}), ...(node.ui.collapsed ? { ui: { collapsed: true } } : {}) });
    }
  }
  return { ops: [...ops, ...later], refs };
}

function pickPort(ports: readonly ResolvedPort[], accepts: (p: ResolvedPort) => boolean, preferType: ValueType | undefined, taken: ReadonlySet<string> = new Set()): ResolvedPort | undefined {
  const candidates = ports.filter((p) => !taken.has(p.key) && accepts(p));
  return candidates.find((p) => p.type === preferType) ?? candidates.find((p) => p.type !== "any") ?? candidates[0];
}

/**
 * The replacePatch op for Replace With: the core op keeps the id, position, name, and every value
 * and cable that still fits a port with the same key. A cable whose key the new type lacks (or
 * doesn't fit) moves to the closest port that takes it, through inputMap and outputMap.
 */
export function replacePatchOp(doc: SonobeDocument, componentId: Id, registry: Registry, patchId: Id, newType: string, componentTarget?: Id): { op: OpOf<"replacePatch"> } | { error: string } {
  const component = doc.components[componentId];
  const old = component?.patches[patchId];
  const spec = getPatchSpec(registry, newType);
  if (!component || !old) return { error: "That patch no longer exists." };
  if (!spec) return { error: `There's no patch type "${newType}".` };
  const oldPorts = resolveNodePorts(doc, old, registry);
  const typeParam = spec.variants?.length ? resolveTypeParam(spec, old.typeParam) : undefined;
  const inputCount = spec.variadic ? resolveInputCount(spec, old.inputCount) : undefined;
  const virtual: PatchNode = { type: newType, inputs: {}, ui: { ...old.ui } };
  if (typeParam) virtual.typeParam = typeParam;
  if (inputCount !== undefined) virtual.inputCount = inputCount;
  if (componentTarget) virtual.component = componentTarget;
  const newPorts = resolveNodePorts(doc, virtual, registry);
  if (!newPorts) return { error: `"${spec.name}" can't be placed here.` };

  const op: OpOf<"replacePatch"> = { op: "replacePatch", component: componentId, id: patchId, patch: { type: newType } };
  if (componentTarget) op.patch.component = componentTarget;
  const inputMap: Record<string, string> = {};
  const usedInputs = new Set<string>();
  const links: [string, string][] = [];
  for (const [key, value] of Object.entries(old.inputs)) {
    if (isLinkInput(value)) links.push([key, value.link]);
    else if (newPorts.inputs.some((p) => p.key === key)) usedInputs.add(key);
  }
  for (const [key, link] of links) {
    const fromType = portTypeAt(doc, componentId, registry, link, "out") ?? "any";
    const same = newPorts.inputs.find((p) => p.key === key && canConnect(fromType, p.type).ok && !usedInputs.has(p.key));
    const oldPort = oldPorts?.inputs.find((p) => p.key === key);
    const target = same ?? pickPort(newPorts.inputs, (p) => canConnect(fromType, p.type).ok && p.type !== "layer", oldPort?.type ?? fromType, usedInputs);
    if (!target) continue;
    usedInputs.add(target.key);
    if (target.key !== key) inputMap[key] = target.key;
  }
  const outputMap: Record<string, string> = {};
  for (const entry of listInputs(component)) {
    if (!isLinkInput(entry.value)) continue;
    const a = parseAddress(entry.value.link);
    if (a?.kind !== "patch" || a.id !== patchId || Object.hasOwn(outputMap, a.key)) continue;
    if (entry.target.kind === "patch" && entry.target.id === patchId) continue;
    const toType = portTypeAt(doc, componentId, registry, targetAddress(entry.target), "in") ?? "any";
    if (newPorts.outputs.some((p) => p.key === a.key && canConnect(p.type, toType).ok)) continue;
    const oldOut = oldPorts?.outputs.find((p) => p.key === a.key);
    const out = pickPort(newPorts.outputs, (p) => canConnect(p.type, toType).ok, oldOut?.type ?? toType);
    if (out) outputMap[a.key] = out.key;
  }
  if (Object.keys(inputMap).length) op.inputMap = inputMap;
  if (Object.keys(outputMap).length) op.outputMap = outputMap;
  return { op };
}

export interface SplicePlan {
  ops: Op[];
  inputKey: string;
  outputKey: string;
}

/** One way to splice a patch into a cable: which input takes the cable and which output drives on. */
export interface SpliceOption {
  inputKey: string;
  inputName: string;
  inputType: ValueType;
  outputKey: string;
  outputName: string;
  outputType: ValueType;
  /** Implicit conversions on the two new cables ("on = 1, off = 0"). */
  conversions: string[];
  /** Lower is a better fit. */
  score: number;
}

interface SpliceContext {
  title: string;
  fromType: ValueType;
  toType: ValueType;
  inputs: ResolvedPort[];
  outputs: ResolvedPort[];
  connected: ReadonlySet<string>;
}

function spliceContext(doc: SonobeDocument, componentId: Id, registry: Registry, patchId: Id, cable: { from: string; to: string }): SpliceContext | { error: string } {
  const component = doc.components[componentId];
  const node = component?.patches[patchId];
  if (!component || !node) return { error: "That patch no longer exists." };
  const from = parseAddress(cable.from);
  const to = parseAddress(cable.to);
  if ((from?.kind === "patch" && from.id === patchId) || (to?.kind === "patch" && to.id === patchId)) return { error: "A patch can't be spliced into its own cable." };
  const ports = resolveNodePorts(doc, node, registry);
  const fromType = portTypeAt(doc, componentId, registry, cable.from, "out");
  const toType = portTypeAt(doc, componentId, registry, cable.to, "in");
  if (!ports || !fromType || !toType) return { error: "That cable no longer exists." };
  const connected = new Set(Object.entries(node.inputs).filter(([, v]) => isLinkInput(v)).map(([k]) => k));
  const title = patchTitle(node, ports.spec);
  const accepting = ports.inputs.filter((p) => canConnect(fromType, p.type).ok && p.type !== "layer");
  const free = accepting.filter((p) => !connected.has(p.key));
  const inputs = free.length ? free : accepting;
  const outputs = ports.outputs.filter((p) => canConnect(p.type, toType).ok);
  if (!inputs.length) return { error: `${title} has no input that takes ${typeLabel(fromType)}.` };
  if (!outputs.length) return { error: `${title} has no output that drives ${typeLabel(toType)}.` };
  return { title, fromType, toType, inputs, outputs, connected };
}

/**
 * Every input × output pair that can splice a patch into a cable, best fit first: exact types, then
 * ports that aren't "any", then declaration order. Several options mean the editor should ask.
 */
export function spliceOptions(doc: SonobeDocument, componentId: Id, registry: Registry, patchId: Id, cable: { from: string; to: string }, limit = 12): SpliceOption[] | { error: string } {
  const ctx = spliceContext(doc, componentId, registry, patchId, cable);
  if ("error" in ctx) return ctx;
  const options: SpliceOption[] = [];
  ctx.inputs.forEach((input, i) => {
    const inCheck = canConnect(ctx.fromType, input.type);
    ctx.outputs.forEach((output, j) => {
      const outCheck = canConnect(output.type, ctx.toType);
      const fit = (a: ValueType, b: ValueType) => (a === b ? 0 : b === "any" || a === "any" ? 2 : 1);
      options.push({
        inputKey: input.key,
        inputName: input.name,
        inputType: input.type,
        outputKey: output.key,
        outputName: output.name,
        outputType: output.type,
        conversions: [inCheck.conversion, outCheck.conversion].filter((c): c is string => !!c),
        score: (fit(ctx.fromType, input.type) + fit(output.type, ctx.toType)) * 10 + i + j * 0.5 + (ctx.connected.has(input.key) ? 50 : 0),
      });
    });
  });
  return options.sort((a, b) => a.score - b.score).slice(0, limit);
}

/** Put a patch between the two ends of a cable, through the given ports or the best fit. */
export function splicePatchOps(doc: SonobeDocument, componentId: Id, registry: Registry, patchId: Id, cable: { from: string; to: string }, choice?: { inputKey: string; outputKey: string }): SplicePlan | { error: string } {
  const ctx = spliceContext(doc, componentId, registry, patchId, cable);
  if ("error" in ctx) return ctx;
  const input = choice ? ctx.inputs.find((p) => p.key === choice.inputKey) : pickPort(ctx.inputs, () => true, ctx.fromType);
  const output = choice ? ctx.outputs.find((p) => p.key === choice.outputKey) : pickPort(ctx.outputs, () => true, ctx.toType);
  if (!input) return { error: `${ctx.title} can't take this cable on that input.` };
  if (!output) return { error: `${ctx.title} can't drive this cable from that output.` };
  return {
    inputKey: input.key,
    outputKey: output.key,
    ops: [
      { op: "connect", component: componentId, from: cable.from, to: `${patchId}.${input.key}` },
      { op: "connect", component: componentId, from: `${patchId}.${output.key}`, to: cable.to },
    ],
  };
}

export type AlignMode = "left" | "right" | "top" | "bottom";

/**
 * Align rects on an edge: left or right edges make a column (overlaps spread downward), top or
 * bottom edges make a row (overlaps spread to the right).
 */
export function alignPositions(rects: readonly (Rect & { id: string })[], mode: AlignMode, gap = mode === "left" || mode === "right" ? 16 : 24): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (rects.length === 0) return out;
  if (mode === "left" || mode === "right") {
    const left = Math.min(...rects.map((r) => r.x));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    let bottom = -Infinity;
    for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const y = Math.max(r.y, bottom + gap);
      out.set(r.id, { x: Math.round(mode === "left" ? left : right - r.width), y: Math.round(y) });
      bottom = y + r.height;
    }
  } else {
    const top = Math.min(...rects.map((r) => r.y));
    const bottomEdge = Math.max(...rects.map((r) => r.y + r.height));
    let right = -Infinity;
    for (const r of [...rects].sort((a, b) => a.x - b.x || a.y - b.y)) {
      const x = Math.max(r.x, right + gap);
      out.set(r.id, { x: Math.round(x), y: Math.round(mode === "top" ? top : bottomEdge - r.height) });
      right = x + r.width;
    }
  }
  return out;
}

/** "left", "to top"… for undo labels ("Align 3 items to the right"). */
export const ALIGN_LABELS: Record<AlignMode, string> = { left: "left", right: "right", top: "to top", bottom: "to bottom" };

/** updatePatch ui ops for patches whose position changed. */
export function movePatchOps(component: Component, positions: ReadonlyMap<string, { x: number; y: number }>): Op[] {
  const ops: Op[] = [];
  for (const [id, pos] of positions) {
    const node = component.patches[id];
    if (!node) continue;
    const x = Math.round(pos.x);
    const y = Math.round(pos.y);
    if (node.ui.x !== x || node.ui.y !== y) ops.push({ op: "updatePatch", component: component.id, id, ui: { x, y } });
  }
  return ops;
}

/** A comment framing the given rects. */
export function commentAroundOps(componentId: Id, rects: readonly Rect[], text = "Comment", color?: string): Op[] {
  const box = boundsOf(rects, COMMENT_PADDING) ?? { x: 0, y: 0, width: 320, height: 160 };
  const rect: [number, number, number, number] = [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
  return [{ op: "addComment", component: componentId, comment: { ref: "comment", text, rect, ...(color ? { color } : {}) } }];
}

/** Comment colors offered in the patch editor (stored as names). */
export const COMMENT_COLORS: readonly { key: string; name: string }[] = [
  { key: "gray", name: "Gray" },
  { key: "yellow", name: "Yellow" },
  { key: "orange", name: "Orange" },
  { key: "pink", name: "Pink" },
  { key: "purple", name: "Purple" },
  { key: "blue", name: "Blue" },
  { key: "green", name: "Green" },
];
