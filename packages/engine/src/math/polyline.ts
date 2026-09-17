/** Polyline helpers for compact curve encodings (CSS `linear()`, previews). */

import { formatNumber } from "./vec.ts";

/** A sample `[x, y]` on a curve. */
export type CurvePoint = [number, number];

/**
 * Ramer–Douglas–Peucker simplification: keeps the endpoints and every point needed to
 * stay within `tolerance` (vertical distance) of the original polyline.
 */
export function simplifyPolyline(points: readonly CurvePoint[], tolerance: number): CurvePoint[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const [x0, y0] = points[start]!;
    const [x1, y1] = points[end]!;
    const dx = x1 - x0;
    let maxDist = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const [x, y] = points[i]!;
      const expected = dx === 0 ? y0 : y0 + ((x - x0) / dx) * (y1 - y0);
      const dist = Math.abs(y - expected);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }
    if (maxIndex > 0 && maxDist > tolerance) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  const out: CurvePoint[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push([points[i]![0], points[i]![1]]);
  return out;
}

/**
 * CSS `linear()` easing from normalized samples (`x` progress 0..1, `y` output).
 * Interior stops carry explicit percentages so unevenly spaced points stay exact.
 */
export function toCssLinear(points: readonly CurvePoint[], decimals = 4): string {
  if (points.length === 0) return "linear";
  const parts = points.map((p, i) => {
    const value = formatNumber(p[1], decimals);
    if (i === 0 || i === points.length - 1) return value;
    return `${value} ${formatNumber(p[0] * 100, 2)}%`;
  });
  if (parts.length === 1) parts.push(parts[0]!);
  return `linear(${parts.join(", ")})`;
}
