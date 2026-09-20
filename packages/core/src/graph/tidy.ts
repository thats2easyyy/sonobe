/**
 * Tidy Up, shared by the patch editor and MCP tidy_graph. Comment frames are sections:
 *
 * 1. Each node belongs to the innermost frame under its title bar (frames.ts), and frames nest the
 *    same way. Frames are handled innermost first, the unframed nodes last.
 * 2. A frame's nodes get a layered left-to-right layout, anchored at the frame's top-left inside its
 *    title padding, keeping their reading order; then the frame is refit around them.
 * 3. The unframed nodes are laid out as one group, anchored where they were.
 * 4. Frames (and the unframed group) that now overlap are pushed apart in reading order: one that
 *    started to the right of the one it hits moves right, otherwise down.
 *
 * With frameMode "arrange", frames are laid out as blocks along with the loose nodes around them
 * instead of staying put. The layout of one group comes from a GroupLayout (ELK, in the editor and in
 * MCP), so this module stays pure and deterministic. Tidying twice changes nothing the second time.
 */

import type { Component, Op } from "../types.ts";
import { FRAME_PADDING, fitFrame, homeFrame } from "./frames.ts";
import { rectsOverlap, type Rect } from "./geometry.ts";
import { isPositionedNodeId, nodePositionsOp } from "./graphNodes.ts";

type XY = { x: number; y: number };

export interface TidyPort {
  /** Handle id ("in:number"). */
  id: string;
  side: "in" | "out";
  /** Offset of the port's center from the node's top edge. */
  y: number;
}

export interface TidyNode extends Rect {
  /** Graph node id: a patch id, "@layerId", "$in" or "$out". */
  id: string;
  ports?: readonly TidyPort[];
}

export interface TidyEdge {
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

export interface TidyFrame extends Rect {
  /** Comment id. */
  id: string;
}

/** What to tidy: everything, the insides of some frames, or some nodes (each within its own frame). */
export type TidyScope = { kind: "all" } | { kind: "frames"; ids: readonly string[] } | { kind: "nodes"; ids: readonly string[] };

export interface TidyLayoutOptions {
  /** LR: sources left, consumers right. TB: sources on top. */
  direction: "LR" | "TB";
  /** Gap between columns (LR). */
  columnGap: number;
  /** Gap between nodes in a column (LR). */
  rowGap: number;
}

/** Lays out one group of nodes (given in reading order); positions are relative to the group's top-left at (0, 0). */
export type GroupLayout = (nodes: readonly TidyNode[], edges: readonly TidyEdge[], options: TidyLayoutOptions) => Promise<Map<string, XY>>;

export interface TidyRequest {
  nodes: readonly TidyNode[];
  edges: readonly TidyEdge[];
  frames?: readonly TidyFrame[];
  /** Default: everything. */
  scope?: TidyScope;
  /** "keep" (default): frames stay where they are, refit and pushed apart. "arrange": frames are laid out as blocks too. */
  frameMode?: "keep" | "arrange";
  direction?: "LR" | "TB";
  /** Default 72. */
  columnGap?: number;
  /** Default 28. */
  rowGap?: number;
  /** Room kept between frames (and groups) pushed apart. Default 40. */
  blockGap?: number;
}

export interface TidyPush {
  /** A frame id, or "nodes" for a group of unframed nodes. */
  id: string;
  /** The frame (or "nodes") it was pushed clear of. */
  by: string;
  dx: number;
  dy: number;
}

export interface TidyPlan {
  /** New top-left positions of the nodes that moved. */
  nodes: Map<string, XY>;
  /** New rects of the frames that moved or changed size. */
  frames: Map<string, Rect>;
  /** Frames and groups pushed clear of another, in the order it happened. */
  pushed: TidyPush[];
}

const ROOT = "";
const NODES = "nodes";

const readingOrder = (a: Rect, b: Rect) => a.y - b.y || a.x - b.x;

const bbox = (rects: readonly Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
};

const union = (a: Rect, b: Rect): Rect => bbox([a, b]);

const grown = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 });

interface Block {
  id: string;
  /** Where it was before this tidy (reading order and push direction). */
  orig: Rect;
  rect: Rect;
  nodes: string[];
  frames: string[];
  /** Laid out, refit or pushed by this tidy. Overlaps between two untouched blocks are left alone. */
  touched: boolean;
}

/** Where every node and frame goes; see the module comment for the rules. */
export async function planTidy(request: TidyRequest, layout: GroupLayout): Promise<TidyPlan> {
  const options: TidyLayoutOptions = { direction: request.direction ?? "LR", columnGap: request.columnGap ?? 72, rowGap: request.rowGap ?? 28 };
  const gap = request.blockGap ?? 40;
  const scope = request.scope ?? { kind: "all" };
  const arrange = request.frameMode === "arrange";
  const frames = request.frames ?? [];
  const nodes = request.nodes;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const pos = new Map<string, XY>(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const rects = new Map<string, Rect>(frames.map((f) => [f.id, { x: f.x, y: f.y, width: f.width, height: f.height }]));
  const origFrame = new Map<string, Rect>(frames.map((f) => [f.id, f]));

  // -- Sections: which frame holds each node and each frame -------------------
  const parentOf = new Map<string, string>();
  for (const f of frames) {
    const parent = homeFrame(f, frames.filter((o) => o.id !== f.id && o.width * o.height > f.width * f.height));
    parentOf.set(f.id, parent?.id ?? ROOT);
  }
  const homeOf = new Map<string, string>(nodes.map((n) => [n.id, homeFrame(n, frames)?.id ?? ROOT]));
  const childFrames = new Map<string, string[]>();
  const childNodes = new Map<string, string[]>();
  for (const [id, parent] of parentOf) childFrames.set(parent, [...(childFrames.get(parent) ?? []), id]);
  for (const [id, home] of homeOf) childNodes.set(home, [...(childNodes.get(home) ?? []), id]);
  const depth = (id: string): number => {
    let d = 0;
    for (let p = parentOf.get(id); p && p !== ROOT && d <= frames.length; p = parentOf.get(p)) d++;
    return d;
  };
  const contents = (frameId: string): { nodes: string[]; frames: string[] } => {
    const out = { nodes: [...(childNodes.get(frameId) ?? [])], frames: [] as string[] };
    for (const child of childFrames.get(frameId) ?? []) {
      const inner = contents(child);
      out.frames.push(child, ...inner.frames);
      out.nodes.push(...inner.nodes);
    }
    return out;
  };

  const nodeRect = (id: string): Rect => ({ ...pos.get(id)!, width: nodeById.get(id)!.width, height: nodeById.get(id)!.height });
  const move = (block: Pick<Block, "nodes" | "frames">, dx: number, dy: number) => {
    if (!dx && !dy) return;
    for (const id of block.nodes) {
      const p = pos.get(id)!;
      pos.set(id, { x: p.x + dx, y: p.y + dy });
    }
    for (const id of block.frames) {
      const r = rects.get(id)!;
      rects.set(id, { ...r, x: r.x + dx, y: r.y + dy });
    }
  };
  const changed = new Set<string>();
  const frameBlock = (id: string): Block => {
    const inner = contents(id);
    return { id, orig: origFrame.get(id)!, rect: rects.get(id)!, nodes: inner.nodes, frames: [id, ...inner.frames], touched: changed.has(id) };
  };

  // -- What's in scope -----------------------------------------------------------
  const selected = scope.kind === "nodes" ? new Set(scope.ids) : undefined;
  const tidiedFrames = scope.kind === "frames" ? new Set(scope.ids) : undefined;
  const laidOutIn = (container: string): string[] => {
    const direct = childNodes.get(container) ?? [];
    if (scope.kind === "all") return direct;
    if (scope.kind === "frames") return tidiedFrames!.has(container) ? direct : [];
    return direct.filter((id) => selected!.has(id));
  };

  const pushed: TidyPush[] = [];
  const pushApart = (blocks: Block[]) => {
    const placed: Block[] = [];
    for (const b of [...blocks].sort((a, c) => readingOrder(a.orig, c.orig))) {
      for (let guard = 0; guard < 100; guard++) {
        const hit = placed.find((a) => (a.touched || b.touched) && rectsOverlap(grown(a.rect, gap - 1), b.rect));
        if (!hit) break;
        const wasRight = b.orig.x >= hit.orig.x + hit.orig.width - 1;
        const dx = wasRight ? hit.rect.x + hit.rect.width + gap - b.rect.x : 0;
        const dy = wasRight ? 0 : hit.rect.y + hit.rect.height + gap - b.rect.y;
        move(b, dx, dy);
        b.rect = { ...b.rect, x: b.rect.x + dx, y: b.rect.y + dy };
        b.touched = true;
        for (const id of b.frames) changed.add(id);
        pushed.push({ id: b.id, by: hit.id, dx, dy });
      }
      placed.push(b);
    }
  };

  // -- Innermost frames first, the unframed nodes last ---------------------------
  const containers = [...frames.map((f) => f.id).sort((a, b) => depth(b) - depth(a)), ROOT];
  for (const container of containers) {
    const members = laidOutIn(container).sort((a, b) => readingOrder(nodeRect(a), nodeRect(b)));
    const frame = container === ROOT ? undefined : rects.get(container)!;
    const arranging = arrange && scope.kind === "all";
    const blockFrames = arranging ? (childFrames.get(container) ?? []) : [];
    if (members.length || blockFrames.length) {
      changed.add(container);
      // One layout of the members (and, when arranging, the child frames as blocks).
      const units: TidyNode[] = [...members.map((id) => ({ ...nodeById.get(id)!, ...pos.get(id)! })), ...blockFrames.map((id) => ({ id, ...rects.get(id)! }))].sort(readingOrder);
      const unitOf = new Map<string, string>(members.map((id) => [id, id]));
      for (const f of blockFrames) for (const id of contents(f).nodes) unitOf.set(id, f);
      const edges: TidyEdge[] = [];
      for (const e of request.edges) {
        const source = unitOf.get(e.source);
        const target = unitOf.get(e.target);
        if (!source || !target || source === target) continue;
        edges.push({ source, target, ...(source === e.source && e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}), ...(target === e.target && e.targetHandle ? { targetHandle: e.targetHandle } : {}) });
      }
      const laid = await layout(units, edges, options);
      const before = bbox(units);
      const interior = frame ? { x: frame.x + FRAME_PADDING.left, y: frame.y + FRAME_PADDING.top } : undefined;
      // A frame's nodes start at its top-left; a selection stays where it was (inside its frame).
      const anchor = interior && scope.kind !== "nodes" ? interior : interior ? { x: Math.max(before.x, interior.x), y: Math.max(before.y, interior.y) } : { x: before.x, y: before.y };
      const frameUnits = new Set(blockFrames);
      for (const unit of units) {
        const p = laid.get(unit.id);
        if (!p) continue;
        const next = { x: Math.round(anchor.x + p.x), y: Math.round(anchor.y + p.y) };
        if (frameUnits.has(unit.id)) move(frameBlock(unit.id), next.x - unit.x, next.y - unit.y);
        else pos.set(unit.id, next);
      }
    }
    // Push apart what's inside this container, when something in it moved or grew.
    if (changed.has(container) && !arranging) {
      const blocks: Block[] = [];
      if (members.length) {
        const orig = bbox(members.map((id) => nodeById.get(id)!));
        blocks.push({ id: members.length === 1 ? members[0]! : NODES, orig, rect: bbox(members.map(nodeRect)), nodes: members, frames: [], touched: true });
      }
      for (const id of childNodes.get(container) ?? []) if (!members.includes(id)) blocks.push({ id, orig: nodeById.get(id)!, rect: nodeRect(id), nodes: [id], frames: [], touched: false });
      for (const id of childFrames.get(container) ?? []) blocks.push(frameBlock(id));
      pushApart(blocks);
    }
    // Refit the frame around what it holds: exactly when it was tidied, otherwise only growing.
    if (frame && changed.has(container)) {
      const inner = contents(container);
      const content = [...inner.nodes.map(nodeRect), ...(childFrames.get(container) ?? []).map((id) => rects.get(id)!)];
      const fit = fitFrame(content);
      if (fit) {
        const exact = scope.kind === "all" || (scope.kind === "frames" && tidiedFrames!.has(container));
        const next = exact ? fit : union(frame, fit);
        const rounded = { x: Math.round(next.x), y: Math.round(next.y), width: Math.round(next.width), height: Math.round(next.height) };
        const prev = rects.get(container)!;
        if (rounded.x !== prev.x || rounded.y !== prev.y || rounded.width !== prev.width || rounded.height !== prev.height) {
          rects.set(container, rounded);
          changed.add(parentOf.get(container) ?? ROOT);
        }
      }
    }
    if (container !== ROOT && changed.has(container)) changed.add(parentOf.get(container) ?? ROOT);
  }

  const plan: TidyPlan = { nodes: new Map(), frames: new Map(), pushed: pushed.filter((p) => p.dx || p.dy) };
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    const next = { x: Math.round(p.x), y: Math.round(p.y) };
    if (next.x !== n.x || next.y !== n.y) plan.nodes.set(n.id, next);
  }
  for (const f of frames) {
    const r = rects.get(f.id)!;
    if (r.x !== f.x || r.y !== f.y || r.width !== f.width || r.height !== f.height) plan.frames.set(f.id, r);
  }
  return plan;
}

/** The ops that apply a plan: updatePatch ui, updateComment rect, and one setNodePositions for layer and interface nodes. */
export function tidyPlanOps(component: Component, plan: TidyPlan): Op[] {
  const ops: Op[] = [];
  const positioned = new Map<string, XY>();
  for (const [id, p] of plan.nodes) {
    if (isPositionedNodeId(id)) positioned.set(id, p);
    else {
      const node = component.patches[id];
      if (node && (node.ui.x !== p.x || node.ui.y !== p.y)) ops.push({ op: "updatePatch", component: component.id, id, ui: { x: p.x, y: p.y } });
    }
  }
  for (const [id, r] of plan.frames) {
    const comment = component.comments.find((c) => c.id === id);
    const rect: [number, number, number, number] = [r.x, r.y, r.width, r.height];
    if (comment && rect.some((v, i) => v !== comment.rect[i])) ops.push({ op: "updateComment", component: component.id, id, rect });
  }
  const positions = positioned.size ? nodePositionsOp(component, positioned) : undefined;
  if (positions) ops.push(positions);
  return ops;
}

// ---------------------------------------------------------------------------
// ELK
// ---------------------------------------------------------------------------

/** The part of an ELK graph this module builds and reads (elkjs's ElkNode). */
export interface ElkGraphNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  ports?: { id: string; x?: number; y?: number; width?: number; height?: number; layoutOptions?: Record<string, string> }[];
  children?: ElkGraphNode[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
}

/** An ELK instance (elkjs): `new ELK()` from "elkjs/lib/elk.bundled.js". */
export interface ElkLike {
  layout(graph: ElkGraphNode): Promise<ElkGraphNode>;
}

/**
 * A GroupLayout on ELK's layered algorithm: ports fixed at their rows, nodes kept in the given order
 * where the flow allows (the graph is flat, so model order is safe), connected groups stacked.
 */
export function createElkGroupLayout(elk: ElkLike): GroupLayout {
  return async (nodes, edges, options) => {
    const out = new Map<string, XY>();
    if (nodes.length === 0) return out;
    const lr = options.direction !== "TB";
    const ids = new Set(nodes.map((n) => n.id));
    const portIds = new Set<string>();
    const graph: ElkGraphNode = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": lr ? "RIGHT" : "DOWN",
        "elk.spacing.nodeNode": String(options.rowGap),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(options.columnGap),
        "elk.spacing.edgeNode": "16",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.separateConnectedComponents": "true",
        "elk.spacing.componentComponent": String(options.rowGap),
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.considerModelOrder.components": "MODEL_ORDER",
      },
      children: nodes.map((n) => {
        const ports = lr
          ? (n.ports ?? []).map((p) => {
              const id = `${n.id}::${p.id}`;
              portIds.add(id);
              return { id, x: p.side === "in" ? 0 : n.width, y: p.y, width: 0, height: 0, layoutOptions: { "elk.port.side": p.side === "in" ? "WEST" : "EAST" } };
            })
          : [];
        return { id: n.id, width: n.width, height: n.height, ports, layoutOptions: { "elk.portConstraints": ports.length ? "FIXED_POS" : "FREE" } };
      }),
      edges: edges
        .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
        .map((e, i) => {
          const source = e.sourceHandle ? `${e.source}::${e.sourceHandle}` : "";
          const target = e.targetHandle ? `${e.target}::${e.targetHandle}` : "";
          return { id: `e${i}`, sources: [portIds.has(source) ? source : e.source], targets: [portIds.has(target) ? target : e.target] };
        }),
    };
    const laid = await elk.layout(graph);
    const children = laid.children ?? [];
    const minX = Math.min(...children.map((c) => c.x ?? 0));
    const minY = Math.min(...children.map((c) => c.y ?? 0));
    for (const c of children) out.set(c.id, { x: Math.round((c.x ?? 0) - minX), y: Math.round((c.y ?? 0) - minY) });
    return out;
  };
}
