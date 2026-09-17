/**
 * The patch graph of a component: cables between patches, feedback loops, and which cables
 * read the previous frame's value (ARCHITECTURE §5.2). The engine orders loops by the same rule,
 * so diagnostics, the editor, and MCP explanations can name the cable that lags.
 */

import { parseAddress } from "./address.ts";
import { findPort, resolveNodePorts, type ResolvedPorts } from "./registry.ts";
import type { Component, Id, Registry, SonobeDocument } from "./types.ts";
import { isLinkInput } from "./values.ts";

/** Patch type of Delay One Frame, the documented feedback primitive. */
export const DELAY_ONE_FRAME_TYPE = "delay1";

/** A cable from a patch output into another patch's input. */
export interface PatchEdge {
  /** Source address: "patchId.outputKey". */
  from: string;
  /** Target address: "patchId.inputKey". */
  to: string;
  sourceId: Id;
  sourceKey: string;
  targetId: Id;
  targetKey: string;
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

/**
 * Every cable from a patch output into another patch's input in a component, in edge order.
 * Links to missing patches or ports, loop-index addresses, and direct self-edges aren't cables.
 */
export function patchEdges(doc: SonobeDocument, componentId: Id, registry: Registry): PatchEdge[] {
  const c = doc.components[componentId];
  if (!c) return [];
  const cache = new Map<Id, ResolvedPorts | undefined>();
  const portsOf = (id: Id) => {
    if (!cache.has(id)) cache.set(id, resolveNodePorts(doc, c.patches[id]!, registry));
    return cache.get(id);
  };
  const out: PatchEdge[] = [];
  for (const [targetId, node] of Object.entries(c.patches)) {
    for (const [targetKey, value] of Object.entries(node.inputs)) {
      if (!isLinkInput(value)) continue;
      const a = parseAddress(value.link);
      if (!a || a.kind !== "patch" || a.index !== undefined || a.id === targetId || !c.patches[a.id]) continue;
      const source = portsOf(a.id);
      const target = portsOf(targetId);
      if (source && !findPort(source.outputs, a.key)) continue;
      if (target && !findPort(target.inputs, targetKey)) continue;
      out.push({ from: `${a.id}.${a.key}`, to: `${targetId}.${targetKey}`, sourceId: a.id, sourceKey: a.key, targetId, targetKey });
    }
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
  const sx = c.patches[e.sourceId]?.ui?.x;
  const tx = c.patches[e.targetId]?.ui?.x;
  return typeof sx === "number" && typeof tx === "number" && sx >= tx;
}

function pickFeedbackEdge(c: Component, inside: readonly PatchEdge[]): { edge: PatchEdge; reason: FeedbackReason } {
  // `inside` is in edge order, so the first match in each tier is the one whose target id sorts first.
  const delayed = inside.find((e) => c.patches[e.targetId]?.type === DELAY_ONE_FRAME_TYPE);
  if (delayed) return { edge: delayed, reason: "delay1" };
  const backwards = inside.find((e) => runsBackwards(c, e));
  if (backwards) return { edge: backwards, reason: "backwards" };
  return { edge: inside[0]!, reason: "id" };
}

/**
 * Feedback loops in a component and, for each, the cables that read the previous frame.
 *
 * Rule (the engine orders loops the same way): while patches still form a loop, each loop gives up
 * one of its cables, preferring
 * 1. a cable into Delay One Frame (delay1), then
 * 2. a cable that runs backwards in the patch editor (source ui.x ≥ target ui.x), then
 * 3. any cable.
 * Ties go to the cable whose target id sorts first (then target port, source id, source port).
 * The chosen cables are set aside and the rest is checked again, so a loop inside a loop gives up
 * its own cable. Direct self-edges aren't counted: ops and diagnostics reject them (self_edge).
 */
export function feedbackLoops(doc: SonobeDocument, componentId: Id, registry: Registry): FeedbackLoop[] {
  const c = doc.components[componentId];
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
