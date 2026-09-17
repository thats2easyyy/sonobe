/**
 * 4x4 matrices in column-major order (the layout of CSS `matrix3d()` and WebGL):
 * element (row r, column c) is `m[c * 4 + r]`. Coordinates are points with Y down,
 * so a positive Z rotation turns clockwise on screen, like CSS `rotate()`.
 */

import { formatNumber } from "./vec.ts";

/** A 4x4 column-major matrix (length 16). */
export type Mat4 = number[];

const DEG = Math.PI / 180;

/** A new identity matrix. */
export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** `a × b`: applies `b` first, then `a`. */
export function multiply(a: readonly number[], b: readonly number[]): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4]!;
    const b1 = b[c * 4 + 1]!;
    const b2 = b[c * 4 + 2]!;
    const b3 = b[c * 4 + 3]!;
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r]! * b0 + a[4 + r]! * b1 + a[8 + r]! * b2 + a[12 + r]! * b3;
    }
  }
  return out;
}

export function translation(tx: number, ty: number, tz = 0): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
}

export function scaling(sx: number, sy: number, sz = 1): Mat4 {
  return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
}

/** Rotation about the X axis in degrees (CSS `rotateX`). */
export function rotationX(degrees: number): Mat4 {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

/** Rotation about the Y axis in degrees (CSS `rotateY`). */
export function rotationY(degrees: number): Mat4 {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/** Rotation about the Z axis in degrees (CSS `rotate`). */
export function rotationZ(degrees: number): Mat4 {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** CSS-style perspective with the given distance (0 or less means none). */
export function perspective(distance: number): Mat4 {
  const m = identity();
  if (distance > 0) m[11] = -1 / distance;
  return m;
}

export interface ComposeParams {
  /** Where the anchor point sits in the parent, from the parent's top-left. */
  position?: readonly number[];
  size?: readonly number[];
  /** 0..1 within the layer; [0, 0] is top-left. */
  anchor?: readonly number[];
  /** 0..1 point that scale and rotation happen around. Default center. */
  pivot?: readonly number[];
  /** Uniform scale or `[sx, sy, sz]`. */
  scale?: number | readonly number[];
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  zPosition?: number;
}

/**
 * Local layer transform: maps layer space (origin at the layer's top-left, in points)
 * into parent space. Equivalent to CSS
 * `translate3d(left, top, z) rotateX() rotateY() rotateZ() scale3d()` with
 * `transform-origin` at the pivot, where left/top = position − anchor × size.
 */
export function compose(params: ComposeParams): Mat4 {
  const w = params.size?.[0] ?? 0;
  const h = params.size?.[1] ?? 0;
  const left = (params.position?.[0] ?? 0) - (params.anchor?.[0] ?? 0) * w;
  const top = (params.position?.[1] ?? 0) - (params.anchor?.[1] ?? 0) * h;
  const px = (params.pivot?.[0] ?? 0.5) * w;
  const py = (params.pivot?.[1] ?? 0.5) * h;
  const scale = params.scale;
  const sx = typeof scale === "number" ? scale : (scale?.[0] ?? 1);
  const sy = typeof scale === "number" ? scale : (scale?.[1] ?? 1);
  const sz = typeof scale === "number" ? scale : (scale?.[2] ?? 1);
  const rx = (params.rotationX ?? 0) * DEG;
  const ry = (params.rotationY ?? 0) * DEG;
  const rz = (params.rotationZ ?? 0) * DEG;
  const cx = Math.cos(rx);
  const snx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sny = Math.sin(ry);
  const cz = Math.cos(rz);
  const snz = Math.sin(rz);

  // R = Rx · Ry · Rz (row-major entries r{row}{col}).
  const r00 = cy * cz;
  const r01 = -cy * snz;
  const r02 = sny;
  const r10 = cx * snz + snx * sny * cz;
  const r11 = cx * cz - snx * sny * snz;
  const r12 = -snx * cy;
  const r20 = snx * snz - cx * sny * cz;
  const r21 = snx * cz + cx * sny * snz;
  const r22 = cx * cy;

  // RS = R · S; translation = T(left + px, top + py, z) − RS · pivot.
  const a00 = r00 * sx,
    a01 = r01 * sy,
    a02 = r02 * sz;
  const a10 = r10 * sx,
    a11 = r11 * sy,
    a12 = r12 * sz;
  const a20 = r20 * sx,
    a21 = r21 * sy,
    a22 = r22 * sz;
  const tx = left + px - (a00 * px + a01 * py);
  const ty = top + py - (a10 * px + a11 * py);
  const tz = (params.zPosition ?? 0) - (a20 * px + a21 * py);

  return [a00, a10, a20, 0, a01, a11, a21, 0, a02, a12, a22, 0, tx, ty, tz, 1];
}

/** General inverse, or null when the matrix is singular. */
export function invert(m: readonly number[]): Mat4 | null {
  const a00 = m[0]!,
    a01 = m[1]!,
    a02 = m[2]!,
    a03 = m[3]!;
  const a10 = m[4]!,
    a11 = m[5]!,
    a12 = m[6]!,
    a13 = m[7]!;
  const a20 = m[8]!,
    a21 = m[9]!,
    a22 = m[10]!,
    a23 = m[11]!;
  const a30 = m[12]!,
    a31 = m[13]!,
    a32 = m[14]!,
    a33 = m[15]!;

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;

  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * inv,
    (a02 * b10 - a01 * b11 - a03 * b09) * inv,
    (a31 * b05 - a32 * b04 + a33 * b03) * inv,
    (a22 * b04 - a21 * b05 - a23 * b03) * inv,
    (a12 * b08 - a10 * b11 - a13 * b07) * inv,
    (a00 * b11 - a02 * b08 + a03 * b07) * inv,
    (a32 * b02 - a30 * b05 - a33 * b01) * inv,
    (a20 * b05 - a22 * b02 + a23 * b01) * inv,
    (a10 * b10 - a11 * b08 + a13 * b06) * inv,
    (a01 * b08 - a00 * b10 - a03 * b06) * inv,
    (a30 * b04 - a31 * b02 + a33 * b00) * inv,
    (a21 * b02 - a20 * b04 - a23 * b00) * inv,
    (a11 * b07 - a10 * b09 - a12 * b06) * inv,
    (a00 * b09 - a01 * b07 + a02 * b06) * inv,
    (a31 * b01 - a30 * b03 - a32 * b00) * inv,
    (a20 * b03 - a21 * b01 + a22 * b00) * inv,
  ];
}

/**
 * Inverse for picking: maps a viewer point (x, y) onto the layer's z = 0 plane under
 * an orthographic view, as a 4x4 usable with {@link transformPoint}. For 2D transforms
 * it agrees with {@link invert}; for 3D-rotated layers it finds the point on the layer
 * surface under the cursor instead of an off-plane point. Null when the layer is edge-on
 * or scaled to zero.
 */
export function planeInverse(m: readonly number[]): Mat4 | null {
  // Homography restricted to z = 0 (row-major): [m0 m4 m12; m1 m5 m13; m3 m7 m15].
  const a = m[0]!,
    b = m[4]!,
    c = m[12]!;
  const d = m[1]!,
    e = m[5]!,
    f = m[13]!;
  const g = m[3]!,
    h = m[7]!,
    i = m[15]!;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const n00 = A * inv;
  const n01 = -(b * i - c * h) * inv;
  const n02 = (b * f - c * e) * inv;
  const n10 = B * inv;
  const n11 = (a * i - c * g) * inv;
  const n12 = -(a * f - c * d) * inv;
  const n20 = C * inv;
  const n21 = -(a * h - b * g) * inv;
  const n22 = (a * e - b * d) * inv;
  return [n00, n10, 0, n20, n01, n11, 0, n21, 0, 0, 1, 0, n02, n12, 0, n22];
}

/** Transform a point (z defaults to 0) with perspective divide. */
export function transformPoint(
  m: readonly number[],
  point: readonly number[],
): [number, number, number] {
  const x = point[0] ?? 0;
  const y = point[1] ?? 0;
  const z = point[2] ?? 0;
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  const iw = w === 1 ? 1 : w === 0 ? Number.NaN : 1 / w;
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) * iw,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) * iw,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) * iw,
  ];
}

/** Approximate on-screen scale of the layer's X and Y axes (for hit slop in points). */
export function axisScales(m: readonly number[]): [number, number] {
  return [Math.hypot(m[0]!, m[1]!), Math.hypot(m[4]!, m[5]!)];
}

/** `matrix3d(...)` for CSS, rounded to 6 decimals without `-0` or exponents. */
export function toCssMatrix3d(m: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < 16; i++) parts.push(formatNumber(m[i] ?? 0, 6));
  return `matrix3d(${parts.join(", ")})`;
}

/** True when every element differs by at most `epsilon`. */
export function approxEqualMat(
  a: readonly number[],
  b: readonly number[],
  epsilon = 1e-9,
): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > epsilon) return false;
  return true;
}
