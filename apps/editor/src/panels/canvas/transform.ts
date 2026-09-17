/**
 * Layer frame math for direct manipulation. A layer's local transform is
 * T(position − anchor·size) · T(pivot·size) · R · S · T(−pivot·size) (engine `mat4.compose`), so a
 * resize solves for the Position that keeps the opposite handle (or the center) fixed in the parent.
 */

import { mat4 } from "@sonobe/engine";
import { inverseTransformPoint, normalizeAngle, type Point, type Rect } from "./geometry.ts";

export interface LayerFrame {
  /** Where the anchor point sits in the parent. */
  position: Point;
  /** Laid-out size in points (before scale). */
  size: Point;
  anchor: Point;
  pivot: Point;
  /** Scale × Scale XYZ on X and Y. */
  scale: Point;
  rotation: number;
  rotationX: number;
  rotationY: number;
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Normalized handle positions in the layer box. */
export const HANDLE_POINTS: Readonly<Record<Handle, Point>> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

const vec2 = (v: unknown, fallback: Point): Point => (Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0] as number, v[1] as number] : fallback);

/** Frame from resolved layer props (SceneNode props). `size` overrides props.size (use the laid-out size). */
export function frameFromProps(props: Readonly<Record<string, unknown>>, size?: Point): LayerFrame {
  const scale = num(props.scale, 1);
  const sxyz = Array.isArray(props.scaleXYZ) ? (props.scaleXYZ as unknown[]) : [];
  return {
    position: vec2(props.position, [0, 0]),
    size: size ?? vec2(props.size, [100, 100]),
    anchor: vec2(props.anchor, [0, 0]),
    pivot: vec2(props.pivot, [0.5, 0.5]),
    scale: [scale * num(sxyz[0], 1), scale * num(sxyz[1], 1)],
    rotation: num(props.rotation, 0),
    rotationX: num(props.rotationX, 0),
    rotationY: num(props.rotationY, 0),
  };
}

/** The layer's local transform (layer space → parent space). */
export function localMatrix(frame: LayerFrame): number[] {
  return mat4.compose({
    position: frame.position,
    size: frame.size,
    anchor: frame.anchor,
    pivot: frame.pivot,
    scale: [frame.scale[0], frame.scale[1], 1],
    rotationX: frame.rotationX,
    rotationY: frame.rotationY,
    rotationZ: frame.rotation,
  });
}

/** Rotation × scale as [a, b, c, d]: local vector (x, y) → (a·x + c·y, b·x + d·y) in the parent. */
export function linearPart(frame: LayerFrame): [number, number, number, number] {
  const m = mat4.compose({ size: frame.size, pivot: [0, 0], scale: [frame.scale[0], frame.scale[1], 1], rotationX: frame.rotationX, rotationY: frame.rotationY, rotationZ: frame.rotation });
  return [m[0]!, m[1]!, m[4]!, m[5]!];
}

/** Parent-space position of a layer-local point. */
export function frameToParent(frame: LayerFrame, local: Point): Point {
  const [a, b, c, d] = linearPart(frame);
  const [w, h] = frame.size;
  const px = frame.pivot[0] * w;
  const py = frame.pivot[1] * h;
  const left = frame.position[0] - frame.anchor[0] * w;
  const top = frame.position[1] - frame.anchor[1] * h;
  const vx = local[0] - px;
  const vy = local[1] - py;
  return [left + px + a * vx + c * vy, top + py + b * vx + d * vy];
}

/** Top-left of the unrotated box in the parent (Position − Anchor × Size). */
export function frameTopLeft(frame: LayerFrame): Point {
  return [frame.position[0] - frame.anchor[0] * frame.size[0], frame.position[1] - frame.anchor[1] * frame.size[1]];
}

/** A Position that puts the box's top-left at `topLeft` for this anchor and size. */
export function positionForTopLeft(topLeft: Point, anchor: Point, size: Point): Point {
  return [topLeft[0] + anchor[0] * size[0], topLeft[1] + anchor[1] * size[1]];
}

/**
 * A Position that puts the normalized box point `normalized` ([0.5, 0.5] = center) at `target` in the
 * parent, for the frame's size, anchor, pivot, rotation, and scale.
 */
export function positionForPoint(frame: LayerFrame, normalized: Point, target: Point): Point {
  const [a, b, c, d] = linearPart(frame);
  const [w, h] = frame.size;
  const px = frame.pivot[0] * w;
  const py = frame.pivot[1] * h;
  const vx = normalized[0] * w - px;
  const vy = normalized[1] * h - py;
  return [target[0] + frame.anchor[0] * w - px - (a * vx + c * vy), target[1] + frame.anchor[1] * h - py - (b * vx + d * vy)];
}

export interface ResizeOptions {
  /** Keep the aspect ratio (⇧). */
  proportional?: boolean;
  /** Resize about the center (⌥). */
  fromCenter?: boolean;
  /** Smallest width or height. Default 1. */
  minSize?: number;
}

export interface ResizeResult {
  position: Point;
  size: Point;
}

/**
 * Drag `handle` by `parentDelta` (in the layer's parent space). The opposite handle stays fixed in
 * the parent (the center with `fromCenter`), whatever the layer's anchor, pivot, rotation, or scale.
 */
export function resizeFrame(frame: LayerFrame, handle: Handle, parentDelta: Point, options: ResizeOptions = {}): ResizeResult {
  const [a, b, c, d] = linearPart(frame);
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return { position: [...frame.position], size: [...frame.size] };
  const dlx = (d * parentDelta[0] - c * parentDelta[1]) / det;
  const dly = (-b * parentDelta[0] + a * parentDelta[1]) / det;
  const [hx, hy] = HANDLE_POINTS[handle];
  const movesX = hx !== 0.5;
  const movesY = hy !== 0.5;
  const fx = movesX && !options.fromCenter ? 1 - hx : 0.5;
  const fy = movesY && !options.fromCenter ? 1 - hy : 0.5;
  const [w, h] = frame.size;
  const min = options.minSize ?? 1;

  let nw = movesX ? Math.max(min, (hx * w + dlx - fx * w) / (hx - fx)) : w;
  let nh = movesY ? Math.max(min, (hy * h + dly - fy * h) / (hy - fy)) : h;
  if (options.proportional && w > 0 && h > 0) {
    const ratio = w / h;
    if (movesX && movesY) {
      const sx = nw / w;
      const sy = nh / h;
      const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
      nw = w * s;
      nh = h * s;
    } else if (movesX) {
      nh = nw / ratio;
    } else if (movesY) {
      nw = nh * ratio;
    }
    if (nw < min || nh < min) {
      const s = Math.max(min / nw, min / nh);
      nw *= s;
      nh *= s;
    }
  }

  const target = frameToParent(frame, [fx * w, fy * h]);
  return { position: positionForPoint({ ...frame, size: [nw, nh] }, [fx, fy], target), size: [nw, nh] };
}

/** Resize an axis-aligned rect (the bounds of a multi-selection) with a handle drag. */
export function resizeRect(rect: Rect, handle: Handle, delta: Point, options: ResizeOptions = {}): Rect {
  const frame: LayerFrame = { position: [rect.x, rect.y], size: [rect.width, rect.height], anchor: [0, 0], pivot: [0.5, 0.5], scale: [1, 1], rotation: 0, rotationX: 0, rotationY: 0 };
  const r = resizeFrame(frame, handle, delta, { minSize: 0.01, ...options });
  return { x: r.position[0], y: r.position[1], width: r.size[0], height: r.size[1] };
}

/** Where `r` lands when the rect it sits in changes from `from` to `to`. */
export function mapRect(r: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return { x: to.x + (r.x - from.x) * sx, y: to.y + (r.y - from.y) * sy, width: r.width * sx, height: r.height * sy };
}

export interface RotateOptions {
  /** Snap the result to `step` degrees (⇧). */
  snap?: boolean;
  step?: number;
}

/** Rotation after dragging from `start` to `current` around `center` (all in one space). */
export function rotateFrame(startRotation: number, center: Point, start: Point, current: Point, options: RotateOptions = {}): number {
  const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const a1 = Math.atan2(current[1] - center[1], current[0] - center[0]);
  let r = startRotation + ((a1 - a0) * 180) / Math.PI;
  if (options.snap) {
    const step = options.step ?? 15;
    r = Math.round(r / step) * step;
  }
  return normalizeAngle(r);
}

/** A drag from `start` to `current` (artboard points) as a delta in the parent's space. */
export function parentDelta(parentWorld: readonly number[] | null, start: Point, current: Point): Point {
  if (!parentWorld) return [current[0] - start[0], current[1] - start[1]];
  const a = inverseTransformPoint(parentWorld, start);
  const b = inverseTransformPoint(parentWorld, current);
  return a && b ? [b[0] - a[0], b[1] - a[1]] : [0, 0];
}

/** An artboard point in the parent's space (identity at the component root). */
export function toParentSpace(parentWorld: readonly number[] | null, p: Point): Point {
  if (!parentWorld) return [p[0], p[1]];
  return inverseTransformPoint(parentWorld, p) ?? [p[0], p[1]];
}
