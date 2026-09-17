/**
 * The patch graph of a component: cables between patches, feedback loops, and which cables
 * read the previous frame's value (ARCHITECTURE §5.2). The engine orders loops by the same rule,
 * so diagnostics, the editor, and MCP explanations can name the cable that lags.
 *
 * Besides direct cables, the graph holds the implicit edges the engine follows: a patch input that
 * reads a layer property ("@card.opacity") depends on whatever patch drives that property, and a
 * Variable Receiver depends on whatever drives its broadcaster's Value. Loops closed through either
 * lag a frame just like loops of cables, so they're reported the same way.
 */

import { formatAddress, parseAddress } from "./address.ts";
import { getOwn } from "./ids.ts";
import { findLayer, findPort, resolveLayerOutputs, resolveLayerProps, resolveNodePorts, type ResolvedPorts } from "./registry.ts";
import type { Component, Id, PatchNode, Registry, SonobeDocument } from "./types.ts";
import { isLinkInput } from "./values.ts";

/** Patch type of Delay One Frame, the documented feedback primitive. */
export const DELAY_ONE_FRAME_TYPE = "delay1";
/** Patch type of Variable Broadcaster: its Value reaches every receiver with the same name. */
export const VARIABLE_BROADCASTER_TYPE = "variableBroadcaster";
/** Patch type of Variable Receiver. */
export const VARIABLE_RECEIVER_TYPE = "variableReceiver";

/**
 * How an edge reaches its target without a cable from the source patch:
 * - "layerProp": the target input links to `address` ("@card.opacity"), a layer property that the
 *   source patch drives, directly or through more layer property links.
 * - "variable": the target is a Variable Receiver named `name`, resolving to broadcaster
 *   `broadcasterId`, whose Value the source patch drives.
 */
export type EdgeVia = { kind: "layerProp"; address: string } | { kind: "variable"; name: string; broadcasterId: Id };

/** A dependency of one patch on another patch's output. */
export interface PatchEdge {
  /**
   * The address the target reads as it's stored: "patchId.outputKey" for a cable, "@layerId.key"
   * for a read through a layer property, and the broadcaster's stored Value link for a variable.
   */
  from: string;
  /** Target address: "patchId.inputKey", or "receiverId.name" for a Variable Receiver (its Name picks the variable). */
  to: string;
  /** The patch whose output drives the target, and that output. */
  sourceId: Id;
  sourceKey: string;
  targetId: Id;
  targetKey: string;
  /** Set when there's no direct cable from the source patch to the target. */
  via?: EdgeVia;
}

/**
 * Why a cable reads the previous frame: it feeds Delay One Frame ("delay1"), it runs right to left
 * in the patch editor ("backwards"), or neither applied and its target id sorts first ("id").
 */
export type FeedbackReason = "delay1" | "backwards" | "id";

export interface FeedbackEdge extends PatchEdge {
  reason: FeedbackReason;
}

export interface FeedbackLoop {
  /** Patches that reach each other through cables (two or more), sorted by id. */
  patchIds: Id[];
  /** The loop's cables that read the previous frame's value, in edge order. */
  feedback: FeedbackEdge[];
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Edge order: target id, target port, source id, source port. */
const compareEdges = (a: PatchEdge, b: PatchEdge) =>
  byId(a.targetId, b.targetId) || byId(a.targetKey, b.targetKey) || byId(a.sourceId, b.sourceId) || byId(a.sourceKey, b.sourceKey);

/** A variable's trimmed name and scope, read from a broadcaster's or receiver's settings. */
function variableOf(node: PatchNode): { name: string; scope: "local" | "global" } {
  const name = node.settings?.name;
  return { name: typeof name === "string" ? name.trim() : "", scope: node.settings?.scope === "global" ? "global" : "local" };
}

/**
 * Every patch-to-patch dependency in a component, in edge order: cables from a patch output into
 * another patch's input, reads through layer properties that a patch drives, and variables whose
 * broadcaster a patch drives (see EdgeVia). Links to missing patches or ports, loop-index addresses,
 * and edges from a patch to itself aren't edges. Layer outputs, published inputs, and published
 * outputs of component layers don't lead to a patch in this component, so they add no edge.
 */
export function patchEdges(doc: SonobeDocument, componentId: Id, registry: Registry): PatchEdge[] {
  const c = getOwn(doc.components, componentId);
  if (!c) return [];
  const cache = new Map<Id, ResolvedPorts | undefined>();
  const portsOf = (id: Id) => {
    if (!cache.has(id)) cache.set(id, resolveNodePorts(doc, c.patches[id]!, registry));
    return cache.get(id);
  };

  /** The patch output a link reads, following layer property links the way the engine compiles them. */
  const driverOf = (link: string, seen: Set<string>): { id: Id; key: string } | undefined => {
    const a = parseAddress(link);
    if (!a || a.index !== undefined) return undefined;
    if (a.kind === "patch") {
      if (!getOwn(c.patches, a.id)) return undefined;
      const source = portsOf(a.id);
      if (source && !findPort(source.outputs, a.key)) return undefined;
      return { id: a.id, key: a.key };
    }
    if (a.kind !== "layer") return undefined;
    const layer = findLayer(c.layers, a.id)?.layer;
    const visit = `${a.id}.${a.key}`;
    if (!layer || seen.has(visit)) return undefined;
    // Layer outputs (and a component layer's published outputs) win over props of the same key.
    if (findPort(resolveLayerOutputs(doc, c.id, layer, registry), a.key)) return undefined;
    if (!findPort(resolveLayerProps(doc, c.id, layer, registry), a.key)) return undefined;
    const stored = getOwn(layer.props, a.key);
    if (!isLinkInput(stored)) return undefined;
    seen.add(visit);
    return driverOf(stored.link, seen);
  };

  const out: PatchEdge[] = [];
  for (const [targetId, node] of Object.entries(c.patches)) {
    for (const [targetKey, value] of Object.entries(node.inputs)) {
      if (!isLinkInput(value)) continue;
      const a = parseAddress(value.link);
      if (!a || a.index !== undefined || (a.kind !== "patch" && a.kind !== "layer")) continue;
      const target = portsOf(targetId);
      if (target && !findPort(target.inputs, targetKey)) continue;
      const source = driverOf(value.link, new Set());
      if (!source || source.id === targetId) continue;
      const edge: PatchEdge = { from: formatAddress(a), to: `${targetId}.${targetKey}`, sourceId: source.id, sourceKey: source.key, targetId, targetKey };
      if (a.kind === "layer") edge.via = { kind: "layerProp", address: edge.from };
      out.push(edge);
    }
  }

  // Variables: a receiver resolves to the broadcaster with the same trimmed name, scope, and type
  // (lowest id on ties), like the engine. Muted broadcasters send zero values, so they add no edge.
  // Global receivers with no broadcaster here read from an enclosing component, outside this graph.
  const broadcasters: { id: Id; node: PatchNode; name: string; scope: string; type: string }[] = [];
  for (const [id, node] of Object.entries(c.patches)) {
    if (node.type !== VARIABLE_BROADCASTER_TYPE) continue;
    const ports = portsOf(id);
    if (ports) broadcasters.push({ id, node, ...variableOf(node), type: ports.inputs.find((p) => p.key === "value")?.type ?? "number" });
  }
  broadcasters.sort((x, y) => byId(x.id, y.id));
  for (const [receiverId, node] of Object.entries(c.patches)) {
    if (node.type !== VARIABLE_RECEIVER_TYPE) continue;
    const ports = portsOf(receiverId);
    const { name, scope } = variableOf(node);
    if (!ports || !name) continue;
    const type = ports.outputs[0]?.type ?? "number";
    const match = broadcasters.find((b) => b.name === name && b.scope === scope && b.type === type);
    const stored = match && match.node.muted !== true ? getOwn(match.node.inputs, "value") : undefined;
    if (!match || !isLinkInput(stored)) continue;
    const a = parseAddress(stored.link);
    const source = a && a.index === undefined ? driverOf(stored.link, new Set()) : undefined;
    if (!a || !source || source.id === receiverId) continue;
    out.push({
      from: formatAddress(a),
      to: `${receiverId}.name`,
      sourceId: source.id,
      sourceKey: source.key,
      targetId: receiverId,
      targetKey: "name",
      via: { kind: "variable", name, broadcasterId: match.id },
    });
  }
  return out.sort(compareEdges);
}

/** Strongly connected groups of two or more patches (Tarjan), each sorted, ordered by first id. */
function loopGroups(ids: readonly Id[], edges: readonly PatchEdge[]): Id[][] {
  const succ = new Map<Id, Id[]>();
  for (const e of edges) {
    const list = succ.get(e.sourceId);
    if (!list) succ.set(e.sourceId, [e.targetId]);
    else if (!list.includes(e.targetId)) list.push(e.targetId);
  }
  let index = 0;
  const indexes = new Map<Id, number>();
  const low = new Map<Id, number>();
  const stack: Id[] = [];
  const onStack = new Set<Id>();
  const out: Id[][] = [];
  const visit = (v: Id) => {
    indexes.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of succ.get(v) ?? []) {
      if (!indexes.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, indexes.get(w)!));
      }
    }
    if (low.get(v) === indexes.get(v)) {
      const group: Id[] = [];
      let w: Id;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        group.push(w);
      } while (w !== v);
      if (group.length > 1) out.push(group.sort(byId));
    }
  };
  for (const v of [...ids].sort(byId)) if (!indexes.has(v)) visit(v);
  return out.sort((a, b) => byId(a[0]!, b[0]!));
}

/** Right to left (or straight down) in the patch editor: the source sits at or right of the target. */
function runsBackwards(c: Component, e: PatchEdge): boolean {
  const sx = getOwn(c.patches, e.sourceId)?.ui?.x;
  const tx = getOwn(c.patches, e.targetId)?.ui?.x;
  return typeof sx === "number" && typeof tx === "number" && sx >= tx;
}

function pickFeedbackEdge(c: Component, inside: readonly PatchEdge[]): { edge: PatchEdge; reason: FeedbackReason } {
  // `inside` is in edge order, so the first match in each tier is the one whose target id sorts first.
  const delayed = inside.find((e) => getOwn(c.patches, e.targetId)?.type === DELAY_ONE_FRAME_TYPE);
  if (delayed) return { edge: delayed, reason: "delay1" };
  const backwards = inside.find((e) => runsBackwards(c, e));
  if (backwards) return { edge: backwards, reason: "backwards" };
  return { edge: inside[0]!, reason: "id" };
}

/**
 * Feedback loops in a component and, for each, the cables that read the previous frame.
 *
 * Rule (the engine orders loops the same way): while patches still form a loop, each loop gives up
 * one of its edges (patchEdges: cables, layer property reads, and variables), preferring
 * 1. an edge into Delay One Frame (delay1), then
 * 2. an edge that runs backwards in the patch editor (source patch ui.x ≥ target patch ui.x), then
 * 3. any edge.
 * Ties go to the edge whose target id sorts first (then target port, source id, source port).
 * The chosen edges are set aside and the rest is checked again, so a loop inside a loop gives up
 * its own edge. Direct self-edges aren't counted: ops and diagnostics reject them (self_edge).
 */
export function feedbackLoops(doc: SonobeDocument, componentId: Id, registry: Registry): FeedbackLoop[] {
  const c = getOwn(doc.components, componentId);
  if (!c) return [];
  const ids = Object.keys(c.patches);
  const edges = patchEdges(doc, componentId, registry);
  const loops: FeedbackLoop[] = loopGroups(ids, edges).map((patchIds) => ({ patchIds, feedback: [] }));
  const loopOf = new Map<Id, FeedbackLoop>();
  for (const loop of loops) for (const id of loop.patchIds) loopOf.set(id, loop);
  let remaining = edges.filter((e) => loopOf.has(e.sourceId) && loopOf.get(e.sourceId) === loopOf.get(e.targetId));
  for (let groups = loopGroups(ids, remaining); groups.length; groups = loopGroups(ids, remaining)) {
    const chosen = new Set<PatchEdge>();
    for (const group of groups) {
      const members = new Set(group);
      const pick = pickFeedbackEdge(c, remaining.filter((e) => members.has(e.sourceId) && members.has(e.targetId)));
      chosen.add(pick.edge);
      loopOf.get(pick.edge.targetId)!.feedback.push({ ...pick.edge, reason: pick.reason });
    }
    remaining = remaining.filter((e) => !chosen.has(e));
  }
  for (const loop of loops) loop.feedback.sort(compareEdges);
  return loops;
}

/** The cables that read the previous frame's value, across every feedback loop in a component (see feedbackLoops). */
export function feedbackEdges(doc: SonobeDocument, componentId: Id, registry: Registry): FeedbackEdge[] {
  return feedbackLoops(doc, componentId, registry)
    .flatMap((loop) => loop.feedback)
    .sort(compareEdges);
}
