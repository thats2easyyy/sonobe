/**
 * Helpers shared by the state patches: the effective variant, the value-equality rules the
 * catalog specifies, probing whether an input is driven by a pulse, 0-based option ports,
 * duration inputs, and muted behavior.
 */

import { encodeValue, isColor, resolveTypeParam } from "@sonobe/core";
import type { PatchSpec, PortSpec, Value, ValueType } from "@sonobe/core";
import type { MutedBehavior, PatchContext, PatchDefinition, RuntimePatchDefinition } from "@sonobe/engine";
import { isPlainObject, portDefaultLiteral, resolvePortType, safeDuration, variadicKeys, warnOnce, zeroValue } from "../infra/index.ts";

/** The node's effective variant: its typeParam when the spec allows it, else the first variant. */
export function variantOf(ctx: Pick<PatchContext, "typeParam">, spec: PatchSpec): ValueType {
  return resolveTypeParam(spec, ctx.typeParam) ?? "number";
}

/** Attach the engine's muted behavior extension to a definition. */
export function withMutedBehavior<S>(definition: PatchDefinition<S>, behavior: MutedBehavior): RuntimePatchDefinition<S> {
  return Object.assign(definition, { mutedBehavior: behavior });
}

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

const VECTOR_TYPES: ReadonlySet<string> = new Set(["point", "point3d", "point4d", "size", "anchor"]);
const MEDIA_TYPES: ReadonlySet<string> = new Set(["image", "video", "sound"]);

/** `===`, except that NaN equals NaN so a steady NaN never counts as a change. */
function sameNumber(a: unknown, b: unknown): boolean {
  return a === b || (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b));
}

/** Deep JSON equality: same kind; arrays element by element in order; objects with the same keys in any order. */
export function jsonEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (sameNumber(a, b)) return true;
  if (depth > 64 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i], depth + 1)) return false;
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  for (const key of keys) if (!Object.hasOwn(rb, key) || !jsonEqual(ra[key], rb[key], depth + 1)) return false;
  return true;
}

const channel8 = (c: number) => Math.round(c * 255);

/** How colors compare: at document precision (8 bits per channel) or exactly. */
export type ColorPrecision = "8bit" | "exact";

/**
 * Value equality by variant (CONVENTIONS.md behavior text for Pulse on Change, Option Equals, Delay):
 * numbers and indices with `===` (0 equals −0), booleans, enum keys and text strictly, vectors component by
 * component, colors per channel (8-bit or exact), layer references by id and copy, media by asset id or url,
 * and everything else (json, gradients, shapes, effects) deeply.
 */
export function sameValue(a: unknown, b: unknown, variant: ValueType, colors: ColorPrecision = "8bit"): boolean {
  switch (variant) {
    case "number":
    case "index":
      return sameNumber(a, b);
    case "boolean":
    case "enum":
    case "text":
      return a === b;
    case "color":
      if (isColor(a) && isColor(b)) {
        return colors === "exact"
          ? sameNumber(a.r, b.r) && sameNumber(a.g, b.g) && sameNumber(a.b, b.b) && sameNumber(a.a, b.a)
          : channel8(a.r) === channel8(b.r) && channel8(a.g) === channel8(b.g) && channel8(a.b) === channel8(b.b) && channel8(a.a) === channel8(b.a);
      }
      return jsonEqual(a, b);
    case "layer":
      if (isPlainObject(a) && isPlainObject(b)) return a.layerId === b.layerId && (a.instance ?? null) === (b.instance ?? null);
      return a === b;
    default:
      if (VECTOR_TYPES.has(variant) && Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!sameNumber(a[i], b[i])) return false;
        return true;
      }
      if (MEDIA_TYPES.has(variant) && isPlainObject(a) && isPlainObject(b)) {
        return (a.assetId ?? null) === (b.assetId ?? null) && (a.url ?? null) === (b.url ?? null);
      }
      return jsonEqual(a, b);
  }
}

// ---------------------------------------------------------------------------
// Pulse sources
// ---------------------------------------------------------------------------

/** What the engine's PatchContext implementation exposes beyond the contract (its compiled node). */
interface EngineContextProbe {
  isPulseSource?: (key: string) => boolean;
  spec?: { muted?: unknown; inputs?: readonly { key?: unknown; pulseSource?: unknown }[] };
}

/**
 * Whether the patch is muted, directly or through a muted component instance around it. PatchContext only
 * exposes the node's own flag, so this also reads the engine's compiled node when the context has one.
 */
export function isMuted(ctx: PatchContext<any>): boolean {
  return ctx.node.muted === true || (ctx as unknown as EngineContextProbe).spec?.muted === true;
}

/**
 * Whether input `key` is driven by a pulse output, as opposed to a held state. PatchContext can't say
 * (contract change request `PatchContext.isPulseSource`), so this uses that method when a host provides it,
 * then the engine's compiled input slot, and otherwise reports false.
 */
export function drivenByPulse(ctx: PatchContext<any>, key: string): boolean {
  const probe = ctx as unknown as EngineContextProbe;
  if (typeof probe.isPulseSource === "function") return probe.isPulseSource(key) === true;
  const inputs = probe.spec?.inputs;
  if (!Array.isArray(inputs)) return false;
  for (const slot of inputs) if (slot?.key === key) return slot.pulseSource === true;
  return false;
}

/**
 * True when a boolean-variant input carries an upstream pulse on this patch's first evaluation. Patches that
 * seed history from the first value (Delay, Delay One Frame) seed `false` then, so the pulse is an event
 * instead of a starting state.
 */
export function pulseOnFirstFrame(ctx: PatchContext<any>, key: string, variant: ValueType): boolean {
  return variant === "boolean" && drivenByPulse(ctx, key) && ctx.pulsed(key);
}

// ---------------------------------------------------------------------------
// Option ports
// ---------------------------------------------------------------------------

/** The literal an option port starts with: the variant's declared default, or its zero value encoded. */
function optionDefault(spec: PatchSpec, key: string, typeParam: string | undefined): Value {
  const literal = portDefaultLiteral(spec, key, typeParam);
  if (literal !== undefined) return literal;
  const type = resolvePortType(spec, spec.variadic!.type, typeParam);
  return encodeValue(zeroValue(type), type) as Value;
}

/**
 * dynamicPorts for the option patches: variadic ports expanded from `startIndex` on the side `direction`
 * names (CONVENTIONS.md §9). Core expands variadics 1-based on the input side until contract change request 1
 * lands; these ports override the matching keys and add the missing ones, so `option0` and Option Sender's
 * outputs exist everywhere ports are resolved.
 */
export function optionPorts(spec: PatchSpec): NonNullable<PatchSpec["dynamicPorts"]> {
  const v = spec.variadic;
  if (!v) throw new Error(`optionPorts: "${spec.type}" has no variadic ports.`);
  const start = v.startIndex ?? 1;
  const outputs = v.direction === "outputs";
  return (node) => {
    const ports = variadicKeys(spec, node.inputCount).map((key, i): PortSpec => {
      const port: PortSpec = { key, name: `${v.name} ${start + i}`, type: v.type, description: v.description };
      if (!outputs && v.type !== "pulse") port.default = optionDefault(spec, key, node.typeParam);
      return port;
    });
    return outputs ? { inputs: [], outputs: ports } : { inputs: ports, outputs: [] };
  };
}

/** Expanded option keys `${key}0…${key}31`, precomputed so evaluators don't build strings every frame. */
export function optionKeys(key: string, max = 32): readonly string[] {
  return Array.from({ length: max }, (_, i) => `${key}${i}`);
}

/** An option number read as a whole number with a 1e-6 epsilon, clamped to [0, count − 1]; non-finite picks 0. */
export function optionIndex(value: unknown, count: number): number {
  const n = typeof value === "number" ? value : typeof value === "boolean" ? (value ? 1 : 0) : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.floor(n + 1e-6), 0), count - 1);
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/** A duration input in seconds: negative is 0, and NaN or ±Infinity is 0 with one warning per restart. */
export function readDuration(ctx: PatchContext<any>, key: string, label: string): number {
  const { seconds, valid } = safeDuration(ctx.input(key));
  if (!valid) warnOnce(ctx, `${key}:nonFinite`, `${label} "${ctx.id}": ${key} isn't a finite number of seconds, so it counts as 0.`);
  return seconds;
}
