import { describe, expect, it } from "vitest";
import {
  createScrubSession,
  decimalsOf,
  formatNumber,
  nudgeValue,
  parseNumberInput,
  roundTo,
  stepMultiplier,
} from "./scrubMath.ts";

describe("stepMultiplier", () => {
  it("uses ×10 for Shift, ×0.1 for Alt, and ×1 otherwise", () => {
    expect(stepMultiplier({})).toBe(1);
    expect(stepMultiplier({ shiftKey: true })).toBe(10);
    expect(stepMultiplier({ altKey: true })).toBe(0.1);
    expect(stepMultiplier({ shiftKey: true, altKey: true })).toBe(1);
  });
});

describe("decimalsOf / roundTo", () => {
  it("counts decimals from the shortest representation", () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.1)).toBe(1);
    expect(decimalsOf(0.25)).toBe(2);
    expect(decimalsOf(-3.125)).toBe(3);
    expect(decimalsOf(1e-7)).toBe(6);
  });

  it("rounds without float noise and never yields -0", () => {
    expect(roundTo(0.1 + 0.2, 6)).toBe(0.3);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(Object.is(roundTo(-0.0001, 2), 0)).toBe(true);
  });
});

describe("nudgeValue (arrow keys)", () => {
  it("steps ±1, Shift ±10, Alt ±0.1", () => {
    expect(nudgeValue(5, 1)).toBe(6);
    expect(nudgeValue(5, -1, { modifiers: { shiftKey: true } })).toBe(-5);
    expect(nudgeValue(0.2, 1, { modifiers: { altKey: true } })).toBe(0.3);
    expect(nudgeValue(0.7, 1, { modifiers: { altKey: true } })).toBe(0.8);
    expect(nudgeValue(1, -1, { modifiers: { altKey: true } })).toBe(0.9);
  });

  it("keeps the value's own precision", () => {
    expect(nudgeValue(12.345, 1)).toBe(13.345);
  });

  it("clamps to min and max", () => {
    expect(nudgeValue(0.95, 1, { modifiers: { altKey: true }, max: 1 })).toBe(1);
    expect(nudgeValue(3, -1, { modifiers: { shiftKey: true }, min: 0 })).toBe(0);
  });

  it("honors a custom base step", () => {
    expect(nudgeValue(400, 1, { step: 100 })).toBe(500);
    expect(nudgeValue(0.5, -1, { step: 0.01 })).toBe(0.49);
  });
});

describe("createScrubSession (drag)", () => {
  it("turns pointer travel into steps", () => {
    const session = createScrubSession({ startValue: 10, pixelsPerStep: 2 });
    expect(session.move(10)).toBe(15);
    expect(session.move(-4)).toBe(13);
    expect(session.value).toBe(13);
  });

  it("ignores zero travel so the start value is not snapped", () => {
    const session = createScrubSession({ startValue: 12.37 });
    expect(session.move(0)).toBe(12.37);
  });

  it("snaps to multiples of the effective step", () => {
    expect(createScrubSession({ startValue: 12.37, pixelsPerStep: 1 }).move(1)).toBe(13);
    const weight = createScrubSession({ startValue: 400, step: 100, pixelsPerStep: 4, min: 100, max: 900 });
    expect(weight.move(9)).toBe(600);
  });

  it("applies modifiers per move: Shift snaps to tens, Alt to tenths", () => {
    const coarse = createScrubSession({ startValue: 0, pixelsPerStep: 1 });
    coarse.move(3);
    expect(coarse.value).toBe(3);
    expect(coarse.move(2, { shiftKey: true })).toBe(20);

    const fine = createScrubSession({ startValue: 1, pixelsPerStep: 1 });
    expect(fine.move(1, { altKey: true })).toBe(1.1);
    expect(fine.move(2, { altKey: true })).toBe(1.3);
  });

  it("clamps at a bound and responds immediately when reversing", () => {
    const session = createScrubSession({ startValue: 0.5, step: 0.01, pixelsPerStep: 1, min: 0, max: 1 });
    session.move(500);
    expect(session.value).toBe(1);
    expect(session.move(-10)).toBe(0.9);
  });
});

describe("formatNumber", () => {
  it("rounds and trims", () => {
    expect(formatNumber(1.23456)).toBe("1.235");
    expect(formatNumber(100)).toBe("100");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(0.5, 0)).toBe("1");
    expect(formatNumber(Infinity)).toBe("∞");
  });
});

describe("parseNumberInput", () => {
  it("parses plain numbers", () => {
    expect(parseNumberInput("42")).toBe(42);
    expect(parseNumberInput(" .5 ")).toBe(0.5);
    expect(parseNumberInput("-3.25")).toBe(-3.25);
    expect(parseNumberInput("1e3")).toBe(1000);
    expect(parseNumberInput("−4")).toBe(-4);
  });

  it("evaluates arithmetic with precedence", () => {
    expect(parseNumberInput("667-49-64.5")).toBe(553.5);
    expect(parseNumberInput("2*(3+4)")).toBe(14);
    expect(parseNumberInput("2 + 3 * 4")).toBe(14);
    expect(parseNumberInput("2^3")).toBe(8);
    expect(parseNumberInput("-3^2")).toBe(-9);
    expect(parseNumberInput("10%3")).toBe(1);
    expect(parseNumberInput("12×2÷4")).toBe(6);
  });

  it("strips a trailing unit", () => {
    expect(parseNumberInput("12pt")).toBe(12);
    expect(parseNumberInput("45°")).toBe(45);
    expect(parseNumberInput("50%")).toBe(50);
    expect(parseNumberInput("(2+2)px")).toBe(4);
  });

  it("rejects invalid input", () => {
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("abc")).toBeNull();
    expect(parseNumberInput("3+")).toBeNull();
    expect(parseNumberInput("(1")).toBeNull();
    expect(parseNumberInput("1/0")).toBeNull();
  });
});
