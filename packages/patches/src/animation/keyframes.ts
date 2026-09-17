/** Keyframes: maps Progress through N stops to values, easing within each segment. */

import { resolveTypeParam } from "@sonobe/core";
import type { PatchNode, PortSpec } from "@sonobe/core";
import { definePatch, easeExtended, fromComponents, warnOnce } from "../infra/index.ts";
import { finiteComponents, requireSpec, variantOf, withMutedBehavior } from "./shared.ts";

const SPEC = requireSpec("keyframes");

export const MIN_KEYFRAMES = 2;
export const MAX_KEYFRAMES = 32;
export const DEFAULT_KEYFRAMES = 3;

/** Number of keyframes for an inputCount: rounded and clamped to 2…32, default 3. */
export function keyframeCount(inputCount: number | undefined): number {
  const n = typeof inputCount === "number" && Number.isFinite(inputCount) && inputCount > 0 ? Math.round(inputCount) : DEFAULT_KEYFRAMES;
  return Math.min(MAX_KEYFRAMES, Math.max(MIN_KEYFRAMES, n));
}

/** The `stop{n}` and `value{n}` inputs for a node (the catalog's dynamicPortsRule). */
export function keyframePorts(node: PatchNode): { inputs: PortSpec[]; outputs: PortSpec[] } {
  const count = keyframeCount(node.inputCount);
  const variant = resolveTypeParam(SPEC, node.typeParam) ?? "number";
  const inputs: PortSpec[] = [];
  for (let n = 1; n <= count; n++) {
    inputs.push({
      key: `stop${n}`,
      name: `Stop ${n}`,
      type: "number",
      step: 0.01,
      default: (n - 1) / (count - 1),
      description: `Where keyframe ${n} sits along Progress, in Progress's units.`,
    });
    const value: PortSpec = { key: `value${n}`, name: `Value ${n}`, type: "variant", description: `The output when Progress is at Stop ${n}.` };
    if (variant === "number") value.default = n % 2 === 1 ? 0 : 1;
    else if (variant === "color") value.default = n % 2 === 1 ? "#FFFFFFFF" : "#000000FF";
    inputs.push(value);
  }
  return { inputs, outputs: [] };
}

export const keyframes = withMutedBehavior(
  definePatch("keyframes", {
    dynamicPorts: (node) => keyframePorts(node),
    evaluate(ctx) {
      const type = variantOf(ctx, SPEC);
      if (ctx.node.muted) {
        ctx.output("output", ctx.input("value1"));
        return;
      }
      // Keyframes has no VariadicSpec, so the runtime reports inputCount 0; read the node's count instead.
      const count = keyframeCount(ctx.inputCount > 0 ? ctx.inputCount : ctx.node.inputCount);
      const stops: number[] = [];
      const values: number[][] = [];
      for (let n = 1; n <= count; n++) {
        const previous = n === 1 ? undefined : stops[n - 2]!;
        let stop = ctx.input<number>(`stop${n}`);
        if (!Number.isFinite(stop)) {
          warnOnce(ctx, "stop", "Keyframes got a Stop that isn't finite, so that keyframe sits on the previous stop.");
          stop = previous ?? 0;
        }
        stops.push(previous === undefined ? stop : Math.max(stop, previous));
        values.push(
          finiteComponents(ctx, ctx.input(`value${n}`), type, undefined, "value", "Keyframes got a Value that isn't finite, so it uses 0 for that part."),
        );
      }
      const p = ctx.input<number>("progress");
      if (!Number.isFinite(p)) {
        warnOnce(ctx, "progress", "Keyframes got a Progress that isn't finite, so it outputs the first keyframe.");
        ctx.output("output", fromComponents(values[0]!, type));
        return;
      }
      const curveKey = String(ctx.input("curve") ?? "");
      const segment = (j: number): number[] => {
        const a = values[j - 1]!;
        const b = values[j]!;
        const width = stops[j]! - stops[j - 1]!;
        if (width === 0) return p < stops[j - 1]! ? a : b;
        const eased = easeExtended(curveKey, (p - stops[j - 1]!) / width);
        return a.map((ai, k) => {
          const v = ai + ((b[k] ?? 0) - ai) * eased;
          return Number.isFinite(v) ? v : 0;
        });
      };
      let index = 0;
      for (let n = 1; n <= count; n++) if (stops[n - 1]! <= p) index = n;
      const extrapolate = ctx.input<boolean>("extrapolate") === true;
      let out: number[];
      if (index === 0) out = extrapolate ? segment(1) : values[0]!;
      else if (index === count) out = extrapolate ? segment(count - 1) : values[count - 1]!;
      else out = segment(index);
      ctx.output("output", fromComponents(out, type));
    },
  }),
  // The runtime's type-matching bypass would pass Progress through for the number variant; muted Keyframes passes Value 1.
  "evaluate",
);
