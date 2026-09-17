/** Line Shape: a straight or Catmull-Rom-smoothed path through two or more points. */

import { clamp01, definePatch, warnOnce } from "../infra/index.ts";
import { cmd, readPoint, tryParseJson } from "./path.ts";
import { readNumber, readPair } from "./read.ts";

/** Points beyond this are ignored. */
export const MAX_LINE_POINTS = 10_000;

export const lineShape = definePatch("lineShape", {
  evaluate(ctx) {
    let list = ctx.input<unknown>("points");
    if (typeof list === "string") {
      if (list.trim() === "") {
        list = null;
      } else {
        const parsed = tryParseJson(list);
        if (parsed === undefined) warnOnce(ctx, "notJson", "Line Shape: Points isn't valid JSON, so Start Point and End Point are used.");
        list = parsed ?? null;
      }
    }
    let pts: [number, number][] = [];
    if (Array.isArray(list)) {
      if (list.length > MAX_LINE_POINTS) warnOnce(ctx, "tooMany", `Line Shape: Points has more than 10,000 items; only the first 10,000 are drawn.`);
      let skipped = 0;
      const count = Math.min(list.length, MAX_LINE_POINTS);
      for (let i = 0; i < count; i++) {
        const p = readPoint(list[i]);
        if (p) pts.push(p);
        else skipped++;
      }
      if (skipped > 0) warnOnce(ctx, "skipped", 'Line Shape: some items in Points were skipped; make each one [x, y] or { "x": 10, "y": 20 } with numbers.');
    } else if (list !== null && list !== undefined) {
      warnOnce(ctx, "notArray", "Line Shape: Points isn't a list of points, so Start Point and End Point are used.");
    }
    if (pts.length < 2) pts = [readPair(ctx, "startPoint"), readPair(ctx, "endPoint")];

    const closed = ctx.input<unknown>("closed") === true;
    const s = clamp01(readNumber(ctx, "smoothing"));
    const n = pts.length;
    const at = (i: number) => (closed ? pts[((i % n) + n) % n]! : pts[Math.min(n - 1, Math.max(0, i))]!);
    const parts = [cmd("M", ...pts[0]!)];
    const segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
      const p0 = at(i);
      const p1 = at(i + 1);
      if (s === 0) {
        parts.push(cmd("L", ...p1));
        continue;
      }
      // Catmull-Rom through the neighbors, written as a cubic Bézier.
      const prev = at(i - 1);
      const next = at(i + 2);
      const c1x = p0[0] + ((p1[0] - prev[0]) * s) / 6;
      const c1y = p0[1] + ((p1[1] - prev[1]) * s) / 6;
      const c2x = p1[0] - ((next[0] - p0[0]) * s) / 6;
      const c2y = p1[1] - ((next[1] - p0[1]) * s) / 6;
      parts.push(cmd("C", c1x, c1y, c2x, c2y, p1[0], p1[1]));
    }
    if (closed) parts.push("Z");
    ctx.output("shape", { path: parts.join(" ") });
  },
});
