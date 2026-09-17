/**
 * Helpers shared by the data patches: converting port values to plain JSON, JSON equality,
 * reading found JSON as a variant type, own-property writes that treat `__proto__` as an ordinary
 * key, per-index warnings, and declaring a muted behavior on a definition.
 */

import { coerce } from "@sonobe/core";
import type { Value, ValueType } from "@sonobe/core";
import type { MutedBehavior, PatchContext, PatchDefinition, RuntimePatchDefinition } from "@sonobe/engine";
import { equalValues, isPlainObject, toJson, warnOnce, zeroValue } from "../infra/index.ts";

/** Attach the engine's `mutedBehavior` extension to a definition. */
export function withMutedBehavior<S>(definition: PatchDefinition<S>, mutedBehavior: MutedBehavior): RuntimePatchDefinition<S> {
  return Object.assign(definition, { mutedBehavior });
}

/** `warnOnce` scoped to this loop index. */
export function warnIndexed(ctx: PatchContext, key: string, message: string): boolean {
  return warnOnce(ctx, `${key}#${ctx.loopIndex}`, message);
}

/**
 * A port value as plain JSON (CONVENTIONS.md data helpers): colors become "#RRGGBBAA", non-finite
 * numbers 0 (with one warning), undefined null, vectors and objects map recursively, media
 * references stay objects. JSON-typed values are passed by reference; only a non-finite top-level
 * number is replaced.
 */
export function portJson(ctx: PatchContext, value: unknown, type: string | undefined): unknown {
  const nonFinite = () => warnIndexed(ctx, "nonFinite", "A number that isn't finite was stored as 0.");
  if (type === "json" || type === "any") {
    if (value === undefined) return null;
    if (typeof value === "number" && !Number.isFinite(value)) {
      nonFinite();
      return 0;
    }
    return value;
  }
  return toJson(value, nonFinite);
}

/** Deep JSON equality: same kind, arrays in order, objects with the same own keys in any order. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return equalValues(a, b);
}

/** Found JSON read as `variant`: json unchanged, null as the zero value, anything else coerced. */
export function readAs(found: unknown, variant: string): Value {
  if (variant === "json") return found === undefined ? null : (found as Value);
  if (found === null || found === undefined) return zeroValue(variant);
  return coerce(found as Value, "json", variant as ValueType);
}

/** Define an own enumerable property, so keys like `__proto__` are stored as ordinary keys. */
export function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

/** A shallow copy that keeps key order and own-property semantics. */
export function shallowCopy(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) defineOwn(out, key, source[key]);
  return out;
}

/** True for a plain JSON object whose own key `key` exists. */
export function hasOwnKey(value: unknown, key: string): value is Record<string, unknown> {
  return isPlainObject(value) && Object.hasOwn(value, key);
}

/** The variant a patch evaluates with: `ctx.typeParam` or the spec's first variant. */
export function variantOf(ctx: Pick<PatchContext, "typeParam">, definition: { variants?: readonly string[] }): string {
  return ctx.typeParam ?? definition.variants?.[0] ?? "json";
}

/** Strip a leading byte-order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** `String(e.message ?? e)` for caught errors. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? error);
}

/** Is `value` a thenable? */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as { then?: unknown }).then === "function";
}
