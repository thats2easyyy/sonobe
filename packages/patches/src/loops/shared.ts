/**
 * Helpers shared by the loop patches: index loops, the single-value port warning, JSON snapshots,
 * the muted pass-through used by the loop mutation patches, replay caches, and variant port
 * declarations with correct defaults.
 */

import type { PatchSpec, PortSpec, Value } from "@sonobe/core";
import type { PatchContext, PatchDefinition, RuntimePatchDefinition } from "@sonobe/engine";
import { equalValues, isPlainObject, loopOf, nodePorts, portDefaultLiteral, zeroValue } from "../infra/index.ts";
import { getSpec } from "../specs.ts";

/** Positions 0 … n − 1. */
export function indices(n: number): number[] {
  const out = new Array<number>(Math.max(0, n));
  for (let i = 0; i < out.length; i++) out[i] = i;
  return out;
}

/** State shared by patches that warn once per restart about looped single-value ports. */
export interface WarnedState {
  warned: boolean;
}

/**
 * Log `message` once per state (so once per restart) when a loop with more than one item drives
 * any of `keys`; those ports read item 0.
 */
export function warnIfLooped(ctx: PatchContext<WarnedState>, keys: readonly string[], message: string): void {
  if (ctx.state.warned) return;
  for (const key of keys) {
    if (ctx.inputItems(key).length > 1) {
      ctx.state.warned = true;
      ctx.services.log("warn", message);
      return;
    }
  }
}

/** A deep copy of arrays and plain objects; other values are immutable and returned as they are. */
export function snapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.map(snapshot) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = snapshot(v);
    return out as T;
  }
  return value;
}

/** Declare how the engine treats a muted patch (engine extension; see @sonobe/engine README). */
export function withMutedBehavior<S>(definition: PatchDefinition<S>, behavior: RuntimePatchDefinition<S>["mutedBehavior"]): RuntimePatchDefinition<S> {
  return Object.assign(definition, { mutedBehavior: behavior });
}

/**
 * The muted output of the loop mutation patches: Loop unchanged and positions 0 … count − 1.
 * Returns true when the patch is muted and has written its outputs.
 */
export function passThroughWhenMuted(ctx: PatchContext<unknown>, indexKey: string): boolean {
  if (ctx.node.muted !== true) return false;
  const items = ctx.inputItems("loop");
  ctx.output("output", loopOf(items));
  ctx.output(indexKey, loopOf(indices(items.length)));
  return true;
}

/** Same length and structurally equal items. */
export function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !equalValues(a[i], b[i])) return false;
  return true;
}

/** The last replay result for one source loop. The cached arrays are never mutated. */
export interface ReplayCache {
  source: readonly unknown[];
  items: readonly unknown[];
}

/** `replay(source)` unless `cache` already holds the result for an equal source. */
export function cachedReplay(cache: ReplayCache | null, source: readonly unknown[], replay: (source: readonly unknown[]) => unknown[]): ReplayCache {
  if (cache && sameItems(cache.source, source)) return cache;
  return { source: [...source], items: replay(source) };
}

/**
 * The variant-typed input ports of catalog patch `type` (static, and variadic with `startIndex`)
 * with defaults per CONVENTIONS.md §8: loop literals for every variant, the declared default for
 * the first variant, and the type's zero value for other variants.
 */
export function variantInputPorts(type: string, typeParam: string | undefined, inputCount: number | undefined): PortSpec[] {
  const spec = getSpec(type);
  if (!spec) return [];
  const variantKeys = new Set(spec.inputs.filter((p) => p.type === "variant").map((p) => p.key));
  const variadic = spec.variadic?.type === "variant" && (spec.variadic.direction ?? "inputs") === "inputs";
  return nodePorts(spec, typeParam, inputCount)
    .inputs.filter((p) => variantKeys.has(p.key) || (variadic && p.variadicIndex !== undefined))
    .map((resolved) => {
      const port: PortSpec & { variadicIndex?: number } = { ...resolved };
      delete port.variadicIndex;
      const literal = portDefaultLiteral(spec, port.key, typeParam);
      port.default = literal === undefined ? zeroValue(port.type, port.enumOptions) : (literal as Value);
      return port;
    });
}

/**
 * A `dynamicPorts` that re-declares {@link variantInputPorts}. Core's resolveNodePorts coerces a
 * variant port's default to the active variant (so `{ "loop": [] }` becomes text or 0) and expands
 * variadic ports 1-based; its merge replaces those ports key for key, and adds `item0`.
 */
export function variantPortsFor(type: string): NonNullable<PatchSpec["dynamicPorts"]> {
  return (node) => ({ inputs: variantInputPorts(type, node.typeParam, node.inputCount), outputs: [] });
}
