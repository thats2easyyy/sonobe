/** 4x4 column-major matrix helpers for CSS transforms and pointer unprojection. */

export type Mat4 = readonly number[];

export const IDENTITY: Mat4 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function isMat4(m: unknown): m is Mat4 {
  if (!Array.isArray(m) || m.length !== 16) return false;
  for (const v of m) if (typeof v !== "number" || !Number.isFinite(v)) return false;
  return true;
}

/** Rounds to 6 decimals and normalizes -0 so transform strings are stable across frames. */
function num(n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
}

/** True when the matrix is a pure 2D affine transform (no z, no perspective). */
export function isAffine2D(m: Mat4): boolean {
  return (
    m[2] === 0 && m[3] === 0 && m[6] === 0 && m[7] === 0 &&
    m[8] === 0 && m[9] === 0 && m[10] === 1 && m[11] === 0 &&
    m[14] === 0 && m[15] === 1
  );
}

/**
 * CSS transform for a column-major matrix. 2D affine matrices are written as `matrix()`
 * (identical result, keeps text on the crisp 2D raster path); anything else as `matrix3d()`.
 */
export function cssTransform(m: Mat4): string {
  if (isAffine2D(m)) return `matrix(${num(m[0]!)}, ${num(m[1]!)}, ${num(m[4]!)}, ${num(m[5]!)}, ${num(m[12]!)}, ${num(m[13]!)})`;
  return `matrix3d(${m.map(num).join(", ")})`;
}

/** Translation-only matrix. */
export function translation(x: number, y: number): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];
}

/** Maps a local point on the layer plane (z = 0) through the matrix, with perspective divide. */
export function projectPoint(m: Mat4, x: number, y: number): [number, number] {
  const w = m[3]! * x + m[7]! * y + m[15]!;
  const d = w === 0 ? 1 : w;
  return [(m[0]! * x + m[4]! * y + m[12]!) / d, (m[1]! * x + m[5]! * y + m[13]!) / d];
}

/**
 * Inverse of `projectPoint`: maps a world point back onto the layer's z = 0 plane.
 * Uses the plane homography (columns x, y, w), so it handles 3D rotations and perspective.
 */
export function unprojectPoint(m: Mat4, x: number, y: number): [number, number] | null {
  const a = m[0]!, b = m[4]!, c = m[12]!;
  const d = m[1]!, e = m[5]!, f = m[13]!;
  const g = m[3]!, h = m[7]!, i = m[15]!;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  const lx = (A * x + D * y + G) / det;
  const ly = (B * x + E * y + H) / det;
  const lw = (C * x + F * y + I) / det;
  if (Math.abs(lw) < 1e-12) return null;
  return [lx / lw, ly / lw];
}

/** Approximate uniform scale of a matrix's 2D part (sqrt of the absolute determinant). */
export function approxScale(m: Mat4): number {
  const s = Math.sqrt(Math.abs(m[0]! * m[5]! - m[1]! * m[4]!));
  return Number.isFinite(s) && s > 0 ? s : 1;
}
