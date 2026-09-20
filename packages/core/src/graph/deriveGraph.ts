/**
 * deriveGraph: a component → graph nodes and cables, as the patch editor draws them. Patch nodes
 * carry resolved ports with literals, connection state, static loop detection, and diagnostics;
 * layers whose properties are driven (or read) get a layer target node; published component ports
 * get interface nodes; comments become frames. Unchanged nodes and edges keep their identity across
 * revisions so memoized views skip re-rendering.
 */

import { parseAddress } from "../address.ts";
import { effectiveKnobLiteral, formatKnobValue, getKnob } from "../knobs.ts";
import { patchDisplayName } from "../names.ts";
import { listInputs, targetAddress, type InputEntry } from "../ops/references.ts";
import { findLayer, getPatchSpec, interfacePortToPort, resolveLayerOutputs, resolveLayerProps, resolveNodePorts, type ResolvedPort, type ResolvedPorts, type ResolvedProp } from "../registry.ts";
import type { Component, Diagnostic, Id, InputValue, LayerNode, PatchNode, Registry, SonobeDocument, Suggestion, ValueType } from "../types.ts";
import { canConnect, defaultForPort, isLayerInput, isLinkInput, isLoopLiteral, normalizeColor } from "../values.ts";
import { deepEqual } from "./equal.ts";
import { knobValueReserve } from "./format.ts";
import { createPlacementIndex, PLACEMENT_PADDING, type Rect } from "./geometry.ts";
import { INPUTS_NODE_ID, layerNodeId, OUTPUTS_NODE_ID, readNodePositions } from "./graphNodes.ts";
import { estimateNodeSize, type NodeTextMeasurer } from "./nodeSize.ts";
import {
  cableId,
  commentNodeId,
  inHandle,
  outHandle,
  portKey,
  type CableData,
  type CableEdge,
  type CommentGraphNode,
  type GraphModel,
  type GraphNode,
  type InterfaceGraphNode,
  type LayerGraphNode,
  type NodeIssue,
  type PatchGraphNode,
  type PatchNodeData,
  type PortModel,
  type PortSide,
  type SessionPositions,
} from "./types.ts";

export interface DeriveGraphOptions {
  doc: SonobeDocument;
  componentId: Id;
  registry: Registry;
  /** Document (and runtime) diagnostics; info-level entries are ignored. */
  diagnostics?: readonly Diagnostic[];
  /** Patch id → names of agents working on it. */
  working?: ReadonlyMap<Id, readonly string[]>;
  /** Positions for layer and interface nodes, over the ones saved in the component's patch editor metadata. */
  positions?: SessionPositions;
  /** Layer properties to show on layer nodes before anything drives them ("@photo.opacity"). */
  pendingTargets?: readonly string[];
  /** The previous model, so unchanged nodes and edges keep their identity. */
  previous?: GraphModel | null;
  /** Measured node sizes (placement of layer and interface nodes). */
  sizes?: ReadonlyMap<string, { width: number; height: number }>;
  /** Measures node text for sizes that weren't measured (default: the SF Pro metrics table). */
  measure?: NodeTextMeasurer;
}

const EMPTY_NAMES: readonly string[] = [];
const EMPTY_ISSUES: NodeIssue[] = [];

const stripIndex = (address: string) => address.replace(/#\d+$/, "");

interface Link {
  entry: InputEntry;
  to: string;
  from: string;
  /** `from`, parsed once. */
  src: ReturnType<typeof parseAddress>;
}

/** Ports of nodes whose spec has no dynamic ports depend only on the node, so each node resolves once. */
const staticPorts = new WeakMap<Registry, WeakMap<PatchNode, ResolvedPorts>>();

function portsOf(doc: SonobeDocument, node: PatchNode, registry: Registry): ResolvedPorts | undefined {
  const spec = getPatchSpec(registry, node.type);
  if (!spec || spec.dynamicPorts) return resolveNodePorts(doc, node, registry);
  let byNode = staticPorts.get(registry);
  if (!byNode) staticPorts.set(registry, (byNode = new WeakMap()));
  let ports = byNode.get(node);
  if (!ports) {
    ports = resolveNodePorts(doc, node, registry);
    if (ports) byNode.set(node, ports);
  }
  return ports;
}

/** What a patch node's derived data was built from, so the next derive can reuse the node object. */
interface PatchCacheEntry {
  node: PatchNode;
  rp: ResolvedPorts;
  /** Output keys other items read, in link order. */
  consumed: string;
  working: readonly string[];
  issues: readonly NodeIssue[];
  flowNode: PatchGraphNode;
}

interface PatchCache {
  registry: Registry;
  componentId: Id;
  /** No patch loops and no whole-loop outputs: a node's loop flags depend only on the node itself. */
  loopFree: boolean;
  entries: Map<Id, PatchCacheEntry>;
  /** The knob set the chips were drawn from. */
  knobs: SonobeDocument["knobs"];
}

const patchCaches = new WeakMap<GraphModel, PatchCache>();

const sameItems = <T>(a: readonly T[], b: readonly T[]) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

const issueCache = new WeakMap<Diagnostic, NodeIssue>();

/** The chip for an input linked to "$knob.<id>": the knob's name and running value (K1), and a color knob's color. */
function knobChip(doc: SonobeDocument, link: string): PortModel["knob"] {
  const a = parseAddress(link);
  if (a?.kind !== "knob") return undefined;
  const knob = getKnob(doc.knobs, a.key);
  if (!knob) return { id: a.key, name: a.key };
  const value = effectiveKnobLiteral(doc.knobs!, knob.id);
  const color = knob.type === "color" && typeof value === "string" ? normalizeColor(value) : undefined;
  const reserve = knobValueReserve(knob);
  return { id: knob.id, name: knob.name, ...(value !== undefined && value !== null ? { valueText: formatKnobValue(knob, value), ...(reserve ? { valueReserve: reserve } : {}) } : {}), ...(color ? { color } : {}) };
}

function toPortModel(port: ResolvedPort, side: PortSide, address: string, connected: boolean, defaultOverride?: unknown): PortModel {
  const model: PortModel = {
    key: port.key,
    name: port.name,
    side,
    type: port.type,
    description: port.description,
    address,
    handleId: side === "in" ? inHandle(port.key) : outHandle(port.key),
    connected,
  };
  if (port.subtype) model.subtype = port.subtype;
  const def = defaultOverride !== undefined ? defaultForPort({ ...port, default: defaultOverride }) : defaultForPort(port);
  if (def !== undefined && def !== null) model.defaultValue = def;
  if (port.min !== undefined) model.min = port.min;
  if (port.max !== undefined) model.max = port.max;
  if (port.step !== undefined) model.step = port.step;
  if (port.enumOptions?.length) model.enumOptions = port.enumOptions;
  if (port.wholeLoop) model.wholeLoop = true;
  return model;
}

const unknownPort = (key: string): ResolvedPort => ({ key, name: key, type: "any", description: "This port isn't declared by the patch type." });

/** A diagnostic as a node badge (one object per diagnostic, so unchanged badges keep their identity). */
function issueFrom(d: Diagnostic): NodeIssue {
  const cached = issueCache.get(d);
  if (cached) return cached;
  const issue: NodeIssue = { severity: d.severity === "error" ? "error" : "warning", code: d.code, message: d.message };
  if (d.port !== undefined) issue.port = d.port;
  if (d.suggestions?.length) issue.suggestions = d.suggestions;
  issueCache.set(d, issue);
  return issue;
}

export function deriveGraph(options: DeriveGraphOptions): GraphModel {
  const { doc, componentId, registry } = options;
  const component = doc.components[componentId];
  if (!component) {
    return { componentId, nodes: [], edges: [], cablesBySource: new Map(), outputAddresses: [], ports: new Map(), nodeIds: new Set() };
  }

  // -- Ports and links ------------------------------------------------------
  const patchPorts = new Map<Id, ResolvedPorts | undefined>();
  let wholeLoopOutputs = false;
  for (const [id, node] of Object.entries(component.patches)) {
    const rp = portsOf(doc, node, registry);
    patchPorts.set(id, rp);
    if (rp?.outputs.some((p) => p.wholeLoop)) wholeLoopOutputs = true;
  }

  const links: Link[] = [];
  const consumedKeys = new Map<Id, string>();
  for (const entry of listInputs(component)) {
    if (!isLinkInput(entry.value)) continue;
    const from = stripIndex(entry.value.link);
    const src = parseAddress(from);
    links.push({ entry, to: targetAddress(entry.target), from, src });
    if (src?.kind === "patch") consumedKeys.set(src.id, consumedKeys.has(src.id) ? `${consumedKeys.get(src.id)}|${src.key}` : src.key);
  }
  const consumed = new Set(links.map((l) => l.from));

  const layerCache = new Map<Id, { layer: LayerNode; props: ResolvedProp[]; outputs: ResolvedPort[] } | null>();
  const layerInfo = (id: Id) => {
    let info = layerCache.get(id);
    if (info === undefined) {
      const loc = findLayer(component.layers, id);
      const props = loc ? resolveLayerProps(doc, componentId, loc.layer, registry) : undefined;
      info = loc ? { layer: loc.layer, props: props ?? [], outputs: resolveLayerOutputs(doc, componentId, loc.layer, registry) } : null;
      layerCache.set(id, info);
    }
    return info;
  };

  const sourcePort = (address: string): ResolvedPort | undefined => {
    const a = parseAddress(address);
    if (!a) return undefined;
    if (a.kind === "patch") return patchPorts.get(a.id)?.outputs.find((p) => p.key === a.key);
    if (a.kind === "layer") {
      const info = layerInfo(a.id);
      return info?.outputs.find((p) => p.key === a.key) ?? info?.props.find((p) => p.key === a.key);
    }
    if (a.kind === "componentInput") {
      const port = component.interface.inputs[a.key];
      return port ? interfacePortToPort(port, "input") : undefined;
    }
    return undefined;
  };

  const targetPort = (entry: InputEntry): ResolvedPort | undefined => {
    const t = entry.target;
    if (t.kind === "patch") return patchPorts.get(t.id)?.inputs.find((p) => p.key === t.key);
    if (t.kind === "layer") return layerInfo(t.id)?.props.find((p) => p.key === t.key);
    const port = component.interface.outputs[t.key];
    return port ? interfacePortToPort(port, "output") : undefined;
  };

  // -- Diagnostics ----------------------------------------------------------
  const issuesByItem = new Map<Id, NodeIssue[]>();
  const cableIssues = new Map<string, { message: string; suggestions?: Suggestion[] }>();
  for (const d of options.diagnostics ?? []) {
    if (d.component !== componentId || d.severity === "info") continue;
    const issue = issueFrom(d);
    for (const id of new Set(d.itemIds)) {
      const list = issuesByItem.get(id) ?? [];
      if (!list.some((i) => i.code === issue.code && i.message === issue.message)) list.push(issue);
      issuesByItem.set(id, list);
    }
    const target = d.itemIds[0];
    if (d.port !== undefined && target !== undefined && d.severity === "error") {
      const address = component.patches[target] ? `${target}.${d.port}` : `@${target}.${d.port}`;
      if (!cableIssues.has(address)) cableIssues.set(address, d.suggestions?.length ? { message: d.message, suggestions: d.suggestions } : { message: d.message });
    }
  }

  // -- Static loops ---------------------------------------------------------
  const looped = new Set<Id>();
  const outputIsLoop = (address: string): boolean => {
    const a = parseAddress(address);
    if (!a || a.kind !== "patch") return false;
    const port = patchPorts.get(a.id)?.outputs.find((p) => p.key === a.key);
    return !!port && (port.wholeLoop === true || looped.has(a.id));
  };
  const inputFeedsLoop = (id: Id, key: string, value: InputValue) => {
    const port = patchPorts.get(id)?.inputs.find((p) => p.key === key);
    if (port?.wholeLoop) return false;
    return isLoopLiteral(value) || (isLinkInput(value) && outputIsLoop(stripIndex(value.link)));
  };
  for (let changed = true, guard = 0; changed && guard <= Object.keys(component.patches).length + 1; guard++) {
    changed = false;
    for (const [id, node] of Object.entries(component.patches)) {
      if (looped.has(id)) continue;
      if (Object.entries(node.inputs).some(([key, value]) => inputFeedsLoop(id, key, value))) {
        looped.add(id);
        changed = true;
      }
    }
  }

  const lengthMemo = new Map<Id, number | null>();
  const visiting = new Set<Id>();
  const outputLength = (address: string): number | null => {
    const a = parseAddress(address);
    if (!a || a.kind !== "patch") return null;
    const ports = patchPorts.get(a.id);
    const port = ports?.outputs.find((p) => p.key === a.key);
    if (!ports || !port) return null;
    if (port.wholeLoop) {
      const node = component.patches[a.id]!;
      const count = node.inputs.count;
      if (typeof count === "number" && !ports.inputs.some((p) => p.wholeLoop)) return Math.max(0, Math.round(count));
      if (ports.spec.variadic && ports.inputCount !== undefined && !ports.inputs.some((p) => p.wholeLoop)) return ports.inputCount;
      return null;
    }
    return looped.has(a.id) ? patchLoopLength(a.id) : null;
  };
  const patchLoopLength = (id: Id): number | null => {
    if (lengthMemo.has(id)) return lengthMemo.get(id)!;
    if (visiting.has(id)) return null;
    visiting.add(id);
    let length: number | null = 0;
    for (const [key, value] of Object.entries(component.patches[id]?.inputs ?? {})) {
      if (!inputFeedsLoop(id, key, value)) continue;
      const n = isLoopLiteral(value) ? value.loop.length : isLinkInput(value) ? outputLength(stripIndex(value.link)) : null;
      if (n === null) {
        length = null;
        break;
      }
      length = Math.max(length, n);
    }
    visiting.delete(id);
    lengthMemo.set(id, length);
    return length;
  };

  // -- Nodes ----------------------------------------------------------------
  const ports = new Map<string, PortModel>();
  const register = (list: PortModel[]) => {
    for (const p of list) ports.set(portKey(p.side, p.address), p);
    return list;
  };
  const nodes: GraphNode[] = [];
  const outputAddresses: string[] = [];
  const patchRects: Rect[] = [];
  const patchData = new Map<Id, PatchNodeData>();
  const estimateOptions = { ...(options.measure ? { measure: options.measure } : {}), layerName: (id: Id) => findLayer(component.layers, id)?.layer.name };
  const sizeOf = (id: string, data: Parameters<typeof estimateNodeSize>[0]) => options.sizes?.get(id) ?? estimateNodeSize(data, estimateOptions);

  const previousCache = options.previous ? patchCaches.get(options.previous) : undefined;
  const loopFree = looped.size === 0 && !wholeLoopOutputs;
  const cache: PatchCache = { registry, componentId, loopFree, entries: new Map(), knobs: doc.knobs };
  const reusable = !!previousCache && previousCache.loopFree && loopFree && previousCache.registry === registry && previousCache.componentId === componentId && previousCache.knobs === doc.knobs;

  for (const [id, node] of Object.entries(component.patches)) {
    const rp = patchPorts.get(id);
    const nodeIssues = issuesByItem.get(id) ?? EMPTY_ISSUES;
    const working = options.working?.get(id) ?? EMPTY_NAMES;
    const consumedSignature = consumedKeys.get(id) ?? "";
    const cached = reusable ? previousCache.entries.get(id) : undefined;
    if (cached && rp && cached.node === node && cached.rp === rp && cached.consumed === consumedSignature && cached.working === working && sameItems(cached.issues, nodeIssues)) {
      // Same node, ports, readers, badges and presence: the derived node is unchanged.
      const flowNode = cached.flowNode;
      register(flowNode.data.inputs);
      register(flowNode.data.outputs);
      for (const o of flowNode.data.outputs) outputAddresses.push(o.address);
      nodes.push(flowNode);
      patchData.set(id, flowNode.data);
      patchRects.push({ x: node.ui.x, y: node.ui.y, ...sizeOf(id, flowNode.data) });
      cache.entries.set(id, cached);
      continue;
    }
    const portIssue = (key: string) => {
      const issue = nodeIssues.find((i) => i.port === key);
      return issue ? { severity: issue.severity, message: issue.message } : undefined;
    };
    const variantDefaults = rp?.typeParam ? rp.spec.variantDefaults?.[rp.typeParam] : undefined;
    const inputs: PortModel[] = [];
    let hiddenInputs = 0;
    let layerRef: Id | undefined;
    for (const port of rp?.inputs ?? []) {
      const value = node.inputs[port.key];
      if (port.advanced && value === undefined) {
        hiddenInputs++;
        continue;
      }
      const connected = isLinkInput(value);
      const model = toPortModel(port, "in", `${id}.${port.key}`, connected, variantDefaults?.[port.key]);
      if (connected) model.link = stripIndex(value.link);
      else if (value !== undefined) model.literal = value;
      const chip = connected ? knobChip(doc, value.link) : undefined;
      if (chip) model.knob = chip;
      if (isLayerInput(value)) layerRef ??= value.layer;
      if (inputFeedsLoop(id, port.key, value ?? null)) model.loop = true;
      const issue = portIssue(port.key);
      if (issue) model.issue = issue;
      inputs.push(model);
    }
    for (const [key, value] of Object.entries(node.inputs)) {
      if (rp?.inputs.some((p) => p.key === key)) continue;
      const model = toPortModel(unknownPort(key), "in", `${id}.${key}`, isLinkInput(value));
      if (isLinkInput(value)) model.link = stripIndex(value.link);
      else model.literal = value;
      model.issue = portIssue(key) ?? { severity: "error", message: `"${key}" isn't an input of ${rp?.spec.name ?? node.type}.` };
      inputs.push(model);
    }
    const outputs: PortModel[] = [];
    for (const port of rp?.outputs ?? []) {
      const address = `${id}.${port.key}`;
      const model = toPortModel(port, "out", address, consumed.has(address));
      if (outputIsLoop(address)) model.loop = true;
      outputs.push(model);
      outputAddresses.push(address);
    }
    if (!rp) {
      for (const l of links) {
        const a = l.src;
        if (a?.kind === "patch" && a.id === id && !outputs.some((p) => p.key === a.key)) outputs.push(toPortModel(unknownPort(a.key), "out", l.from, true));
      }
    }
    const spec = rp?.spec;
    const data: PatchNodeData = {
      kind: "patch",
      componentId,
      patchId: id,
      type: node.type,
      title: patchDisplayName(node, spec),
      specName: spec?.name ?? node.type,
      customName: patchDisplayName(node, spec) !== (spec?.name ?? node.type),
      category: spec?.category ?? "utility",
      known: !!spec,
      inputs: register(inputs),
      outputs: register(outputs),
      hiddenInputs,
      muted: node.muted === true,
      collapsed: node.ui.collapsed === true,
      looped: looped.has(id),
      issues: nodeIssues,
      working,
    };
    if (rp?.typeParam) data.typeParam = rp.typeParam;
    if (spec?.variants?.length) data.variants = spec.variants;
    if (rp?.inputCount !== undefined && spec?.variadic) {
      data.inputCount = rp.inputCount;
      data.variadic = { min: spec.variadic.min, max: spec.variadic.max, name: spec.variadic.name };
    }
    if (looped.has(id) || outputs.some((o) => o.wholeLoop)) {
      const length = outputs.find((o) => o.wholeLoop) ? outputLength(`${id}.${outputs.find((o) => o.wholeLoop)!.key}`) : patchLoopLength(id);
      if (length !== null) data.loopLength = length;
    }
    if (node.component !== undefined) data.componentTarget = node.component;
    if (layerRef !== undefined) data.layerRef = layerRef;
    const flowNode: PatchGraphNode = { id, type: "patch", position: { x: node.ui.x, y: node.ui.y }, data };
    nodes.push(flowNode);
    patchData.set(id, data);
    patchRects.push({ x: node.ui.x, y: node.ui.y, ...sizeOf(id, data) });
    if (rp) cache.entries.set(id, { node, rp, consumed: consumedSignature, working, issues: nodeIssues, flowNode });
  }

  // Layer target nodes: driven properties in, read outputs/properties out.
  const bound = new Map<Id, Set<string>>();
  const read = new Map<Id, Set<string>>();
  const driversOf = new Map<Id, Set<Id>>();
  const readersOf = new Map<Id, Set<Id>>();
  const add = <K, V>(map: Map<K, Set<V>>, key: K, value: V) => {
    const set = map.get(key) ?? new Set<V>();
    set.add(value);
    map.set(key, set);
  };
  for (const l of links) {
    const src = l.src;
    if (l.entry.target.kind === "layer") {
      add(bound, l.entry.target.id, l.entry.target.key);
      if (src?.kind === "patch") add(driversOf, l.entry.target.id, src.id);
    }
    if (src?.kind === "layer") {
      add(read, src.id, src.key);
      if (l.entry.target.kind === "patch") add(readersOf, src.id, l.entry.target.id);
    }
  }
  const savedPositions = readNodePositions(component);
  // Properties someone asked to drive that nothing drives yet: open inputs on the layer's node.
  const pending = new Map<Id, string[]>();
  for (const address of options.pendingTargets ?? []) {
    const a = parseAddress(address);
    if (a?.kind !== "layer" || bound.get(a.id)?.has(a.key)) continue;
    if (!layerInfo(a.id)?.props.some((p) => p.key === a.key && p.bindable !== false)) continue;
    const keys = pending.get(a.id) ?? [];
    if (!keys.includes(a.key)) keys.push(a.key);
    pending.set(a.id, keys);
  }
  const graphRight = patchRects.length ? Math.max(...patchRects.map((r) => r.x + r.width)) : 0;
  const graphTop = patchRects.length ? Math.min(...patchRects.map((r) => r.y)) : 0;
  const placed = createPlacementIndex(PLACEMENT_PADDING);
  for (const r of patchRects) placed.add(r);
  const place = (id: string, size: { width: number; height: number }, preferred: { x: number; y: number }) => {
    const saved = options.positions?.[id] ?? savedPositions[id];
    if (saved) return { x: saved.x, y: saved.y };
    const base: Rect = { x: Math.round(preferred.x), y: Math.round(preferred.y), ...size };
    // First fit: the preferred spot, then 24 px steps down and up, clear of placed nodes by 12 px.
    for (let d = 0; d <= 480; d += 24) {
      for (const dy of d === 0 ? [0] : [d, -d]) {
        const rect = { ...base, y: base.y + dy };
        if (!placed.overlaps(rect)) {
          placed.add(rect);
          return { x: rect.x, y: rect.y };
        }
      }
    }
    placed.add(base);
    return { x: base.x, y: base.y };
  };
  const layerIds = [...new Set([...bound.keys(), ...read.keys(), ...pending.keys()])].filter((id) => layerInfo(id));
  const rectOfPatch = (id: Id) => {
    const node = component.patches[id];
    const data = patchData.get(id);
    return node && data ? { x: node.ui.x, y: node.ui.y, ...sizeOf(id, data) } : undefined;
  };
  const avgY = (ids: Set<Id> | undefined) => {
    const ys = [...(ids ?? [])].map((p) => component.patches[p]?.ui.y).filter((y): y is number => y !== undefined);
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
  };
  layerIds.sort((a, b) => avgY(driversOf.get(a) ?? readersOf.get(a)) - avgY(driversOf.get(b) ?? readersOf.get(b)));
  for (const layerId of layerIds) {
    const info = layerInfo(layerId)!;
    const nodeId = layerNodeId(layerId);
    const boundKeys = bound.get(layerId) ?? new Set<string>();
    const readKeys = read.get(layerId) ?? new Set<string>();
    // Bound properties in the order of their drivers (top to bottom), so cables don't cross.
    const driverY = (key: string) => {
      const value = info.layer.props[key];
      const src = isLinkInput(value) ? parseAddress(value.link) : undefined;
      return src?.kind === "patch" ? (component.patches[src.id]?.ui.y ?? 0) : 0;
    };
    const driven = info.props
      .filter((p) => boundKeys.has(p.key))
      .map((p, index) => ({ p, index, y: driverY(p.key) }))
      .sort((a, b) => a.y - b.y || a.index - b.index)
      .map(({ p }) => {
        const value = info.layer.props[p.key];
        const model = toPortModel(p, "in", `@${layerId}.${p.key}`, true);
        if (isLinkInput(value)) model.link = stripIndex(value.link);
        const chip = isLinkInput(value) ? knobChip(doc, value.link) : undefined;
        if (chip) model.knob = chip;
        return model;
      });
    // Undriven targets after the driven ones, in the order they were asked for.
    const undriven = (pending.get(layerId) ?? [])
      .map((key) => info.props.find((p) => p.key === key))
      .filter((p): p is ResolvedProp => !!p)
      .map((p) => toPortModel(p, "in", `@${layerId}.${p.key}`, false));
    const inputs = register([...driven, ...undriven]);
    const readable = [...info.outputs, ...info.props.filter((p) => !info.outputs.some((o) => o.key === p.key))];
    const outputs = register(readable.filter((p) => readKeys.has(p.key)).map((p) => toPortModel(p, "out", `@${layerId}.${p.key}`, true)));
    for (const o of outputs) outputAddresses.push(o.address);
    const spec = registry.layers.get(info.layer.type);
    const data = {
      kind: "layer" as const,
      componentId,
      layerId,
      title: info.layer.name,
      layerType: info.layer.type,
      layerTypeName: spec?.name ?? info.layer.type,
      inputs,
      outputs,
      issues: (issuesByItem.get(layerId) ?? EMPTY_ISSUES).filter((i) => i.port === undefined || boundKeys.has(i.port)),
    };
    const size = sizeOf(nodeId, data);
    const drivers = [...(driversOf.get(layerId) ?? [])].map(rectOfPatch).filter((r): r is Rect => !!r);
    const readers = [...(readersOf.get(layerId) ?? [])].map(rectOfPatch).filter((r): r is Rect => !!r);
    const preferred = drivers.length
      ? { x: Math.max(...drivers.map((r) => r.x + r.width)) + 96, y: Math.min(...drivers.map((r) => r.y)) }
      : readers.length
        ? { x: Math.min(...readers.map((r) => r.x)) - size.width - 96, y: Math.min(...readers.map((r) => r.y)) }
        : { x: graphRight + 120, y: graphTop };
    const flowNode: LayerGraphNode = { id: nodeId, type: "layer", position: place(nodeId, size, preferred), data };
    nodes.push(flowNode);
  }

  // Component interface nodes.
  const bbox = patchRects.length
    ? { minX: Math.min(...patchRects.map((r) => r.x)), minY: Math.min(...patchRects.map((r) => r.y)), maxX: Math.max(...patchRects.map((r) => r.x + r.width)) }
    : { minX: 0, minY: 0, maxX: 240 };
  const inPorts = Object.values(component.interface.inputs).sort((a, b) => (a.key < b.key ? -1 : 1));
  if (inPorts.length) {
    const outputs = register(inPorts.map((p) => toPortModel(interfacePortToPort(p, "input"), "out", `$in.${p.key}`, consumed.has(`$in.${p.key}`))));
    const data = { kind: "interface" as const, componentId, side: "inputs" as const, title: "Component Inputs", inputs: [], outputs };
    const size = sizeOf(INPUTS_NODE_ID, data);
    const flowNode: InterfaceGraphNode = { id: INPUTS_NODE_ID, type: "interface", position: place(INPUTS_NODE_ID, size, { x: bbox.minX - size.width - 120, y: bbox.minY }), data };
    nodes.push(flowNode);
  }
  const outPorts = Object.values(component.interface.outputs).sort((a, b) => (a.key < b.key ? -1 : 1));
  if (outPorts.length) {
    const inputs = register(
      outPorts.map((p) => {
        const model = toPortModel(interfacePortToPort(p, "output"), "in", `$out.${p.key}`, p.link !== undefined);
        if (p.link !== undefined) model.link = stripIndex(p.link);
        return model;
      }),
    );
    const data = { kind: "interface" as const, componentId, side: "outputs" as const, title: "Component Outputs", inputs, outputs: [] };
    const size = sizeOf(OUTPUTS_NODE_ID, data);
    const flowNode: InterfaceGraphNode = { id: OUTPUTS_NODE_ID, type: "interface", position: place(OUTPUTS_NODE_ID, size, { x: bbox.maxX + 120, y: bbox.minY }), data };
    nodes.push(flowNode);
  }

  // Comments sit behind everything.
  for (const c of component.comments) {
    const data = { kind: "comment" as const, componentId, commentId: c.id, text: c.text, ...(c.color !== undefined ? { color: c.color } : {}) };
    const flowNode: CommentGraphNode = { id: commentNodeId(c.id), type: "comment", position: { x: c.rect[0], y: c.rect[1] }, width: c.rect[2], height: c.rect[3], zIndex: -1, data };
    nodes.push(flowNode);
  }

  // -- Cables ---------------------------------------------------------------
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: CableEdge[] = [];
  const cablesBySource = new Map<string, string[]>();
  for (const l of links) {
    const src = l.src;
    if (!src || src.kind === "componentOutput") continue;
    const sourceNode = src.kind === "patch" ? src.id : src.kind === "layer" ? layerNodeId(src.id) : INPUTS_NODE_ID;
    const t = l.entry.target;
    const targetNode = t.kind === "patch" ? t.id : t.kind === "layer" ? layerNodeId(t.id) : OUTPUTS_NODE_ID;
    if (!nodeIds.has(sourceNode) || !nodeIds.has(targetNode)) continue;
    if (!ports.has(portKey("out", l.from)) || !ports.has(portKey("in", l.to))) continue;
    const sourceType: ValueType = sourcePort(l.from)?.type ?? "any";
    const targetType: ValueType = targetPort(l.entry)?.type ?? "any";
    const check = canConnect(sourceType, targetType);
    const data: CableData = { from: l.from, to: l.to, sourceType, targetType, loop: outputIsLoop(l.from) };
    if (check.conversion) data.conversion = check.conversion;
    const issue = cableIssues.get(l.to);
    if (issue) {
      data.invalid = issue.message;
      if (issue.suggestions) data.suggestions = issue.suggestions;
    } else if (!check.ok) {
      data.invalid = check.reason ?? "These types don't connect.";
    }
    const id = cableId(l.to);
    edges.push({ id, type: "cable", source: sourceNode, sourceHandle: outHandle(src.key), target: targetNode, targetHandle: inHandle(t.key), data });
    const list = cablesBySource.get(l.from) ?? [];
    list.push(id);
    cablesBySource.set(l.from, list);
  }

  const result = share({ componentId, nodes, edges, cablesBySource, outputAddresses, ports, nodeIds }, options.previous);
  // Remember the node objects the model actually holds, so the next derive hands them back.
  for (const node of result.nodes) {
    const entry = node.type === "patch" ? cache.entries.get(node.id) : undefined;
    if (entry) entry.flowNode = node as PatchGraphNode;
  }
  patchCaches.set(result, cache);
  return result;
}

const CABLE_KEYS = ["from", "to", "sourceType", "targetType", "conversion", "invalid", "loop"] as const;

function sameCable(a: CableData | undefined, b: CableData | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || Object.keys(a).length !== Object.keys(b).length) return false;
  for (const key of CABLE_KEYS) if (a[key] !== b[key]) return false;
  for (const key of Object.keys(a)) if (!(CABLE_KEYS as readonly string[]).includes(key) && a[key] !== b[key] && !deepEqual(a[key], b[key])) return false;
  return true;
}

/** Reuse previous node and edge objects that didn't change. */
function share(next: GraphModel, previous: GraphModel | null | undefined): GraphModel {
  if (!previous || previous.componentId !== next.componentId) return next;
  const prevNodes = new Map(previous.nodes.map((n) => [n.id, n]));
  const nodes = next.nodes.map((n) => {
    const p = prevNodes.get(n.id);
    if (p === n) return p;
    if (!p || p.type !== n.type || p.position.x !== n.position.x || p.position.y !== n.position.y || p.width !== n.width || p.height !== n.height) return n;
    if (p.data === n.data || deepEqual(p.data, n.data)) return p;
    return n;
  });
  const prevEdges = new Map(previous.edges.map((e) => [e.id, e]));
  const edges = next.edges.map((e) => {
    const p = prevEdges.get(e.id);
    return p && p.source === e.source && p.target === e.target && p.sourceHandle === e.sourceHandle && p.targetHandle === e.targetHandle && sameCable(p.data, e.data) ? p : e;
  });
  // Unchanged lists keep their identity too, so React Flow skips rebuilding its lookups (a literal edit changes one node and no cables).
  return { ...next, nodes: sameItems(nodes, previous.nodes) ? previous.nodes : nodes, edges: sameItems(edges, previous.edges) ? previous.edges : edges };
}

/** Rect of a patch in a component using an estimate (placement before measuring). */
export function patchRectEstimate(model: GraphModel, id: string): Rect | undefined {
  const node = model.nodes.find((n) => n.id === id);
  return node ? { x: node.position.x, y: node.position.y, ...estimateNodeSize(node.data) } : undefined;
}

/** Component → patch ids ordered by position (top-left first). */
export function patchIdsByPosition(component: Component): Id[] {
  return Object.entries(component.patches)
    .sort(([, a], [, b]) => a.ui.y - b.ui.y || a.ui.x - b.ui.x)
    .map(([id]) => id);
}
