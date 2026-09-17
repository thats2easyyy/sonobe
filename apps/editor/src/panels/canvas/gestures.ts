/**
 * Canvas gestures as pure functions: snapshot what a drag needs when it starts, then turn pointer
 * positions (artboard points) into ops plus the guides and measurements to draw. The panel owns
 * events, selection, and history.
 */

import { isLinkInput, type Id, type Op } from "@sonobe/core";
import { mat4 } from "@sonobe/engine";
import { boundsOf, isAxisAligned, quadOf, rectFromPoints, roundTo, transformPoint, unionRects, type Point, type Rect } from "./geometry.ts";
import { drawRect, insertOps, layoutDropTarget, moveOps, reorderOps, resizeOps, rotateOps, type DrawOptions, type DropTarget, type FlowChild, type InsertTool } from "./ops.ts";
import { hitLayers, isEditableLayer, type CanvasIndex, type FlowLayout } from "./sceneIndex.ts";
import { measureGaps, measurementMatchesMark, snapMove, snapRect, type Guide, type Measurement, type SnapEdge, type SpacingMark } from "./snapping.ts";
import { HANDLE_POINTS, frameFromProps, localMatrix, mapRect, parentDelta, positionForPoint, resizeFrame, resizeRect, rotateFrame, toParentSpace, type Handle, type LayerFrame } from "./transform.ts";

export interface GestureResult {
  ops: Op[];
  guides: Guide[];
  measurements: Measurement[];
  /** Equal gaps between siblings (moves only). */
  spacing?: SpacingMark[];
  /** Artboard bounds of what's being edited after this step. */
  bounds: Rect | null;
}

export interface SnapSettings {
  /** Snap to siblings and the artboard. */
  snap: boolean;
  /** Snap distance in artboard points (screen threshold / zoom). */
  threshold: number;
}

/** True when a document prop is driven by a link, so direct manipulation would fight the patch. */
export function isPropLinked(index: CanvasIndex, id: Id, key: string): boolean {
  return isLinkInput(index.entry(id)?.layer.props[key]);
}

interface SnapContext {
  /** Rects edges snap to: siblings, the container, and the artboard. */
  targets: Rect[];
  /** Sibling rects (for gap measurements). */
  others: Rect[];
  /** Parent bounds, or the artboard at the component root. */
  container: Rect | null;
}

function snapContext(index: CanvasIndex, ids: readonly Id[], artboard: Rect): SnapContext {
  const moving = new Set(ids);
  const parents = [...new Set(ids.map((id) => index.entry(id)?.parentId ?? null))];
  const others: Rect[] = [];
  for (const parentId of parents) {
    for (const sibling of index.children(parentId)) {
      if (moving.has(sibling.id) || sibling.hidden || sibling.layer.type === "colorFill") continue;
      const b = index.bounds(sibling.id);
      if (b) others.push(b);
    }
  }
  const parentId = parents.length === 1 ? parents[0]! : null;
  const container = parentId !== null ? index.bounds(parentId) : artboard;
  const targets = [...others];
  if (container) targets.push(container);
  if (container !== artboard) targets.push(artboard);
  return { targets, others, container };
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

export interface MoveSnapshot extends SnapContext {
  componentId: Id;
  layers: { id: Id; position: Point; parentWorld: readonly number[] | null }[];
  bounds: Rect;
  /** Selected layers left out because their Position is linked to a patch. */
  blocked: Id[];
}

/** Start moving layers. Null when nothing selected can move (see `blocked`). */
export function beginMove(index: CanvasIndex, componentId: Id, ids: readonly Id[], artboard: Rect): MoveSnapshot | { blocked: Id[]; layers: [] } {
  const layers: MoveSnapshot["layers"] = [];
  const blocked: Id[] = [];
  const rects: Rect[] = [];
  for (const id of ids) {
    if (!isEditableLayer(index, id)) continue;
    if (isPropLinked(index, id, "position")) {
      blocked.push(id);
      continue;
    }
    const node = index.entry(id)!.node!;
    layers.push({ id, position: frameFromProps(node.props).position, parentWorld: index.parentWorld(id) });
    const b = index.bounds(id);
    if (b) rects.push(b);
  }
  const bounds = unionRects(rects);
  if (layers.length === 0 || !bounds) return { blocked, layers: [] };
  return { componentId, layers, bounds, blocked, ...snapContext(index, layers.map((l) => l.id), artboard) };
}

export interface MoveOptions extends SnapSettings {
  /** Constrain to the dominant axis (⇧). */
  axisLock?: boolean;
}

export function moveGesture(s: MoveSnapshot, start: Point, current: Point, options: MoveOptions): GestureResult {
  let dx = current[0] - start[0];
  let dy = current[1] - start[1];
  if (options.axisLock) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  // Land the selection on whole points.
  dx = roundTo(s.bounds.x + dx) - s.bounds.x;
  dy = roundTo(s.bounds.y + dy) - s.bounds.y;
  let guides: Guide[] = [];
  let spacing: SpacingMark[] = [];
  if (options.snap) {
    const edges: { edgesX?: SnapEdge[]; edgesY?: SnapEdge[] } = options.axisLock ? (dx === 0 ? { edgesX: [] } : { edgesY: [] }) : {};
    const snap = snapMove({ ...s.bounds, x: s.bounds.x + dx, y: s.bounds.y + dy }, s.targets, s.others, { threshold: options.threshold, ...edges });
    dx += snap.dx;
    dy += snap.dy;
    guides = snap.guides;
    spacing = snap.spacing;
  }
  const moved: Rect = { ...s.bounds, x: s.bounds.x + dx, y: s.bounds.y + dy };
  const target: Point = [start[0] + dx, start[1] + dy];
  const ops = moveOps(
    s.componentId,
    s.layers.map((l) => {
      const d = parentDelta(l.parentWorld, start, target);
      return { id: l.id, position: [l.position[0] + d[0], l.position[1] + d[1]] as Point };
    }),
  );
  const measurements = measureGaps(moved, s.others, s.container).filter((m) => !spacing.some((mark) => measurementMatchesMark(m, mark)));
  return { ops, guides, measurements, spacing, bounds: moved };
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

interface ResizeMember {
  id: Id;
  frame: LayerFrame;
  parentWorld: readonly number[] | null;
  bounds: Rect;
  /** No rotation or flip on screen: edges line up with artboard axes. */
  axisAligned: boolean;
  /** Placed by the parent's layout (Position is ignored). */
  flow: boolean;
  widthMode: string;
  heightMode: string;
}

export interface ResizeSnapshot extends SnapContext {
  componentId: Id;
  handle: Handle;
  members: ResizeMember[];
  bounds: Rect;
  blocked: Id[];
}

export function beginResize(index: CanvasIndex, componentId: Id, ids: readonly Id[], handle: Handle, artboard: Rect): ResizeSnapshot | null {
  const members: ResizeMember[] = [];
  const blocked: Id[] = [];
  for (const id of ids) {
    if (!isEditableLayer(index, id)) continue;
    const flow = index.flowLayout(id) !== null;
    if (isPropLinked(index, id, "size") || (!flow && isPropLinked(index, id, "position"))) {
      blocked.push(id);
      continue;
    }
    const node = index.entry(id)!.node!;
    const bounds = index.bounds(id);
    if (!bounds) continue;
    const m = node.worldTransform;
    members.push({
      id,
      frame: frameFromProps(node.props, [node.width, node.height]),
      parentWorld: index.parentWorld(id),
      bounds,
      axisAligned: isAxisAligned(m) && m[0]! > 0 && m[5]! > 0,
      flow,
      widthMode: typeof node.props.widthMode === "string" ? node.props.widthMode : "fixed",
      heightMode: typeof node.props.heightMode === "string" ? node.props.heightMode : "fixed",
    });
  }
  const bounds = members.length === 1 ? members[0]!.bounds : unionRects(members.map((m) => m.bounds));
  if (members.length === 0 || !bounds) return null;
  return { componentId, handle, members, bounds, blocked, ...snapContext(index, members.map((m) => m.id), artboard) };
}

export interface ResizeGestureOptions extends SnapSettings {
  proportional?: boolean;
  fromCenter?: boolean;
}

function snapEdges(handle: Handle): { edgesX: SnapEdge[]; edgesY: SnapEdge[] } {
  const [hx, hy] = HANDLE_POINTS[handle];
  const edge = (h: number): SnapEdge[] => (h === 0 ? ["start"] : h === 1 ? ["end"] : []);
  return { edgesX: edge(hx), edgesY: edge(hy) };
}

const changed = (a: number, b: number) => Math.abs(a - b) > 1e-6;

function resizeStep(s: ResizeSnapshot, start: Point, delta: Point, options: ResizeGestureOptions): { ops: Op[]; bounds: Rect } {
  const resizeOptions = { proportional: !!options.proportional, fromCenter: !!options.fromCenter };
  if (s.members.length === 1) {
    const m = s.members[0]!;
    const pd = parentDelta(m.parentWorld, start, [start[0] + delta[0], start[1] + delta[1]]);
    const r = resizeFrame(m.frame, s.handle, pd, { ...resizeOptions, minSize: 1 });
    const next: LayerFrame = { ...m.frame, position: r.position, size: r.size };
    const world = m.parentWorld ? mat4.multiply(m.parentWorld, localMatrix(next)) : localMatrix(next);
    const ops = resizeOps(s.componentId, [
      {
        id: m.id,
        size: r.size,
        ...(m.flow ? {} : { position: r.position }),
        fixWidth: m.widthMode !== "fixed" && changed(r.size[0], m.frame.size[0]),
        fixHeight: m.heightMode !== "fixed" && changed(r.size[1], m.frame.size[1]),
      },
    ]);
    return { ops, bounds: boundsOf(quadOf(world, r.size[0], r.size[1])) };
  }
  const next = resizeRect(s.bounds, s.handle, delta, resizeOptions);
  const sx = s.bounds.width > 0 ? next.width / s.bounds.width : 1;
  const sy = s.bounds.height > 0 ? next.height / s.bounds.height : 1;
  const ops = resizeOps(
    s.componentId,
    s.members.map((m) => {
      const mapped = mapRect(m.bounds, s.bounds, next);
      const size: Point = m.axisAligned ? [Math.max(1, m.frame.size[0] * sx), Math.max(1, m.frame.size[1] * sy)] : [...m.frame.size];
      const center = toParentSpace(m.parentWorld, [mapped.x + mapped.width / 2, mapped.y + mapped.height / 2]);
      const position = positionForPoint({ ...m.frame, size }, [0.5, 0.5], center);
      return {
        id: m.id,
        size,
        ...(m.flow ? {} : { position }),
        fixWidth: m.widthMode !== "fixed" && changed(size[0], m.frame.size[0]),
        fixHeight: m.heightMode !== "fixed" && changed(size[1], m.frame.size[1]),
      };
    }),
  );
  return { ops, bounds: next };
}

/** Resize from a handle drag. Snaps the moving edges of unrotated layers (not while ⇧ keeps proportions). */
export function resizeGesture(s: ResizeSnapshot, start: Point, current: Point, options: ResizeGestureOptions): GestureResult {
  let delta: Point = [current[0] - start[0], current[1] - start[1]];
  let step = resizeStep(s, start, delta, options);
  let guides: Guide[] = [];
  const snappable = options.snap && !options.proportional && s.members.every((m) => m.axisAligned && !m.flow);
  if (snappable) {
    const snap = snapRect(step.bounds, s.targets, { threshold: options.threshold, ...snapEdges(s.handle) });
    if (snap.dx !== 0 || snap.dy !== 0) {
      delta = [delta[0] + snap.dx, delta[1] + snap.dy];
      step = resizeStep(s, start, delta, options);
    }
    guides = snap.guides;
  }
  return { ops: step.ops, guides, measurements: [], bounds: step.bounds };
}

// ---------------------------------------------------------------------------
// Rotate
// ---------------------------------------------------------------------------

export interface RotateSnapshot {
  componentId: Id;
  id: Id;
  rotation: number;
  /** The pivot in artboard space. */
  center: Point;
}

export function beginRotate(index: CanvasIndex, componentId: Id, id: Id): RotateSnapshot | null {
  if (!isEditableLayer(index, id) || isPropLinked(index, id, "rotation")) return null;
  const node = index.entry(id)!.node!;
  const frame = frameFromProps(node.props, [node.width, node.height]);
  return { componentId, id, rotation: frame.rotation, center: transformPoint(node.worldTransform, [frame.pivot[0] * node.width, frame.pivot[1] * node.height]) };
}

export function rotateGesture(s: RotateSnapshot, start: Point, current: Point, options: { snap?: boolean } = {}): { ops: Op[]; rotation: number } {
  const rotation = rotateFrame(s.rotation, s.center, start, current, { snap: !!options.snap });
  return { ops: rotateOps(s.componentId, s.id, rotation), rotation };
}

// ---------------------------------------------------------------------------
// Reorder (layout children)
// ---------------------------------------------------------------------------

export interface ReorderSnapshot {
  componentId: Id;
  id: Id;
  parentId: Id | null;
  layout: FlowLayout;
  /** Siblings as they were when the drag started. */
  children: FlowChild[];
  /** Index among the parent's children. */
  index: number;
  /** Index among the other in-flow siblings. */
  flowIndex: number;
  bounds: Rect;
}

/** Start dragging a layout child: it reorders among its siblings instead of moving. */
export function beginReorder(index: CanvasIndex, componentId: Id, id: Id): ReorderSnapshot | null {
  const layout = index.flowLayout(id);
  const entry = index.entry(id);
  const bounds = index.bounds(id);
  if (!layout || !entry || !bounds || entry.locked) return null;
  const children = index.children(entry.parentId).map((c) => ({ id: c.id, rect: index.bounds(c.id) ?? { x: 0, y: 0, width: 0, height: 0 }, inFlow: index.flowLayout(c.id) !== null }));
  const flowIndex = children.slice(0, entry.index).filter((c) => c.inFlow).length;
  return { componentId, id, parentId: entry.parentId, layout, children, index: entry.index, flowIndex, bounds };
}

export function reorderGesture(s: ReorderSnapshot, start: Point, current: Point): { ops: Op[]; drop: DropTarget; ghost: Rect } {
  const drop = layoutDropTarget(s.children, s.id, current, s.layout);
  return {
    ops: drop.flowIndex === s.flowIndex ? [] : reorderOps(s.componentId, s.id, s.parentId, drop.index),
    drop,
    ghost: { ...s.bounds, x: s.bounds.x + current[0] - start[0], y: s.bounds.y + current[1] - start[1] },
  };
}

// ---------------------------------------------------------------------------
// Nudge
// ---------------------------------------------------------------------------

/** Positions for a nudge run: `starts` plus the accumulated delta (parent units). */
export function nudgeGesture(componentId: Id, starts: ReadonlyMap<Id, Point>, delta: Point): Op[] {
  return moveOps(componentId, [...starts].map(([id, p]) => ({ id, position: [p[0] + delta[0], p[1] + delta[1]] as Point })));
}

/** Current literal-or-default positions of nudgeable layers (absolute, Position not linked). */
export function nudgeStarts(index: CanvasIndex, ids: readonly Id[]): { starts: Map<Id, Point>; blocked: Id[] } {
  const starts = new Map<Id, Point>();
  const blocked: Id[] = [];
  for (const id of ids) {
    if (!isEditableLayer(index, id) || index.flowLayout(id)) continue;
    if (isPropLinked(index, id, "position")) blocked.push(id);
    else starts.set(id, frameFromProps(index.entry(id)!.node!.props).position);
  }
  return { starts, blocked };
}

/** Move a layout child one step along its siblings (arrow keys in a layout). Empty at either end. */
export function nudgeReorder(index: CanvasIndex, componentId: Id, id: Id, direction: 1 | -1): Op[] {
  const entry = index.entry(id);
  if (!entry || !index.flowLayout(id)) return [];
  const siblings = index.children(entry.parentId);
  for (let j = entry.index + direction; j >= 0 && j < siblings.length; j += direction) {
    if (index.flowLayout(siblings[j]!.id)) return reorderOps(componentId, id, entry.parentId, j);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

/** The group a new layer drawn at `p` goes into: the deepest unrotated group under the point. */
export function insertParentAt(index: CanvasIndex, p: Point): Id | null {
  for (const id of hitLayers(index, p)) {
    const entry = index.entry(id);
    const node = entry?.node;
    if (entry?.layer.type !== "group" || !node) continue;
    const m = node.worldTransform;
    if (isAxisAligned(m) && m[0]! > 0 && m[5]! > 0) return id;
  }
  return null;
}

export interface InsertGestureOptions extends DrawOptions {
  /** The pointer never moved past the drag threshold. */
  click?: boolean;
}

export interface InsertResult {
  ops: Op[];
  /** Drawn rect in artboard space (zero size for a click). */
  rect: Rect;
  parentId: Id | null;
}

/** addLayer for an insert-tool drag from `start` to `current` (artboard points). */
export function insertGesture(index: CanvasIndex, componentId: Id, tool: InsertTool, start: Point, current: Point, options: InsertGestureOptions = {}): InsertResult {
  const snappedStart: Point = [roundTo(start[0]), roundTo(start[1])];
  const rect = options.click ? { x: snappedStart[0], y: snappedStart[1], width: 0, height: 0 } : drawRect(snappedStart, [roundTo(current[0]), roundTo(current[1])], options);
  const parentId = insertParentAt(index, start);
  const world = parentId ? (index.entry(parentId)?.node?.worldTransform ?? null) : null;
  const a = toParentSpace(world, [rect.x, rect.y]);
  const b = toParentSpace(world, [rect.x + rect.width, rect.y + rect.height]);
  const local = rectFromPoints([roundTo(a[0], 0.5), roundTo(a[1], 0.5)], [roundTo(b[0], 0.5), roundTo(b[1], 0.5)]);
  return { ops: insertOps(componentId, tool, local, { parent: parentId, click: !!options.click }), rect, parentId };
}
