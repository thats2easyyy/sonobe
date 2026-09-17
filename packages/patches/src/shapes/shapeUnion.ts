/** Shape Union: appends input shapes as subpaths with clockwise net winding, so their fills merge. */

import { definePatch, isPlainObject, warnOnce } from "../infra/index.ts";
import { formatPath, parsePath, reverseSubpaths, signedArea } from "./path.ts";

interface ShapeUnionState {
  /** Last input texts and the output they produced. */
  cache: { inputs: (string | null)[]; shape: { path: string } } | null;
}

/** `v.path` for a shape, `v` for text, null for anything else or whitespace-only text. */
function pathText(v: unknown): string | null {
  const d = typeof v === "string" ? v : isPlainObject(v) && typeof v.path === "string" ? v.path : null;
  return d !== null && d.trim() !== "" ? d : null;
}

const sameInputs = (a: readonly (string | null)[], b: readonly (string | null)[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export const shapeUnion = definePatch<ShapeUnionState>("shapeUnion", {
  state: () => ({ cache: null }),
  evaluate(ctx) {
    const n = Math.min(32, Math.max(2, ctx.inputCount));
    const inputs: (string | null)[] = [];
    for (let i = 1; i <= n; i++) inputs.push(pathText(ctx.input<unknown>(`shape${i}`)));
    const cached = ctx.state.cache;
    if (cached && sameInputs(cached.inputs, inputs)) {
      ctx.output("shape", cached.shape);
      return;
    }
    const parts: string[] = [];
    inputs.forEach((d, index) => {
      if (d === null) return;
      const parsed = parsePath(d);
      if (parsed.syntaxError) warnOnce(ctx, `syntax:${index + 1}`, `Shape ${index + 1} has path data that stops at character ${parsed.errorAt}.`);
      let segments = parsed.segments;
      if (segments.length === 0) return;
      // Clockwise net winding makes overlaps add up under the nonzero fill rule.
      if (signedArea(segments) < -1e-6) segments = reverseSubpaths(segments);
      parts.push(formatPath(segments));
    });
    const shape = { path: parts.join(" ") };
    ctx.state.cache = { inputs, shape };
    ctx.output("shape", shape);
  },
});
