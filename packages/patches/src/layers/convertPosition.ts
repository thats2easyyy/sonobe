/** Convert Position: a point from one layer's local space into another's, using previous-frame geometry. */

import type { LayerRef } from "@sonobe/core";
import { mat4 } from "@sonobe/engine";
import type { RuntimeServices } from "@sonobe/engine";
import { definePatch, warnOnce } from "../infra/index.ts";

type Vec2 = [number, number];

/** A coordinate space: a layer's local points (origin top-left, before its scale and rotation), or the screen. */
export interface CoordinateSpace {
  size: Vec2;
  toScreen(q: Vec2): Vec2;
  fromScreen(q: Vec2): Vec2;
  invertible: boolean;
}

const identity = (q: Vec2): Vec2 => [q[0], q[1]];

/** The screen: prototype coordinates at the device's screen size. */
export function screenSpace(services: RuntimeServices): CoordinateSpace {
  const [w, h] = services.device().screenSize;
  return { size: [w, h], toScreen: identity, fromScreen: identity, invertible: true };
}

const isMatrix = (m: unknown): m is number[] => Array.isArray(m) && m.length === 16 && m.every((v) => typeof v === "number");

/**
 * A layer's local space from its snapshot's world transform: the layer's plane (z = 0) mapped to
 * prototype coordinates with every ancestor's transform, including component instance layers,
 * rotation in 2D and 3D, pivots, and perspective. It is the same mapping touches use, so a converted
 * point lands where a tap on it would. Null when the layer has no snapshot.
 */
export function layerSpace(services: RuntimeServices, ref: LayerRef): CoordinateSpace | null {
  const info = services.layerInfo(ref);
  if (!info || !isMatrix(info.worldTransform)) return null;
  const world = info.worldTransform;
  const inverse = mat4.planeInverse(world);
  const apply = (m: readonly number[], q: Vec2): Vec2 => {
    const [x, y] = mat4.transformPoint(m, [q[0], q[1], 0]);
    return [x, y];
  };
  return {
    size: [info.size[0], info.size[1]],
    toScreen: (q) => apply(world, q),
    fromScreen: (q) => (inverse ? apply(inverse, q) : [Number.NaN, Number.NaN]),
    invertible: inverse !== null,
  };
}

function spaceFor(services: RuntimeServices, ref: LayerRef | null | undefined): CoordinateSpace | null {
  if (ref === null || ref === undefined) return screenSpace(services);
  return typeof ref.layerId === "string" ? layerSpace(services, ref) : null;
}

const vec2 = (v: unknown): Vec2 => (Array.isArray(v) ? [Number(v[0] ?? 0), Number(v[1] ?? 0)] : [0, 0]);

export const convertPosition = definePatch<{ last: Vec2 }>("convertPosition", {
  state: () => ({ last: [0, 0] }),
  evaluate(ctx) {
    const fail = () => {
      ctx.output("convertedPosition", [ctx.state.last[0], ctx.state.last[1]]);
      ctx.output("error", true);
    };
    const from = spaceFor(ctx.services, ctx.input<LayerRef | null>("fromLayer"));
    const to = spaceFor(ctx.services, ctx.input<LayerRef | null>("toLayer"));
    if (!from || !to || !to.invertible) {
      fail();
      return;
    }
    const a = vec2(ctx.input("anchor"));
    const p = vec2(ctx.input("position"));
    const ta = vec2(ctx.input("toAnchor"));
    const local: Vec2 = [a[0] * from.size[0] + p[0], a[1] * from.size[1] + p[1]];
    const inTo = to.fromScreen(from.toScreen(local));
    const result: Vec2 = [inTo[0] - ta[0] * to.size[0], inTo[1] - ta[1] * to.size[1]];
    if (!Number.isFinite(result[0]) || !Number.isFinite(result[1])) {
      warnOnce(ctx, "nonFinite", "Convert Position: the converted position isn't a finite number; holding the last good value.");
      fail();
      return;
    }
    const clean: Vec2 = [result[0] === 0 ? 0 : result[0], result[1] === 0 ? 0 : result[1]];
    ctx.state.last = clean;
    ctx.output("convertedPosition", [clean[0], clean[1]]);
    ctx.output("error", false);
  },
});
