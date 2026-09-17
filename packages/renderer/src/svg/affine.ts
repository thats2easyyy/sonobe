/** 2D affine transforms for the SVG serializer, derived from the engine's 4x4 world transforms. DOM-free. */

import { projectPoint } from "../matrix.ts";
import { num } from "./xml.ts";

/** [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (SVG matrix order). */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY_AFFINE: Affine = [1, 0, 0, 1, 0, 0];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const finite = (m: readonly number[]) => m.every((v) => Number.isFinite(v));

/** m ∘ n: apply n, then m. */
export function multiplyAffine(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** The inverse transform, or null when it collapses the plane (scale 0). */
export function invertAffine(m: Affine): Affine | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const [a, b, c, d, e, f] = m;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * The affine transform that best matches a 4x4 transform on a w × h layer: it maps the layer's
 * top-left, top-right and bottom-left corners exactly (2D transforms come out exact; 3D rotations and
 * perspective flatten to a parallelogram). Null for non-finite or degenerate matrices.
 */
export function affineFromMat4(m: readonly number[] | undefined, w: number, h: number): Affine | null {
  if (!Array.isArray(m) || m.length !== 16 || !finite(m)) return null;
  if (m[3] === 0 && m[7] === 0 && m[15] === 1) return [m[0]!, m[1]!, m[4]!, m[5]!, m[12]!, m[13]!];
  const W = w > 1e-6 ? w : 1;
  const H = h > 1e-6 ? h : 1;
  const p0 = projectPoint(m, 0, 0);
  const px = projectPoint(m, W, 0);
  const py = projectPoint(m, 0, H);
  const out: Affine = [(px[0] - p0[0]) / W, (px[1] - p0[1]) / W, (py[0] - p0[0]) / H, (py[1] - p0[1]) / H, p0[0], p0[1]];
  return finite(out) ? out : null;
}

export const isIdentityAffine = (m: Affine) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;

/** SVG transform attribute value (undefined for identity). */
export function affineAttr(m: Affine): string | undefined {
  if (isIdentityAffine(m)) return undefined;
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1) return `translate(${num(m[4], 4)} ${num(m[5], 4)})`;
  return `matrix(${m.map((v) => num(v, 6)).join(" ")})`;
}

/** Axis-aligned bounds of a rect after a transform. */
export function transformRect(m: Affine, r: Rect): Rect {
  const pts = [applyAffine(m, r.x, r.y), applyAffine(m, r.x + r.width, r.y), applyAffine(m, r.x, r.y + r.height), applyAffine(m, r.x + r.width, r.y + r.height)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export const padRect = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
