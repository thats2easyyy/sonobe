/** Convert Position: a point from one layer's local space into another's, using previous-frame geometry. */

import type { LayerRef } from "@sonobe/core";
import type { LayerInfoSnapshot, RuntimeServices } from "@sonobe/engine";
import { definePatch, warnOnce } from "../infra/index.ts";

type Vec2 = [number, number];

/** A coordinate space: a layer's local points (origin top-left, before its scale), or the screen. */
export interface CoordinateSpace {
  size: Vec2;
  toScreen(q: Vec2): Vec2;
  fromScreen(q: Vec2): Vec2;
  invertible: boolean;
}

/** Deepest parent chain followed (guards against malformed snapshots). */
const MAX_CHAIN = 256;

const identity = (q: Vec2): Vec2 => [q[0], q[1]];

/** The screen: prototype coordinates at the device's screen size. */
export function screenSpace(services: RuntimeServices): CoordinateSpace {
  const [w, h] = services.device().screenSize;
  return { size: [w, h], toScreen: identity, fromScreen: identity, invertible: true };
}

/**
 * A layer's local space, composed from layer-info snapshots up the parent chain (parent refs keep
 * the target's `instance`). Each layer maps q to its parent as topLeft + pivot + scale ⊙ (q − pivot)
 * with the default center pivot; rotation is ignored. Null when any snapshot on the chain is missing.
 */
export function layerSpace(services: RuntimeServices, ref: LayerRef): CoordinateSpace | null {
  const chain: LayerInfoSnapshot[] = [];
  let current: LayerRef | null = ref;
  while (current) {
    if (chain.length >= MAX_CHAIN) return null;
    const info = services.layerInfo(current);
    if (!info) return null;
    chain.push(info);
    current = info.parent === null || info.parent === undefined ? null : ref.instance === undefined ? { layerId: info.parent } : { layerId: info.parent, instance: ref.instance };
  }
  const invertible = chain.every((L) => Math.abs(L.scale[0]) >= 1e-6 && Math.abs(L.scale[1]) >= 1e-6);
  const toParent = (L: LayerInfoSnapshot, q: Vec2): Vec2 => {
    const px = 0.5 * L.size[0];
    const py = 0.5 * L.size[1];
    const left = L.position[0] - L.anchor[0] * L.size[0];
    const top = L.position[1] - L.anchor[1] * L.size[1];
    return [left + px + L.scale[0] * (q[0] - px), top + py + L.scale[1] * (q[1] - py)];
  };
  const fromParent = (L: LayerInfoSnapshot, q: Vec2): Vec2 => {
    const px = 0.5 * L.size[0];
    const py = 0.5 * L.size[1];
    const left = L.position[0] - L.anchor[0] * L.size[0];
    const top = L.position[1] - L.anchor[1] * L.size[1];
    return [px + (q[0] - left - px) / L.scale[0], py + (q[1] - top - py) / L.scale[1]];
  };
  const target = chain[0]!;
  return {
    size: [target.size[0], target.size[1]],
    toScreen(q) {
      let p = q;
      for (const L of chain) p = toParent(L, p);
      return p;
    },
    fromScreen(q) {
      let p = q;
      for (let k = chain.length - 1; k >= 0; k--) p = fromParent(chain[k]!, p);
      return p;
    },
    invertible,
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
    ctx.state.last = result;
    ctx.output("convertedPosition", [result[0], result[1]]);
    ctx.output("error", false);
  },
});
