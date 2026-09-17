/** GradientValue → CSS gradient strings that honour start/end points in layer bounds. */

import type { GradientStop, GradientValue } from "@sonobe/core";
import { cssColor, fmt } from "./values.ts";

function stopList(stops: readonly GradientStop[], position: (offset: number) => string): string {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  // CSS needs two stops; a single stop is a solid fill.
  const list = sorted.length === 1 ? [sorted[0]!, { ...sorted[0]!, offset: 1 }] : sorted;
  return list.map((s) => `${cssColor(s.color)} ${position(s.offset)}`).join(", ");
}

/**
 * CSS `background-image` for a gradient drawn into a w × h box.
 * - linear: the gradient runs from `start` to `end` (normalized points in the box)
 * - radial: centred on `start`, reaching the last stop at `end`
 * - angular: centred on `start`, offset 0 pointing towards `end`, sweeping clockwise
 */
export function cssGradient(g: GradientValue, w: number, h: number): string {
  const sx = g.start[0] * w, sy = g.start[1] * h;
  const ex = g.end[0] * w, ey = g.end[1] * h;
  const dx = ex - sx, dy = ey - sy;
  const len = Math.hypot(dx, dy);

  if (g.kind === "radial") {
    const r = Math.max(len, 0.001);
    return `radial-gradient(circle ${fmt(r)}px at ${fmt(sx)}px ${fmt(sy)}px, ${stopList(g.stops, (o) => `${fmt(o * 100)}%`)})`;
  }
  if (g.kind === "angular") {
    const deg = len > 0 ? (Math.atan2(dx, -dy) * 180) / Math.PI : 0;
    return `conic-gradient(from ${fmt(deg)}deg at ${fmt(sx)}px ${fmt(sy)}px, ${stopList(g.stops, (o) => `${fmt(o * 100)}%`)})`;
  }

  if (len === 0) {
    const last = [...g.stops].sort((a, b) => a.offset - b.offset).at(-1)!;
    return `linear-gradient(${cssColor(last.color)}, ${cssColor(last.color)})`;
  }
  // CSS angle: 0deg points up, clockwise. The gradient line passes through the box centre
  // with length |w·sinθ| + |h·cosθ|; project start/end onto it to place the stops exactly.
  const theta = Math.atan2(dx, -dy);
  const dirX = Math.sin(theta), dirY = -Math.cos(theta);
  const lineLen = Math.abs(w * dirX) + Math.abs(h * dirY);
  if (lineLen === 0) {
    return `linear-gradient(${fmt((theta * 180) / Math.PI)}deg, ${stopList(g.stops, (o) => `${fmt(o * 100)}%`)})`;
  }
  const p0x = w / 2 - (dirX * lineLen) / 2;
  const p0y = h / 2 - (dirY * lineLen) / 2;
  const tS = ((sx - p0x) * dirX + (sy - p0y) * dirY) / lineLen;
  const tE = ((ex - p0x) * dirX + (ey - p0y) * dirY) / lineLen;
  const deg = (theta * 180) / Math.PI;
  return `linear-gradient(${fmt(deg)}deg, ${stopList(g.stops, (o) => `${fmt((tS + o * (tE - tS)) * 100)}%`)})`;
}
