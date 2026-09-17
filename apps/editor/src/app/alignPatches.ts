/**
 * Align patches from outside the patch editor (the native Patch menu): left, right, top, or bottom
 * edges, spreading patches that would overlap. Sizes come from the rendered nodes when the patch
 * editor is on screen, else from an estimate.
 */

import type { Component, Id, Op } from "@sonobe/core";

export interface PatchRect {
  id: Id;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlignEdge = "left" | "right" | "top" | "bottom";

/**
 * New positions for rects aligned on an edge. Left and right make a column (overlaps spread
 * downward); top and bottom make a row (overlaps spread to the right).
 */
export function alignPatchRects(rects: readonly PatchRect[], edge: AlignEdge, gap = edge === "left" || edge === "right" ? 16 : 24): Map<Id, { x: number; y: number }> {
  const out = new Map<Id, { x: number; y: number }>();
  if (rects.length === 0) return out;
  if (edge === "left" || edge === "right") {
    const left = Math.min(...rects.map((r) => r.x));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    let bottom = -Infinity;
    for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const y = Math.max(r.y, bottom + gap);
      out.set(r.id, { x: Math.round(edge === "left" ? left : right - r.width), y: Math.round(y) });
      bottom = y + r.height;
    }
  } else {
    const top = Math.min(...rects.map((r) => r.y));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    let right = -Infinity;
    for (const r of [...rects].sort((a, b) => a.x - b.x || a.y - b.y)) {
      const x = Math.max(r.x, right + gap);
      out.set(r.id, { x: Math.round(x), y: Math.round(edge === "top" ? top : bottom - r.height) });
      right = x + r.width;
    }
  }
  return out;
}

/** updatePatch ui ops for patches whose position changes. */
export function alignOps(component: Component, positions: ReadonlyMap<Id, { x: number; y: number }>): Op[] {
  const ops: Op[] = [];
  for (const [id, pos] of positions) {
    const node = component.patches[id];
    if (!node || (node.ui.x === pos.x && node.ui.y === pos.y)) continue;
    ops.push({ op: "updatePatch", component: component.id, id, ui: { x: pos.x, y: pos.y } });
  }
  return ops;
}

const ESTIMATE = { width: 168, header: 30, row: 22, footer: 8 };

/** A rough size for a patch that isn't rendered: a header plus one row per port pair. */
export function estimatePatchSize(inputCount: number, outputCount: number): { width: number; height: number } {
  return { width: ESTIMATE.width, height: ESTIMATE.header + Math.max(1, inputCount, outputCount) * ESTIMATE.row + ESTIMATE.footer };
}

/** The patch editor's zoom, read from React Flow's viewport transform (1 when not rendered). */
export function flowZoom(root: ParentNode): number {
  const viewport = root.querySelector<HTMLElement>(".sb-pe .react-flow__viewport");
  const match = viewport ? /scale\(([\d.]+)\)/.exec(viewport.style.transform) : null;
  const zoom = match ? Number(match[1]) : 1;
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/** Rects for patches in document coordinates, measuring rendered nodes when possible. */
export function patchRects(component: Component, ids: readonly Id[], portCounts: (id: Id) => { inputs: number; outputs: number }, root: ParentNode | null = typeof document === "undefined" ? null : document): PatchRect[] {
  const zoom = root ? flowZoom(root) : 1;
  const rects: PatchRect[] = [];
  for (const id of ids) {
    const node = component.patches[id];
    if (!node) continue;
    const element = root?.querySelector<HTMLElement>(`.sb-pe .react-flow__node[data-id="${cssEscape(id)}"]`);
    const box = element?.getBoundingClientRect();
    const size = box && box.width > 0 && box.height > 0 ? { width: box.width / zoom, height: box.height / zoom } : estimatePatchSize(portCounts(id).inputs, portCounts(id).outputs);
    rects.push({ id, x: node.ui.x, y: node.ui.y, ...size });
  }
  return rects;
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}
