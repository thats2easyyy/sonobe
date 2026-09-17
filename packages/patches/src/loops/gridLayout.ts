/** Grid Layout: a top-left position and size per item for a grid of equal columns. */

import { definePatch, finiteOr, warnOnce } from "../infra/index.ts";

export const gridLayoutPatch = definePatch("gridLayout", {
  evaluate(ctx) {
    const cols = Math.max(1, Math.floor(finiteOr(ctx.input("columns"), 1)));
    const spacing = finiteOr(ctx.input("spacing"), 0);
    const itemWidth = Math.max(0, (finiteOr(ctx.input("width"), 0) - spacing * (cols - 1)) / cols);
    const itemHeight = Math.max(0, finiteOr(ctx.input("itemHeight"), 0));
    const index = finiteOr(ctx.input("index"), 0);
    const i = index > 0 ? Math.floor(index) : 0;
    const row = Math.floor(i / cols);
    const col = i - row * cols;
    const origin = ctx.input<unknown>("origin");
    const ox = Array.isArray(origin) ? finiteOr(origin[0], 0) : 0;
    const oy = Array.isArray(origin) ? finiteOr(origin[1], 0) : 0;
    const x = ox + col * (itemWidth + spacing);
    const y = oy + row * (itemHeight + spacing);
    const w = Number.isFinite(itemWidth) ? itemWidth : 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || w !== itemWidth) {
      warnOnce(ctx, "nonFinite", "Grid Layout: a position got too large to show, so it outputs 0.");
    }
    ctx.output("position", [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0]);
    ctx.output("size", [w, itemHeight]);
  },
});
