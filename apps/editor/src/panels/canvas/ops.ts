/**
 * Op builders for canvas edits (move, resize, rotate, reorder, insert, text) and the geometry behind
 * the insert tools and layout reordering. Positions and sizes are rounded so files stay clean.
 */

import type { Id, InputValue, NewLayer, Op } from "@sonobe/core";
import { rectCenter, rectFromPoints, roundTo, type Point, type Rect } from "./geometry.ts";
import type { FlowLayout } from "./sceneIndex.ts";

export type InsertTool = "rectangle" | "oval" | "text";

/** Geometry is stored to 1/100 pt. */
export const GEOMETRY_PRECISION = 0.01;

export const cleanNumber = (n: number): number => roundTo(n, GEOMETRY_PRECISION);

export const cleanPoint = (p: readonly number[]): [number, number] => [cleanNumber(p[0] ?? 0), cleanNumber(p[1] ?? 0)];

type UpdateLayerOp = Extract<Op, { op: "updateLayer" }>;
type AddLayerOp = Extract<Op, { op: "addLayer" }>;

export interface MoveChange {
  id: Id;
  position: Point;
}

export function moveOps(componentId: Id, changes: readonly MoveChange[]): Op[] {
  return changes.map((c): UpdateLayerOp => ({ op: "updateLayer", component: componentId, id: c.id, props: { position: cleanPoint(c.position) } }));
}

export interface ResizeChange {
  id: Id;
  size: Point;
  position?: Point;
  /** Switch an auto, grow, or percent width to fixed so the new width sticks. */
  fixWidth?: boolean;
  fixHeight?: boolean;
}

export function resizeOps(componentId: Id, changes: readonly ResizeChange[]): Op[] {
  return changes.map((c): UpdateLayerOp => {
    const props: Record<string, InputValue> = { size: cleanPoint([Math.max(0, c.size[0]), Math.max(0, c.size[1])]) };
    if (c.position) props.position = cleanPoint(c.position);
    if (c.fixWidth) props.widthMode = "fixed";
    if (c.fixHeight) props.heightMode = "fixed";
    return { op: "updateLayer", component: componentId, id: c.id, props };
  });
}

export function rotateOps(componentId: Id, id: Id, rotation: number): Op[] {
  return [{ op: "updateLayer", component: componentId, id, props: { rotation: roundTo(rotation, GEOMETRY_PRECISION) } }];
}

export function reorderOps(componentId: Id, id: Id, parentId: Id | null, index: number): Op[] {
  return [{ op: "moveLayer", component: componentId, id, parent: parentId, index }];
}

export function textOps(componentId: Id, id: Id, text: string): Op[] {
  return [{ op: "updateLayer", component: componentId, id, props: { text } }];
}

/** Size used when an insert tool is clicked without dragging. */
export const DEFAULT_INSERT_SIZE: Readonly<Record<Exclude<InsertTool, "text">, Point>> = { rectangle: [100, 100], oval: [100, 100] };

export interface InsertOptions {
  /** Parent layer (null or omitted: the component root). */
  parent?: Id | null;
  index?: number;
  /** Temp ref for the new layer's id in the result's idMap. Default "inserted". */
  ref?: string;
  /** A click without a drag: default size (shapes) or auto width (text). */
  click?: boolean;
}

/** addLayer for an insert tool; `rect` is in the parent's space. */
export function insertOps(componentId: Id, tool: InsertTool, rect: Rect, options: InsertOptions = {}): Op[] {
  const click = options.click ?? (rect.width < 1 && rect.height < 1);
  const props: Record<string, InputValue> = { position: cleanPoint([rect.x, rect.y]) };
  if (tool === "text") {
    props.text = "Text";
    if (!click) {
      props.size = cleanPoint([Math.max(1, rect.width), Math.max(1, rect.height)]);
      props.widthMode = "fixed";
    }
  } else {
    props.size = click ? [...DEFAULT_INSERT_SIZE[tool]] : cleanPoint([Math.max(1, rect.width), Math.max(1, rect.height)]);
  }
  const layer: NewLayer = { ref: options.ref ?? "inserted", type: tool, props };
  const op: AddLayerOp = { op: "addLayer", component: componentId, parent: options.parent ?? null, layer };
  if (options.index !== undefined) op.index = options.index;
  return [op];
}

export interface DrawOptions {
  /** Equal width and height (⇧). */
  square?: boolean;
  /** Draw outward from the start point (⌥). */
  fromCenter?: boolean;
}

/** The rect an insert tool draws from `start` to `current`. */
export function drawRect(start: Point, current: Point, options: DrawOptions = {}): Rect {
  let dx = current[0] - start[0];
  let dy = current[1] - start[1];
  if (options.square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * s;
    dy = (dy < 0 ? -1 : 1) * s;
  }
  if (options.fromCenter) return { x: start[0] - Math.abs(dx), y: start[1] - Math.abs(dy), width: Math.abs(dx) * 2, height: Math.abs(dy) * 2 };
  return rectFromPoints(start, [start[0] + dx, start[1] + dy]);
}

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** Nudge distance for an arrow key: 1 pt, or 10 pt with ⇧. */
export function nudgeDelta(key: ArrowKey, big: boolean): Point {
  const step = big ? 10 : 1;
  switch (key) {
    case "ArrowUp":
      return [0, -step];
    case "ArrowDown":
      return [0, step];
    case "ArrowLeft":
      return [-step, 0];
    case "ArrowRight":
      return [step, 0];
  }
}

export interface FlowChild {
  id: Id;
  /** Artboard bounds. */
  rect: Rect;
  /** Arranged by the parent's layout (not absolute, not a fill). */
  inFlow: boolean;
}

export interface DropTarget {
  /** `moveLayer` index among the parent's children (after removing the dragged layer). */
  index: number;
  /** Position among the other in-flow siblings (what the layout sees). */
  flowIndex: number;
  /** Insertion marker in artboard space. */
  line: [Point, Point] | null;
}

/** Where a dragged layout child lands among its siblings, for a pointer at `point`. */
export function layoutDropTarget(children: readonly FlowChild[], draggedId: Id, point: Point, layout: FlowLayout): DropTarget {
  const others = children.filter((c) => c.id !== draggedId);
  const flow = others.filter((c) => c.inFlow);
  const original = Math.max(0, children.findIndex((c) => c.id === draggedId));
  if (flow.length === 0) return { index: original, flowIndex: 0, line: null };
  const before = (c: FlowChild) => {
    const [cx, cy] = rectCenter(c.rect);
    if (layout === "row") return point[0] > cx;
    if (layout === "column") return point[1] > cy;
    return point[1] > c.rect.y + c.rect.height || (point[1] >= c.rect.y && point[0] > cx);
  };
  let k = 0;
  while (k < flow.length && before(flow[k]!)) k++;
  const vertical = layout !== "column";
  const edgeLine = (r: Rect, leading: boolean): [Point, Point] => {
    if (vertical) {
      const x = leading ? r.x : r.x + r.width;
      return [[x, r.y], [x, r.y + r.height]];
    }
    const y = leading ? r.y : r.y + r.height;
    return [[r.x, y], [r.x + r.width, y]];
  };
  if (k < flow.length) return { index: others.indexOf(flow[k]!), flowIndex: k, line: edgeLine(flow[k]!.rect, true) };
  const last = flow[flow.length - 1]!;
  return { index: others.indexOf(last) + 1, flowIndex: k, line: edgeLine(last.rect, false) };
}
