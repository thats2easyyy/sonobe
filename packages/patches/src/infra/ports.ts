/**
 * Port helpers: concrete port types for a variant, declared defaults as runtime values
 * (variantDefaults and zero values, CONVENTIONS.md §7–§8), and variadic expansion that honors
 * `startIndex` and `direction`.
 */

import { decodeInput, isDecodedLoop, isGradientLiteral, isLiteral, isLoopLiteral, resolveInputCount, resolveTypeParam } from "@sonobe/core";
import type { EnumOption, InputValue, PatchSpec, PortSpec, ResolvedPort, Value, ValueType } from "@sonobe/core";
import { loopOf } from "./loops.ts";
import { zeroValue } from "./values.ts";

/** The concrete type of a port: "variant" becomes the effective variant (or "any" without variants). */
export function resolvePortType(spec: PatchSpec, portType: PortSpec["type"], typeParam?: string): ValueType {
  return portType === "variant" ? (resolveTypeParam(spec, typeParam) ?? "any") : portType;
}

/** A declared default (document encoding, CONVENTIONS.md §7) as an InputValue core `decodeInput` accepts. */
export function defaultToInput(value: unknown): InputValue | undefined {
  if (value === undefined) return undefined;
  if (isLiteral(value) || isLoopLiteral(value) || isGradientLiteral(value)) return value;
  return { json: value };
}

/** Decode a declared default into a runtime value of `type`; `{ loop }` literals become Loop values. */
export function decodeDefault(value: unknown, type: ValueType, enumOptions?: readonly EnumOption[]): Value {
  const input = defaultToInput(value);
  if (input === undefined) return zeroValue(type, enumOptions);
  const decoded = decodeInput(input, type);
  if (decoded === undefined) return zeroValue(type, enumOptions);
  return isDecodedLoop(decoded) ? loopOf(decoded.items) : decoded;
}

/** Expanded variadic keys for `count` ports (clamped to the spec range): `value1…`, or `option0…` with startIndex 0. */
export function variadicKeys(spec: PatchSpec, count?: number): string[] {
  const v = spec.variadic;
  if (!v) return [];
  const n = resolveInputCount(spec, count) ?? v.defaultCount;
  const start = v.startIndex ?? 1;
  return Array.from({ length: n }, (_, i) => `${v.key}${start + i}`);
}

/** The number in an expanded variadic key (`option2` → 2) within the spec's maximum, else undefined. */
export function variadicIndex(spec: PatchSpec, key: string): number | undefined {
  const v = spec.variadic;
  if (!v || !key.startsWith(v.key)) return undefined;
  const rest = key.slice(v.key.length);
  if (!/^(0|[1-9]\d*)$/.test(rest)) return undefined;
  const n = Number(rest);
  const start = v.startIndex ?? 1;
  return n >= start && n < start + v.max ? n : undefined;
}

/** A declared port by key: static inputs, static outputs, then expanded variadic keys. */
export function findSpecPort(spec: PatchSpec, key: string): { port: PortSpec; direction: "inputs" | "outputs" } | undefined {
  const input = spec.inputs.find((p) => p.key === key);
  if (input) return { port: input, direction: "inputs" };
  const output = spec.outputs.find((p) => p.key === key);
  if (output) return { port: output, direction: "outputs" };
  const n = variadicIndex(spec, key);
  const v = spec.variadic;
  if (n === undefined || !v) return undefined;
  const port: PortSpec = { key, name: `${v.name} ${n}`, type: v.type, description: v.description };
  if (v.default !== undefined) port.default = v.default;
  return { port, direction: v.direction ?? "inputs" };
}

/**
 * The literal a port starts with for a variant (document encoding): the spec's `variantDefaults`
 * entry (by expanded or base variadic key), the declared default for the first variant, or
 * undefined (the zero value) for other variants. Loop literals apply to every variant.
 */
export function portDefaultLiteral(spec: PatchSpec, key: string, typeParam?: string): unknown {
  const found = findSpecPort(spec, key);
  if (!found) return undefined;
  const { port } = found;
  if (port.type !== "variant" || !spec.variants?.length) return port.default;
  const variant = resolveTypeParam(spec, typeParam)!;
  const overrides = spec.variantDefaults?.[variant];
  if (overrides && Object.hasOwn(overrides, key)) return overrides[key];
  const baseKey = spec.variadic && variadicIndex(spec, key) !== undefined ? spec.variadic.key : undefined;
  if (overrides && baseKey !== undefined && Object.hasOwn(overrides, baseKey)) return overrides[baseKey];
  if (variant === spec.variants[0] || isLoopLiteral(port.default)) return port.default;
  return undefined;
}

/** Runtime default for a port (static or expanded variadic) for `typeParam`; undefined for unknown keys. */
export function resolvePortDefault(spec: PatchSpec, key: string, typeParam?: string): Value | undefined {
  const found = findSpecPort(spec, key);
  if (!found) return undefined;
  const type = resolvePortType(spec, found.port.type, typeParam);
  return decodeDefault(portDefaultLiteral(spec, key, typeParam), type, found.port.enumOptions);
}

/**
 * Concrete static and variadic ports for a node, without dynamic ports. Variadic ports go to the
 * side named by `direction` and use `startIndex`; `variadicIndex` on each is its 1-based position.
 */
export function nodePorts(spec: PatchSpec, typeParam?: string, inputCount?: number): { inputs: ResolvedPort[]; outputs: ResolvedPort[] } {
  const resolve = (p: PortSpec): ResolvedPort => ({ ...p, type: resolvePortType(spec, p.type, typeParam) });
  const inputs = spec.inputs.map(resolve);
  const outputs = spec.outputs.map(resolve);
  const v = spec.variadic;
  if (v) {
    const side = (v.direction ?? "inputs") === "outputs" ? outputs : inputs;
    const start = v.startIndex ?? 1;
    variadicKeys(spec, inputCount).forEach((key, i) => {
      const port = resolve({ key, name: `${v.name} ${start + i}`, type: v.type, description: v.description });
      if (v.default !== undefined) port.default = v.default;
      port.variadicIndex = i + 1;
      side.push(port);
    });
  }
  return { inputs, outputs };
}
