import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { formatNumberPatch, formatNumberText } from "./formatNumber.ts";
import type { NumberFormatOptions } from "./formatNumber.ts";

const DEFAULTS: NumberFormatOptions = {
  style: "number",
  decimals: 0,
  rounding: "nearest",
  trailingZeros: true,
  minimumDigits: 1,
  separators: "commaPeriod",
  groupThousands: true,
};

const format = (value: number, options: Partial<NumberFormatOptions> = {}) => formatNumberText(value, { ...DEFAULTS, ...options });

const run = (inputs: Record<string, unknown>) => createPatchHarness(formatNumberPatch, { inputs }).step().outputs.text;

describe("formatNumber", () => {
  it("formats the catalog examples", () => {
    expect(run({ value: 1234.5 })).toBe("1,235");
    expect(run({ value: 1234.5, decimals: 2 })).toBe("1,234.50");
    expect(run({ value: 1234.5, decimals: 2, trailingZeros: false })).toBe("1,234.5");
    expect(run({ value: 0.426, style: "percent" })).toBe("43%");
    expect(run({ value: 12345, style: "compact", decimals: 1 })).toBe("12.3K");
    expect(run({ value: 999950, style: "compact", decimals: 1 })).toBe("1.0M");
    expect(run({ value: 999950, style: "compact", decimals: 1, trailingZeros: false })).toBe("1M");
    expect(run({ value: -0.4 })).toBe("0");
    expect(run({ value: 7, minimumDigits: 2 })).toBe("07");
    expect(run({ value: 1234.5, decimals: 2, separators: "periodComma" })).toBe("1.234,50");
  });

  it("adds prefix and suffix around the sign", () => {
    expect(run({ value: -5, prefix: "$" })).toBe("$-5");
    expect(run({ value: 3, prefix: "Page ", suffix: " of 5" })).toBe("Page 3 of 5");
    expect(run({ value: 2, prefix: 10, suffix: true })).toBe("102true");
  });

  it("rounds nearest half away from zero, down toward −∞, and up toward +∞", () => {
    expect(format(2.5)).toBe("3");
    expect(format(-2.5)).toBe("-3");
    expect(format(1.005, { decimals: 2 })).toBe("1.01");
    expect(format(2.9, { rounding: "down" })).toBe("2");
    expect(format(-2.1, { rounding: "down" })).toBe("-3");
    expect(format(2.1, { rounding: "up" })).toBe("3");
    expect(format(-2.9, { rounding: "up" })).toBe("-2");
    expect(format(-0.2, { rounding: "up" })).toBe("0");
    expect(format(12.35, { decimals: 1, rounding: "bogus" })).toBe("12.4");
  });

  it("shortens with K, M, B, and T and stays in T past a trillion", () => {
    expect(format(999, { style: "compact" })).toBe("999");
    expect(format(1000, { style: "compact" })).toBe("1K");
    expect(format(-1500, { style: "compact", decimals: 1 })).toBe("-1.5K");
    expect(format(2.5e9, { style: "compact", decimals: 1 })).toBe("2.5B");
    expect(format(999.6, { style: "compact" })).toBe("1K");
    expect(format(2e15, { style: "compact" })).toBe("2,000T");
    expect(format(1200, { style: "compact", decimals: 1, trailingZeros: false })).toBe("1.2K");
    expect(format(1000, { style: "compact", decimals: 1, trailingZeros: false })).toBe("1K");
  });

  it("never writes exponent notation", () => {
    expect(format(1e21)).toBe("1,000,000,000,000,000,000,000");
    expect(format(1e-7, { decimals: 8 })).toBe("0.00000010");
  });

  it("clamps decimals and minimum digits to whole numbers in range", () => {
    expect(format(3.14159, { decimals: 2.7 })).toBe("3.14");
    expect(format(1.5, { decimals: -3 })).toBe("2");
    expect(format(0.1, { decimals: 99 })).toBe("0.10000000000000000000");
    expect(format(5, { minimumDigits: 0 })).toBe("5");
    expect(format(5, { minimumDigits: 3.9 })).toBe("005");
    expect(format(5, { minimumDigits: 100, groupThousands: false })).toBe("000000000000000000005");
    expect(format(5, { minimumDigits: 5 })).toBe("00,005");
    expect(format(1234, { minimumDigits: 6 })).toBe("001,234");
  });

  it("uses the chosen separators, with a no-break space for Space and Comma", () => {
    expect(format(1234.5, { decimals: 1, separators: "spaceComma" })).toBe("1 234,5");
    expect(format(1234567, { groupThousands: false })).toBe("1234567");
    expect(format(1234.5, { decimals: 1, separators: "unknown" })).toBe("1,234.5");
  });

  it("formats each loop index", () => {
    const h = createPatchHarness(formatNumberPatch, { inputs: { value: loopOf([1, 1500, 2e6]), style: "compact", decimals: loopOf([0, 1]) } });
    expect(h.step().outputs.text).toEqual(loopOf(["1", "1.5K", "2M"]));
  });

  it("shows non-finite values as 0 and warns once", () => {
    const h = createPatchHarness(formatNumberPatch, { inputs: { value: Number.NaN, prefix: "$" } });
    expect(h.step().outputs.text).toBe("$0");
    h.step({ inputs: { value: Number.POSITIVE_INFINITY } });
    expect(h.output("text")).toBe("$0");
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("outputs the plain number-to-text coercion while muted", () => {
    const result = runPatch(formatNumberPatch, [{ value: 1234.5678912, prefix: "$", decimals: 2 }], { muted: true });
    expect(result.frames[0]!.outputs.text).toBe("1234.567891");
  });

  it("runs in the engine evaluator with declared defaults", () => {
    const result = runPatch(formatNumberPatch, [{}, { value: 12500 }]);
    expect(result.frames.map((f) => f.outputs.text)).toEqual(["0", "12,500"]);
    expect(result.issues).toEqual([]);
  });
});
