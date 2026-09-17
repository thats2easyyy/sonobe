/** Rounded Rectangle Shape: the Rectangle layer's corner geometry (radii and smoothing) as a path. */

import { clamp01, definePatch } from "../infra/index.ts";
import { MAX_COORDINATE } from "./path.ts";
import { emptyShape, readNumber, readPair, readVector } from "./read.ts";
import { squirclePath } from "./squircle.ts";

const clampCoordinate = (v: number) => Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, v));

export const roundedRectangleShape = definePatch("roundedRectangleShape", {
  evaluate(ctx) {
    const [px, py] = readPair(ctx, "position");
    const [ax, ay] = readPair(ctx, "anchor");
    const [sw, sh] = readPair(ctx, "size");
    const w = Math.max(0, sw);
    const h = Math.max(0, sh);
    if (w === 0 || h === 0) {
      ctx.output("shape", emptyShape());
      return;
    }
    const r = readNumber(ctx, "cornerRadius");
    const [tl, tr, br, bl] = readVector(ctx, "cornerRadii", 4) as [number, number, number, number];
    // Connected Corner Radii always win, so an animation through [0, 0, 0, 0] doesn't jump back.
    const perCorner = ctx.isConnected("cornerRadii") || tl > 0 || tr > 0 || br > 0 || bl > 0;
    const radii: [number, number, number, number] = perCorner ? [tl, tr, br, bl] : [r, r, r, r];
    const smoothing = clamp01(readNumber(ctx, "cornerSmoothing"));
    // Clamp the rectangle's edges into ±1,000,000 so every coordinate stays in range.
    const rawLeft = px - ax * w;
    const rawTop = py - ay * h;
    const left = clampCoordinate(rawLeft);
    const top = clampCoordinate(rawTop);
    const width = clampCoordinate(rawLeft + w) - left;
    const height = clampCoordinate(rawTop + h) - top;
    if (!(width > 0 && height > 0)) {
      ctx.output("shape", emptyShape());
      return;
    }
    ctx.output("shape", { path: squirclePath(left, top, width, height, radii, smoothing) });
  },
});
