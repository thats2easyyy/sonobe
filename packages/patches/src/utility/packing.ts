/**
 * Shared evaluators for the pack and unpack patches (Point, Size, Point 3D, Point 4D, Edges,
 * Corner Radii, and their Unpack counterparts). Components pass through unclamped; a non-finite
 * component becomes 0 and warns once per loop index until the prototype restarts.
 */

import type { PatchContext, PatchDefinition } from "@sonobe/engine";
import { definePatch } from "../infra/index.ts";

/** Per-index state: whether this index already warned about a non-finite component. */
export interface FiniteWarnState {
  warned: boolean;
}

/** `value` when it's a finite number; otherwise 0, logging `message(ctx.id)` once for this index. */
export function finiteComponent(ctx: PatchContext<FiniteWarnState>, value: unknown, message: (id: string) => string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!ctx.state.warned) {
    ctx.state.warned = true;
    ctx.services.log("warn", message(ctx.id));
  }
  return 0;
}

/** A patch that packs its number inputs `keys`, in order, into a new `output` vector every frame. */
export function definePack(type: string, keys: readonly string[], message: (id: string) => string): PatchDefinition<FiniteWarnState> {
  return definePatch<FiniteWarnState>(type, {
    state: () => ({ warned: false }),
    evaluate(ctx) {
      const out = new Array<number>(keys.length);
      for (let i = 0; i < keys.length; i++) out[i] = finiteComponent(ctx, ctx.input(keys[i]!), message);
      ctx.output("output", out);
    },
  });
}

/** A patch that splits its vector input `value` into the number outputs `keys`, in order. */
export function defineUnpack(type: string, keys: readonly string[], message: (id: string) => string): PatchDefinition<FiniteWarnState> {
  return definePatch<FiniteWarnState>(type, {
    state: () => ({ warned: false }),
    evaluate(ctx) {
      const value = ctx.input<unknown>("value");
      const parts: readonly unknown[] = Array.isArray(value) ? value : [];
      for (let i = 0; i < keys.length; i++) ctx.output(keys[i]!, finiteComponent(ctx, parts[i], message));
    },
  });
}
