/**
 * Typed arithmetic for Add, Subtract, Multiply, Divide, Modulo, Min, and Max: component-wise over
 * numbers, vectors, and colors by typeParam, text joining for Add, and the edge cases those
 * patches share. Non-finite results become 0, -0 becomes 0, and a zero divisor gives 0.
 */

import { inferValueType } from "@sonobe/core";
import type { Value, ValueType } from "@sonobe/core";
import { componentCount, components, fromComponents, toText } from "./values.ts";

export type ArithmeticOp = "add" | "subtract" | "multiply" | "divide" | "modulo" | "min" | "max";

/** What went wrong while computing; patches turn these into one warning per restart. */
export interface ArithmeticReport {
  /** Some result component wasn't finite and became 0. */
  nonFinite: boolean;
  /** 0-based position of the first operand that was a zero divisor (divide, modulo), or null. */
  zeroDivisor: number | null;
}

export function createArithmeticReport(): ArithmeticReport {
  return { nonFinite: false, zeroDivisor: null };
}

function operandType(type: string | undefined, first: unknown): ValueType {
  if (type === "text") return "text";
  if (type === "boolean") return "number";
  if (type !== undefined && componentCount(type) !== undefined) return type as ValueType;
  if (typeof first === "string") return "text";
  const inferred = inferValueType(first as Value);
  return componentCount(inferred) !== undefined && inferred !== "boolean" ? inferred : "number";
}

function apply(op: ArithmeticOp, a: number, b: number, position: number, report: ArithmeticReport | undefined): number {
  switch (op) {
    case "add":
      return a + b;
    case "subtract":
      return a - b;
    case "multiply":
      return a * b;
    case "divide":
      if (b === 0) {
        if (report && report.zeroDivisor === null) report.zeroDivisor = position;
        return 0;
      }
      return a / b;
    case "modulo": {
      if (b === 0) {
        if (report && report.zeroDivisor === null) report.zeroDivisor = position;
        return 0;
      }
      const r = a - b * Math.floor(a / b);
      return Math.abs(r) >= Math.abs(b) ? 0 : r;
    }
    case "min":
      return Math.min(a, b);
    case "max":
      return Math.max(a, b);
  }
}

/**
 * Left fold of `values` with `op` for `type` (the patch's typeParam; inferred from the first value
 * when omitted). Operands coerce to the type, so a number broadcasts into a vector. Colors work
 * channel by channel and clamp to 0–1. Text joins for add; other ops on text return the first value.
 * Modulo is floored: the result has the sign of the divisor.
 */
export function foldArithmetic(op: ArithmeticOp, values: readonly unknown[], type?: ValueType | string, report?: ArithmeticReport): Value {
  const t = operandType(type, values[0]);
  if (t === "text") return op === "add" ? values.map(toText).join("") : toText(values[0]);
  if (values.length === 0) return fromComponents([], t);
  const acc = components(values[0], t);
  for (let i = 1; i < values.length; i++) {
    const b = components(values[i], t);
    for (let j = 0; j < acc.length; j++) acc[j] = apply(op, acc[j]!, b[j] ?? 0, i, report);
  }
  for (let j = 0; j < acc.length; j++) {
    const v = acc[j]!;
    if (!Number.isFinite(v)) {
      acc[j] = 0;
      if (report) report.nonFinite = true;
    } else if (v === 0) {
      acc[j] = 0;
    }
  }
  return fromComponents(acc, t);
}

/** `op` on two operands; see {@link foldArithmetic}. */
export function arithmetic(op: ArithmeticOp, a: unknown, b: unknown, type?: ValueType | string, report?: ArithmeticReport): Value {
  return foldArithmetic(op, [a, b], type, report);
}

export function addValues(a: unknown, b: unknown, type?: ValueType | string, report?: ArithmeticReport): Value {
  return foldArithmetic("add", [a, b], type, report);
}

export function subtractValues(a: unknown, b: unknown, type?: ValueType | string, report?: ArithmeticReport): Value {
  return foldArithmetic("subtract", [a, b], type, report);
}

export function multiplyValues(a: unknown, b: unknown, type?: ValueType | string, report?: ArithmeticReport): Value {
  return foldArithmetic("multiply", [a, b], type, report);
}

export function divideValues(a: unknown, b: unknown, type?: ValueType | string, report?: ArithmeticReport): Value {
  return foldArithmetic("divide", [a, b], type, report);
}

export function moduloValues(a: unknown, b: unknown, type?: ValueType | string, report?: ArithmeticReport): Value {
  return foldArithmetic("modulo", [a, b], type, report);
}

export function minValues(a: unknown, b: unknown, type?: ValueType | string, report?: ArithmeticReport): Value {
  return foldArithmetic("min", [a, b], type, report);
}

export function maxValues(a: unknown, b: unknown, type?: ValueType | string, report?: ArithmeticReport): Value {
  return foldArithmetic("max", [a, b], type, report);
}
