/**
 * Helpers shared by the interaction patches: reading Layer inputs, ancestor scales for parent-space
 * gestures, finite number and point inputs that warn once, and the engine's muted-behavior extension.
 */

import type { LayerRef } from "@sonobe/core";
import type { MutedBehavior, PatchContext, PatchDefinition, RuntimePatchDefinition, RuntimeServices } from "@sonobe/engine";
import { findSpecPort, warnOnce } from "../infra/index.ts";
import { getSpec } from "../specs.ts";

export type Vec2 = [number, number];

/** A tap or long press allows this much movement, in points (ARCHITECTURE.md §5.5). */
export const TOUCH_SLOP = 10;

/** The Layer input as a reference; null (the whole screen) when empty or malformed. */
export function layerInput(ctx: Pick<PatchContext, "input">, key = "layer"): LayerRef | null {
  const value = ctx.input<unknown>(key);
  return typeof value === "object" && value !== null && typeof (value as LayerRef).layerId === "string" ? (value as LayerRef) : null;
}

function portLabel(ctx: Pick<PatchContext, "node">, key: string): string {
  const spec = getSpec(ctx.node.type);
  const port = spec ? findSpecPort(spec, key)?.port.name : undefined;
  return `${spec?.name ?? ctx.node.type}'s ${port ?? key}`;
}

type WarnContext = Pick<PatchContext, "id" | "componentPath" | "frame" | "services" | "node" | "input">;

/** A number input; non-finite values read as 0 with one warning per restart. */
export function finiteInput(ctx: WarnContext, key: string): number {
  const value = ctx.input<unknown>(key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  warnOnce(ctx, `nonFinite:${key}`, `${portLabel(ctx, key)} isn't a finite number, so it counts as 0.`);
  return 0;
}

/** A point or size input; non-finite components read as 0 with one warning per restart. */
export function finitePointInput(ctx: WarnContext, key: string): Vec2 {
  const value = ctx.input<unknown>(key);
  const x = Array.isArray(value) ? value[0] : undefined;
  const y = Array.isArray(value) ? value[1] : undefined;
  const fx = typeof x === "number" && Number.isFinite(x);
  const fy = typeof y === "number" && Number.isFinite(y);
  if (!fx || !fy) warnOnce(ctx, `nonFinite:${key}`, `${portLabel(ctx, key)} has a value that isn't a finite number, so that part counts as 0.`);
  return [fx ? (x as number) : 0, fy ? (y as number) : 0];
}

/** A copy of a pointer coordinate pair, or null when either coordinate isn't finite. */
export function finitePoint(point: readonly number[] | undefined): Vec2 | null {
  const x = point?.[0];
  const y = point?.[1];
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

export function samePoint(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function usableScale(scale: number | undefined): number {
  return typeof scale === "number" && Number.isFinite(scale) && Math.abs(scale) > 1e-6 ? scale : 1;
}

/**
 * Product of the ancestor layers' scales (previous frame's layout), so pointer deltas in prototype
 * points convert to the layer's parent space. Rotations aren't compensated; zero or non-finite scales count as 1.
 */
export function ancestorScale(services: RuntimeServices, ref: LayerRef | null): Vec2 {
  if (!ref) return [1, 1];
  let sx = 1;
  let sy = 1;
  const seen = new Set<string>();
  let info = services.layerInfo(ref);
  while (info?.parent && !seen.has(info.parent) && seen.size < 64) {
    seen.add(info.parent);
    info = services.layerInfo(ref.instance === undefined ? { layerId: info.parent } : { layerId: info.parent, instance: ref.instance });
    if (!info) break;
    sx *= usableScale(info.scale[0]);
    sy *= usableScale(info.scale[1]);
  }
  return [sx, sy];
}

/** The parent layer of `ref` (same loop instance), or null for root layers and missing layers. */
export function parentRef(services: RuntimeServices, ref: LayerRef | null): LayerRef | null {
  const parent = ref ? services.layerInfo(ref)?.parent : null;
  if (!ref || !parent) return null;
  return ref.instance === undefined ? { layerId: parent } : { layerId: parent, instance: ref.instance };
}

/** Declare what the runtime does while the patch is muted (engine extension to the contract). */
export function withMutedBehavior<S>(definition: PatchDefinition<S>, mutedBehavior: MutedBehavior): RuntimePatchDefinition<S> {
  return Object.assign(definition, { mutedBehavior });
}
