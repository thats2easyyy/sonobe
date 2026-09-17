/**
 * Snap: snaps a value to the nearest step or point, after projecting it along its velocity with
 * the same POP decay Scroll momentum uses. Points arrive as a whole loop; every other input zips.
 */

import type { Value, ValueType } from "@sonobe/core";
import { DECELERATION_FAST, DECELERATION_NORMAL, decayFinalPosition } from "@sonobe/engine";
import type { PatchContext } from "@sonobe/engine";
import { MAX_LOOP_LENGTH, components, definePatch, fromComponents, loopItems, loopOf, normalizeZero, resolvePortDefault } from "../infra/index.ts";
import { getSpec } from "../specs.ts";
import { finiteComponents, roundHalfAwayFromZero, variantResolver, warnNonFinite } from "./shared.ts";

const variantOf = variantResolver("snap");

export interface SnapResult {
  output: number[];
  /** The step count (of the first stepped component) or the chosen point's index; -1 with no points. */
  index: number;
  projected: number[];
}

function distance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let c = 0; c < a.length; c++) {
    const d = a[c]! - (b[c] ?? 0);
    sum += d * d;
  }
  return a.length === 1 ? Math.abs(a[0]! - (b[0] ?? 0)) : Math.sqrt(sum);
}

/** Snap one zipped item. `mode` "points" snaps to the nearest of `points` (ties go to the lowest index); anything else steps. */
export function snapItem(
  value: readonly number[],
  velocity: readonly number[],
  mode: string,
  step: readonly number[],
  offset: readonly number[],
  points: readonly (readonly number[])[],
  deceleration: string,
): SnapResult {
  const rate = deceleration === "fast" ? DECELERATION_FAST : DECELERATION_NORMAL;
  const projected = value.map((v, c) => {
    const speed = velocity[c] ?? 0;
    return speed === 0 ? v : decayFinalPosition(v, speed, rate);
  });
  if (mode === "points") {
    if (points.length === 0) return { output: [...projected], index: -1, projected };
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let k = 0; k < points.length; k++) {
      const d = distance(projected, points[k]!);
      if (d < bestDistance) {
        best = k;
        bestDistance = d;
      }
    }
    return { output: [...points[best]!], index: best, projected };
  }
  const output = new Array<number>(value.length);
  let index: number | undefined;
  for (let c = 0; c < value.length; c++) {
    const size = Math.abs(step[c] ?? 0);
    if (size === 0 || !Number.isFinite(size)) {
      output[c] = projected[c]!;
      continue;
    }
    const origin = offset[c] ?? 0;
    const n = roundHalfAwayFromZero((projected[c]! - origin) / size);
    output[c] = origin + n * size;
    index ??= n;
  }
  return { output, index: normalizeZero(index ?? 0), projected };
}

const defaultPoints = new Map<ValueType, readonly unknown[]>();

/**
 * The Points items. Unconnected with no stored literal, the catalog default is used directly: core
 * port resolution coerces the loop-literal default of a variant port into a scalar.
 */
function pointItems(ctx: PatchContext, variant: ValueType): readonly unknown[] {
  if (ctx.isConnected("points") || ctx.node.inputs?.points !== undefined) return ctx.inputItems("points");
  let items = defaultPoints.get(variant);
  if (!items) {
    items = loopItems(resolvePortDefault(getSpec("snap")!, "points", variant));
    defaultPoints.set(variant, items);
  }
  return items;
}

const at = (items: readonly unknown[], i: number): unknown => items[i % items.length];

export const snap = definePatch("snap", {
  evaluate(ctx) {
    const variant = variantOf(ctx.typeParam);
    const zipped = ["value", "velocity", "mode", "step", "offset", "deceleration"].map((key) => ctx.inputItems(key));
    let count = 0;
    let empty = false;
    for (const items of zipped) {
      if (items.length === 0) empty = true;
      count = Math.max(count, items.length);
    }
    count = empty ? 0 : Math.min(count, MAX_LOOP_LENGTH);
    const [values, velocities, modes, steps, offsets, decelerations] = zipped as [unknown[], unknown[], unknown[], unknown[], unknown[], unknown[]];
    const points = pointItems(ctx, variant).map((p) => components(p, variant));

    const outputs: Value[] = [];
    const indices: number[] = [];
    const projections: Value[] = [];
    let nonFinite = false;
    for (let i = 0; i < count; i++) {
      const result = snapItem(
        components(at(values, i), variant),
        components(at(velocities, i), variant),
        String(at(modes, i)),
        components(at(steps, i), variant),
        components(at(offsets, i), variant),
        points,
        String(at(decelerations, i)),
      );
      if (finiteComponents(result.output)) nonFinite = true;
      if (finiteComponents(result.projected)) nonFinite = true;
      outputs.push(fromComponents(result.output, variant));
      indices.push(Number.isFinite(result.index) ? result.index : 0);
      projections.push(fromComponents(result.projected, variant));
    }
    if (nonFinite) warnNonFinite(ctx, "The snapped value");
    if (count === 1) {
      ctx.output("output", outputs[0]!);
      ctx.output("index", indices[0]!);
      ctx.output("projected", projections[0]!);
    } else {
      ctx.output("output", loopOf(outputs));
      ctx.output("index", loopOf(indices));
      ctx.output("projected", loopOf(projections));
    }
  },
});
